"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportingService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const locations_service_1 = require("../locations/locations.service");
const sales_service_1 = require("../sales/sales.service");
const stock_util_1 = require("../common/stock.util");
let ReportingService = class ReportingService {
    prisma;
    locations;
    sales;
    constructor(prisma, locations, sales) {
        this.prisma = prisma;
        this.locations = locations;
        this.sales = sales;
    }
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
        const enriched = await Promise.all(items.map(async (row) => {
            const { available, reserved } = await (0, stock_util_1.productStockSnapshot)(this.prisma, row.productId, defaultLoc.id);
            return { row, available, reserved };
        }));
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
            status: available.lte(0) ? "OUT" : "LOW",
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
            where: { status: client_1.ReservationStatus.RESERVED },
            include: { product: true },
            orderBy: { createdAt: "desc" },
            take: 10,
        });
        let stockValue = new client_1.Prisma.Decimal(0);
        for (const row of items) {
            stockValue = stockValue.add(row.quantityOnHand.mul(row.averageCost));
        }
        return {
            today,
            week: { grandTotal: week.grandTotal, saleCount: week.saleCount },
            month: { grandTotal: month.grandTotal, saleCount: month.saleCount },
            year: { grandTotal: year.grandTotal, saleCount: year.saleCount },
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
    salesByPeriod(period, date) {
        return this.sales.salesForPeriod(period, date);
    }
};
exports.ReportingService = ReportingService;
exports.ReportingService = ReportingService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        locations_service_1.LocationsService,
        sales_service_1.SalesService])
], ReportingService);
//# sourceMappingURL=reporting.service.js.map