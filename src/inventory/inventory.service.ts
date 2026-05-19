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
import { ExportService, type ExportColumn } from "../export/export.service";

const toDecimal = (value: string | number) => new Prisma.Decimal(value);

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
    const [items, total] = await Promise.all([
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
    return { items, total, skip, take };
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
    const batch = movement.stockBatch;
    return {
      ...movement,
      qtyDelta: movement.qtyDelta.toString(),
      beforeOnHand: movement.beforeOnHand?.toString() ?? null,
      afterOnHand: movement.afterOnHand?.toString() ?? null,
      unitCost: movement.unitCost?.toString() ?? null,
      stockBatch: batch
        ? {
            ...batch,
            qtyReceived: batch.qtyReceived.toString(),
            qtyRemaining: batch.qtyRemaining.toString(),
            unitCost: batch.unitCost.toString(),
          }
        : null,
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

    const expiryDate = data.expiryDate ? new Date(data.expiryDate) : null;
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
