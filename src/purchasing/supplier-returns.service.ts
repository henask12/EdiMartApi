import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MovementType, Prisma, SupplierReturnStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { allocateFromBatches, lockInventoryRows } from "../common/stock.util";
import { money2, nextDocumentNumber, qty4, toDecimal } from "./document-numbers";

type ReturnLineInput = {
  productId: string;
  quantity: string;
  unitCost?: string;
  locationId: string;
  stockBatchId?: string;
};

const RET_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  lines: {
    include: {
      product: { select: { id: true, name: true, sku: true } },
      location: { select: { id: true, code: true, name: true } },
    },
  },
  createdBy: { select: { id: true, displayName: true, email: true } },
} as const;

type RetLoaded = Prisma.SupplierReturnGetPayload<{ include: typeof RET_INCLUDE }>;

@Injectable()
export class SupplierReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(params: {
    supplierId?: string;
    status?: SupplierReturnStatus;
    skip?: number;
    take?: number;
  }, includeCost: boolean) {
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    const where: Prisma.SupplierReturnWhereInput = {};
    if (params.supplierId) where.supplierId = params.supplierId;
    if (params.status) where.status = params.status;
    const [items, total] = await Promise.all([
      this.prisma.supplierReturn.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: RET_INCLUDE,
      }),
      this.prisma.supplierReturn.count({ where }),
    ]);
    return { items: items.map((r) => this.mapRet(r, includeCost)), total, skip, take };
  }

  async get(id: string, includeCost: boolean) {
    const row = await this.prisma.supplierReturn.findUnique({
      where: { id },
      include: RET_INCLUDE,
    });
    if (!row) throw new NotFoundException("Supplier return not found");
    return this.mapRet(row, includeCost);
  }

  async create(
    userId: string,
    data: {
      supplierId: string;
      reason?: string;
      notes?: string;
      lines: ReturnLineInput[];
    },
    includeCost: boolean,
  ) {
    if (!data.lines?.length) throw new BadRequestException("At least one line is required");
    const supplier = await this.prisma.supplier.findUnique({ where: { id: data.supplierId } });
    if (!supplier) throw new NotFoundException("Supplier not found");

    const prepared: Array<{
      productId: string;
      quantity: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      locationId: string;
      stockBatchId: string | null;
    }> = [];

    for (const line of data.lines) {
      const qty = toDecimal(line.quantity);
      if (qty.lte(0)) throw new BadRequestException("Quantity must be positive");
      const loc = await this.prisma.location.findUnique({ where: { id: line.locationId } });
      if (!loc) throw new BadRequestException(`Unknown location ${line.locationId}`);
      const product = await this.prisma.product.findUnique({ where: { id: line.productId } });
      if (!product) throw new BadRequestException(`Unknown product ${line.productId}`);
      const inv = await this.prisma.inventoryItem.findUnique({
        where: { productId_locationId: { productId: line.productId, locationId: line.locationId } },
      });
      const unitCost = line.unitCost
        ? toDecimal(line.unitCost)
        : inv?.averageCost?.gt(0)
          ? inv.averageCost
          : product.costPrice;
      prepared.push({
        productId: line.productId,
        quantity: qty,
        unitCost,
        locationId: line.locationId,
        stockBatchId: line.stockBatchId ?? null,
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const returnNumber = await nextDocumentNumber(tx, "SRET", "SRET");
      return tx.supplierReturn.create({
        data: {
          returnNumber,
          supplierId: data.supplierId,
          status: SupplierReturnStatus.DRAFT,
          reason: data.reason?.trim() || null,
          notes: data.notes?.trim() || null,
          createdByUserId: userId,
          lines: {
            create: prepared.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              unitCost: l.unitCost,
              locationId: l.locationId,
              stockBatchId: l.stockBatchId,
            })),
          },
        },
        include: RET_INCLUDE,
      });
    });

    await this.audit.log(userId, "SUPPLIER_RETURN_CREATE", "SupplierReturn", created.id, {
      returnNumber: created.returnNumber,
    });
    return this.mapRet(created, includeCost);
  }

  async complete(userId: string, id: string, includeCost: boolean) {
    const existing = await this.prisma.supplierReturn.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!existing) throw new NotFoundException("Supplier return not found");
    if (
      existing.status !== SupplierReturnStatus.DRAFT &&
      existing.status !== SupplierReturnStatus.SENT
    ) {
      throw new BadRequestException(`Cannot complete a return in status ${existing.status}`);
    }
    if (!existing.lines.length) throw new BadRequestException("Return has no lines");

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const line of existing.lines) {
        let inv = await tx.inventoryItem.findUnique({
          where: {
            productId_locationId: { productId: line.productId, locationId: line.locationId },
          },
        });
        if (!inv) {
          inv = await tx.inventoryItem.create({
            data: {
              productId: line.productId,
              locationId: line.locationId,
              quantityOnHand: new Prisma.Decimal(0),
              averageCost: new Prisma.Decimal(0),
            },
          });
        }
        await lockInventoryRows(tx, [line.productId], line.locationId);
        const current = await tx.inventoryItem.findUniqueOrThrow({ where: { id: inv.id } });
        const beforeOnHand = current.quantityOnHand;
        const afterOnHand = beforeOnHand.sub(line.quantity);
        if (afterOnHand.lt(0)) {
          throw new BadRequestException(
            `Not enough stock for product ${line.productId} at location ${line.locationId}`,
          );
        }

        if (line.stockBatchId) {
          const batch = await tx.stockBatch.findUnique({ where: { id: line.stockBatchId } });
          if (!batch || batch.productId !== line.productId) {
            throw new BadRequestException(`Invalid stockBatchId ${line.stockBatchId}`);
          }
          if (batch.qtyRemaining.lt(line.quantity)) {
            throw new BadRequestException("Batch does not have enough remaining quantity");
          }
          await tx.stockBatch.update({
            where: { id: batch.id },
            data: { qtyRemaining: batch.qtyRemaining.sub(line.quantity) },
          });
        } else {
          await allocateFromBatches(tx, line.productId, line.quantity, {
            locationId: line.locationId,
            allowExpired: true,
          });
        }

        await tx.stockMovement.create({
          data: {
            inventoryItemId: current.id,
            stockBatchId: line.stockBatchId,
            type: MovementType.SUPPLIER_RETURN,
            qtyDelta: line.quantity.neg(),
            unitCost: line.unitCost,
            beforeOnHand,
            afterOnHand,
            refType: "SUPPLIER_RETURN",
            refId: id,
            notes: existing.reason ?? existing.notes,
            createdByUserId: userId,
          },
        });

        await tx.inventoryItem.update({
          where: { id: current.id },
          data: { quantityOnHand: afterOnHand },
        });
      }

      return tx.supplierReturn.update({
        where: { id },
        data: { status: SupplierReturnStatus.COMPLETED },
        include: RET_INCLUDE,
      });
    });

    await this.audit.log(userId, "SUPPLIER_RETURN_COMPLETE", "SupplierReturn", id, {
      returnNumber: existing.returnNumber,
    });
    return this.mapRet(updated, includeCost);
  }

  async cancel(userId: string, id: string, includeCost: boolean) {
    const existing = await this.prisma.supplierReturn.findUnique({
      where: { id },
      include: RET_INCLUDE,
    });
    if (!existing) throw new NotFoundException("Supplier return not found");
    if (existing.status === SupplierReturnStatus.COMPLETED) {
      throw new BadRequestException("Cannot cancel a completed return");
    }
    if (existing.status === SupplierReturnStatus.CANCELLED) {
      return this.mapRet(existing, includeCost);
    }
    const updated = await this.prisma.supplierReturn.update({
      where: { id },
      data: { status: SupplierReturnStatus.CANCELLED },
      include: RET_INCLUDE,
    });
    await this.audit.log(userId, "SUPPLIER_RETURN_CANCEL", "SupplierReturn", id, {});
    return this.mapRet(updated, includeCost);
  }

  private mapRet(r: RetLoaded, includeCost: boolean) {
    return {
      id: r.id,
      returnNumber: r.returnNumber,
      supplierId: r.supplierId,
      supplier: r.supplier,
      status: r.status,
      reason: r.reason,
      notes: r.notes,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      lines: r.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        product: l.product,
        quantity: qty4(l.quantity),
        locationId: l.locationId,
        location: l.location,
        stockBatchId: l.stockBatchId,
        ...(includeCost ? { unitCost: money2(l.unitCost) } : {}),
      })),
    };
  }
}
