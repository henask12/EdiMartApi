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
exports.SalesService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const locations_service_1 = require("../locations/locations.service");
const audit_service_1 = require("../audit/audit.service");
const stock_util_1 = require("../common/stock.util");
const notifications_service_1 = require("../notifications/notifications.service");
const date_range_util_1 = require("../common/date-range.util");
const export_service_1 = require("../export/export.service");
const toDecimal = (value) => new client_1.Prisma.Decimal(value);
const apiBase = () => (process.env.PUBLIC_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
let SalesService = class SalesService {
    prisma;
    locations;
    audit;
    notifications;
    exportService;
    constructor(prisma, locations, audit, notifications, exportService) {
        this.prisma = prisma;
        this.locations = locations;
        this.audit = audit;
        this.notifications = notifications;
        this.exportService = exportService;
    }
    mapSale(sale) {
        return {
            ...sale,
            grandTotal: sale.grandTotal.toFixed(2),
            subtotal: sale.subtotal.toFixed(2),
            attachments: sale.attachments.map((a) => ({
                id: a.id,
                imagePath: a.imagePath,
                imageUrl: `${apiBase()}${a.imagePath}`,
                createdAt: a.createdAt,
            })),
        };
    }
    async listSales(params) {
        const take = Math.min(params.take ?? 50, 200);
        const skip = params.skip ?? 0;
        const where = {};
        const createdAt = (0, date_range_util_1.buildCreatedAtRange)(params.from, params.to);
        if (createdAt) {
            where.createdAt = createdAt;
        }
        const [items, total] = await Promise.all([
            this.prisma.sale.findMany({
                where,
                skip,
                take,
                orderBy: { createdAt: "desc" },
                include: {
                    lines: { include: { product: true } },
                    createdBy: { select: { id: true, displayName: true, email: true } },
                    attachments: true,
                },
            }),
            this.prisma.sale.count({ where }),
        ]);
        return {
            items: items.map((s) => this.mapSale(s)),
            total,
            skip,
            take,
        };
    }
    async getSale(id) {
        const sale = await this.prisma.sale.findUnique({
            where: { id },
            include: {
                lines: { include: { product: true } },
                createdBy: { select: { id: true, displayName: true, email: true } },
                attachments: true,
                payments: true,
            },
        });
        if (!sale) {
            throw new common_1.NotFoundException("Sale not found");
        }
        return this.mapSale(sale);
    }
    async exportSales(format, params) {
        const { items } = await this.listSales({ ...params, skip: 0, take: 5000 });
        const columns = [
            { header: "Sale #", key: "saleNumber" },
            { header: "Date", key: "date" },
            { header: "Total", key: "total" },
            { header: "Items", key: "items" },
            { header: "Cashier", key: "cashier" },
        ];
        const rows = items.map((s) => ({
            saleNumber: s.saleNumber,
            date: s.createdAt.toISOString().slice(0, 16).replace("T", " "),
            total: s.grandTotal,
            items: s.lines
                .map((l) => `${l.product.name} x${l.quantity.toString()}`)
                .join("; "),
            cashier: s.createdBy.displayName ?? s.createdBy.email,
        }));
        return this.exportService.build(format, `sales-${Date.now()}`, columns, rows);
    }
    async checkout(userId, input) {
        if (!input.lines?.length) {
            throw new common_1.BadRequestException("Add at least one product");
        }
        const defaultLoc = await this.locations.getDefault();
        const productIds = [...new Set(input.lines.map((l) => l.productId))];
        const products = await this.prisma.product.findMany({
            where: { id: { in: productIds }, isActive: true },
        });
        const productById = new Map(products.map((p) => [p.id, p]));
        const computedLines = [];
        for (const line of input.lines) {
            const product = productById.get(line.productId);
            if (!product) {
                throw new common_1.NotFoundException(`Product not found`);
            }
            const qty = toDecimal(line.quantity);
            if (qty.lte(0)) {
                throw new common_1.BadRequestException("Quantity must be positive");
            }
            if (line.reservationId) {
                const reservation = await this.prisma.reservation.findUnique({
                    where: { id: line.reservationId },
                });
                if (!reservation || reservation.status !== client_1.ReservationStatus.RESERVED) {
                    throw new common_1.BadRequestException("Reservation is not active");
                }
                if (reservation.productId !== line.productId) {
                    throw new common_1.BadRequestException("Reservation does not match product");
                }
                if (!reservation.quantity.eq(qty)) {
                    throw new common_1.BadRequestException("Quantity must match reservation");
                }
                const { onHand } = await (0, stock_util_1.productStockSnapshot)(this.prisma, line.productId, defaultLoc.id);
                if (onHand.lt(qty)) {
                    throw new common_1.BadRequestException(`Not enough stock on hand for ${product.name}`);
                }
            }
            else {
                const { available } = await (0, stock_util_1.productStockSnapshot)(this.prisma, line.productId, defaultLoc.id);
                if (available.lt(qty)) {
                    throw new common_1.BadRequestException(`Not enough available stock for ${product.name}`);
                }
            }
            const lineTotal = product.sellingPrice.mul(qty);
            computedLines.push({
                productId: product.id,
                quantity: qty,
                unitPrice: product.sellingPrice,
                lineTotal,
                reservationId: line.reservationId,
            });
        }
        const grandTotal = computedLines.reduce((acc, l) => acc.add(l.lineTotal), new client_1.Prisma.Decimal(0));
        const proofPaths = (input.proofImagePaths ?? []).filter((p) => p.startsWith("/uploads/"));
        const receipt = await this.prisma.$transaction(async (tx) => {
            const start = new Date();
            start.setUTCHours(0, 0, 0, 0);
            const count = await tx.sale.count({
                where: { createdAt: { gte: start } },
            });
            const y = start.getUTCFullYear();
            const m = String(start.getUTCMonth() + 1).padStart(2, "0");
            const d = String(start.getUTCDate()).padStart(2, "0");
            const seq = String(count + 1).padStart(4, "0");
            const saleNumber = `SALE-${y}${m}${d}-${seq}`;
            const sale = await tx.sale.create({
                data: {
                    saleNumber,
                    subtotal: grandTotal,
                    discountTotal: 0,
                    taxTotal: 0,
                    grandTotal,
                    createdByUserId: userId,
                    lines: {
                        create: computedLines.map((l) => ({
                            productId: l.productId,
                            quantity: l.quantity,
                            unitPrice: l.unitPrice,
                            lineDiscount: 0,
                            taxAmount: 0,
                            lineTotal: l.lineTotal,
                        })),
                    },
                    payments: {
                        create: [{ method: client_1.PaymentMethod.CASH, amount: grandTotal }],
                    },
                    attachments: proofPaths.length
                        ? { create: proofPaths.map((imagePath) => ({ imagePath })) }
                        : undefined,
                },
                include: {
                    lines: { include: { product: true } },
                    attachments: true,
                },
            });
            for (const line of computedLines) {
                const inv = await tx.inventoryItem.findUniqueOrThrow({
                    where: {
                        productId_locationId: {
                            productId: line.productId,
                            locationId: defaultLoc.id,
                        },
                    },
                });
                const beforeOnHand = inv.quantityOnHand;
                const afterOnHand = beforeOnHand.sub(line.quantity);
                await tx.stockMovement.create({
                    data: {
                        inventoryItemId: inv.id,
                        type: client_1.MovementType.SALE,
                        qtyDelta: line.quantity.mul(new client_1.Prisma.Decimal(-1)),
                        beforeOnHand,
                        afterOnHand,
                        refType: "SALE",
                        refId: sale.id,
                        createdByUserId: userId,
                        notes: input.notes,
                    },
                });
                await tx.inventoryItem.update({
                    where: { id: inv.id },
                    data: { quantityOnHand: afterOnHand },
                });
                if (line.reservationId) {
                    await tx.reservation.update({
                        where: { id: line.reservationId },
                        data: { status: client_1.ReservationStatus.COMPLETED },
                    });
                    await tx.stockMovement.create({
                        data: {
                            inventoryItemId: inv.id,
                            type: client_1.MovementType.RELEASE_RESERVE,
                            qtyDelta: line.quantity.mul(new client_1.Prisma.Decimal(-1)),
                            refType: "RESERVATION",
                            refId: line.reservationId,
                            createdByUserId: userId,
                            metadata: { reservationId: line.reservationId, fulfilledBySale: sale.id },
                        },
                    });
                }
            }
            return sale;
        }, {
            isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 5000,
            timeout: 15000,
        });
        await this.audit.log(userId, "SELL", "Sale", receipt.id, {
            saleNumber: receipt.saleNumber,
        });
        for (const line of computedLines) {
            await this.notifications.checkStockAlertsForProduct(line.productId);
        }
        const full = await this.getSale(receipt.id);
        return {
            sale: full,
            digitalReceipt: this.buildReceiptText(receipt),
        };
    }
    async todaySummary() {
        return this.salesInRange(this.dayBounds(new Date()));
    }
    async salesInRange(range) {
        const sales = await this.prisma.sale.findMany({
            where: { createdAt: { gte: range.start, lt: range.end } },
            include: { lines: { include: { product: true } } },
        });
        const total = sales.reduce((a, s) => a.add(s.grandTotal), new client_1.Prisma.Decimal(0));
        const productQty = new Map();
        for (const sale of sales) {
            for (const line of sale.lines) {
                const key = line.productId;
                const prev = productQty.get(key) ?? {
                    name: line.product.name,
                    qty: new client_1.Prisma.Decimal(0),
                    revenue: new client_1.Prisma.Decimal(0),
                };
                prev.qty = prev.qty.add(line.quantity);
                prev.revenue = prev.revenue.add(line.lineTotal);
                productQty.set(key, prev);
            }
        }
        const topProducts = [...productQty.values()]
            .sort((a, b) => (b.revenue.gt(a.revenue) ? 1 : -1))
            .slice(0, 5)
            .map((p) => ({
            name: p.name,
            quantity: p.qty.toString(),
            revenue: p.revenue.toFixed(2),
        }));
        return {
            period: range.label,
            start: range.start.toISOString(),
            end: range.end.toISOString(),
            saleCount: sales.length,
            grandTotal: total.toFixed(2),
            topProducts,
        };
    }
    salesForPeriod(period, anchor) {
        const base = anchor ? new Date(anchor) : new Date();
        if (Number.isNaN(base.getTime())) {
            throw new common_1.BadRequestException("Invalid date");
        }
        switch (period) {
            case "day":
                return this.salesInRange(this.dayBounds(base));
            case "week":
                return this.salesInRange(this.weekBounds(base));
            case "month":
                return this.salesInRange(this.monthBounds(base));
            case "year":
                return this.salesInRange(this.yearBounds(base));
            default:
                throw new common_1.BadRequestException("Invalid period");
        }
    }
    dayBounds(d) {
        const start = new Date(d);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        return { start, end, label: start.toISOString().slice(0, 10) };
    }
    weekBounds(d) {
        const start = new Date(d);
        start.setHours(0, 0, 0, 0);
        const day = start.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        start.setDate(start.getDate() + diff);
        const end = new Date(start);
        end.setDate(end.getDate() + 7);
        return {
            start,
            end,
            label: `week-${start.toISOString().slice(0, 10)}`,
        };
    }
    monthBounds(d) {
        const start = new Date(d.getFullYear(), d.getMonth(), 1);
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        return {
            start,
            end,
            label: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
        };
    }
    yearBounds(d) {
        const start = new Date(d.getFullYear(), 0, 1);
        const end = new Date(d.getFullYear() + 1, 0, 1);
        return { start, end, label: String(start.getFullYear()) };
    }
    buildReceiptText(sale) {
        const lines = sale.lines
            .map((l) => `${l.product.name} x${l.quantity.toString()} @ ${l.unitPrice.toFixed(2)} = ${l.lineTotal.toFixed(2)}`)
            .join("\n");
        return [
            "Edi's Collection",
            `Sale ${sale.saleNumber}`,
            "----------------",
            lines,
            "----------------",
            `Total: ${sale.grandTotal.toFixed(2)}`,
        ].join("\n");
    }
};
exports.SalesService = SalesService;
exports.SalesService = SalesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        locations_service_1.LocationsService,
        audit_service_1.AuditService,
        notifications_service_1.NotificationsService,
        export_service_1.ExportService])
], SalesService);
//# sourceMappingURL=sales.service.js.map