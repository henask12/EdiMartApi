import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MovementType, Prisma, TransferStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { LocationsService } from "../locations/locations.service";
import { allocateFromBatches, lockInventoryRows } from "../common/stock.util";
import { businessDateString } from "../common/business-time";

const toDecimal = (v: string | number) => new Prisma.Decimal(v);

const TRANSFER_SCOPE = "TRANSFER";

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly locations: LocationsService,
  ) {}

  private async nextTransferNumber(tx: Prisma.TransactionClient): Promise<string> {
    const date = businessDateString();
    const rows = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO "DocumentCounter" ("scope", "date", "value") VALUES (${TRANSFER_SCOPE}, ${date}, 1)
      ON CONFLICT ("scope", "date") DO UPDATE SET "value" = "DocumentCounter"."value" + 1
      RETURNING "value"`;
    return `TRF-${date.replace(/-/g, "")}-${String(rows[0].value).padStart(4, "0")}`;
  }

  private transferInclude = {
    lines: { include: { product: { select: { id: true, name: true, sku: true } } } },
    fromLocation: true,
    toLocation: true,
    createdBy: { select: { id: true, displayName: true, email: true } },
    receivedBy: { select: { id: true, displayName: true, email: true } },
  } as const;

  async listTransfers(params: { status?: TransferStatus; skip?: number; take?: number }) {
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    const where: Prisma.StockTransferWhereInput = {};
    if (params.status) where.status = params.status;
    const [items, total] = await Promise.all([
      this.prisma.stockTransfer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
        include: this.transferInclude,
      }),
      this.prisma.stockTransfer.count({ where }),
    ]);
    return { items, total, skip, take };
  }

  async getTransfer(id: string) {
    const t = await this.prisma.stockTransfer.findUnique({
      where: { id },
      include: this.transferInclude,
    });
    if (!t) throw new NotFoundException("Transfer not found");
    return t;
  }

  /**
   * Create a draft transfer.
   */
  async createDraft(
    userId: string,
    data: {
      fromLocationId: string;
      toLocationId: string;
      notes?: string;
      lines: Array<{ productId: string; quantity: string }>;
    },
  ) {
    if (data.fromLocationId === data.toLocationId) {
      throw new BadRequestException("From and to locations must be different");
    }
    if (!data.lines.length) throw new BadRequestException("At least one line is required");

    // Validate locations exist
    await this.locations.getLocation(data.fromLocationId);
    await this.locations.getLocation(data.toLocationId);

    const transfer = await this.prisma.$transaction(async (tx) => {
      const transferNumber = await this.nextTransferNumber(tx);
      return tx.stockTransfer.create({
        data: {
          transferNumber,
          status: TransferStatus.DRAFT,
          fromLocationId: data.fromLocationId,
          toLocationId: data.toLocationId,
          notes: data.notes?.trim() || null,
          createdByUserId: userId,
          lines: {
            create: data.lines.map((l) => ({
              productId: l.productId,
              quantity: toDecimal(l.quantity),
            })),
          },
        },
        include: this.transferInclude,
      });
    });

    await this.audit.log(userId, "CREATE", "StockTransfer", transfer.id, {
      transferNumber: transfer.transferNumber,
    });
    return transfer;
  }

  /**
   * Send a draft transfer: deduct stock from the source location.
   */
  async sendTransfer(userId: string, id: string) {
    const transfer = await this.prisma.stockTransfer.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!transfer) throw new NotFoundException("Transfer not found");
    if (transfer.status !== TransferStatus.DRAFT) {
      throw new BadRequestException("Only draft transfers can be sent");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const productIds = transfer.lines.map((l) => l.productId);
      await lockInventoryRows(tx, productIds, transfer.fromLocationId);

      for (const line of transfer.lines) {
        let inv = await tx.inventoryItem.findUnique({
          where: {
            productId_locationId: {
              productId: line.productId,
              locationId: transfer.fromLocationId,
            },
          },
        });
        if (!inv) throw new BadRequestException(`No inventory at source for product ${line.productId}`);
        const current = await tx.inventoryItem.findUniqueOrThrow({ where: { id: inv.id } });
        if (current.quantityOnHand.lt(line.quantity)) {
          throw new BadRequestException(`Not enough stock at source for product ${line.productId}`);
        }
        const beforeOnHand = current.quantityOnHand;
        const afterOnHand = beforeOnHand.sub(line.quantity);

        await allocateFromBatches(tx, line.productId, line.quantity, { locationId: transfer.fromLocationId });

        await tx.stockMovement.create({
          data: {
            inventoryItemId: inv.id,
            type: MovementType.TRANSFER,
            qtyDelta: line.quantity.neg(),
            beforeOnHand,
            afterOnHand,
            refType: "TRANSFER",
            refId: transfer.id,
            notes: `Transfer out ${transfer.transferNumber}`,
            createdByUserId: userId,
          },
        });
        await tx.inventoryItem.update({
          where: { id: inv.id },
          data: { quantityOnHand: afterOnHand },
        });
      }

      return tx.stockTransfer.update({
        where: { id },
        data: { status: TransferStatus.SENT, sentAt: new Date() },
        include: this.transferInclude,
      });
    });

    await this.audit.log(userId, "SEND", "StockTransfer", id, { transferNumber: transfer.transferNumber });
    return updated;
  }

  /**
   * Receive a sent transfer: add stock at the destination location.
   */
  async receiveTransfer(userId: string, id: string) {
    const transfer = await this.prisma.stockTransfer.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!transfer) throw new NotFoundException("Transfer not found");
    if (transfer.status !== TransferStatus.SENT) {
      throw new BadRequestException("Only sent transfers can be received");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const line of transfer.lines) {
        let inv = await tx.inventoryItem.findUnique({
          where: {
            productId_locationId: {
              productId: line.productId,
              locationId: transfer.toLocationId,
            },
          },
        });
        if (!inv) {
          inv = await tx.inventoryItem.create({
            data: {
              productId: line.productId,
              locationId: transfer.toLocationId,
              quantityOnHand: new Prisma.Decimal(0),
              averageCost: new Prisma.Decimal(0),
            },
          });
        }

        await lockInventoryRows(tx, [line.productId], transfer.toLocationId);
        const current = await tx.inventoryItem.findUniqueOrThrow({ where: { id: inv.id } });
        const beforeOnHand = current.quantityOnHand;
        const afterOnHand = beforeOnHand.add(line.quantity);

        // Create batch at destination
        await tx.stockBatch.create({
          data: {
            productId: line.productId,
            locationId: transfer.toLocationId,
            qtyReceived: line.quantity,
            qtyRemaining: line.quantity,
            unitCost: current.averageCost,
          },
        });

        await tx.stockMovement.create({
          data: {
            inventoryItemId: inv.id,
            type: MovementType.TRANSFER,
            qtyDelta: line.quantity,
            beforeOnHand,
            afterOnHand,
            refType: "TRANSFER",
            refId: transfer.id,
            notes: `Transfer in ${transfer.transferNumber}`,
            createdByUserId: userId,
          },
        });
        await tx.inventoryItem.update({
          where: { id: inv.id },
          data: { quantityOnHand: afterOnHand },
        });
      }

      return tx.stockTransfer.update({
        where: { id },
        data: {
          status: TransferStatus.RECEIVED,
          receivedAt: new Date(),
          receivedByUserId: userId,
        },
        include: this.transferInclude,
      });
    });

    await this.audit.log(userId, "RECEIVE", "StockTransfer", id, { transferNumber: transfer.transferNumber });
    return updated;
  }

  async cancelTransfer(userId: string, id: string) {
    const transfer = await this.prisma.stockTransfer.findUnique({ where: { id } });
    if (!transfer) throw new NotFoundException("Transfer not found");
    if (transfer.status !== TransferStatus.DRAFT) {
      throw new BadRequestException("Only draft transfers can be cancelled");
    }
    const updated = await this.prisma.stockTransfer.update({
      where: { id },
      data: { status: TransferStatus.CANCELLED },
      include: this.transferInclude,
    });
    await this.audit.log(userId, "CANCEL", "StockTransfer", id, {
      transferNumber: transfer.transferNumber,
    });
    return updated;
  }
}
