import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MovementType, Prisma, StockCountStatus, StockCountType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { LocationsService } from "../locations/locations.service";
import { lockInventoryRows } from "../common/stock.util";
import { businessDateString } from "../common/business-time";

const toDecimal = (v: string | number) => new Prisma.Decimal(v);
const COUNT_SCOPE = "COUNT";

@Injectable()
export class StockCountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly locations: LocationsService,
  ) {}

  private async nextCountNumber(tx: Prisma.TransactionClient): Promise<string> {
    const date = businessDateString();
    const rows = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO "DocumentCounter" ("scope", "date", "value") VALUES (${COUNT_SCOPE}, ${date}, 1)
      ON CONFLICT ("scope", "date") DO UPDATE SET "value" = "DocumentCounter"."value" + 1
      RETURNING "value"`;
    return `CNT-${date.replace(/-/g, "")}-${String(rows[0].value).padStart(4, "0")}`;
  }

  private countInclude = {
    lines: { include: { product: { select: { id: true, name: true, sku: true } } } },
    location: true,
    createdBy: { select: { id: true, displayName: true, email: true } },
    postedBy: { select: { id: true, displayName: true, email: true } },
  } as const;

  async listCounts(params: { status?: StockCountStatus; skip?: number; take?: number }) {
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    const where: Prisma.StockCountWhereInput = {};
    if (params.status) where.status = params.status;
    const [items, total] = await Promise.all([
      this.prisma.stockCount.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
        include: this.countInclude,
      }),
      this.prisma.stockCount.count({ where }),
    ]);
    return { items, total, skip, take };
  }

  async getCount(id: string) {
    const c = await this.prisma.stockCount.findUnique({
      where: { id },
      include: this.countInclude,
    });
    if (!c) throw new NotFoundException("Stock count not found");
    return c;
  }

  /**
   * Create a draft stock count. Optionally scoped to a location.
   */
  async createCount(
    userId: string,
    data: {
      type?: StockCountType;
      locationId?: string;
      notes?: string;
    },
  ) {
    const locationId = data.locationId || (await this.locations.getDefault()).id;
    await this.locations.getLocation(locationId);

    const count = await this.prisma.$transaction(async (tx) => {
      const countNumber = await this.nextCountNumber(tx);
      return tx.stockCount.create({
        data: {
          countNumber,
          type: data.type ?? StockCountType.FULL,
          status: StockCountStatus.DRAFT,
          locationId,
          notes: data.notes?.trim() || null,
          createdByUserId: userId,
        },
        include: this.countInclude,
      });
    });

    await this.audit.log(userId, "CREATE", "StockCount", count.id, {
      countNumber: count.countNumber,
    });
    return count;
  }

  /**
   * Start a count: snapshot current quantities for all products at the location.
   * Moves status from DRAFT → IN_PROGRESS.
   */
  async startCount(userId: string, id: string) {
    const count = await this.prisma.stockCount.findUnique({ where: { id } });
    if (!count) throw new NotFoundException("Stock count not found");
    if (count.status !== StockCountStatus.DRAFT) {
      throw new BadRequestException("Only draft counts can be started");
    }

    const locationId = count.locationId || (await this.locations.getDefault()).id;

    const inventoryItems = await this.prisma.inventoryItem.findMany({
      where: { locationId },
      select: { productId: true, quantityOnHand: true },
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.stockCountLine.createMany({
        data: inventoryItems.map((item) => ({
          countId: id,
          productId: item.productId,
          systemQtySnapshot: item.quantityOnHand,
        })),
        skipDuplicates: true,
      });

      return tx.stockCount.update({
        where: { id },
        data: { status: StockCountStatus.IN_PROGRESS, startedAt: new Date() },
        include: this.countInclude,
      });
    });

    await this.audit.log(userId, "START", "StockCount", id, {
      countNumber: count.countNumber,
      lineCount: inventoryItems.length,
    });
    return updated;
  }

  /**
   * Record a counted quantity for a product in an active count.
   */
  async recordCountLine(
    _userId: string,
    countId: string,
    data: { productId: string; countedQty: string; notes?: string },
  ) {
    const count = await this.prisma.stockCount.findUnique({ where: { id: countId } });
    if (!count) throw new NotFoundException("Stock count not found");
    if (count.status !== StockCountStatus.IN_PROGRESS && count.status !== StockCountStatus.REVIEW) {
      throw new BadRequestException("Count is not active for counting");
    }

    const line = await this.prisma.stockCountLine.findUnique({
      where: { countId_productId: { countId, productId: data.productId } },
    });
    if (!line) throw new NotFoundException("Product not found in this count");

    return this.prisma.stockCountLine.update({
      where: { id: line.id },
      data: {
        countedQty: toDecimal(data.countedQty),
        notes: data.notes?.trim() || null,
        needsRecount: false,
      },
    });
  }

  /**
   * Post a stock count: compute variances and write adjustments as COUNT movements.
   * Status goes to POSTED.
   */
  async postCount(userId: string, id: string) {
    const count = await this.prisma.stockCount.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!count) throw new NotFoundException("Stock count not found");
    if (count.status !== StockCountStatus.IN_PROGRESS && count.status !== StockCountStatus.REVIEW) {
      throw new BadRequestException("Count is not ready to post");
    }

    const locationId = count.locationId || (await this.locations.getDefault()).id;
    const uncounted = count.lines.filter((l) => l.countedQty === null);
    if (uncounted.length > 0) {
      throw new BadRequestException(`${uncounted.length} line(s) have not been counted yet`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const productIds = count.lines.map((l) => l.productId);
      await lockInventoryRows(tx, productIds, locationId);

      for (const line of count.lines) {
        const counted = line.countedQty!;
        const inv = await tx.inventoryItem.findUnique({
          where: { productId_locationId: { productId: line.productId, locationId } },
        });
        if (!inv) continue;

        const currentOnHand = inv.quantityOnHand;
        // Variance = counted - (snapshot + movements since start)
        // For simplicity: we just set on-hand to counted and record the delta
        const delta = counted.sub(currentOnHand);
        const variance = counted.sub(line.systemQtySnapshot);

        await tx.stockCountLine.update({
          where: { id: line.id },
          data: { varianceQty: variance },
        });

        if (!delta.eq(0)) {
          await tx.stockMovement.create({
            data: {
              inventoryItemId: inv.id,
              type: MovementType.COUNT,
              qtyDelta: delta,
              beforeOnHand: currentOnHand,
              afterOnHand: counted,
              refType: "STOCK_COUNT",
              refId: count.id,
              notes: `Count adjustment ${count.countNumber}`,
              createdByUserId: userId,
            },
          });
          await tx.inventoryItem.update({
            where: { id: inv.id },
            data: { quantityOnHand: counted },
          });
        }
      }

      return tx.stockCount.update({
        where: { id },
        data: {
          status: StockCountStatus.POSTED,
          postedAt: new Date(),
          postedByUserId: userId,
        },
        include: this.countInclude,
      });
    });

    await this.audit.log(userId, "POST", "StockCount", id, {
      countNumber: count.countNumber,
    });
    return updated;
  }
}
