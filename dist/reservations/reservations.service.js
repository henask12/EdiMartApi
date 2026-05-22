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
exports.ReservationsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const locations_service_1 = require("../locations/locations.service");
const audit_service_1 = require("../audit/audit.service");
const stock_util_1 = require("../common/stock.util");
const sales_service_1 = require("../sales/sales.service");
const toDecimal = (value) => new client_1.Prisma.Decimal(value);
let ReservationsService = class ReservationsService {
    prisma;
    locations;
    audit;
    sales;
    constructor(prisma, locations, audit, sales) {
        this.prisma = prisma;
        this.locations = locations;
        this.audit = audit;
        this.sales = sales;
    }
    async list(params) {
        const take = Math.min(params.take ?? 20, 100);
        const skip = params.skip ?? 0;
        const where = {
            status: params.status,
            productId: params.productId,
        };
        const [items, total] = await Promise.all([
            this.prisma.reservation.findMany({
                where,
                skip,
                take,
                orderBy: { createdAt: "desc" },
                include: {
                    product: { include: { category: true } },
                    createdBy: { select: { id: true, displayName: true, email: true } },
                },
            }),
            this.prisma.reservation.count({ where }),
        ]);
        return { items, total, skip, take };
    }
    async create(userId, data) {
        const qty = toDecimal(data.quantity);
        if (qty.lte(0)) {
            throw new common_1.BadRequestException("Quantity must be positive");
        }
        const defaultLoc = await this.locations.getDefault();
        const { inv, available } = await (0, stock_util_1.productStockSnapshot)(this.prisma, data.productId, defaultLoc.id);
        if (!inv) {
            throw new common_1.NotFoundException("No inventory for product");
        }
        if (available.lt(qty)) {
            throw new common_1.BadRequestException("Not enough available stock to reserve");
        }
        const reservation = await this.prisma.$transaction(async (tx) => {
            const created = await tx.reservation.create({
                data: {
                    productId: data.productId,
                    quantity: qty,
                    customerName: data.customerName?.trim() || null,
                    expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
                    createdByUserId: userId,
                },
                include: { product: true },
            });
            await tx.stockMovement.create({
                data: {
                    inventoryItemId: inv.id,
                    type: client_1.MovementType.RESERVE,
                    qtyDelta: qty,
                    refType: "RESERVATION",
                    refId: created.id,
                    createdByUserId: userId,
                    metadata: { reservationId: created.id },
                },
            });
            return created;
        });
        await this.audit.log(userId, "RESERVE", "Reservation", reservation.id, {
            productId: data.productId,
            quantity: data.quantity,
        });
        return reservation;
    }
    async cancel(userId, id) {
        const reservation = await this.prisma.reservation.findUnique({
            where: { id },
            include: { product: true },
        });
        if (!reservation) {
            throw new common_1.NotFoundException("Reservation not found");
        }
        if (reservation.status !== client_1.ReservationStatus.RESERVED) {
            throw new common_1.BadRequestException("Only active reservations can be cancelled");
        }
        const defaultLoc = await this.locations.getDefault();
        const inv = await this.prisma.inventoryItem.findUnique({
            where: {
                productId_locationId: {
                    productId: reservation.productId,
                    locationId: defaultLoc.id,
                },
            },
        });
        if (!inv) {
            throw new common_1.NotFoundException("Inventory not found");
        }
        const updated = await this.prisma.$transaction(async (tx) => {
            const res = await tx.reservation.update({
                where: { id },
                data: { status: client_1.ReservationStatus.CANCELLED },
                include: { product: true },
            });
            await tx.stockMovement.create({
                data: {
                    inventoryItemId: inv.id,
                    type: client_1.MovementType.RELEASE_RESERVE,
                    qtyDelta: reservation.quantity.mul(-1),
                    refType: "RESERVATION",
                    refId: id,
                    createdByUserId: userId,
                    metadata: { reservationId: id },
                },
            });
            return res;
        });
        await this.audit.log(userId, "CANCEL_RESERVE", "Reservation", id);
        return updated;
    }
    async completeAsSale(userId, id) {
        const reservation = await this.prisma.reservation.findUnique({
            where: { id },
        });
        if (!reservation) {
            throw new common_1.NotFoundException("Reservation not found");
        }
        if (reservation.status !== client_1.ReservationStatus.RESERVED) {
            throw new common_1.BadRequestException("Reservation is not active");
        }
        const checkout = await this.sales.checkout(userId, {
            lines: [
                {
                    productId: reservation.productId,
                    quantity: reservation.quantity.toString(),
                    reservationId: id,
                },
            ],
            notes: `Reservation ${id}`,
        });
        await this.audit.log(userId, "COMPLETE_RESERVE", "Reservation", id, {
            saleId: checkout.sale.id,
        });
        return {
            reservation: { ...reservation, status: client_1.ReservationStatus.COMPLETED },
            ...checkout,
        };
    }
};
exports.ReservationsService = ReservationsService;
exports.ReservationsService = ReservationsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        locations_service_1.LocationsService,
        audit_service_1.AuditService,
        sales_service_1.SalesService])
], ReservationsService);
//# sourceMappingURL=reservations.service.js.map