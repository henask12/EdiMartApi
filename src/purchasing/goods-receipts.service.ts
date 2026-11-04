import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MovementType, Prisma, PurchaseOrderStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import { lockInventoryRows } from "../common/stock.util";
import { money2, nextDocumentNumber, qty4, toDecimal } from "./document-numbers";

type ReceiptLineInput = {
  purchaseOrderLineId?: string;
  productId: string;
  quantity: string;
  unitCost: string;
  locationId: string;
  expiryDate?: string;
  lotNumber?: string;
};

const RECEIVABLE: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.APPROVED,
  PurchaseOrderStatus.SENT,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
];

const GR_INCLUDE = {
  lines: {
    include: {
      product: { select: { id: true, name: true, sku: true } },
      location: { select: { id: true, code: true, name: true } },
    },
  },
  landedCosts: true,
  purchaseOrder: { select: { id: true, poNumber: true, status: true } },
  createdBy: { select: { id: true, displayName: true, email: true } },
} as const;

type GrLoaded = Prisma.GoodsReceiptGetPayload<{ include: typeof GR_INCLUDE }>;

@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(params: { purchaseOrderId?: string; skip?: number; take?: number }, includeCost: boolean) {
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    const where: Prisma.GoodsReceiptWhereInput = {};
    if (params.purchaseOrderId) where.purchaseOrderId = params.purchaseOrderId;
    const [items, total] = await Promise.all([
      this.prisma.goodsReceipt.findMany({
        where,
        orderBy: { receivedAt: "desc" },
        skip,
        take,
        include: GR_INCLUDE,
      }),
      this.prisma.goodsReceipt.count({ where }),
    ]);
    return { items: items.map((g) => this.mapGr(g, includeCost)), total, skip, take };
  }

  async get(id: string, includeCost: boolean) {
    const gr = await this.prisma.goodsReceipt.findUnique({
      where: { id },
      include: GR_INCLUDE,
    });
    if (!gr) throw new NotFoundException("Goods receipt not found");
    return this.mapGr(gr, includeCost);
  }

  /**
   * Receive against a PO: create StockBatch + RECEIPT movement + WAC update per line
   * (same math as inventory.receiveGoods), then bump PO line received qty / status.
   */
  async create(
    userId: string,
    data: { purchaseOrderId: string; notes?: string; lines: ReceiptLineInput[] },
    includeCost: boolean,
  ) {
    if (!data.lines?.length) throw new BadRequestException("At least one line is required");

    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: data.purchaseOrderId },
      include: { lines: true, supplier: true },
    });
    if (!po) throw new NotFoundException("Purchase order not found");
    if (!RECEIVABLE.includes(po.status)) {
      throw new BadRequestException(`Cannot receive against a PO in status ${po.status}`);
    }

    const poLineById = new Map(po.lines.map((l) => [l.id, l]));
    const prepared = data.lines.map((line) => {
      const qty = toDecimal(line.quantity);
      const unitCost = toDecimal(line.unitCost);
      if (qty.lte(0)) throw new BadRequestException("Quantity must be positive");
      if (unitCost.lt(0)) throw new BadRequestException("Unit cost must be non-negative");
      if (!line.locationId) throw new BadRequestException("locationId is required");
      let purchaseOrderLineId = line.purchaseOrderLineId ?? null;
      let productId = line.productId;
      if (purchaseOrderLineId) {
        const pol = poLineById.get(purchaseOrderLineId);
        if (!pol || pol.purchaseOrderId !== po.id) {
          throw new BadRequestException(`PO line ${purchaseOrderLineId} does not belong to this PO`);
        }
        productId = pol.productId;
      } else {
        const match = po.lines.find((l) => l.productId === productId);
        if (match) purchaseOrderLineId = match.id;
      }
      const expiryDate = line.expiryDate ? new Date(line.expiryDate) : null;
      if (expiryDate && Number.isNaN(expiryDate.getTime())) {
        throw new BadRequestException("Invalid expiry date");
      }
      return {
        purchaseOrderLineId,
        productId,
        qty,
        unitCost,
        locationId: line.locationId,
        expiryDate,
        lotNumber: line.lotNumber?.trim() || null,
      };
    });

    for (const line of prepared) {
      const loc = await this.prisma.location.findUnique({ where: { id: line.locationId } });
      if (!loc) throw new BadRequestException(`Unknown location ${line.locationId}`);
      const product = await this.prisma.product.findUnique({ where: { id: line.productId } });
      if (!product) throw new BadRequestException(`Unknown product ${line.productId}`);
    }

    const receipt = await this.prisma.$transaction(async (tx) => {
      const receiptNumber = await nextDocumentNumber(tx, "GR", "GR");
      const gr = await tx.goodsReceipt.create({
        data: {
          receiptNumber,
          purchaseOrderId: po.id,
          supplierId: po.supplierId,
          notes: data.notes?.trim() || null,
          createdByUserId: userId,
        },
      });

      for (const line of prepared) {
        const inv = await this.ensureInventoryItem(tx, line.productId, line.locationId);
        await lockInventoryRows(tx, [line.productId], line.locationId);
        const current = await tx.inventoryItem.findUniqueOrThrow({ where: { id: inv.id } });
        const beforeOnHand = current.quantityOnHand;
        const afterOnHand = beforeOnHand.add(line.qty);
        const oldAvg = current.averageCost;
        let newAvg = line.unitCost;
        if (afterOnHand.gt(0)) {
          newAvg = beforeOnHand.mul(oldAvg).add(line.qty.mul(line.unitCost)).div(afterOnHand);
        }

        const batch = await tx.stockBatch.create({
          data: {
            productId: line.productId,
            locationId: line.locationId,
            lotNumber: line.lotNumber,
            qtyReceived: line.qty,
            qtyRemaining: line.qty,
            unitCost: line.unitCost,
            expiryDate: line.expiryDate,
            receivedByUserId: userId,
          },
        });

        await tx.stockMovement.create({
          data: {
            inventoryItemId: current.id,
            stockBatchId: batch.id,
            type: MovementType.RECEIPT,
            qtyDelta: line.qty,
            unitCost: line.unitCost,
            beforeOnHand,
            afterOnHand,
            refType: "GOODS_RECEIPT",
            refId: gr.id,
            notes: data.notes,
            createdByUserId: userId,
            metadata: {
              goodsReceiptId: gr.id,
              purchaseOrderId: po.id,
              batchId: batch.id,
              lotNumber: line.lotNumber,
            },
          },
        });

        await tx.inventoryItem.update({
          where: { id: current.id },
          data: { quantityOnHand: afterOnHand, averageCost: newAvg },
        });

        await tx.goodsReceiptLine.create({
          data: {
            goodsReceiptId: gr.id,
            productId: line.productId,
            purchaseOrderLineId: line.purchaseOrderLineId,
            quantity: line.qty,
            unitCost: line.unitCost,
            locationId: line.locationId,
            stockBatchId: batch.id,
            expiryDate: line.expiryDate,
            lotNumber: line.lotNumber,
          },
        });

        if (line.purchaseOrderLineId) {
          const pol = poLineById.get(line.purchaseOrderLineId)!;
          await tx.purchaseOrderLine.update({
            where: { id: line.purchaseOrderLineId },
            data: { quantityReceived: pol.quantityReceived.add(line.qty) },
          });
          // Keep local map in sync for multi-line same PO line
          pol.quantityReceived = pol.quantityReceived.add(line.qty);
        }

        // Prefer updating supplier lastCost when linked
        await tx.supplierProduct.updateMany({
          where: { supplierId: po.supplierId, productId: line.productId },
          data: { lastCost: line.unitCost },
        });
      }

      const refreshedLines = await tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId: po.id },
      });
      const allReceived = refreshedLines.every((l) => l.quantityReceived.gte(l.quantityOrdered));
      const anyReceived = refreshedLines.some((l) => l.quantityReceived.gt(0));
      let nextStatus = po.status;
      if (allReceived) nextStatus = PurchaseOrderStatus.RECEIVED;
      else if (anyReceived) nextStatus = PurchaseOrderStatus.PARTIALLY_RECEIVED;

      if (nextStatus !== po.status) {
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: nextStatus },
        });
      }

      return tx.goodsReceipt.findUniqueOrThrow({
        where: { id: gr.id },
        include: GR_INCLUDE,
      });
    });

    await this.audit.log(userId, "GOODS_RECEIPT", "GoodsReceipt", receipt.id, {
      receiptNumber: receipt.receiptNumber,
      purchaseOrderId: po.id,
      lineCount: prepared.length,
    });

    for (const line of prepared) {
      await this.notifications.checkLowStockForProduct(line.productId);
    }

    return this.mapGr(receipt, includeCost);
  }

  /**
   * Landed-cost approach:
   * 1. Allocate charge across GR lines by VALUE (qty*unitCost) or QUANTITY.
   * 2. Set each line's landedUnitCost = unitCost + allocated/qty.
   * 3. Update StockBatch.unitCost to landedUnitCost.
   * 4. Incremental WAC: avg' = avg + (qty * (landed - priorUnit)) / onHand
   *    where priorUnit is the previous landedUnitCost (or unitCost if first apply).
   *    This preserves WAC when stock has already moved since receipt.
   */
  async addLandedCost(
    userId: string,
    goodsReceiptId: string,
    data: { kind: string; description?: string; amount: string; allocateBy?: "VALUE" | "QUANTITY" },
    includeCost: boolean,
  ) {
    const amount = toDecimal(data.amount);
    if (amount.lte(0)) throw new BadRequestException("Amount must be positive");
    const allocateBy = data.allocateBy === "QUANTITY" ? "QUANTITY" : "VALUE";
    const kind = data.kind?.trim().toUpperCase();
    if (!kind) throw new BadRequestException("kind is required");

    const gr = await this.prisma.goodsReceipt.findUnique({
      where: { id: goodsReceiptId },
      include: { lines: true },
    });
    if (!gr) throw new NotFoundException("Goods receipt not found");
    if (!gr.lines.length) throw new BadRequestException("Receipt has no lines");

    const updated = await this.prisma.$transaction(async (tx) => {
      const landed = await tx.landedCost.create({
        data: {
          goodsReceiptId,
          kind,
          description: data.description?.trim() || null,
          amount,
          allocateBy,
        },
      });

      const weights = gr.lines.map((l) => {
        const w =
          allocateBy === "QUANTITY"
            ? l.quantity
            : l.quantity.mul(l.landedUnitCost ?? l.unitCost);
        return { line: l, weight: w };
      });
      const totalWeight = weights.reduce((a, w) => a.add(w.weight), new Prisma.Decimal(0));
      if (totalWeight.lte(0)) throw new BadRequestException("Cannot allocate: total weight is zero");

      for (const { line, weight } of weights) {
        const share = amount.mul(weight).div(totalWeight);
        const perUnit = share.div(line.quantity);
        const priorUnit = line.landedUnitCost ?? line.unitCost;
        const newLanded = priorUnit.add(perUnit);

        await tx.goodsReceiptLine.update({
          where: { id: line.id },
          data: { landedUnitCost: newLanded },
        });

        if (line.stockBatchId) {
          await tx.stockBatch.update({
            where: { id: line.stockBatchId },
            data: { unitCost: newLanded },
          });
        }

        const inv = await tx.inventoryItem.findUnique({
          where: {
            productId_locationId: { productId: line.productId, locationId: line.locationId },
          },
        });
        if (inv && inv.quantityOnHand.gt(0)) {
          const delta = line.quantity.mul(newLanded.sub(priorUnit));
          const newAvg = inv.averageCost.add(delta.div(inv.quantityOnHand));
          await tx.inventoryItem.update({
            where: { id: inv.id },
            data: { averageCost: newAvg.lt(0) ? new Prisma.Decimal(0) : newAvg },
          });
        }
      }

      return { landedId: landed.id, gr: await tx.goodsReceipt.findUniqueOrThrow({
        where: { id: goodsReceiptId },
        include: GR_INCLUDE,
      }) };
    });

    await this.audit.log(userId, "LANDED_COST", "LandedCost", updated.landedId, {
      goodsReceiptId,
      kind,
      amount: money2(amount),
      allocateBy,
    });

    return this.mapGr(updated.gr, includeCost);
  }

  private async ensureInventoryItem(
    tx: Prisma.TransactionClient,
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

  private mapGr(gr: GrLoaded, includeCost: boolean) {
    return {
      id: gr.id,
      receiptNumber: gr.receiptNumber,
      purchaseOrderId: gr.purchaseOrderId,
      purchaseOrder: gr.purchaseOrder,
      supplierId: gr.supplierId,
      notes: gr.notes,
      receivedAt: gr.receivedAt,
      createdAt: gr.createdAt,
      createdBy: gr.createdBy,
      landedCosts: gr.landedCosts.map((c) => ({
        id: c.id,
        kind: c.kind,
        description: c.description,
        amount: money2(c.amount),
        allocateBy: c.allocateBy,
        createdAt: c.createdAt,
      })),
      lines: gr.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        product: l.product,
        purchaseOrderLineId: l.purchaseOrderLineId,
        quantity: qty4(l.quantity),
        locationId: l.locationId,
        location: l.location,
        stockBatchId: l.stockBatchId,
        expiryDate: l.expiryDate?.toISOString().slice(0, 10) ?? null,
        lotNumber: l.lotNumber,
        ...(includeCost
          ? {
              unitCost: money2(l.unitCost),
              landedUnitCost: l.landedUnitCost ? money2(l.landedUnitCost) : null,
            }
          : {}),
      })),
    };
  }
}
