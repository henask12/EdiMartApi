import { Injectable } from "@nestjs/common";
import { Prisma, ReservationStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { SalesService } from "../sales/sales.service";
import { productStockSnapshot } from "../common/stock.util";

@Injectable()
export class ReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
    private readonly sales: SalesService,
  ) {}

  async dashboard() {
    const defaultLoc = await this.locations.getDefault();
    const today = await this.sales.todaySummary();
    const week = await this.sales.salesForPeriod("week");
    const month = await this.sales.salesForPeriod("month");
    const year = await this.sales.salesForPeriod("year");

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

    let stockValue = new Prisma.Decimal(0);
    for (const row of items) {
      stockValue = stockValue.add(row.quantityOnHand.mul(row.averageCost));
    }

    return {
      today: {
        grandTotal: today.grandTotal,
        saleCount: today.saleCount,
        netProfit: today.netProfit,
      },
      week: {
        grandTotal: week.grandTotal,
        saleCount: week.saleCount,
        netProfit: week.netProfit,
      },
      month: {
        grandTotal: month.grandTotal,
        saleCount: month.saleCount,
        netProfit: month.netProfit,
      },
      year: {
        grandTotal: year.grandTotal,
        saleCount: year.saleCount,
        netProfit: year.netProfit,
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
      stockValue: stockValue.toFixed(2),
      productCount: items.length,
    };
  }

  salesByPeriod(period: "day" | "week" | "month" | "year", date?: string) {
    return this.sales.salesForPeriod(period, date);
  }
}
