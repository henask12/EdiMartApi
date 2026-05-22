import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MovementType, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { AuditService } from "../audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import { buildCreatedAtRange } from "../common/date-range.util";
import { productStockSnapshot } from "../common/stock.util";
import { ExportService, type ExportColumn } from "../export/export.service";

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly exportService: ExportService,
  ) {}

  async listMovements(params: {
    productId?: string;
    type?: MovementType;
    from?: string;
    to?: string;
    take?: number;
    skip?: number;
  }) {
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
    const items = await this.mapMovementList(rows);
    return { items, total, skip, take };
  }

  private parseReservationMeta(metadata: Prisma.JsonValue | null): ReservationMeta | null {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return null;
    }
    const m = metadata as Record<string, unknown>;
    return {
      reservedQty: typeof m.reservedQty === "string" ? m.reservedQty : undefined,
      availableBefore: typeof m.availableBefore === "string" ? m.availableBefore : undefined,
      availableAfter: typeof m.availableAfter === "string" ? m.availableAfter : undefined,
      customerName:
        typeof m.customerName === "string" || m.customerName === null
          ? (m.customerName as string | null)
          : undefined,
    };
  }

  private async mapMovementList(rows: MovementListRow[]) {
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
        createdAt: m.createdAt,
        notes: m.notes,
        refType: m.refType,
        refId: m.refId,
        inventoryItem: m.inventoryItem,
        stockBatch: batch
          ? {
              ...batch,
              qtyReceived: batch.qtyReceived.toString(),
              qtyRemaining: batch.qtyRemaining.toString(),
              unitCost: batch.unitCost.toString(),
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

  async getMovement(id: string) {
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
    const [mapped] = await this.mapMovementList([movement]);
    return {
      ...mapped,
      unitCost: movement.unitCost?.toString() ?? null,
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

  listBatches(productId: string, params?: { skip?: number; take?: number }) {
    if (!productId) {
      throw new BadRequestException("productId is required");
    }
    const take = Math.min(params?.take ?? 50, 200);
    const skip = params?.skip ?? 0;
    return this.prisma.stockBatch.findMany({
      where: { productId },
      orderBy: { receivedAt: "desc" },
      skip,
      take,
      include: {
        receivedBy: { select: { id: true, displayName: true, email: true } },
      },
    });
  }

  async receiveGoods(
    userId: string,
    data: {
      productId: string;
      quantity: string;
      unitCost: string;
      expiryDate?: string;
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
    const defaultLoc = await this.locations.getDefault();
    const inv = await this.prisma.inventoryItem.findUnique({
      where: {
        productId_locationId: {
          productId: data.productId,
          locationId: defaultLoc.id,
        },
      },
    });
    if (!inv) {
      throw new NotFoundException("Inventory row not found for product");
    }

    const expiryDate = resolvedExpiryStr ? new Date(resolvedExpiryStr) : null;
    if (expiryDate && Number.isNaN(expiryDate.getTime())) {
      throw new BadRequestException("Invalid expiry date");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
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
          metadata: { batchId: batch.id, expiryDate: expiryDate?.toISOString() },
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
    });
    await this.notifications.checkLowStockForProduct(data.productId);
    return updated;
  }

  async adjustStock(
    userId: string,
    data: { productId: string; quantityDelta: string; notes?: string },
  ) {
    const delta = toDecimal(data.quantityDelta);
    if (delta.eq(0)) {
      throw new BadRequestException("quantityDelta cannot be zero");
    }
    const defaultLoc = await this.locations.getDefault();
    const inv = await this.prisma.inventoryItem.findUnique({
      where: {
        productId_locationId: {
          productId: data.productId,
          locationId: defaultLoc.id,
        },
      },
    });
    if (!inv) {
      throw new NotFoundException("Inventory row not found for product");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.inventoryItem.findUniqueOrThrow({
        where: { id: inv.id },
      });
      const beforeOnHand = current.quantityOnHand;
      const nextQty = beforeOnHand.add(delta);
      if (nextQty.lt(0)) {
        throw new BadRequestException("Adjustment would make quantity negative");
      }
      await tx.stockMovement.create({
        data: {
          inventoryItemId: current.id,
          type: MovementType.ADJUSTMENT,
          qtyDelta: delta,
          beforeOnHand,
          afterOnHand: nextQty,
          refType: "MANUAL_ADJUSTMENT",
          notes: data.notes,
          createdByUserId: userId,
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
    });
    await this.notifications.checkLowStockForProduct(data.productId);
    return updated;
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
    const inv = await this.prisma.inventoryItem.findUnique({
      where: {
        productId_locationId: {
          productId: data.productId,
          locationId: defaultLoc.id,
        },
      },
    });
    if (!inv) {
      throw new NotFoundException("Inventory row not found for product");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
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
    return updated;
  }
}
