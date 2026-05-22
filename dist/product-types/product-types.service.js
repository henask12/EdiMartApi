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
exports.ProductTypesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const audit_service_1 = require("../audit/audit.service");
let ProductTypesService = class ProductTypesService {
    prisma;
    audit;
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
    }
    list() {
        return this.prisma.productType.findMany({
            orderBy: { name: "asc" },
            include: { _count: { select: { products: true } } },
        });
    }
    async get(id) {
        const row = await this.prisma.productType.findUnique({
            where: { id },
            include: { _count: { select: { products: true } } },
        });
        if (!row) {
            throw new common_1.NotFoundException("Product type not found");
        }
        return row;
    }
    async create(userId, name) {
        const trimmed = name.trim();
        if (!trimmed) {
            throw new common_1.BadRequestException("Type name is required");
        }
        const existing = await this.prisma.productType.findUnique({ where: { name: trimmed } });
        if (existing) {
            throw new common_1.BadRequestException("Product type already exists");
        }
        const row = await this.prisma.productType.create({ data: { name: trimmed } });
        await this.audit.log(userId, "CREATE", "ProductType", row.id, { name: trimmed });
        return row;
    }
    async update(userId, id, name) {
        await this.get(id);
        const trimmed = name.trim();
        if (!trimmed) {
            throw new common_1.BadRequestException("Type name is required");
        }
        const dup = await this.prisma.productType.findFirst({
            where: { name: trimmed, NOT: { id } },
        });
        if (dup) {
            throw new common_1.BadRequestException("Product type name already in use");
        }
        const row = await this.prisma.productType.update({
            where: { id },
            data: { name: trimmed },
        });
        await this.audit.log(userId, "UPDATE", "ProductType", id, { name: trimmed });
        return row;
    }
    async remove(userId, id) {
        const count = await this.prisma.product.count({ where: { productTypeId: id } });
        if (count > 0) {
            throw new common_1.BadRequestException("Cannot delete type with products");
        }
        await this.prisma.productType.delete({ where: { id } });
        await this.audit.log(userId, "DELETE", "ProductType", id);
        return { ok: true };
    }
};
exports.ProductTypesService = ProductTypesService;
exports.ProductTypesService = ProductTypesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], ProductTypesService);
//# sourceMappingURL=product-types.service.js.map