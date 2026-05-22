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
exports.CatalogService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require(".prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const locations_service_1 = require("../locations/locations.service");
const audit_service_1 = require("../audit/audit.service");
const inventory_service_1 = require("../inventory/inventory.service");
const stock_util_1 = require("../common/stock.util");
const export_service_1 = require("../export/export.service");
const toDecimal = (value) => new client_1.Prisma.Decimal(value);
const autoSku = (name) => `auto-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${Date.now().toString(36)}`;
const productInclude = {
    category: true,
    productType: true,
    inventoryItems: { include: { location: true } },
};
const normalizeStockStatus = (value) => {
    if (!value)
        return undefined;
    const v = value.toLowerCase().trim();
    if (v === "out" || v === "out of stock")
        return "out of stock";
    if (v === "low" || v === "low stock")
        return "low stock";
    if (v === "in_stock" || v === "in stock")
        return "in_stock";
    return undefined;
};
let CatalogService = class CatalogService {
    prisma;
    locations;
    audit;
    inventory;
    exportService;
    constructor(prisma, locations, audit, inventory, exportService) {
        this.prisma = prisma;
        this.locations = locations;
        this.audit = audit;
        this.inventory = inventory;
        this.exportService = exportService;
    }
    stockStatus(available, restockAt) {
        if (available.lte(0)) {
            return "out of stock";
        }
        if (available.lte(restockAt)) {
            return "low stock";
        }
        return "in_stock";
    }
    async enrichProduct(product, locationId) {
        const { onHand, reserved, available } = await (0, stock_util_1.productStockSnapshot)(this.prisma, product.id, locationId);
        const imageUrl = product.imagePath
            ? `${(process.env.PUBLIC_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "")}${product.imagePath}`
            : null;
        return {
            ...product,
            imageUrl,
            onHand: onHand.toString(),
            reserved: reserved.toString(),
            available: available.toString(),
            stockStatus: this.stockStatus(available, product.restockAt),
            sellingPrice: product.sellingPrice.toFixed(2),
            costPrice: product.costPrice.toFixed(2),
        };
    }
    buildWhere(params) {
        const where = { isActive: true };
        if (params.q) {
            where.OR = [
                { name: { contains: params.q, mode: "insensitive" } },
                { sku: { contains: params.q, mode: "insensitive" } },
            ];
        }
        if (params.categoryId) {
            where.categoryId = params.categoryId;
        }
        if (params.productTypeId) {
            where.productTypeId = params.productTypeId;
        }
        return where;
    }
    async listProducts(params) {
        const take = Math.min(params.take ?? 100, 200);
        const skip = params.skip ?? 0;
        const where = this.buildWhere(params);
        const defaultLoc = await this.locations.getDefault();
        const stockFilter = normalizeStockStatus(params.stockStatus);
        if (stockFilter) {
            const raw = await this.prisma.product.findMany({
                where,
                orderBy: { name: "asc" },
                include: productInclude,
            });
            const enriched = await Promise.all(raw.map((p) => this.enrichProduct(p, defaultLoc.id)));
            const filtered = enriched.filter((p) => p.stockStatus === stockFilter);
            const total = filtered.length;
            const items = filtered.slice(skip, skip + take);
            return { items, total, skip, take };
        }
        const [raw, total] = await Promise.all([
            this.prisma.product.findMany({
                where,
                skip,
                take,
                orderBy: { name: "asc" },
                include: productInclude,
            }),
            this.prisma.product.count({ where }),
        ]);
        const items = await Promise.all(raw.map((p) => this.enrichProduct(p, defaultLoc.id)));
        return { items, total, skip, take };
    }
    async exportProducts(format, params) {
        const { items } = await this.listProducts({
            ...params,
            skip: 0,
            take: 10000,
        });
        const columns = [
            { header: "SKU", key: "sku" },
            { header: "Name", key: "name" },
            { header: "Type", key: "type" },
            { header: "Category", key: "category" },
            { header: "On hand", key: "onHand" },
            { header: "Available", key: "available" },
            { header: "Status", key: "status" },
            { header: "Cost", key: "cost" },
            { header: "Price", key: "price" },
        ];
        const rows = items.map((p) => ({
            sku: p.sku ?? "",
            name: p.name,
            type: p.productType?.name ?? "",
            category: p.category.name,
            onHand: p.onHand,
            available: p.available,
            status: p.stockStatus,
            cost: p.costPrice,
            price: p.sellingPrice,
        }));
        return this.exportService.build(format, `products-${Date.now()}`, columns, rows);
    }
    async getProduct(id) {
        const product = await this.prisma.product.findUnique({
            where: { id },
            include: productInclude,
        });
        if (!product) {
            throw new common_1.NotFoundException("Product not found");
        }
        const defaultLoc = await this.locations.getDefault();
        return this.enrichProduct(product, defaultLoc.id);
    }
    async createProduct(userId, data) {
        const name = data.name.trim();
        if (!name) {
            throw new common_1.BadRequestException("Product name is required");
        }
        const category = await this.prisma.category.findUnique({
            where: { id: data.categoryId },
        });
        if (!category) {
            throw new common_1.BadRequestException("Category not found");
        }
        if (data.productTypeId) {
            const pt = await this.prisma.productType.findUnique({ where: { id: data.productTypeId } });
            if (!pt) {
                throw new common_1.BadRequestException("Product type not found");
            }
        }
        const existing = await this.prisma.product.findUnique({
            where: { categoryId_name: { categoryId: data.categoryId, name } },
        });
        if (existing) {
            throw new common_1.BadRequestException("A product with this name already exists in this category");
        }
        const defaultLoc = await this.locations.getDefault();
        const cost = toDecimal(data.costPrice ?? 0);
        const product = await this.prisma.$transaction(async (tx) => {
            const created = await tx.product.create({
                data: {
                    sku: autoSku(name),
                    name,
                    categoryId: data.categoryId,
                    productTypeId: data.productTypeId ?? null,
                    imagePath: data.imagePath,
                    description: data.description?.trim() || null,
                    originCountry: data.originCountry?.trim() || null,
                    sellingPrice: toDecimal(data.sellingPrice),
                    costPrice: cost,
                    restockAt: data.restockAt ?? 0,
                    restockQty: data.restockQty ?? 0,
                },
            });
            await tx.inventoryItem.create({
                data: {
                    productId: created.id,
                    locationId: defaultLoc.id,
                    quantityOnHand: new client_1.Prisma.Decimal(0),
                    averageCost: cost,
                },
            });
            return created;
        });
        await this.audit.log(userId, "CREATE", "Product", product.id, { name });
        const initialQty = data.initialQuantity ? toDecimal(data.initialQuantity) : new client_1.Prisma.Decimal(0);
        if (initialQty.gt(0)) {
            await this.inventory.receiveGoods(userId, {
                productId: product.id,
                quantity: initialQty.toString(),
                unitCost: cost.toString(),
                expiryDate: data.initialExpiryDate,
                notes: "Opening stock",
            });
        }
        return this.getProduct(product.id);
    }
    async updateProduct(userId, id, data) {
        const existing = await this.ensureProduct(id);
        if (data.productTypeId) {
            const pt = await this.prisma.productType.findUnique({ where: { id: data.productTypeId } });
            if (!pt) {
                throw new common_1.BadRequestException("Product type not found");
            }
        }
        if (data.categoryId) {
            const cat = await this.prisma.category.findUnique({ where: { id: data.categoryId } });
            if (!cat) {
                throw new common_1.BadRequestException("Category not found");
            }
        }
        if (data.name !== undefined || data.categoryId !== undefined) {
            const targetCategoryId = data.categoryId ?? existing.categoryId;
            const targetName = (data.name ?? existing.name).trim();
            const dup = await this.prisma.product.findFirst({
                where: {
                    categoryId: targetCategoryId,
                    name: targetName,
                    NOT: { id },
                },
            });
            if (dup) {
                throw new common_1.BadRequestException("A product with this name already exists in this category");
            }
        }
        await this.prisma.product.update({
            where: { id },
            data: {
                name: data.name?.trim(),
                categoryId: data.categoryId,
                productTypeId: data.productTypeId !== undefined ? data.productTypeId : undefined,
                imagePath: data.imagePath,
                description: data.description !== undefined ? data.description.trim() || null : undefined,
                originCountry: data.originCountry !== undefined ? data.originCountry.trim() || null : undefined,
                sellingPrice: data.sellingPrice !== undefined ? toDecimal(data.sellingPrice) : undefined,
                costPrice: data.costPrice !== undefined ? toDecimal(data.costPrice) : undefined,
                restockAt: data.restockAt,
                restockQty: data.restockQty,
                isActive: data.isActive,
            },
        });
        await this.audit.log(userId, "UPDATE", "Product", id, { name: data.name });
        return this.getProduct(id);
    }
    async ensureProduct(id) {
        const p = await this.prisma.product.findUnique({ where: { id } });
        if (!p) {
            throw new common_1.NotFoundException("Product not found");
        }
        return p;
    }
};
exports.CatalogService = CatalogService;
exports.CatalogService = CatalogService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        locations_service_1.LocationsService,
        audit_service_1.AuditService,
        inventory_service_1.InventoryService,
        export_service_1.ExportService])
], CatalogService);
//# sourceMappingURL=catalog.service.js.map