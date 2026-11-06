import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { AdjustReason, MovementType, PermissionKey, Prisma, PurchaseOrderStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { AuditService } from "../audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import { buildCreatedAtRange } from "../common/date-range.util";
import { allocateFromBatches, lockInventoryRows, productStockSnapshot, productMultiLocationAvailable } from "../common/stock.util";
import { ExportService, type ExportColumn } from "../export/export.service";
import { hasPermission, omit } from "../permissions/access";
import type { Actor } from "../permissions/permissions.service";
import { ApprovalsService } from "../approvals/approvals.service";
import { StoreSettingsService } from "../settings/store-settings.service";
import { BUSINESS_TZ, businessDateString } from "../common/business-time";
import { reconcileStock } from "./reconciliation";

const toDecimal = (value: string | number) => new Prisma.Decimal(value);

type MovementListRow = Prisma.StockMovementGetPayload<{
  include: {
    inventoryItem: { include: { product: { include: { category: true } }; location: true } };
    stockBatch: true;
    createdBy: { select: { id: true; email: true; displayName: true } };
  };
}>;

type ReservationMeta = {
  reservedQty?: string;
  availableBefore?: string;
  availableAfter?: string;
  customerName?: string | null;
};

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly exportService: ExportService,
    private readonly approvals: ApprovalsService,
    private readonly settings: StoreSettingsService,
  ) {}

  async listMovements(params: {
    productId?: string;
    type?: MovementType;
    from?: string;
    to?: string;
    take?: number;
    skip?: number;
  }, includeCost = false) {
    const take = Math.min(params.take ?? 100, 500);
    const skip = params.skip ?? 0;
    const where: Prisma.StockMovementWhereInput = {};
    if (params.productId) {
      where.inventoryItem = { productId: params.productId };
    }
    if (params.type) {
      where.type = params.type;
    }
    const createdAt = buildCreatedAtRange(params.from, params.to);
    if (createdAt) {
      where.createdAt = createdAt;
    }
    const [rows, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
        include: {
          inventoryItem: { include: { product: { include: { category: true } }, location: true } },
          stockBatch: true,
          createdBy: { select: { id: true, email: true, displayName: true } },
        },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    const items = await this.mapMovementList(rows, includeCost);
    return { items, total, skip, take };
  }

  private parseReservationMeta(metadata: Prisma.JsonValue | null): ReservationMeta | null {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return null;
    }
    const m = metadata as Record<string, unknown>;
    const asString = (value: unknown) => {
      if (typeof value === "string") return value;
      if (typeof value === "number") return String(value);
      return undefined;
    };
    return {
      reservedQty: asString(m.reservedQty),
      availableBefore: asString(m.availableBefore),
      availableAfter: asString(m.availableAfter),
      customerName:
        typeof m.customerName === "string" || m.customerName === null
          ? (m.customerName as string | null)
          : undefined,
    };
  }

  private async mapMovementList(rows: MovementListRow[], includeCost: boolean) {
    const reservationIds = [
      ...new Set(
        rows
          .filter((m) => m.refType === "RESERVATION" && m.refId)
          .map((m) => m.refId as string),
      ),
    ];
    const reservations =
      reservationIds.length > 0
        ? await this.prisma.reservation.findMany({
            where: { id: { in: reservationIds } },
            select: { id: true, quantity: true, customerName: true },
          })
        : [];
    const reservationById = new Map(reservations.map((r) => [r.id, r]));

    return rows.map((m) => {
      const batch = m.stockBatch;
      const meta = this.parseReservationMeta(m.metadata);
      const reservation =
        m.refType === "RESERVATION" && m.refId ? reservationById.get(m.refId) : undefined;
      return {
        id: m.id,
        type: m.type,
        qtyDelta: m.qtyDelta.toString(),
        beforeOnHand: m.beforeOnHand?.toString() ?? null,
        afterOnHand: m.afterOnHand?.toString() ?? null,
        reasonCode: m.reasonCode,
        createdAt: m.createdAt,
        notes: m.notes,
        refType: m.refType,
        refId: m.refId,
        inventoryItem: includeCost
          ? m.inventoryItem
          : {
              ...omit(m.inventoryItem, "averageCost"),
              product: omit(m.inventoryItem.product, "costPrice"),
            },
        stockBatch: batch
          ? {
              ...omit(batch, "unitCost"),
              qtyReceived: batch.qtyReceived.toString(),
              qtyRemaining: batch.qtyRemaining.toString(),
              ...(includeCost ? { unitCost: batch.unitCost.toString() } : {}),
            }
          : null,
        createdBy: m.createdBy,
        reservation: reservation
          ? {
              id: reservation.id,
              quantity: reservation.quantity.toString(),
              customerName: reservation.customerName,
            }
          : null,
        reservationMeta: meta,
      };
    });
  }

  async getMovement(id: string, includeCost = false) {
    const movement = await this.prisma.stockMovement.findUnique({
      where: { id },
      include: {
        inventoryItem: {
          include: {
            product: { include: { category: true, productType: true } },
            location: true,
          },
        },
        stockBatch: true,
        createdBy: { select: { id: true, email: true, displayName: true } },
      },
    });
    if (!movement) {
      throw new NotFoundException("Stock movement not found");
    }
    const [mapped] = await this.mapMovementList([movement], includeCost);
    return {
      ...mapped,
      ...(includeCost ? { unitCost: movement.unitCost?.toString() ?? null } : {}),
    };
  }

  async exportMovements(
    format: "csv" | "xlsx" | "pdf",
    params: {
      productId?: string;
      type?: MovementType;
      from?: string;
      to?: string;
    },
  ) {
    const { items } = await this.listMovements({ ...params, skip: 0, take: 5000 });
    const columns: ExportColumn[] = [
      { header: "Date", key: "date" },
      { header: "Product", key: "product" },
      { header: "Category", key: "category" },
      { header: "Type", key: "type" },
      { header: "Qty", key: "qty" },
      { header: "Before", key: "before" },
      { header: "After", key: "after" },
      { header: "Reason", key: "reason" },
      { header: "Notes", key: "notes" },
    ];
    const rows = items.map((m) => ({
      date: m.createdAt.toISOString().slice(0, 16).replace("T", " "),
      product: m.inventoryItem.product.name,
      category: m.inventoryItem.product.category.name,
      type: m.type,
      qty: m.qtyDelta.toString(),
      before: m.beforeOnHand?.toString() ?? "",
      after: m.afterOnHand?.toString() ?? "",
      reason: m.reasonCode ?? "",
      notes: m.notes ?? "",
    }));
    return this.exportService.build(format, `stock-history-${Date.now()}`, columns, rows);
  }

  async listExpiry(params: { status?: "expiring" | "expired" | "all"; days?: number }) {
    const days = params.days ?? 7;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const until = new Date(today);
    until.setDate(until.getDate() + days);
    until.setHours(23, 59, 59, 999);

    const status = params.status ?? "all";
    const batchWhere: Prisma.StockBatchWhereInput = {
      qtyRemaining: { gt: 0 },
      expiryDate: { not: null },
    };
    if (status === "expired") {
      batchWhere.expiryDate = { lt: today };
    } else if (status === "expiring") {
      batchWhere.expiryDate = { gte: today, lte: until };
    }

    const batches = await this.prisma.stockBatch.findMany({
      where: batchWhere,
      include: { product: { include: { category: true } } },
      orderBy: { expiryDate: "asc" },
      take: 500,
    });

    const defaultLoc = await this.locations.getDefault();
    const productWhere: Prisma.ProductWhereInput = {
      isActive: true,
      expiryDate: { not: null },
      inventoryItems: { some: { locationId: defaultLoc.id, quantityOnHand: { gt: 0 } } },
    };
    if (status === "expired") {
      productWhere.expiryDate = { lt: today };
    } else if (status === "expiring") {
      productWhere.expiryDate = { gte: today, lte: until };
    }

    const productsWithExpiry = await this.prisma.product.findMany({
      where: productWhere,
      include: { category: true },
      orderBy: { expiryDate: "asc" },
      take: 200,
    });

    const batchProductIds = new Set(batches.map((b) => b.productId));
    const productOnly = productsWithExpiry.filter((p) => !batchProductIds.has(p.id));

    const dayMs = 86400000;
    const mapBatch = (b: (typeof batches)[0]) => {
      const exp = b.expiryDate!;
      const daysLeft = Math.ceil((exp.getTime() - today.getTime()) / dayMs);
      return {
        id: b.id,
        source: "batch" as const,
        productId: b.product.id,
        productName: b.product.name,
        categoryName: b.product.category.name,
        qtyRemaining: b.qtyRemaining.toString(),
        expiryDate: exp.toISOString().slice(0, 10),
        daysLeft,
        status: daysLeft < 0 ? ("expired" as const) : daysLeft <= days ? ("expiring" as const) : ("ok" as const),
      };
    };

    const mapProduct = async (p: (typeof productOnly)[0]) => {
      const exp = p.expiryDate!;
      const daysLeft = Math.ceil((exp.getTime() - today.getTime()) / dayMs);
      const { available } = await productStockSnapshot(this.prisma, p.id, defaultLoc.id);
      return {
        id: `product-${p.id}`,
        source: "product" as const,
        productId: p.id,
        productName: p.name,
        categoryName: p.category.name,
        qtyRemaining: available.toString(),
        expiryDate: exp.toISOString().slice(0, 10),
        daysLeft,
        status: daysLeft < 0 ? ("expired" as const) : daysLeft <= days ? ("expiring" as const) : ("ok" as const),
      };
    };

    const batchItems = batches.map(mapBatch);
    const productItems = await Promise.all(productOnly.map(mapProduct));
    const items = [...batchItems, ...productItems].sort(
      (a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.productName.localeCompare(b.productName),
    );

    return { items, total: items.length, days };
  }

  async listBatches(
    productId: string,
    params?: { skip?: number; take?: number },
    includeCost = false,
  ) {
    if (!productId) {
      throw new BadRequestException("productId is required");
    }
    const take = Math.min(params?.take ?? 50, 200);
    const skip = params?.skip ?? 0;
    const rows = await this.prisma.stockBatch.findMany({
      where: { productId },
      orderBy: { receivedAt: "desc" },
      skip,
      take,
      include: {
        receivedBy: { select: { id: true, displayName: true, email: true } },
      },
    });
    return includeCost ? rows : rows.map((row) => omit(row, "unitCost"));
  }

  /** What a stock change returns: quantities only, never the average cost. */
  private summarize(inv: {
    id: string;
    productId: string;
    locationId: string;
    quantityOnHand: Prisma.Decimal;
    updatedAt: Date;
  }) {
    return {
      id: inv.id,
      productId: inv.productId,
      locationId: inv.locationId,
      quantityOnHand: inv.quantityOnHand.toString(),
      updatedAt: inv.updatedAt,
    };
  }

  /** Ensure an InventoryItem row exists for this product+location, creating it if missing. */
  private async ensureInventoryItem(
    tx: Prisma.TransactionClient | PrismaService,
    productId: string,
    locationId: string,
  ) {
    let inv = await tx.inventoryItem.findUnique({
      where: { productId_locationId: { productId, locationId } },
    });
    if (!inv) {
      inv = await tx.inventoryItem.create({
        data: {
          productId,
          locationId,
          quantityOnHand: new Prisma.Decimal(0),
          averageCost: new Prisma.Decimal(0),
        },
      });
    }
    return inv;
  }

  async receiveGoods(
    userId: string,
    data: {
      productId: string;
      quantity: string;
      unitCost: string;
      expiryDate?: string;
      locationId?: string;
      lotNumber?: string;
      notes?: string;
    },
  ) {
    let resolvedExpiryStr = data.expiryDate;
    if (!resolvedExpiryStr) {
      const product = await this.prisma.product.findUnique({
        where: { id: data.productId },
        select: { expiryDate: true },
      });
      if (product?.expiryDate) {
        resolvedExpiryStr = product.expiryDate.toISOString().slice(0, 10);
      }
    }
    const qty = toDecimal(data.quantity);
    if (qty.lte(0)) {
      throw new BadRequestException("Quantity must be positive");
    }
    const unitCost = toDecimal(data.unitCost);
    if (unitCost.lt(0)) {
      throw new BadRequestException("Unit cost must be non-negative");
    }

    const locationId = data.locationId || (await this.locations.getDefault()).id;
    const inv = await this.ensureInventoryItem(this.prisma, data.productId, locationId);

    const expiryDate = resolvedExpiryStr ? new Date(resolvedExpiryStr) : null;
    if (expiryDate && Number.isNaN(expiryDate.getTime())) {
      throw new BadRequestException("Invalid expiry date");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await lockInventoryRows(tx, [data.productId], locationId);
      const current = await tx.inventoryItem.findUniqueOrThrow({
        where: { id: inv.id },
      });
      const beforeOnHand = current.quantityOnHand;
      const afterOnHand = beforeOnHand.add(qty);
      const oldAvg = current.averageCost;
      let newAvg = unitCost;
      if (afterOnHand.gt(0)) {
        const numerator = beforeOnHand.mul(oldAvg).add(qty.mul(unitCost));
        newAvg = numerator.div(afterOnHand);
      }

      const batch = await tx.stockBatch.create({
        data: {
          productId: data.productId,
          locationId,
          lotNumber: data.lotNumber?.trim() || null,
          qtyReceived: qty,
          qtyRemaining: qty,
          unitCost,
          expiryDate,
          receivedByUserId: userId,
        },
      });

      await tx.stockMovement.create({
        data: {
          inventoryItemId: current.id,
          stockBatchId: batch.id,
          type: MovementType.RECEIPT,
          qtyDelta: qty,
          unitCost,
          beforeOnHand,
          afterOnHand,
          refType: "STOCK_BATCH",
          refId: batch.id,
          notes: data.notes,
          createdByUserId: userId,
          metadata: { batchId: batch.id, expiryDate: expiryDate?.toISOString(), lotNumber: data.lotNumber },
        },
      });

      return tx.inventoryItem.update({
        where: { id: current.id },
        data: { quantityOnHand: afterOnHand, averageCost: newAvg },
      });
    });

    await this.audit.log(userId, "RECEIPT", "InventoryItem", updated.id, {
      productId: data.productId,
      quantity: data.quantity,
      locationId,
    });
    await this.notifications.checkLowStockForProduct(data.productId);
    return this.summarize(updated);
  }

  /**
   * Receive multiple lines at once (scan-to-receive).
   * Returns an array of summaries, one per line.
   */
  async receiveBatch(
    userId: string,
    lines: Array<{
      productId: string;
      quantity: string;
      unitCost: string;
      expiryDate?: string;
      locationId?: string;
      lotNumber?: string;
      notes?: string;
    }>,
  ) {
    if (!lines.length) throw new BadRequestException("At least one line is required");
    const results: ReturnType<InventoryService["summarize"]>[] = [];
    for (const line of lines) {
      results.push(await this.receiveGoods(userId, line));
    }
    return results;
  }

  /**
   * Correct stock by hand. A correction worth more than the approval limit needs a manager
   * approval. Accepts optional locationId and reasonCode.
   */
  async adjustStock(
    actor: Actor,
    data: {
      productId: string;
      quantityDelta: string;
      notes?: string;
      locationId?: string;
      reasonCode?: AdjustReason;
    },
    approvalToken?: string,
  ) {
    const userId = actor.userId;
    const delta = toDecimal(data.quantityDelta);
    if (delta.eq(0)) {
      throw new BadRequestException("quantityDelta cannot be zero");
    }

    if (data.reasonCode === AdjustReason.DATA_CORRECTION && !data.notes?.trim()) {
      throw new BadRequestException("A note is required for data-correction adjustments");
    }

    const locationId = data.locationId || (await this.locations.getDefault()).id;
    const inv = await this.ensureInventoryItem(this.prisma, data.productId, locationId);

    const unitCost = inv.averageCost.gt(0)
      ? inv.averageCost
      : (
          await this.prisma.product.findUniqueOrThrow({
            where: { id: data.productId },
            select: { costPrice: true },
          })
        ).costPrice;
    const value = delta.abs().mul(unitCost);
    const threshold = await this.settings.getAdjustmentThreshold();
    const needsApproval = value.gt(threshold) && !hasPermission(actor, PermissionKey.STOCK_COUNT_APPROVE);
    if (needsApproval && !approvalToken) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "Forbidden",
        code: "APPROVAL_REQUIRED",
        action: "STOCK_ADJUST_OVER_LIMIT",
        message: `This correction is worth ${value.toFixed(2)} Birr, above the ${threshold.toFixed(2)} Birr limit. A manager must approve it with their PIN.`,
        value: value.toFixed(2),
        threshold: threshold.toFixed(2),
      });
    }

    let approvedByUserId: string | undefined;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (needsApproval && approvalToken) {
        approvedByUserId = (
          await this.approvals.consume(tx, approvalToken, "STOCK_ADJUST_OVER_LIMIT", userId)
        ).approverId;
      }
      await lockInventoryRows(tx, [data.productId], locationId);
      const current = await tx.inventoryItem.findUniqueOrThrow({
        where: { id: inv.id },
      });
      const beforeOnHand = current.quantityOnHand;
      const nextQty = beforeOnHand.add(delta);
      if (nextQty.lt(0)) {
        throw new BadRequestException("Adjustment would make quantity negative");
      }
      if (delta.lt(0)) {
        await allocateFromBatches(tx, data.productId, delta.neg(), { locationId });
      }
      await tx.stockMovement.create({
        data: {
          inventoryItemId: current.id,
          type: MovementType.ADJUSTMENT,
          qtyDelta: delta,
          beforeOnHand,
          afterOnHand: nextQty,
          reasonCode: data.reasonCode,
          refType: "MANUAL_ADJUSTMENT",
          notes: data.notes,
          createdByUserId: userId,
          metadata: approvedByUserId ? { approvedByUserId } : undefined,
        },
      });
      return tx.inventoryItem.update({
        where: { id: current.id },
        data: { quantityOnHand: nextQty },
      });
    });
    await this.audit.log(userId, "ADJUST", "InventoryItem", updated.id, {
      productId: data.productId,
      quantityDelta: data.quantityDelta,
      reasonCode: data.reasonCode,
      value: value.toFixed(2),
      ...(approvedByUserId ? { approvedByUserId } : {}),
    });
    await this.notifications.checkLowStockForProduct(data.productId);
    return this.summarize(updated);
  }

  /**
   * Write off stock (expired, damaged, etc.). Writes a WRITE_OFF movement.
   */
  async writeOff(
    userId: string,
    data: {
      productId: string;
      quantity: string;
      reasonCode: AdjustReason;
      locationId?: string;
      notes?: string;
    },
  ) {
    const qty = toDecimal(data.quantity);
    if (qty.lte(0)) throw new BadRequestException("Quantity must be positive");

    const locationId = data.locationId || (await this.locations.getDefault()).id;
    const inv = await this.ensureInventoryItem(this.prisma, data.productId, locationId);

    const updated = await this.prisma.$transaction(async (tx) => {
      await lockInventoryRows(tx, [data.productId], locationId);
      const current = await tx.inventoryItem.findUniqueOrThrow({ where: { id: inv.id } });
      const beforeOnHand = current.quantityOnHand;
      const afterOnHand = beforeOnHand.sub(qty);
      if (afterOnHand.lt(0)) {
        throw new BadRequestException("Write-off would make quantity negative");
      }
      await allocateFromBatches(tx, data.productId, qty, { locationId });
      await tx.stockMovement.create({
        data: {
          inventoryItemId: current.id,
          type: MovementType.WRITE_OFF,
          qtyDelta: qty.neg(),
          beforeOnHand,
          afterOnHand,
          reasonCode: data.reasonCode,
          refType: "WRITE_OFF",
          notes: data.notes,
          createdByUserId: userId,
        },
      });
      return tx.inventoryItem.update({
        where: { id: current.id },
        data: { quantityOnHand: afterOnHand },
      });
    });

    await this.audit.log(userId, "WRITE_OFF", "InventoryItem", updated.id, {
      productId: data.productId,
      quantity: data.quantity,
      reasonCode: data.reasonCode,
      locationId,
    });
    return this.summarize(updated);
  }

  async returnToStock(
    userId: string,
    data: { productId: string; quantity: string; notes?: string; refSaleId?: string },
  ) {
    const qty = toDecimal(data.quantity);
    if (qty.lte(0)) {
      throw new BadRequestException("Quantity must be positive");
    }
    const defaultLoc = await this.locations.getDefault();
    const inv = await this.ensureInventoryItem(this.prisma, data.productId, defaultLoc.id);

    const updated = await this.prisma.$transaction(async (tx) => {
      await lockInventoryRows(tx, [data.productId], defaultLoc.id);
      const current = await tx.inventoryItem.findUniqueOrThrow({
        where: { id: inv.id },
      });
      const beforeOnHand = current.quantityOnHand;
      const afterOnHand = beforeOnHand.add(qty);
      await tx.stockMovement.create({
        data: {
          inventoryItemId: current.id,
          type: MovementType.RETURN,
          qtyDelta: qty,
          beforeOnHand,
          afterOnHand,
          refType: data.refSaleId ? "SALE_RETURN" : "MANUAL_RETURN",
          refId: data.refSaleId,
          notes: data.notes,
          createdByUserId: userId,
        },
      });
      return tx.inventoryItem.update({
        where: { id: current.id },
        data: { quantityOnHand: afterOnHand },
      });
    });
    await this.audit.log(userId, "RETURN", "InventoryItem", updated.id, {
      productId: data.productId,
      quantity: data.quantity,
    });
    await this.notifications.checkLowStockForProduct(data.productId);
    return this.summarize(updated);
  }

  /**
   * Stock overview stats for the inventory dashboard.
   */
  async inventoryOverview(includeCost = false) {
    const sellableIds = await this.locations.listSellableLocationIds();
    const items = await this.prisma.inventoryItem.findMany({
      include: { product: { include: { category: true } }, location: true },
    });

    let stockValueAtCost = new Prisma.Decimal(0);
    let stockValueAtRetail = new Prisma.Decimal(0);
    let lowCount = 0;
    let outCount = 0;
    const skuSet = new Set<string>();

    for (const item of items) {
      skuSet.add(item.productId);
      if (item.quantityOnHand.gt(0)) {
        stockValueAtCost = stockValueAtCost.add(item.quantityOnHand.mul(item.averageCost));
        stockValueAtRetail = stockValueAtRetail.add(item.quantityOnHand.mul(item.product.sellingPrice));
      }
      if (sellableIds.includes(item.locationId)) {
        if (item.quantityOnHand.lte(0)) outCount++;
        else if (item.quantityOnHand.lte(item.product.restockAt)) lowCount++;
      }
    }

    const expiryDays = 30;
    const until = new Date();
    until.setDate(until.getDate() + expiryDays);
    const expiringBatches = await this.prisma.stockBatch.findMany({
      where: { expiryDate: { lte: until, gte: new Date() }, qtyRemaining: { gt: 0 } },
      include: { product: true },
      orderBy: { expiryDate: "asc" },
      take: 20,
    });
    let expiringValue = new Prisma.Decimal(0);
    for (const b of expiringBatches) {
      expiringValue = expiringValue.add(b.qtyRemaining.mul(b.unitCost));
    }

    const quarantine = await this.prisma.location.findFirst({
      where: { code: "QUARANTINE", isActive: true },
    });
    let quarantinedQty = new Prisma.Decimal(0);
    if (quarantine) {
      const qAgg = await this.prisma.inventoryItem.aggregate({
        where: { locationId: quarantine.id },
        _sum: { quantityOnHand: true },
      });
      quarantinedQty = qAgg._sum.quantityOnHand ?? new Prisma.Decimal(0);
    }

    return {
      skuCount: skuSet.size,
      lowStockCount: lowCount,
      outOfStockCount: outCount,
      quarantinedQty: quarantinedQty.toString(),
      ...(includeCost
        ? {
            stockValueAtCost: stockValueAtCost.toFixed(2),
            stockValueAtRetail: stockValueAtRetail.toFixed(2),
            valueAtCost: stockValueAtCost.toFixed(2),
            valueAtRetail: stockValueAtRetail.toFixed(2),
            expiringValue30d: expiringValue.toFixed(2),
          }
        : {
            stockValueAtRetail: stockValueAtRetail.toFixed(2),
            valueAtRetail: stockValueAtRetail.toFixed(2),
          }),
      expiringBatchCount: expiringBatches.length,
    };
  }

  /**
   * Stock lookup: find product by barcode, SKU, or name.
   */
  async stockLookup(query: string, includeCost = false) {
    if (!query?.trim()) throw new BadRequestException("Search query is required");
    const q = query.trim();

    // Try barcode first
    const byBarcode = await this.prisma.productBarcode.findUnique({
      where: { barcode: q },
      include: { product: true },
    });
    const product = byBarcode?.product
      ?? await this.prisma.product.findFirst({ where: { sku: q } })
      ?? await this.prisma.product.findFirst({
          where: {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { nameAm: { contains: q, mode: "insensitive" } },
            ],
          },
        });

    if (!product) throw new NotFoundException("Product not found");

    const inventoryItems = await this.prisma.inventoryItem.findMany({
      where: { productId: product.id },
      include: { location: true },
    });
    const batches = await this.prisma.stockBatch.findMany({
      where: { productId: product.id, qtyRemaining: { gt: 0 } },
      orderBy: { expiryDate: { sort: "asc", nulls: "last" } },
      take: 50,
    });

    const sellableIds = await this.locations.listSellableLocationIds();
    const { totalOnHand, reserved, available } = await productMultiLocationAvailable(
      this.prisma,
      product.id,
      sellableIds,
    );
    const incoming = await this.incomingFromOpenPos(product.id);
    const locationById = new Map(
      (
        await this.prisma.location.findMany({
          where: { id: { in: batches.map((b) => b.locationId).filter(Boolean) as string[] } },
        })
      ).map((l) => [l.id, l.code]),
    );

    return {
      product: {
        ...(includeCost ? product : omit(product, "costPrice")),
        sellingPrice: product.sellingPrice.toFixed(2),
        ...(includeCost ? { costPrice: product.costPrice.toFixed(2) } : {}),
        trackBatches: product.trackBatches,
      },
      onHand: totalOnHand.toString(),
      reserved: reserved.toString(),
      available: available.toString(),
      incoming: incoming.toString(),
      byLocation: inventoryItems.map((i) => ({
        locationId: i.locationId,
        code: i.location.code,
        name: i.location.name,
        sellable: i.location.sellable,
        quantityOnHand: i.quantityOnHand.toString(),
        ...(includeCost ? { averageCost: i.averageCost.toString() } : {}),
      })),
      batches: batches.map((b) => ({
        id: b.id,
        lotNumber: b.lotNumber,
        qtyRemaining: b.qtyRemaining.toString(),
        expiryDate: b.expiryDate?.toISOString().slice(0, 10) ?? null,
        locationCode: b.locationId ? locationById.get(b.locationId) ?? null : null,
        ...(includeCost ? { unitCost: b.unitCost.toString() } : {}),
      })),
    };
  }

  /** Remaining qty on APPROVED / SENT / PARTIALLY_RECEIVED POs (Phase 6). */
  private async incomingFromOpenPos(productId: string): Promise<Prisma.Decimal> {
    const lines = await this.prisma.purchaseOrderLine.findMany({
      where: {
        productId,
        purchaseOrder: {
          status: {
            in: [
              PurchaseOrderStatus.APPROVED,
              PurchaseOrderStatus.SENT,
              PurchaseOrderStatus.PARTIALLY_RECEIVED,
            ],
          },
        },
      },
      select: { quantityOrdered: true, quantityReceived: true },
    });
    return lines.reduce((acc, l) => {
      const remaining = l.quantityOrdered.sub(l.quantityReceived);
      return remaining.gt(0) ? acc.add(remaining) : acc;
    }, new Prisma.Decimal(0));
  }

  /**
   * Move quantity from a sellable location (default shop floor) into Quarantine.
   */
  async moveToQuarantine(
    userId: string,
    data: { productId: string; quantity: string; fromLocationId?: string; notes?: string },
  ) {
    const qty = toDecimal(data.quantity);
    if (qty.lte(0)) throw new BadRequestException("Quantity must be positive");

    const quarantine = await this.prisma.location.findFirst({
      where: { code: "QUARANTINE", isActive: true },
    });
    if (!quarantine) throw new NotFoundException("Quarantine location not configured");

    const fromId = data.fromLocationId || (await this.locations.getDefault()).id;
    if (fromId === quarantine.id) {
      throw new BadRequestException("Stock is already in quarantine");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await lockInventoryRows(tx, [data.productId], fromId);
      const fromInv = await this.ensureInventoryItem(tx, data.productId, fromId);
      const current = await tx.inventoryItem.findUniqueOrThrow({ where: { id: fromInv.id } });
      if (current.quantityOnHand.lt(qty)) {
        throw new BadRequestException("Not enough stock to quarantine");
      }
      const beforeFrom = current.quantityOnHand;
      const afterFrom = beforeFrom.sub(qty);
      await allocateFromBatches(tx, data.productId, qty, { locationId: fromId, allowExpired: true });
      await tx.stockMovement.create({
        data: {
          inventoryItemId: current.id,
          type: MovementType.TRANSFER,
          qtyDelta: qty.neg(),
          beforeOnHand: beforeFrom,
          afterOnHand: afterFrom,
          reasonCode: AdjustReason.EXPIRED,
          refType: "QUARANTINE",
          notes: data.notes ?? "Moved to quarantine",
          createdByUserId: userId,
        },
      });
      await tx.inventoryItem.update({
        where: { id: current.id },
        data: { quantityOnHand: afterFrom },
      });

      let toInv = await tx.inventoryItem.findUnique({
        where: {
          productId_locationId: { productId: data.productId, locationId: quarantine.id },
        },
      });
      if (!toInv) {
        toInv = await tx.inventoryItem.create({
          data: {
            productId: data.productId,
            locationId: quarantine.id,
            quantityOnHand: new Prisma.Decimal(0),
            averageCost: current.averageCost,
          },
        });
      }
      await lockInventoryRows(tx, [data.productId], quarantine.id);
      const toCurrent = await tx.inventoryItem.findUniqueOrThrow({ where: { id: toInv.id } });
      const beforeTo = toCurrent.quantityOnHand;
      const afterTo = beforeTo.add(qty);
      await tx.stockBatch.create({
        data: {
          productId: data.productId,
          locationId: quarantine.id,
          qtyReceived: qty,
          qtyRemaining: qty,
          unitCost: current.averageCost,
          receivedByUserId: userId,
        },
      });
      await tx.stockMovement.create({
        data: {
          inventoryItemId: toCurrent.id,
          type: MovementType.TRANSFER,
          qtyDelta: qty,
          beforeOnHand: beforeTo,
          afterOnHand: afterTo,
          refType: "QUARANTINE",
          notes: data.notes ?? "Received in quarantine",
          createdByUserId: userId,
        },
      });
      return tx.inventoryItem.update({
        where: { id: toCurrent.id },
        data: { quantityOnHand: afterTo },
      });
    });

    await this.audit.log(userId, "QUARANTINE", "InventoryItem", updated.id, {
      productId: data.productId,
      quantity: data.quantity,
      fromLocationId: fromId,
      toLocationId: quarantine.id,
    });
    return this.summarize(updated);
  }

  /**
   * Suggest bringing stock from Back store to Shop floor when floor is below reorder point.
   */
  async replenishmentSuggestions() {
    const floor = await this.locations.getDefault();
    const back = await this.prisma.location.findFirst({
      where: { code: "BACK_STORE", isActive: true },
    });
    if (!back) return { items: [] as const };

    const products = await this.prisma.product.findMany({
      where: { isActive: true, archivedAt: null },
      select: {
        id: true,
        name: true,
        sku: true,
        restockAt: true,
        restockQty: true,
        minStock: true,
        maxStock: true,
        inventoryItems: {
          where: { locationId: { in: [floor.id, back.id] } },
          select: { locationId: true, quantityOnHand: true },
        },
      },
      take: 500,
    });

    const items = [];
    for (const p of products) {
      const floorQty =
        p.inventoryItems.find((i) => i.locationId === floor.id)?.quantityOnHand ??
        new Prisma.Decimal(0);
      const backQty =
        p.inventoryItems.find((i) => i.locationId === back.id)?.quantityOnHand ??
        new Prisma.Decimal(0);
      if (backQty.lte(0)) continue;
      const threshold = Math.max(p.restockAt, p.minStock);
      if (floorQty.gt(threshold)) continue;
      const target = p.maxStock > 0 ? p.maxStock : p.restockQty > 0 ? p.restockQty : threshold;
      const need = new Prisma.Decimal(Math.max(target, threshold)).sub(floorQty);
      if (need.lte(0)) continue;
      const suggested = Prisma.Decimal.min(need, backQty);
      if (suggested.lte(0)) continue;
      items.push({
        productId: p.id,
        productName: p.name,
        sku: p.sku,
        floorOnHand: floorQty.toString(),
        backOnHand: backQty.toString(),
        threshold,
        suggestedQty: suggested.toString(),
        fromLocationId: back.id,
        toLocationId: floor.id,
      });
    }

    return { items };
  }

  /**
   * Nightly: write InventorySnapshot rows and log ledger drift (read-only reconcile).
   */
  @Cron("5 0 * * *", { timeZone: BUSINESS_TZ })
  async nightlySnapshotAndReconcile() {
    const date = businessDateString();
    this.logger.log(`Nightly inventory snapshot for ${date}`);
    try {
      await this.takeDailySnapshot(date);
      const result = await reconcileStock(this.prisma as never);
      if (result.findings.length) {
        this.logger.warn(
          `Stock ledger drift on ${result.findings.length} row(s); run npm run reconcile for detail`,
        );
        await this.audit.log(undefined, "RECONCILE_DRIFT", "InventorySnapshot", undefined, {
          date,
          driftCount: result.findings.length,
        });
      }
    } catch (e) {
      this.logger.error("Nightly snapshot failed", e instanceof Error ? e.stack : e);
    }
  }

  async takeDailySnapshot(date = businessDateString()) {
    const rows = await this.prisma.inventoryItem.findMany({
      where: { quantityOnHand: { gt: 0 } },
      include: { product: { select: { sellingPrice: true } } },
    });
    let written = 0;
    for (const row of rows) {
      const qty = row.quantityOnHand;
      const valueAtCost = qty.mul(row.averageCost);
      const valueAtRetail = qty.mul(row.product.sellingPrice);
      await this.prisma.inventorySnapshot.upsert({
        where: {
          date_productId_locationId: {
            date,
            productId: row.productId,
            locationId: row.locationId,
          },
        },
        create: {
          date,
          productId: row.productId,
          locationId: row.locationId,
          quantity: qty,
          valueAtCost,
          valueAtRetail,
        },
        update: {
          quantity: qty,
          valueAtCost,
          valueAtRetail,
        },
      });
      written += 1;
    }
    return { date, written };
  }
}
