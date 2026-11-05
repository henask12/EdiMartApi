import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import {
  AdjustReason,
  MovementType,
  Prisma,
  PurchaseOrderStatus,
  ReservationStatus,
  ShiftStatus,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { SalesService } from "../sales/sales.service";
import { InventoryService } from "../inventory/inventory.service";
import { BillsService } from "../purchasing/bills.service";
import { ExportService } from "../export/export.service";
import { productStockSnapshot } from "../common/stock.util";
import {
  addDays,
  businessDateString,
  businessDayStart,
  businessMonthStart,
} from "../common/business-time";
import { buildCreatedAtRange } from "../common/date-range.util";
import { deltaPct, resolveReportRange, type ResolvedDateRange } from "./date-range";
import { SummaryRebuildService } from "./summary-rebuild.service";
import { asMoney, asQty, D0, toNumber } from "./money";

const CASH_VARIANCE_THRESHOLD = new Prisma.Decimal(1);
const THIN_MARGIN_PCT = 10;

type NeedsAttentionItem = {
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  count: number;
  href: string;
  items?: Array<Record<string, string | number | null>>;
};

@Injectable()
export class ReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
    private readonly sales: SalesService,
    private readonly inventory: InventoryService,
    private readonly bills: BillsService,
    private readonly exportSvc: ExportService,
    private readonly summaries: SummaryRebuildService,
  ) {}

  // ─── Summary rebuild passthrough ───────────────────────────────────────────

  rebuildDay(businessDate: string) {
    return this.summaries.rebuildDay(businessDate);
  }

  rebuildRange(from?: string, to?: string) {
    if (from && to) return this.summaries.rebuildRange(from, to);
    return this.summaries.rebuildRecent(90);
  }

  // ─── Business dashboard ────────────────────────────────────────────────────

  async dashboard(
    includeCost = false,
    opts: { preset?: string; from?: string; to?: string } = {},
  ) {
    const range = resolveReportRange(opts);
    const [periodAgg, comparisonAgg, legacy, attention, topProducts, hourAvg] =
      await Promise.all([
        this.aggregateSummaries(range.from, range.to),
        this.aggregateSummaries(range.comparisonFrom, range.comparisonTo),
        this.legacyPeriodSummaries(includeCost),
        this.needsAttention(includeCost),
        this.topProductsFromSummaries(range.from, range.to, 10, includeCost),
        this.sameWeekdayHourAverage(range),
      ]);

    const sales = toNumber(periodAgg.grandTotal);
    const salesPrev = toNumber(comparisonAgg.grandTotal);
    const transactions = periodAgg.saleCount;
    const transactionsPrev = comparisonAgg.saleCount;
    const avgBasket =
      transactions > 0 ? periodAgg.grandTotal.div(transactions) : D0();
    const avgBasketPrev =
      transactionsPrev > 0 ? comparisonAgg.grandTotal.div(transactionsPrev) : D0();

    const profit = periodAgg.grandTotal.sub(periodAgg.costTotal);
    const profitPrev = comparisonAgg.grandTotal.sub(comparisonAgg.costTotal);
    const marginPct =
      periodAgg.grandTotal.gt(0)
        ? Number(profit.div(periodAgg.grandTotal).mul(100).toFixed(2))
        : 0;

    const kpis: Record<string, unknown> = {
      sales: {
        value: asMoney(periodAgg.grandTotal),
        deltaPct: deltaPct(sales, salesPrev),
      },
      transactions: {
        value: transactions,
        deltaPct: deltaPct(transactions, transactionsPrev),
      },
      avgBasket: {
        value: asMoney(avgBasket),
        deltaPct: deltaPct(toNumber(avgBasket), toNumber(avgBasketPrev)),
      },
    };
    if (includeCost) {
      kpis.profit = {
        value: asMoney(profit),
        deltaPct: deltaPct(toNumber(profit), toNumber(profitPrev)),
      };
      kpis.margin = {
        value: marginPct,
        deltaPct: null,
      };
    }

    return {
      period: {
        preset: range.preset,
        from: range.from,
        to: range.to,
      },
      comparison: {
        from: range.comparisonFrom,
        to: range.comparisonTo,
      },
      kpis,
      salesByHour: periodAgg.salesByHour.map((amount, hour) => ({
        hour,
        amount,
        weekdayAvg: hourAvg[hour] ?? "0.00",
      })),
      paymentsByMethod: Object.entries(periodAgg.paymentsByMethod).map(
        ([method, amount]) => ({ method, amount }),
      ),
      topProducts,
      needsAttention: attention,
      // Legacy fields so older clients keep working during deploy.
      today: legacy.today,
      week: legacy.week,
      month: legacy.month,
      year: legacy.year,
      needsRestock: legacy.needsRestock,
      expiringSoon: legacy.expiringSoon,
      openReservations: legacy.openReservations,
      productCount: legacy.productCount,
      ...(includeCost && legacy.stockValue ? { stockValue: legacy.stockValue } : {}),
    };
  }

  private async aggregateSummaries(from: string, to: string) {
    const rows = await this.prisma.dailySalesSummary.findMany({
      where: { businessDate: { gte: from, lte: to } },
    });
    let saleCount = 0;
    let voidCount = 0;
    let returnCount = 0;
    let subtotal = D0();
    let discountTotal = D0();
    let taxTotal = D0();
    let grandTotal = D0();
    let costTotal = D0();
    const paymentsByMethod: Record<string, string> = {};
    const hourBuckets = Array.from({ length: 24 }, () => D0());

    for (const row of rows) {
      saleCount += row.saleCount;
      voidCount += row.voidCount;
      returnCount += row.returnCount;
      subtotal = subtotal.add(row.subtotal);
      discountTotal = discountTotal.add(row.discountTotal);
      taxTotal = taxTotal.add(row.taxTotal);
      grandTotal = grandTotal.add(row.grandTotal);
      costTotal = costTotal.add(row.costTotal);

      const payMap =
        row.paymentsByMethod && typeof row.paymentsByMethod === "object"
          ? (row.paymentsByMethod as Record<string, string>)
          : {};
      for (const [method, amount] of Object.entries(payMap)) {
        paymentsByMethod[method] = asMoney(
          new Prisma.Decimal(paymentsByMethod[method] ?? 0).add(amount),
        );
      }

      const hours = Array.isArray(row.salesByHour)
        ? (row.salesByHour as string[])
        : [];
      for (let h = 0; h < 24; h++) {
        hourBuckets[h] = hourBuckets[h].add(hours[h] ?? 0);
      }
    }

    return {
      saleCount,
      voidCount,
      returnCount,
      subtotal,
      discountTotal,
      taxTotal,
      grandTotal,
      costTotal,
      paymentsByMethod,
      salesByHour: hourBuckets.map((d) => asMoney(d)),
    };
  }

  private async sameWeekdayHourAverage(range: ResolvedDateRange) {
    // Average hourly sales for the same weekday over the prior 8 weeks.
    const weekday = businessDayStart(range.from).getUTCDay();
    const sampleDates: string[] = [];
    for (let w = 1; w <= 8; w++) {
      const d = addDays(range.from, -7 * w);
      if (businessDayStart(d).getUTCDay() === weekday) sampleDates.push(d);
    }
    if (sampleDates.length === 0) {
      return Array.from({ length: 24 }, () => "0.00");
    }
    const rows = await this.prisma.dailySalesSummary.findMany({
      where: { businessDate: { in: sampleDates } },
    });
    const sums = Array.from({ length: 24 }, () => D0());
    for (const row of rows) {
      const hours = Array.isArray(row.salesByHour)
        ? (row.salesByHour as string[])
        : [];
      for (let h = 0; h < 24; h++) {
        sums[h] = sums[h].add(hours[h] ?? 0);
      }
    }
    const n = Math.max(rows.length, 1);
    return sums.map((s) => asMoney(s.div(n)));
  }

  private async topProductsFromSummaries(
    from: string,
    to: string,
    take: number,
    includeCost: boolean,
  ) {
    const rows = await this.prisma.dailyProductSales.findMany({
      where: { businessDate: { gte: from, lte: to } },
      include: { product: { select: { id: true, name: true } } },
    });
    const map = new Map<
      string,
      { productId: string; name: string; quantity: Prisma.Decimal; revenue: Prisma.Decimal; cost: Prisma.Decimal }
    >();
    for (const row of rows) {
      const prev = map.get(row.productId) ?? {
        productId: row.productId,
        name: row.product.name,
        quantity: D0(),
        revenue: D0(),
        cost: D0(),
      };
      prev.quantity = prev.quantity.add(row.quantity);
      prev.revenue = prev.revenue.add(row.revenue);
      prev.cost = prev.cost.add(row.cost);
      map.set(row.productId, prev);
    }
    return [...map.values()]
      .sort((a, b) => (b.revenue.gt(a.revenue) ? 1 : -1))
      .slice(0, take)
      .map((p) => ({
        productId: p.productId,
        name: p.name,
        quantity: asQty(p.quantity),
        revenue: asMoney(p.revenue),
        ...(includeCost
          ? {
              cost: asMoney(p.cost),
              profit: asMoney(p.revenue.sub(p.cost)),
            }
          : {}),
      }));
  }

  private async legacyPeriodSummaries(includeCost: boolean) {
    const defaultLoc = await this.locations.getDefault();
    const today = await this.sales.todaySummary(includeCost);
    const week = await this.sales.salesForPeriod("week", undefined, includeCost);
    const month = await this.sales.salesForPeriod("month", undefined, includeCost);
    const year = await this.sales.salesForPeriod("year", undefined, includeCost);

    const items = await this.prisma.inventoryItem.findMany({
      where: { locationId: defaultLoc.id },
      include: { product: { include: { category: true } } },
    });

    const enriched = await Promise.all(
      items.map(async (row) => {
        const { available, reserved } = await productStockSnapshot(
          this.prisma,
          row.productId,
          defaultLoc.id,
        );
        return { row, available, reserved };
      }),
    );

    const needsRestock = enriched
      .filter(({ available, row }) => available.lte(0) || available.lte(row.product.restockAt))
      .map(({ row, available, reserved }) => ({
        id: row.product.id,
        name: row.product.name,
        quantityOnHand: row.quantityOnHand.toString(),
        available: available.toString(),
        reserved: reserved.toString(),
        restockAt: row.product.restockAt,
        restockQty: row.product.restockQty,
        sellingPrice: row.product.sellingPrice.toFixed(2),
        status: available.lte(0) ? ("OUT" as const) : ("LOW" as const),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const expiryDays = Number(process.env.EXPIRY_ALERT_DAYS ?? 7);
    const until = new Date();
    until.setDate(until.getDate() + expiryDays);
    const expiringSoon = await this.prisma.stockBatch.findMany({
      where: {
        expiryDate: { lte: until, gte: new Date() },
        qtyRemaining: { gt: 0 },
      },
      include: { product: true },
      orderBy: { expiryDate: "asc" },
      take: 10,
    });

    const openReservations = await this.prisma.reservation.findMany({
      where: { status: ReservationStatus.RESERVED },
      include: { product: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    let stockValue = D0();
    for (const row of items) {
      stockValue = stockValue.add(row.quantityOnHand.mul(row.averageCost));
    }

    return {
      today: {
        grandTotal: today.grandTotal,
        saleCount: today.saleCount,
        ...(includeCost ? { netProfit: today.netProfit } : {}),
      },
      week: {
        grandTotal: week.grandTotal,
        saleCount: week.saleCount,
        ...(includeCost ? { netProfit: week.netProfit } : {}),
      },
      month: {
        grandTotal: month.grandTotal,
        saleCount: month.saleCount,
        ...(includeCost ? { netProfit: month.netProfit } : {}),
      },
      year: {
        grandTotal: year.grandTotal,
        saleCount: year.saleCount,
        ...(includeCost ? { netProfit: year.netProfit } : {}),
      },
      needsRestock,
      expiringSoon: expiringSoon.map((b) => ({
        id: b.id,
        productName: b.product.name,
        qtyRemaining: b.qtyRemaining.toString(),
        expiryDate: b.expiryDate?.toISOString().slice(0, 10),
      })),
      openReservations: openReservations.map((r) => ({
        id: r.id,
        productName: r.product.name,
        quantity: r.quantity.toString(),
        customerName: r.customerName,
        createdAt: r.createdAt.toISOString(),
      })),
      ...(includeCost ? { stockValue: stockValue.toFixed(2) } : {}),
      productCount: items.length,
    };
  }

  async needsAttention(_includeCost = false): Promise<NeedsAttentionItem[]> {
    const today = businessDateString();
    const now = new Date();
    const out: NeedsAttentionItem[] = [];

    const sellableIds = await this.locations.listSellableLocationIds();
    const items = await this.prisma.inventoryItem.findMany({
      where: { locationId: { in: sellableIds } },
      include: { product: true },
    });
    const low: NeedsAttentionItem["items"] = [];
    const outStock: NeedsAttentionItem["items"] = [];
    for (const item of items) {
      if (item.quantityOnHand.lte(0)) {
        outStock!.push({
          productId: item.productId,
          name: item.product.name,
          quantity: item.quantityOnHand.toString(),
        });
      } else if (item.quantityOnHand.lte(item.product.restockAt)) {
        low!.push({
          productId: item.productId,
          name: item.product.name,
          quantity: item.quantityOnHand.toString(),
        });
      }
    }
    if (outStock!.length > 0) {
      out.push({
        kind: "out_of_stock",
        severity: "critical",
        title: "Out of stock",
        count: outStock!.length,
        href: "/inventory",
        items: outStock!.slice(0, 10),
      });
    }
    if (low!.length > 0) {
      out.push({
        kind: "low_stock",
        severity: "warning",
        title: "Low stock",
        count: low!.length,
        href: "/reorder",
        items: low!.slice(0, 10),
      });
    }

    const expiryUntil = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    const expiring = await this.prisma.stockBatch.findMany({
      where: {
        expiryDate: { lte: expiryUntil, gte: now },
        qtyRemaining: { gt: 0 },
      },
      include: { product: { select: { name: true } } },
      orderBy: { expiryDate: "asc" },
      take: 50,
    });
    if (expiring.length > 0) {
      out.push({
        kind: "expiring_batches",
        severity: "warning",
        title: "Batches expiring within 30 days",
        count: expiring.length,
        href: "/expiry",
        items: expiring.slice(0, 10).map((b) => ({
          id: b.id,
          productName: b.product.name,
          qtyRemaining: b.qtyRemaining.toString(),
          expiryDate: b.expiryDate?.toISOString().slice(0, 10) ?? null,
        })),
      });
    }

    const overduePos = await this.prisma.purchaseOrder.findMany({
      where: {
        status: {
          in: [PurchaseOrderStatus.SENT, PurchaseOrderStatus.PARTIALLY_RECEIVED],
        },
        expectedAt: { lt: businessDayStart(today) },
      },
      include: { supplier: { select: { name: true } } },
      take: 50,
    });
    if (overduePos.length > 0) {
      out.push({
        kind: "overdue_pos",
        severity: "warning",
        title: "Purchase orders overdue for delivery",
        count: overduePos.length,
        href: "/purchase-orders",
        items: overduePos.slice(0, 10).map((po) => ({
          id: po.id,
          poNumber: po.poNumber,
          supplier: po.supplier.name,
          expectedAt: po.expectedAt?.toISOString().slice(0, 10) ?? null,
        })),
      });
    }

    const overdueReservations = await this.prisma.reservation.findMany({
      where: {
        status: ReservationStatus.RESERVED,
        expiresAt: { lt: now },
      },
      include: { product: { select: { name: true } } },
      take: 50,
    });
    if (overdueReservations.length > 0) {
      out.push({
        kind: "overdue_reservations",
        severity: "warning",
        title: "Overdue reservations",
        count: overdueReservations.length,
        href: "/reservations",
        items: overdueReservations.slice(0, 10).map((r) => ({
          id: r.id,
          productName: r.product.name,
          customerName: r.customerName,
          expiresAt: r.expiresAt?.toISOString() ?? null,
        })),
      });
    }

    const overdueCredit = await this.prisma.customer.count({
      where: { creditBalance: { gt: 0 }, isActive: true },
    });
    if (overdueCredit > 0) {
      out.push({
        kind: "overdue_credit",
        severity: "warning",
        title: "Customers with outstanding credit",
        count: overdueCredit,
        href: "/customers/overdue",
      });
    }

    const varianceShifts = await this.prisma.shift.findMany({
      where: {
        status: ShiftStatus.CLOSED,
        variance: { not: null },
        closedAt: { gte: addDaysDate(today, -14) },
      },
      orderBy: { closedAt: "desc" },
      take: 20,
    });
    const openVariance = varianceShifts.filter(
      (s) => s.variance && s.variance.abs().gt(CASH_VARIANCE_THRESHOLD),
    );
    if (openVariance.length > 0) {
      out.push({
        kind: "cash_variance",
        severity: "warning",
        title: "Recent shifts with cash variance",
        count: openVariance.length,
        href: "/shifts",
        items: openVariance.slice(0, 10).map((s) => ({
          id: s.id,
          shiftNumber: s.shiftNumber,
          variance: s.variance!.toFixed(2),
        })),
      });
    }

    return out;
  }

  // ─── Inventory dashboard ───────────────────────────────────────────────────

  async inventoryDashboard(includeCost = false) {
    const base = await this.inventory.inventoryOverview(includeCost);
    const today = businessDateString();
    const monthStart = businessMonthStart(today);
    const from90 = addDays(today, -89);
    const from30 = addDays(today, -29);

    const [dead, abc30, shrinkage, snapshots] = await Promise.all([
      this.deadStock({ days: 90, includeCost }),
      this.abcAnalysis({ from: from30, to: today, by: "revenue", includeCost }),
      this.shrinkageReport({ from: monthStart, to: today, includeCost }),
      this.prisma.inventorySnapshot.findMany({
        where: { date: { gte: addDays(today, -30), lte: today } },
        select: { date: true },
        distinct: ["date"],
        orderBy: { date: "asc" },
      }),
    ]);

    const cogs90 = await this.prisma.dailyProductSales.aggregate({
      where: { businessDate: { gte: from90, lte: today } },
      _sum: { cost: true, revenue: true },
    });
    const stockCost = new Prisma.Decimal(
      (base as { stockValueAtCost?: string }).stockValueAtCost ??
        (base as { valueAtCost?: string }).valueAtCost ??
        0,
    );
    const cogs = cogs90._sum.cost ?? D0();
    const turnover =
      stockCost.gt(0) && includeCost
        ? Number(cogs.div(stockCost).toFixed(2))
        : null;
    const doi =
      includeCost && cogs.gt(0)
        ? Number(stockCost.div(cogs.div(90)).toFixed(1))
        : null;

    const deadValue = (dead.items as Array<{ valueCost?: string; valueRetail?: string }>).reduce(
      (acc, row) => acc.add(row.valueCost ?? row.valueRetail ?? 0),
      D0(),
    );

    return {
      ...base,
      stockValueCost: includeCost
        ? (base as { stockValueAtCost?: string }).stockValueAtCost ?? null
        : undefined,
      stockValueRetail:
        (base as { stockValueAtRetail?: string }).stockValueAtRetail ??
        (base as { valueAtRetail?: string }).valueAtRetail,
      skuCount: base.skuCount,
      lowCount: base.lowStockCount,
      outCount: base.outOfStockCount,
      expiring30Value: includeCost
        ? (base as { expiringValue30d?: string }).expiringValue30d
        : undefined,
      deadStockValue: includeCost
        ? asMoney(deadValue)
        : asMoney(
            (dead.items as Array<{ valueRetail?: string }>).reduce(
              (acc, row) => acc.add(row.valueRetail ?? 0),
              D0(),
            ),
          ),
      turnover,
      daysOfInventory: doi,
      abc: {
        A: abc30.counts.A,
        B: abc30.counts.B,
        C: abc30.counts.C,
      },
      shrinkageThisMonth: includeCost ? shrinkage.totalValue : undefined,
      accuracyTrend: snapshots.map((s) => s.date),
    };
  }

  // ─── Sales reports ─────────────────────────────────────────────────────────

  salesByPeriod(period: "day" | "week" | "month" | "year", date?: string, includeCost = false) {
    return this.sales.salesForPeriod(period, date, includeCost);
  }

  async salesByDay(opts: { from?: string; to?: string; includeCost?: boolean }) {
    const range = resolveReportRange({
      preset: opts.from && opts.to ? "custom" : "this_month",
      from: opts.from,
      to: opts.to,
    });
    const rows = await this.prisma.dailySalesSummary.findMany({
      where: { businessDate: { gte: range.from, lte: range.to } },
      orderBy: { businessDate: "asc" },
    });
    return {
      from: range.from,
      to: range.to,
      items: rows.map((r) => ({
        date: r.businessDate,
        saleCount: r.saleCount,
        voidCount: r.voidCount,
        returnCount: r.returnCount,
        subtotal: asMoney(r.subtotal),
        discountTotal: asMoney(r.discountTotal),
        taxTotal: asMoney(r.taxTotal),
        grandTotal: asMoney(r.grandTotal),
        ...(opts.includeCost
          ? {
              costTotal: asMoney(r.costTotal),
              profit: asMoney(r.grandTotal.sub(r.costTotal)),
            }
          : {}),
      })),
    };
  }

  async salesByHour(opts: { from?: string; to?: string }) {
    const range = resolveReportRange({
      preset: opts.from && opts.to ? "custom" : "this_week",
      from: opts.from,
      to: opts.to,
    });
    const agg = await this.aggregateSummaries(range.from, range.to);
    const byWeekday = await this.weekdayHeatmap(range.from, range.to);
    return {
      from: range.from,
      to: range.to,
      byHour: agg.salesByHour.map((amount, hour) => ({ hour, amount })),
      byWeekdayHour: byWeekday,
    };
  }

  private async weekdayHeatmap(from: string, to: string) {
    const rows = await this.prisma.dailySalesSummary.findMany({
      where: { businessDate: { gte: from, lte: to } },
    });
    const grid: Record<number, string[]> = {};
    for (let d = 0; d < 7; d++) {
      grid[d] = Array.from({ length: 24 }, () => "0.00");
    }
    const sums: Record<number, Prisma.Decimal[]> = {};
    for (let d = 0; d < 7; d++) {
      sums[d] = Array.from({ length: 24 }, () => D0());
    }
    for (const row of rows) {
      const weekday = businessDayStart(row.businessDate).getUTCDay();
      const hours = Array.isArray(row.salesByHour) ? (row.salesByHour as string[]) : [];
      for (let h = 0; h < 24; h++) {
        sums[weekday][h] = sums[weekday][h].add(hours[h] ?? 0);
      }
    }
    for (let d = 0; d < 7; d++) {
      grid[d] = sums[d].map((v) => asMoney(v));
    }
    return Object.entries(grid).map(([weekday, hours]) => ({
      weekday: Number(weekday),
      hours: hours.map((amount, hour) => ({ hour, amount })),
    }));
  }

  async salesByProduct(opts: {
    from?: string;
    to?: string;
    groupBy?: string;
    includeCost?: boolean;
  }) {
    const range = resolveReportRange({
      preset: opts.from && opts.to ? "custom" : "this_month",
      from: opts.from,
      to: opts.to,
    });
    const groupBy = (opts.groupBy ?? "product") as
      | "product"
      | "category"
      | "type"
      | "brand";
    if (!["product", "category", "type", "brand"].includes(groupBy)) {
      throw new BadRequestException("groupBy must be product|category|type|brand");
    }

    const rows = await this.prisma.dailyProductSales.findMany({
      where: { businessDate: { gte: range.from, lte: range.to } },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            brand: true,
            categoryId: true,
            category: { select: { id: true, name: true } },
            productTypeId: true,
            productType: { select: { id: true, name: true } },
          },
        },
      },
    });

    type Agg = {
      key: string;
      label: string;
      quantity: Prisma.Decimal;
      revenue: Prisma.Decimal;
      cost: Prisma.Decimal;
    };
    const map = new Map<string, Agg>();
    for (const row of rows) {
      let key: string;
      let label: string;
      switch (groupBy) {
        case "category":
          key = row.product.categoryId;
          label = row.product.category.name;
          break;
        case "type":
          key = row.product.productTypeId ?? "none";
          label = row.product.productType?.name ?? "(none)";
          break;
        case "brand":
          key = row.product.brand ?? "none";
          label = row.product.brand ?? "(none)";
          break;
        default:
          key = row.productId;
          label = row.product.name;
      }
      const prev = map.get(key) ?? {
        key,
        label,
        quantity: D0(),
        revenue: D0(),
        cost: D0(),
      };
      prev.quantity = prev.quantity.add(row.quantity);
      prev.revenue = prev.revenue.add(row.revenue);
      prev.cost = prev.cost.add(row.cost);
      map.set(key, prev);
    }

    const items = [...map.values()]
      .sort((a, b) => (b.revenue.gt(a.revenue) ? 1 : -1))
      .map((r) => ({
        key: r.key,
        name: r.label,
        quantity: asQty(r.quantity),
        revenue: asMoney(r.revenue),
        ...(opts.includeCost
          ? {
              cost: asMoney(r.cost),
              profit: asMoney(r.revenue.sub(r.cost)),
            }
          : {}),
      }));

    return { from: range.from, to: range.to, groupBy, items };
  }

  async salesByCashier(opts: { from?: string; to?: string; includeCost?: boolean }) {
    const range = resolveReportRange({
      preset: opts.from && opts.to ? "custom" : "this_month",
      from: opts.from,
      to: opts.to,
    });
    const sales = await this.prisma.sale.findMany({
      where: {
        createdAt: { gte: range.start, lte: range.end },
        status: { not: "VOIDED" },
      },
      include: {
        createdBy: { select: { id: true, displayName: true, email: true } },
        lines: true,
      },
    });
    const map = new Map<
      string,
      {
        userId: string;
        name: string;
        email: string;
        saleCount: number;
        grandTotal: Prisma.Decimal;
        costTotal: Prisma.Decimal;
      }
    >();
    for (const sale of sales) {
      const prev = map.get(sale.createdByUserId) ?? {
        userId: sale.createdByUserId,
        name: sale.createdBy.displayName ?? sale.createdBy.email,
        email: sale.createdBy.email,
        saleCount: 0,
        grandTotal: D0(),
        costTotal: D0(),
      };
      prev.saleCount += 1;
      prev.grandTotal = prev.grandTotal.add(sale.grandTotal);
      for (const line of sale.lines) {
        prev.costTotal = prev.costTotal.add(line.unitCostAtSale.mul(line.quantity));
      }
      map.set(sale.createdByUserId, prev);
    }
    return {
      from: range.from,
      to: range.to,
      items: [...map.values()]
        .sort((a, b) => (b.grandTotal.gt(a.grandTotal) ? 1 : -1))
        .map((r) => ({
          userId: r.userId,
          name: r.name,
          email: r.email,
          saleCount: r.saleCount,
          grandTotal: asMoney(r.grandTotal),
          ...(opts.includeCost
            ? {
                costTotal: asMoney(r.costTotal),
                profit: asMoney(r.grandTotal.sub(r.costTotal)),
              }
            : {}),
        })),
    };
  }

  async salesByPayment(opts: { from?: string; to?: string }) {
    const range = resolveReportRange({
      preset: opts.from && opts.to ? "custom" : "this_month",
      from: opts.from,
      to: opts.to,
    });
    const agg = await this.aggregateSummaries(range.from, range.to);
    return {
      from: range.from,
      to: range.to,
      items: Object.entries(agg.paymentsByMethod)
        .map(([method, amount]) => ({ method, amount }))
        .sort((a, b) => (new Prisma.Decimal(b.amount).gt(a.amount) ? 1 : -1)),
    };
  }

  async discountsVoidsRefunds(opts: { from?: string; to?: string }) {
    const range = resolveReportRange({
      preset: opts.from && opts.to ? "custom" : "this_month",
      from: opts.from,
      to: opts.to,
    });
    const [sales, credits, summary] = await Promise.all([
      this.prisma.sale.findMany({
        where: {
          createdAt: { gte: range.start, lte: range.end },
          OR: [{ discountTotal: { gt: 0 } }, { status: "VOIDED" }],
        },
        select: {
          id: true,
          saleNumber: true,
          status: true,
          discountTotal: true,
          grandTotal: true,
          voidReason: true,
          createdAt: true,
        },
      }),
      this.prisma.creditNote.findMany({
        where: { createdAt: { gte: range.start, lte: range.end } },
        select: {
          id: true,
          creditNumber: true,
          kind: true,
          refundAmount: true,
          reason: true,
          createdAt: true,
        },
      }),
      this.aggregateSummaries(range.from, range.to),
    ]);

    const discounted = sales.filter((s) => s.status !== "VOIDED" && s.discountTotal.gt(0));
    const voided = sales.filter((s) => s.status === "VOIDED");

    return {
      from: range.from,
      to: range.to,
      totals: {
        discountTotal: asMoney(summary.discountTotal),
        voidCount: summary.voidCount,
        returnCount: summary.returnCount,
        refundTotal: asMoney(
          credits.reduce((a, c) => a.add(c.refundAmount), D0()),
        ),
      },
      discounts: discounted.map((s) => ({
        saleId: s.id,
        saleNumber: s.saleNumber,
        discountTotal: asMoney(s.discountTotal),
        grandTotal: asMoney(s.grandTotal),
        createdAt: s.createdAt.toISOString(),
      })),
      voids: voided.map((s) => ({
        saleId: s.id,
        saleNumber: s.saleNumber,
        grandTotal: asMoney(s.grandTotal),
        voidReason: s.voidReason,
        createdAt: s.createdAt.toISOString(),
      })),
      refunds: credits.map((c) => ({
        id: c.id,
        creditNumber: c.creditNumber,
        kind: c.kind,
        refundAmount: asMoney(c.refundAmount),
        reason: c.reason,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  async customersReport(opts: { from?: string; to?: string }) {
    const range = resolveReportRange({
      preset: opts.from && opts.to ? "custom" : "this_month",
      from: opts.from,
      to: opts.to,
    });
    const sales = await this.prisma.sale.findMany({
      where: {
        createdAt: { gte: range.start, lte: range.end },
        status: { not: "VOIDED" },
        customerId: { not: null },
      },
      select: {
        customerId: true,
        grandTotal: true,
        customer: { select: { id: true, name: true, phone: true, createdAt: true } },
      },
    });

    const spend = new Map<
      string,
      { customerId: string; name: string; phone: string | null; total: Prisma.Decimal; visits: number; createdAt: Date }
    >();
    for (const sale of sales) {
      if (!sale.customerId || !sale.customer) continue;
      const prev = spend.get(sale.customerId) ?? {
        customerId: sale.customerId,
        name: sale.customer.name,
        phone: sale.customer.phone,
        total: D0(),
        visits: 0,
        createdAt: sale.customer.createdAt,
      };
      prev.total = prev.total.add(sale.grandTotal);
      prev.visits += 1;
      spend.set(sale.customerId, prev);
    }

    const newCustomers = [...spend.values()].filter(
      (c) => c.createdAt >= range.start && c.createdAt <= range.end,
    ).length;
    const returning = [...spend.values()].filter((c) => c.visits > 1).length;

    return {
      from: range.from,
      to: range.to,
      newCustomers,
      returningCustomers: returning,
      topSpenders: [...spend.values()]
        .sort((a, b) => (b.total.gt(a.total) ? 1 : -1))
        .slice(0, 25)
        .map((c) => ({
          customerId: c.customerId,
          name: c.name,
          phone: c.phone,
          visits: c.visits,
          total: asMoney(c.total),
        })),
    };
  }

  async vatSummary(opts: { from?: string; to?: string }) {
    const range = resolveReportRange({
      preset: opts.from && opts.to ? "custom" : "this_month",
      from: opts.from,
      to: opts.to,
    });
    const sales = await this.prisma.sale.findMany({
      where: {
        createdAt: { gte: range.start, lte: range.end },
        status: { not: "VOIDED" },
      },
      include: {
        lines: {
          include: { product: { select: { taxCategory: true } } },
        },
      },
    });

    let taxableNet = D0();
    let taxTotal = D0();
    let zeroRated = D0();
    let exempt = D0();
    let grandTotal = D0();

    for (const sale of sales) {
      grandTotal = grandTotal.add(sale.grandTotal);
      taxTotal = taxTotal.add(sale.taxTotal);
      for (const line of sale.lines) {
        const cat = line.product.taxCategory;
        if (cat === "ZERO_RATED") zeroRated = zeroRated.add(line.lineTotal);
        else if (cat === "EXEMPT") exempt = exempt.add(line.lineTotal);
        else taxableNet = taxableNet.add(line.lineTotal.sub(line.taxAmount));
      }
    }

    return {
      from: range.from,
      to: range.to,
      taxableNet: asMoney(taxableNet),
      taxTotal: asMoney(taxTotal),
      zeroRated: asMoney(zeroRated),
      exempt: asMoney(exempt),
      grandTotal: asMoney(grandTotal),
    };
  }

  async shiftVariances(opts: { from?: string; to?: string }) {
    const range = resolveReportRange({
      preset: opts.from && opts.to ? "custom" : "this_month",
      from: opts.from,
      to: opts.to,
    });
    const shifts = await this.prisma.shift.findMany({
      where: {
        status: ShiftStatus.CLOSED,
        closedAt: { gte: range.start, lte: range.end },
      },
      include: {
        openedBy: { select: { displayName: true } },
        register: { select: { code: true, name: true } },
      },
      orderBy: { closedAt: "desc" },
    });
    return {
      from: range.from,
      to: range.to,
      items: shifts.map((s) => ({
        id: s.id,
        shiftNumber: s.shiftNumber,
        register: s.register.code,
        openedBy: s.openedBy.displayName ?? null,
        openedAt: s.openedAt.toISOString(),
        closedAt: s.closedAt?.toISOString() ?? null,
        expectedCash: s.expectedCash?.toFixed(2) ?? null,
        countedCash: s.countedCash?.toFixed(2) ?? null,
        variance: s.variance?.toFixed(2) ?? null,
      })),
    };
  }

  // ─── Inventory reports ─────────────────────────────────────────────────────

  async stockOnHand(opts: {
    locationId?: string;
    categoryId?: string;
    includeCost?: boolean;
  }) {
    const where: Prisma.InventoryItemWhereInput = {};
    if (opts.locationId) where.locationId = opts.locationId;
    if (opts.categoryId) where.product = { categoryId: opts.categoryId };

    const items = await this.prisma.inventoryItem.findMany({
      where,
      include: {
        product: { include: { category: true } },
        location: true,
      },
      orderBy: [{ product: { name: "asc" } }],
    });

    return {
      items: items.map((i) => ({
        productId: i.productId,
        sku: i.product.sku,
        name: i.product.name,
        category: i.product.category.name,
        locationId: i.locationId,
        locationCode: i.location.code,
        quantityOnHand: asQty(i.quantityOnHand),
        sellingPrice: asMoney(i.product.sellingPrice),
        retailValue: asMoney(i.quantityOnHand.mul(i.product.sellingPrice)),
        ...(opts.includeCost
          ? {
              averageCost: asMoney(i.averageCost),
              costValue: asMoney(i.quantityOnHand.mul(i.averageCost)),
            }
          : {}),
      })),
    };
  }

  async valuation(opts: {
    asOf?: string;
    includeCost?: boolean;
  }): Promise<{
    asOf: string;
    source: "current" | "snapshot";
    stockValueRetail: string;
    stockValueCost?: string;
  }> {
    const asOf = opts.asOf ?? businessDateString();
    const today = businessDateString();

    if (asOf !== today && asOf < today) {
      const snaps = await this.prisma.inventorySnapshot.findMany({
        where: { date: asOf },
      });
      if (snaps.length > 0) {
        let cost = D0();
        let retail = D0();
        for (const s of snaps) {
          cost = cost.add(s.valueAtCost);
          retail = retail.add(s.valueAtRetail);
        }
        return {
          asOf,
          source: "snapshot",
          stockValueRetail: asMoney(retail),
          ...(opts.includeCost ? { stockValueCost: asMoney(cost) } : {}),
        };
      }
    }

    const items = await this.prisma.inventoryItem.findMany({
      include: { product: true, location: true },
    });
    let cost = D0();
    let retail = D0();
    for (const i of items) {
      if (i.quantityOnHand.lte(0)) continue;
      cost = cost.add(i.quantityOnHand.mul(i.averageCost));
      retail = retail.add(i.quantityOnHand.mul(i.product.sellingPrice));
    }
    return {
      asOf: asOf > today ? today : asOf,
      source: "current",
      stockValueRetail: asMoney(retail),
      ...(opts.includeCost ? { stockValueCost: asMoney(cost) } : {}),
    };
  }

  async movementsReport(opts: {
    type?: MovementType;
    userId?: string;
    from?: string;
    to?: string;
    locationId?: string;
    productId?: string;
    skip?: number;
    take?: number;
    includeCost?: boolean;
  }) {
    const take = Math.min(opts.take ?? 100, 500);
    const skip = opts.skip ?? 0;
    const where: Prisma.StockMovementWhereInput = {};
    if (opts.type) where.type = opts.type;
    if (opts.userId) where.createdByUserId = opts.userId;
    if (opts.productId || opts.locationId) {
      where.inventoryItem = {
        ...(opts.productId ? { productId: opts.productId } : {}),
        ...(opts.locationId ? { locationId: opts.locationId } : {}),
      };
    }
    const createdAt = buildCreatedAtRange(opts.from, opts.to);
    if (createdAt) where.createdAt = createdAt;

    const [rows, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
        include: {
          inventoryItem: {
            include: {
              product: { select: { id: true, name: true, sku: true } },
              location: { select: { id: true, code: true } },
            },
          },
          createdBy: { select: { id: true, displayName: true, email: true } },
        },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return {
      total,
      skip,
      take,
      items: rows.map((m) => ({
        id: m.id,
        type: m.type,
        qtyDelta: asQty(m.qtyDelta),
        beforeOnHand: m.beforeOnHand?.toString() ?? null,
        afterOnHand: m.afterOnHand?.toString() ?? null,
        reasonCode: m.reasonCode,
        notes: m.notes,
        createdAt: m.createdAt.toISOString(),
        productId: m.inventoryItem.product.id,
        productName: m.inventoryItem.product.name,
        sku: m.inventoryItem.product.sku,
        locationCode: m.inventoryItem.location.code,
        userId: m.createdBy?.id ?? null,
        userName: m.createdBy?.displayName ?? m.createdBy?.email ?? null,
        ...(opts.includeCost && m.unitCost
          ? { unitCost: asMoney(m.unitCost) }
          : {}),
      })),
    };
  }

  async abcAnalysis(opts: {
    from?: string;
    to?: string;
    by?: "revenue" | "profit";
    includeCost?: boolean;
  }) {
    const range = resolveReportRange({
      preset: opts.from && opts.to ? "custom" : "this_month",
      from: opts.from,
      to: opts.to,
    });
    const by = opts.by ?? "revenue";
    if (by === "profit" && !opts.includeCost) {
      throw new ForbiddenException("Profit ABC requires REPORTS_VIEW_COST_PROFIT");
    }

    const rows = await this.prisma.dailyProductSales.findMany({
      where: { businessDate: { gte: range.from, lte: range.to } },
      include: { product: { select: { id: true, name: true, sku: true } } },
    });
    const map = new Map<
      string,
      { productId: string; name: string; sku: string | null; metric: Prisma.Decimal; revenue: Prisma.Decimal; cost: Prisma.Decimal }
    >();
    for (const row of rows) {
      const prev = map.get(row.productId) ?? {
        productId: row.productId,
        name: row.product.name,
        sku: row.product.sku,
        metric: D0(),
        revenue: D0(),
        cost: D0(),
      };
      prev.revenue = prev.revenue.add(row.revenue);
      prev.cost = prev.cost.add(row.cost);
      prev.metric =
        by === "profit" ? prev.revenue.sub(prev.cost) : prev.revenue;
      map.set(row.productId, prev);
    }

    const sorted = [...map.values()].sort((a, b) =>
      b.metric.gt(a.metric) ? 1 : -1,
    );
    const total = sorted.reduce((a, r) => a.add(r.metric), D0());
    let running = D0();
    const items = sorted.map((r) => {
      running = running.add(r.metric);
      const share =
        total.gt(0) ? Number(running.div(total).mul(100).toFixed(2)) : 100;
      const klass = share <= 80 ? "A" : share <= 95 ? "B" : "C";
      return {
        productId: r.productId,
        name: r.name,
        sku: r.sku,
        class: klass as "A" | "B" | "C",
        revenue: asMoney(r.revenue),
        ...(opts.includeCost
          ? { cost: asMoney(r.cost), profit: asMoney(r.revenue.sub(r.cost)) }
          : {}),
        cumulativePct: share,
      };
    });

    const counts = {
      A: items.filter((i) => i.class === "A").length,
      B: items.filter((i) => i.class === "B").length,
      C: items.filter((i) => i.class === "C").length,
    };
    return { from: range.from, to: range.to, by, counts, items };
  }

  async turnoverReport(opts: { from?: string; to?: string; includeCost?: boolean }) {
    const range = resolveReportRange({
      preset: opts.from && opts.to ? "custom" : "this_month",
      from: opts.from,
      to: opts.to,
    });
    const dayCount = Math.max(
      1,
      Math.floor(
        (businessDayStart(range.to).getTime() -
          businessDayStart(range.from).getTime()) /
          (24 * 3600 * 1000),
      ) + 1,
    );

    const productSales = await this.prisma.dailyProductSales.groupBy({
      by: ["productId"],
      where: { businessDate: { gte: range.from, lte: range.to } },
      _sum: { quantity: true, revenue: true, cost: true },
    });
    const inventory = await this.prisma.inventoryItem.findMany({
      include: { product: { select: { id: true, name: true, sku: true, sellingPrice: true } } },
    });
    const onHand = new Map<string, { qty: Prisma.Decimal; cost: Prisma.Decimal; product: (typeof inventory)[0]["product"] }>();
    for (const i of inventory) {
      const prev = onHand.get(i.productId) ?? {
        qty: D0(),
        cost: D0(),
        product: i.product,
      };
      prev.qty = prev.qty.add(i.quantityOnHand);
      prev.cost = prev.cost.add(i.quantityOnHand.mul(i.averageCost));
      onHand.set(i.productId, prev);
    }

    const items = productSales.map((row) => {
      const inv = onHand.get(row.productId);
      const qtySold = row._sum.quantity ?? D0();
      const avgDaily = qtySold.div(dayCount);
      const stock = inv?.qty ?? D0();
      const doi = avgDaily.gt(0) ? Number(stock.div(avgDaily).toFixed(1)) : null;
      const cogs = row._sum.cost ?? D0();
      const stockCost = inv?.cost ?? D0();
      const turns =
        opts.includeCost && stockCost.gt(0)
          ? Number(cogs.div(stockCost).toFixed(2))
          : null;
      return {
        productId: row.productId,
        name: inv?.product.name ?? row.productId,
        sku: inv?.product.sku ?? null,
        quantitySold: asQty(qtySold),
        quantityOnHand: asQty(stock),
        daysOfInventory: doi,
        ...(opts.includeCost
          ? {
              costOfGoodsSold: asMoney(cogs),
              stockValueCost: asMoney(stockCost),
              turnover: turns,
            }
          : {}),
      };
    });

    return { from: range.from, to: range.to, dayCount, items };
  }

  async deadStock(opts: { days?: number; includeCost?: boolean }) {
    const days = [30, 60, 90, 180].includes(opts.days ?? 90)
      ? (opts.days as number)
      : 90;
    const today = businessDateString();
    const since = addDays(today, -(days - 1));

    const sold = await this.prisma.dailyProductSales.findMany({
      where: { businessDate: { gte: since, lte: today } },
      select: { productId: true },
      distinct: ["productId"],
    });
    const soldIds = new Set(sold.map((s) => s.productId));

    const items = await this.prisma.inventoryItem.findMany({
      where: { quantityOnHand: { gt: 0 } },
      include: {
        product: { select: { id: true, name: true, sku: true, sellingPrice: true, isActive: true } },
      },
    });

    const map = new Map<
      string,
      { productId: string; name: string; sku: string | null; qty: Prisma.Decimal; cost: Prisma.Decimal; retail: Prisma.Decimal }
    >();
    for (const i of items) {
      if (!i.product.isActive) continue;
      if (soldIds.has(i.productId)) continue;
      const prev = map.get(i.productId) ?? {
        productId: i.productId,
        name: i.product.name,
        sku: i.product.sku,
        qty: D0(),
        cost: D0(),
        retail: D0(),
      };
      prev.qty = prev.qty.add(i.quantityOnHand);
      prev.cost = prev.cost.add(i.quantityOnHand.mul(i.averageCost));
      prev.retail = prev.retail.add(i.quantityOnHand.mul(i.product.sellingPrice));
      map.set(i.productId, prev);
    }

    return {
      days,
      since,
      items: [...map.values()]
        .sort((a, b) => (b.retail.gt(a.retail) ? 1 : -1))
        .map((r) => ({
          productId: r.productId,
          name: r.name,
          sku: r.sku,
          quantityOnHand: asQty(r.qty),
          valueRetail: asMoney(r.retail),
          ...(opts.includeCost ? { valueCost: asMoney(r.cost) } : {}),
        })),
    };
  }

  async overstock(opts: { coverDays?: number; includeCost?: boolean }) {
    const coverDays = Math.max(1, opts.coverDays ?? 90);
    const today = businessDateString();
    const from = addDays(today, -89);

    const sales = await this.prisma.dailyProductSales.groupBy({
      by: ["productId"],
      where: { businessDate: { gte: from, lte: today } },
      _sum: { quantity: true },
    });
    const rate = new Map<string, Prisma.Decimal>(
      sales.map((s) => [
        s.productId,
        (s._sum.quantity ?? D0()).div(90),
      ]),
    );

    const items = await this.prisma.inventoryItem.findMany({
      where: { quantityOnHand: { gt: 0 } },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            sellingPrice: true,
            maxStock: true,
          },
        },
      },
    });

    const map = new Map<
      string,
      { productId: string; name: string; sku: string | null; qty: Prisma.Decimal; cost: Prisma.Decimal; retail: Prisma.Decimal; maxStock: number }
    >();
    for (const i of items) {
      const prev = map.get(i.productId) ?? {
        productId: i.productId,
        name: i.product.name,
        sku: i.product.sku,
        qty: D0(),
        cost: D0(),
        retail: D0(),
        maxStock: i.product.maxStock,
      };
      prev.qty = prev.qty.add(i.quantityOnHand);
      prev.cost = prev.cost.add(i.quantityOnHand.mul(i.averageCost));
      prev.retail = prev.retail.add(i.quantityOnHand.mul(i.product.sellingPrice));
      map.set(i.productId, prev);
    }

    const over = [...map.values()].filter((r) => {
      const daily = rate.get(r.productId) ?? D0();
      if (daily.lte(0)) {
        return r.maxStock > 0 ? r.qty.gt(r.maxStock) : r.qty.gt(0);
      }
      const cover = r.qty.div(daily);
      return cover.gt(coverDays) || (r.maxStock > 0 && r.qty.gt(r.maxStock));
    });

    return {
      coverDays,
      items: over
        .sort((a, b) => (b.qty.gt(a.qty) ? 1 : -1))
        .map((r) => {
          const daily = rate.get(r.productId) ?? D0();
          return {
            productId: r.productId,
            name: r.name,
            sku: r.sku,
            quantityOnHand: asQty(r.qty),
            avgDailySales: asQty(daily),
            coverDays: daily.gt(0) ? Number(r.qty.div(daily).toFixed(1)) : null,
            valueRetail: asMoney(r.retail),
            ...(opts.includeCost ? { valueCost: asMoney(r.cost) } : {}),
          };
        }),
    };
  }

  async shrinkageReport(opts: {
    from?: string;
    to?: string;
    includeCost?: boolean;
  }) {
    const range = resolveReportRange({
      preset: opts.from && opts.to ? "custom" : "this_month",
      from: opts.from,
      to: opts.to,
    });
    const rows = await this.prisma.stockMovement.findMany({
      where: {
        type: { in: [MovementType.WRITE_OFF, MovementType.DAMAGE, MovementType.COUNT] },
        createdAt: { gte: range.start, lte: range.end },
      },
      include: {
        inventoryItem: {
          include: { product: { select: { name: true, sku: true } } },
        },
      },
    });

    let totalValue = D0();
    const items = rows.map((m) => {
      const value = (m.unitCost ?? D0()).mul(m.qtyDelta.abs());
      totalValue = totalValue.add(value);
      return {
        id: m.id,
        type: m.type,
        reasonCode: m.reasonCode,
        qtyDelta: asQty(m.qtyDelta),
        productName: m.inventoryItem.product.name,
        sku: m.inventoryItem.product.sku,
        createdAt: m.createdAt.toISOString(),
        ...(opts.includeCost ? { value: asMoney(value) } : {}),
      };
    });

    return {
      from: range.from,
      to: range.to,
      count: items.length,
      ...(opts.includeCost ? { totalValue: asMoney(totalValue) } : {}),
      items,
    };
  }

  async expiryLosses(opts: { from?: string; to?: string; includeCost?: boolean }) {
    const range = resolveReportRange({
      preset: opts.from && opts.to ? "custom" : "this_month",
      from: opts.from,
      to: opts.to,
    });
    const rows = await this.prisma.stockMovement.findMany({
      where: {
        type: MovementType.WRITE_OFF,
        reasonCode: AdjustReason.EXPIRED,
        createdAt: { gte: range.start, lte: range.end },
      },
      include: {
        inventoryItem: {
          include: {
            product: {
              select: {
                name: true,
                sku: true,
                category: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    let totalValue = D0();
    const byCategory = new Map<string, Prisma.Decimal>();
    const items = rows.map((m) => {
      const value = (m.unitCost ?? D0()).mul(m.qtyDelta.abs());
      totalValue = totalValue.add(value);
      const cat = m.inventoryItem.product.category.name;
      byCategory.set(cat, (byCategory.get(cat) ?? D0()).add(value));
      return {
        id: m.id,
        productName: m.inventoryItem.product.name,
        sku: m.inventoryItem.product.sku,
        category: cat,
        qtyDelta: asQty(m.qtyDelta),
        createdAt: m.createdAt.toISOString(),
        ...(opts.includeCost ? { value: asMoney(value) } : {}),
      };
    });

    return {
      from: range.from,
      to: range.to,
      ...(opts.includeCost
        ? {
            totalValue: asMoney(totalValue),
            byCategory: [...byCategory.entries()].map(([category, value]) => ({
              category,
              value: asMoney(value),
            })),
          }
        : {}),
      items,
    };
  }

  async marginAlerts(includeCost: boolean) {
    if (!includeCost) {
      return { thinMarginPct: THIN_MARGIN_PCT, items: [] as unknown[] };
    }
    const products = await this.prisma.product.findMany({
      where: { isActive: true, archivedAt: null },
      select: {
        id: true,
        name: true,
        sku: true,
        sellingPrice: true,
        costPrice: true,
      },
    });
    const items = products
      .map((p) => {
        const margin = p.sellingPrice.sub(p.costPrice);
        const marginPct = p.sellingPrice.gt(0)
          ? Number(margin.div(p.sellingPrice).mul(100).toFixed(2))
          : 0;
        return {
          productId: p.id,
          name: p.name,
          sku: p.sku,
          sellingPrice: asMoney(p.sellingPrice),
          costPrice: asMoney(p.costPrice),
          margin: asMoney(margin),
          marginPct,
          alert: margin.lt(0)
            ? ("negative" as const)
            : marginPct < THIN_MARGIN_PCT
              ? ("thin" as const)
              : null,
        };
      })
      .filter((p) => p.alert !== null);

    return {
      thinMarginPct: THIN_MARGIN_PCT,
      items,
    };
  }

  // ─── Purchasing reports ────────────────────────────────────────────────────

  async purchasesBySupplier(opts: { from?: string; to?: string }) {
    const range = resolveReportRange({
      preset: opts.from && opts.to ? "custom" : "this_month",
      from: opts.from,
      to: opts.to,
    });
    const receipts = await this.prisma.goodsReceipt.findMany({
      where: { receivedAt: { gte: range.start, lte: range.end } },
      include: {
        purchaseOrder: {
          include: { supplier: { select: { id: true, name: true } } },
        },
        lines: true,
        landedCosts: true,
      },
    });

    const map = new Map<
      string,
      {
        supplierId: string;
        supplierName: string;
        receiptCount: number;
        lineTotal: Prisma.Decimal;
        landedTotal: Prisma.Decimal;
      }
    >();
    for (const gr of receipts) {
      const supplierId =
        gr.supplierId ?? gr.purchaseOrder?.supplier.id ?? "unknown";
      const supplierName = gr.purchaseOrder?.supplier.name ?? "(unknown)";
      const prev = map.get(supplierId) ?? {
        supplierId,
        supplierName,
        receiptCount: 0,
        lineTotal: D0(),
        landedTotal: D0(),
      };
      prev.receiptCount += 1;
      for (const line of gr.lines) {
        prev.lineTotal = prev.lineTotal.add(line.unitCost.mul(line.quantity));
      }
      for (const lc of gr.landedCosts) {
        prev.landedTotal = prev.landedTotal.add(lc.amount);
      }
      map.set(supplierId, prev);
    }

    return {
      from: range.from,
      to: range.to,
      items: [...map.values()]
        .sort((a, b) => (b.lineTotal.gt(a.lineTotal) ? 1 : -1))
        .map((r) => ({
          supplierId: r.supplierId,
          supplierName: r.supplierName,
          receiptCount: r.receiptCount,
          merchandiseTotal: asMoney(r.lineTotal),
          landedCostTotal: asMoney(r.landedTotal),
          total: asMoney(r.lineTotal.add(r.landedTotal)),
        })),
    };
  }

  async openPurchaseOrders() {
    const pos = await this.prisma.purchaseOrder.findMany({
      where: {
        status: {
          in: [
            PurchaseOrderStatus.DRAFT,
            PurchaseOrderStatus.APPROVED,
            PurchaseOrderStatus.SENT,
            PurchaseOrderStatus.PARTIALLY_RECEIVED,
          ],
        },
      },
      include: {
        supplier: { select: { id: true, name: true } },
        lines: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      items: pos.map((po) => {
        const ordered = po.lines.reduce(
          (a, l) => a.add(l.quantityOrdered),
          D0(),
        );
        const received = po.lines.reduce(
          (a, l) => a.add(l.quantityReceived),
          D0(),
        );
        return {
          id: po.id,
          poNumber: po.poNumber,
          status: po.status,
          supplierId: po.supplierId,
          supplierName: po.supplier.name,
          expectedAt: po.expectedAt?.toISOString().slice(0, 10) ?? null,
          subtotal: asMoney(po.subtotal),
          quantityOrdered: asQty(ordered),
          quantityReceived: asQty(received),
          createdAt: po.createdAt.toISOString(),
        };
      }),
    };
  }

  agedPayables() {
    return this.bills.agedPayables();
  }

  async landedCostReport(opts: { from?: string; to?: string }) {
    const range = resolveReportRange({
      preset: opts.from && opts.to ? "custom" : "this_month",
      from: opts.from,
      to: opts.to,
    });
    const costs = await this.prisma.landedCost.findMany({
      where: {
        goodsReceipt: { receivedAt: { gte: range.start, lte: range.end } },
      },
      include: {
        goodsReceipt: {
          include: {
            purchaseOrder: {
              include: { supplier: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const byKind = new Map<string, Prisma.Decimal>();
    for (const c of costs) {
      byKind.set(c.kind, (byKind.get(c.kind) ?? D0()).add(c.amount));
    }

    return {
      from: range.from,
      to: range.to,
      byKind: [...byKind.entries()].map(([kind, amount]) => ({
        kind,
        amount: asMoney(amount),
      })),
      items: costs.map((c) => ({
        id: c.id,
        kind: c.kind,
        description: c.description,
        amount: asMoney(c.amount),
        allocateBy: c.allocateBy,
        goodsReceiptId: c.goodsReceiptId,
        supplierName: c.goodsReceipt.purchaseOrder?.supplier.name ?? null,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  // ─── CSV export ────────────────────────────────────────────────────────────

  async exportCsv(
    reportKey: string,
    query: Record<string, string | undefined>,
    includeCost: boolean,
  ) {
    const from = query.from;
    const to = query.to;
    switch (reportKey) {
      case "sales-by-day": {
        const data = await this.salesByDay({ from, to, includeCost });
        return this.exportSvc.build(
          "csv",
          `sales-by-day-${data.from}_${data.to}`,
          [
            { header: "Date", key: "date" },
            { header: "Sales", key: "saleCount" },
            { header: "Grand Total", key: "grandTotal" },
            { header: "Discount", key: "discountTotal" },
            { header: "Tax", key: "taxTotal" },
            ...(includeCost
              ? [
                  { header: "Cost", key: "costTotal" },
                  { header: "Profit", key: "profit" },
                ]
              : []),
          ],
          data.items,
        );
      }
      case "sales-by-product": {
        const data = await this.salesByProduct({
          from,
          to,
          groupBy: query.groupBy,
          includeCost,
        });
        return this.exportSvc.build(
          "csv",
          `sales-by-product-${data.from}_${data.to}`,
          [
            { header: "Key", key: "key" },
            { header: "Name", key: "name" },
            { header: "Quantity", key: "quantity" },
            { header: "Revenue", key: "revenue" },
            ...(includeCost
              ? [
                  { header: "Cost", key: "cost" },
                  { header: "Profit", key: "profit" },
                ]
              : []),
          ],
          data.items,
        );
      }
      case "stock-on-hand": {
        const data = await this.stockOnHand({
          locationId: query.locationId,
          categoryId: query.categoryId,
          includeCost,
        });
        return this.exportSvc.build(
          "csv",
          "stock-on-hand",
          [
            { header: "SKU", key: "sku" },
            { header: "Name", key: "name" },
            { header: "Category", key: "category" },
            { header: "Location", key: "locationCode" },
            { header: "On Hand", key: "quantityOnHand" },
            { header: "Retail Value", key: "retailValue" },
            ...(includeCost
              ? [
                  { header: "Avg Cost", key: "averageCost" },
                  { header: "Cost Value", key: "costValue" },
                ]
              : []),
          ],
          data.items,
        );
      }
      case "movements": {
        const data = await this.movementsReport({
          type: query.type as MovementType | undefined,
          userId: query.userId,
          from,
          to,
          locationId: query.locationId,
          productId: query.productId,
          take: 5000,
          includeCost,
        });
        return this.exportSvc.build(
          "csv",
          "movements",
          [
            { header: "When", key: "createdAt" },
            { header: "Type", key: "type" },
            { header: "Product", key: "productName" },
            { header: "SKU", key: "sku" },
            { header: "Location", key: "locationCode" },
            { header: "Qty", key: "qtyDelta" },
            { header: "User", key: "userName" },
            ...(includeCost ? [{ header: "Unit Cost", key: "unitCost" }] : []),
          ],
          data.items,
        );
      }
      case "dead-stock": {
        const data = await this.deadStock({
          days: query.days ? Number(query.days) : 90,
          includeCost,
        });
        return this.exportSvc.build(
          "csv",
          `dead-stock-${data.days}d`,
          [
            { header: "SKU", key: "sku" },
            { header: "Name", key: "name" },
            { header: "On Hand", key: "quantityOnHand" },
            { header: "Retail Value", key: "valueRetail" },
            ...(includeCost ? [{ header: "Cost Value", key: "valueCost" }] : []),
          ],
          data.items,
        );
      }
      case "purchases-by-supplier": {
        const data = await this.purchasesBySupplier({ from, to });
        return this.exportSvc.build(
          "csv",
          `purchases-by-supplier-${data.from}_${data.to}`,
          [
            { header: "Supplier", key: "supplierName" },
            { header: "Receipts", key: "receiptCount" },
            { header: "Merchandise", key: "merchandiseTotal" },
            { header: "Landed Costs", key: "landedCostTotal" },
            { header: "Total", key: "total" },
          ],
          data.items,
        );
      }
      default:
        throw new BadRequestException(`Unknown report key: ${reportKey}`);
    }
  }
}

/** Convert a business date string to a UTC Date at day start (helper for shift lookback). */
const addDaysDate = (date: string, days: number): Date =>
  businessDayStart(addDays(date, days));
