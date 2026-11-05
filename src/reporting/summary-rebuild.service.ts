import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  addDays,
  BUSINESS_TZ,
  businessDateString,
  businessDayEnd,
  businessDayStart,
} from "../common/business-time";
import { eachBusinessDate } from "./date-range";

const HOUR_MS = 3_600_000;
const BUSINESS_UTC_OFFSET_HOURS = 3;

const businessHour = (at: Date): number =>
  (at.getUTCHours() + BUSINESS_UTC_OFFSET_HOURS) % 24;

const emptyHourBuckets = (): string[] => Array.from({ length: 24 }, () => "0.00");

@Injectable()
export class SummaryRebuildService {
  private readonly logger = new Logger(SummaryRebuildService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Rebuild DailySalesSummary + DailyProductSales for one business calendar day.
   * Idempotent: upserts the day summary and replaces product rows for that day.
   */
  async rebuildDay(businessDate: string) {
    const start = businessDayStart(businessDate);
    const end = businessDayEnd(businessDate);

    const sales = await this.prisma.sale.findMany({
      where: { createdAt: { gte: start, lte: end } },
      include: {
        lines: true,
        payments: true,
        creditNotes: { select: { id: true, kind: true } },
      },
    });

    let saleCount = 0;
    let voidCount = 0;
    let returnCount = 0;
    let subtotal = new Prisma.Decimal(0);
    let discountTotal = new Prisma.Decimal(0);
    let taxTotal = new Prisma.Decimal(0);
    let grandTotal = new Prisma.Decimal(0);
    let costTotal = new Prisma.Decimal(0);
    const paymentsByMethod: Record<string, string> = {};
    const hourBuckets = emptyHourBuckets().map((v) => new Prisma.Decimal(v));
    const productMap = new Map<
      string,
      { quantity: Prisma.Decimal; revenue: Prisma.Decimal; cost: Prisma.Decimal; lineCount: number }
    >();

    for (const sale of sales) {
      if (sale.status === "VOIDED") {
        voidCount += 1;
        continue;
      }
      saleCount += 1;
      subtotal = subtotal.add(sale.subtotal);
      discountTotal = discountTotal.add(sale.discountTotal);
      taxTotal = taxTotal.add(sale.taxTotal);
      grandTotal = grandTotal.add(sale.grandTotal);

      const hour = businessHour(sale.createdAt);
      hourBuckets[hour] = hourBuckets[hour].add(sale.grandTotal);

      for (const pay of sale.payments) {
        const prev = new Prisma.Decimal(paymentsByMethod[pay.method] ?? "0");
        paymentsByMethod[pay.method] = prev.add(pay.amount).toFixed(2);
      }

      for (const line of sale.lines) {
        const lineCost = line.unitCostAtSale.mul(line.quantity);
        costTotal = costTotal.add(lineCost);
        const prev = productMap.get(line.productId) ?? {
          quantity: new Prisma.Decimal(0),
          revenue: new Prisma.Decimal(0),
          cost: new Prisma.Decimal(0),
          lineCount: 0,
        };
        prev.quantity = prev.quantity.add(line.quantity);
        prev.revenue = prev.revenue.add(line.lineTotal);
        prev.cost = prev.cost.add(lineCost);
        prev.lineCount += 1;
        productMap.set(line.productId, prev);
      }

      for (const cn of sale.creditNotes) {
        if (cn.kind === "RETURN" || cn.kind === "EXCHANGE") {
          returnCount += 1;
        }
      }
    }

    // Credit notes created on this day (may link to older sales).
    const creditNotes = await this.prisma.creditNote.findMany({
      where: { createdAt: { gte: start, lte: end }, kind: { in: ["RETURN", "EXCHANGE"] } },
      select: { id: true },
    });
    // Prefer day-of-credit-note count when available (covers returns on older sales).
    if (creditNotes.length > 0) {
      returnCount = creditNotes.length;
    }

    const salesByHour = hourBuckets.map((d) => d.toFixed(2));
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.dailySalesSummary.upsert({
        where: { businessDate },
        create: {
          businessDate,
          saleCount,
          voidCount,
          returnCount,
          subtotal,
          discountTotal,
          taxTotal,
          grandTotal,
          costTotal,
          paymentsByMethod,
          salesByHour,
          rebuiltAt: now,
        },
        update: {
          saleCount,
          voidCount,
          returnCount,
          subtotal,
          discountTotal,
          taxTotal,
          grandTotal,
          costTotal,
          paymentsByMethod,
          salesByHour,
          rebuiltAt: now,
        },
      });

      await tx.dailyProductSales.deleteMany({ where: { businessDate } });
      if (productMap.size > 0) {
        await tx.dailyProductSales.createMany({
          data: [...productMap.entries()].map(([productId, row]) => ({
            businessDate,
            productId,
            quantity: row.quantity,
            revenue: row.revenue,
            cost: row.cost,
            lineCount: row.lineCount,
            rebuiltAt: now,
          })),
        });
      }
    });

    return {
      businessDate,
      saleCount,
      voidCount,
      returnCount,
      grandTotal: grandTotal.toFixed(2),
      productCount: productMap.size,
    };
  }

  async rebuildRange(from: string, to: string) {
    const dates = eachBusinessDate(from, to);
    const results = [];
    for (const date of dates) {
      results.push(await this.rebuildDay(date));
    }
    return { from, to, days: results.length, results };
  }

  async rebuildRecent(days = 90) {
    const today = businessDateString();
    const from = addDays(today, -(Math.max(1, days) - 1));
    return this.rebuildRange(from, today);
  }

  /** Nightly catch-up: rebuild yesterday and today (idempotent). */
  @Cron("15 0 * * *", { timeZone: BUSINESS_TZ })
  async cronRebuildRecent() {
    const today = businessDateString();
    const yesterday = addDays(today, -1);
    try {
      await this.rebuildDay(yesterday);
      await this.rebuildDay(today);
      this.logger.log(`Rebuilt daily sales summaries for ${yesterday} and ${today}`);
    } catch (err) {
      this.logger.error(`Daily summary rebuild failed: ${(err as Error).message}`);
    }
  }
}

/** Tiny helper kept for tests that want millisecond math without importing elsewhere. */
export const _testOnly = { businessHour, HOUR_MS };
