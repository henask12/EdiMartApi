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
exports.CategoriesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const audit_service_1 = require("../audit/audit.service");
let CategoriesService = class CategoriesService {
    prisma;
    audit;
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
    }
    list() {
        return this.prisma.category.findMany({
            orderBy: { name: "asc" },
            include: { _count: { select: { products: true } } },
        });
    }
    async get(id) {
        const cat = await this.prisma.category.findUnique({
            where: { id },
            include: { _count: { select: { products: true } } },
        });
        if (!cat) {
            throw new common_1.NotFoundException("Category not found");
        }
        return cat;
    }
    async create(userId, name) {
        const trimmed = name.trim();
        if (!trimmed) {
            throw new common_1.BadRequestException("Category name is required");
        }
        const existing = await this.prisma.category.findFirst({
            where: { name: { equals: trimmed, mode: "insensitive" } },
        });
        if (existing) {
            throw new common_1.BadRequestException("A category with this name already exists");
        }
        const cat = await this.prisma.category.create({ data: { name: trimmed } });
        await this.audit.log(userId, "CREATE", "Category", cat.id, { name: trimmed });
        return cat;
    }
    async update(userId, id, name) {
        await this.get(id);
        const trimmed = name.trim();
        if (!trimmed) {
            throw new common_1.BadRequestException("Category name is required");
        }
        const dup = await this.prisma.category.findFirst({
            where: {
                name: { equals: trimmed, mode: "insensitive" },
                NOT: { id },
            },
        });
        if (dup) {
            throw new common_1.BadRequestException("A category with this name already exists");
        }
        const cat = await this.prisma.category.update({
            where: { id },
            data: { name: trimmed },
        });
        await this.audit.log(userId, "UPDATE", "Category", id, { name: trimmed });
        return cat;
    }
    async remove(userId, id) {
        const count = await this.prisma.product.count({ where: { categoryId: id } });
        if (count > 0) {
            throw new common_1.BadRequestException("Cannot delete category with products");
        }
        await this.prisma.category.delete({ where: { id } });
        await this.audit.log(userId, "DELETE", "Category", id);
        return { ok: true };
    }
};
exports.CategoriesService = CategoriesService;
exports.CategoriesService = CategoriesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], CategoriesService);
//# sourceMappingURL=categories.service.js.map