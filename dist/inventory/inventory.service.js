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
exports.InventoryService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const locations_service_1 = require("../locations/locations.service");
const audit_service_1 = require("../audit/audit.service");
const notifications_service_1 = require("../notifications/notifications.service");
const date_range_util_1 = require("../common/date-range.util");
const export_service_1 = require("../export/export.service");
const toDecimal = (value) => new client_1.Prisma.Decimal(value);
let InventoryService = class InventoryService {
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
    async listMovements(params) {
        const take = Math.min(params.take ?? 100, 500);
        const skip = params.skip ?? 0;
        const where = {};
        if (params.productId) {
            where.inventoryItem = { productId: params.productId };
        }
        if (params.type) {
            where.type = params.type;
        }
        const createdAt = (0, date_range_util_1.buildCreatedAtRange)(params.from, params.to);
        if (createdAt) {
            where.createdAt = createdAt;
        }
        const [items, total] = await Promise.all([
            this.prisma.stockMovement.findMany({
                where,
                orderBy: { createdAt: "desc" },
                take,
                skip,
                include: {
                    inventoryItem: { include: { product: { include: { category: true } }, location: true } },
                    stockBatch: true,
                    createdBy: { select: { id: true, email: true, displayName: true } },
                },
            }),
            this.prisma.stockMovement.count({ where }),
        ]);
        return { items, total, skip, take };
    }
    async getMovement(id) {
        const movement = await this.prisma.stockMovement.findUnique({
            where: { id },
            include: {
                inventoryItem: {
                    include: {
                        product: { include: { category: true, productType: true } },
                        location: true,
                    },
                },
                stockBatch: true,
                createdBy: { select: { id: true, email: true, displayName: true } },
            },
        });
        if (!movement) {
            throw new common_1.NotFoundException("Stock movement not found");
        }
        const batch = movement.stockBatch;
        return {
            ...movement,
            qtyDelta: movement.qtyDelta.toString(),
            beforeOnHand: movement.beforeOnHand?.toString() ?? null,
            afterOnHand: movement.afterOnHand?.toString() ?? null,
            unitCost: movement.unitCost?.toString() ?? null,
            stockBatch: batch
                ? {
                    ...batch,
                    qtyReceived: batch.qtyReceived.toString(),
                    qtyRemaining: batch.qtyRemaining.toString(),
                    unitCost: batch.unitCost.toString(),
                }
                : null,
        };
    }
    async exportMovements(format, params) {
        const { items } = await this.listMovements({ ...params, skip: 0, take: 5000 });
        const columns = [
            { header: "Date", key: "date" },
            { header: "Product", key: "product" },
            { header: "Category", key: "category" },
            { header: "Type", key: "type" },
            { header: "Qty", key: "qty" },
            { header: "Before", key: "before" },
            { header: "After", key: "after" },
            { header: "Notes", key: "notes" },
        ];
        const rows = items.map((m) => ({
            date: m.createdAt.toISOString().slice(0, 16).replace("T", " "),
            product: m.inventoryItem.product.name,
            category: m.inventoryItem.product.category.name,
            type: m.type,
            qty: m.qtyDelta.toString(),
            before: m.beforeOnHand?.toString() ?? "",
            after: m.afterOnHand?.toString() ?? "",
            notes: m.notes ?? "",
        }));
        return this.exportService.build(format, `stock-history-${Date.now()}`, columns, rows);
    }
    listBatches(productId, params) {
        if (!productId) {
            throw new common_1.BadRequestException("productId is required");
        }
        const take = Math.min(params?.take ?? 50, 200);
        const skip = params?.skip ?? 0;
        return this.prisma.stockBatch.findMany({
            where: { productId },
            orderBy: { receivedAt: "desc" },
            skip,
            take,
            include: {
                receivedBy: { select: { id: true, displayName: true, email: true } },
            },
        });
    }
    async receiveGoods(userId, data) {
        const qty = toDecimal(data.quantity);
        if (qty.lte(0)) {
            throw new common_1.BadRequestException("Quantity must be positive");
        }
        const unitCost = toDecimal(data.unitCost);
        if (unitCost.lt(0)) {
            throw new common_1.BadRequestException("Unit cost must be non-negative");
        }
        const defaultLoc = await this.locations.getDefault();
        const inv = await this.prisma.inventoryItem.findUnique({
            where: {
                productId_locationId: {
                    productId: data.productId,
                    locationId: defaultLoc.id,
                },
            },
        });
        if (!inv) {
            throw new common_1.NotFoundException("Inventory row not found for product");
        }
        const expiryDate = data.expiryDate ? new Date(data.expiryDate) : null;
        if (expiryDate && Number.isNaN(expiryDate.getTime())) {
            throw new common_1.BadRequestException("Invalid expiry date");
        }
        const updated = await this.prisma.$transaction(async (tx) => {
            const current = await tx.inventoryItem.findUniqueOrThrow({
                where: { id: inv.id },
            });
            const beforeOnHand = current.quantityOnHand;
            const afterOnHand = beforeOnHand.add(qty);
            const oldAvg = current.averageCost;
            let newAvg = unitCost;
            if (afterOnHand.gt(0)) {
                const numerator = beforeOnHand.mul(oldAvg).add(qty.mul(unitCost));
                newAvg = numerator.div(afterOnHand);
            }
            const batch = await tx.stockBatch.create({
                data: {
                    productId: data.productId,
                    qtyReceived: qty,
                    qtyRemaining: qty,
                    unitCost,
                    expiryDate,
                    receivedByUserId: userId,
                },
            });
            await tx.stockMovement.create({
                data: {
                    inventoryItemId: current.id,
                    stockBatchId: batch.id,
                    type: client_1.MovementType.RECEIPT,
                    qtyDelta: qty,
                    unitCost,
                    beforeOnHand,
                    afterOnHand,
                    refType: "STOCK_BATCH",
                    refId: batch.id,
                    notes: data.notes,
                    createdByUserId: userId,
                    metadata: { batchId: batch.id, expiryDate: expiryDate?.toISOString() },
                },
            });
            return tx.inventoryItem.update({
                where: { id: current.id },
                data: { quantityOnHand: afterOnHand, averageCost: newAvg },
            });
        });
        await this.audit.log(userId, "RECEIPT", "InventoryItem", updated.id, {
            productId: data.productId,
            quantity: data.quantity,
        });
        await this.notifications.checkLowStockForProduct(data.productId);
        return updated;
    }
    async adjustStock(userId, data) {
        const delta = toDecimal(data.quantityDelta);
        if (delta.eq(0)) {
            throw new common_1.BadRequestException("quantityDelta cannot be zero");
        }
        const defaultLoc = await this.locations.getDefault();
        const inv = await this.prisma.inventoryItem.findUnique({
            where: {
                productId_locationId: {
                    productId: data.productId,
                    locationId: defaultLoc.id,
                },
            },
        });
        if (!inv) {
            throw new common_1.NotFoundException("Inventory row not found for product");
        }
        const updated = await this.prisma.$transaction(async (tx) => {
            const current = await tx.inventoryItem.findUniqueOrThrow({
                where: { id: inv.id },
            });
            const beforeOnHand = current.quantityOnHand;
            const nextQty = beforeOnHand.add(delta);
            if (nextQty.lt(0)) {
                throw new common_1.BadRequestException("Adjustment would make quantity negative");
            }
            await tx.stockMovement.create({
                data: {
                    inventoryItemId: current.id,
                    type: client_1.MovementType.ADJUSTMENT,
                    qtyDelta: delta,
                    beforeOnHand,
                    afterOnHand: nextQty,
                    refType: "MANUAL_ADJUSTMENT",
                    notes: data.notes,
                    createdByUserId: userId,
                },
            });
            return tx.inventoryItem.update({
                where: { id: current.id },
                data: { quantityOnHand: nextQty },
            });
        });
        await this.audit.log(userId, "ADJUST", "InventoryItem", updated.id, {
            productId: data.productId,
            quantityDelta: data.quantityDelta,
        });
        await this.notifications.checkLowStockForProduct(data.productId);
        return updated;
    }
    async returnToStock(userId, data) {
        const qty = toDecimal(data.quantity);
        if (qty.lte(0)) {
            throw new common_1.BadRequestException("Quantity must be positive");
        }
        const defaultLoc = await this.locations.getDefault();
        const inv = await this.prisma.inventoryItem.findUnique({
            where: {
                productId_locationId: {
                    productId: data.productId,
                    locationId: defaultLoc.id,
                },
            },
        });
        if (!inv) {
            throw new common_1.NotFoundException("Inventory row not found for product");
        }
        const updated = await this.prisma.$transaction(async (tx) => {
            const current = await tx.inventoryItem.findUniqueOrThrow({
                where: { id: inv.id },
            });
            const beforeOnHand = current.quantityOnHand;
            const afterOnHand = beforeOnHand.add(qty);
            await tx.stockMovement.create({
                data: {
                    inventoryItemId: current.id,
                    type: client_1.MovementType.RETURN,
                    qtyDelta: qty,
                    beforeOnHand,
                    afterOnHand,
                    refType: data.refSaleId ? "SALE_RETURN" : "MANUAL_RETURN",
                    refId: data.refSaleId,
                    notes: data.notes,
                    createdByUserId: userId,
                },
            });
            return tx.inventoryItem.update({
                where: { id: current.id },
                data: { quantityOnHand: afterOnHand },
            });
        });
        await this.audit.log(userId, "RETURN", "InventoryItem", updated.id, {
            productId: data.productId,
            quantity: data.quantity,
        });
        await this.notifications.checkLowStockForProduct(data.productId);
        return updated;
    }
};
exports.InventoryService = InventoryService;
exports.InventoryService = InventoryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        locations_service_1.LocationsService,
        audit_service_1.AuditService,
        notifications_service_1.NotificationsService,
        export_service_1.ExportService])
], InventoryService);
//# sourceMappingURL=inventory.service.js.map