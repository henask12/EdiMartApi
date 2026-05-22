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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogController = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const permissions_decorator_1 = require("../common/decorators/permissions.decorator");
const export_response_util_1 = require("../export/export-response.util");
const catalog_service_1 = require("./catalog.service");
const catalog_dto_1 = require("./dto/catalog.dto");
let CatalogController = class CatalogController {
    catalog;
    constructor(catalog) {
        this.catalog = catalog;
    }
    async exportProducts(res, format, q, categoryId, productTypeId, stockStatus) {
        const result = await this.catalog.exportProducts((0, export_response_util_1.parseExportFormat)(format), {
            q,
            categoryId,
            productTypeId,
            stockStatus,
        });
        (0, export_response_util_1.sendExport)(res, result);
    }
    listProducts(q, categoryId, productTypeId, stockStatus, skip, take) {
        return this.catalog.listProducts({
            q,
            categoryId,
            productTypeId,
            stockStatus,
            skip: skip ? Number(skip) : undefined,
            take: take ? Number(take) : undefined,
        });
    }
    getProduct(id) {
        return this.catalog.getProduct(id);
    }
    createProduct(req, body) {
        return this.catalog.createProduct(req.user.userId, body);
    }
    updateProduct(req, id, body) {
        return this.catalog.updateProduct(req.user.userId, id, body);
    }
};
exports.CatalogController = CatalogController;
__decorate([
    (0, common_1.Get)("export"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Query)("format")),
    __param(2, (0, common_1.Query)("q")),
    __param(3, (0, common_1.Query)("categoryId")),
    __param(4, (0, common_1.Query)("productTypeId")),
    __param(5, (0, common_1.Query)("stockStatus")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], CatalogController.prototype, "exportProducts", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)("q")),
    __param(1, (0, common_1.Query)("categoryId")),
    __param(2, (0, common_1.Query)("productTypeId")),
    __param(3, (0, common_1.Query)("stockStatus")),
    __param(4, (0, common_1.Query)("skip")),
    __param(5, (0, common_1.Query)("take")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "listProducts", null);
__decorate([
    (0, common_1.Get)(":id"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "getProduct", null);
__decorate([
    (0, permissions_decorator_1.RequirePermissions)(client_1.PermissionKey.PRODUCTS_CREATE),
    (0, common_1.Post)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, catalog_dto_1.CreateProductDto]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "createProduct", null);
__decorate([
    (0, permissions_decorator_1.RequirePermissions)(client_1.PermissionKey.PRODUCTS_EDIT),
    (0, common_1.Patch)(":id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, catalog_dto_1.UpdateProductDto]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "updateProduct", null);
exports.CatalogController = CatalogController = __decorate([
    (0, common_1.Controller)("products"),
    __metadata("design:paramtypes", [catalog_service_1.CatalogService])
], CatalogController);
//# sourceMappingURL=catalog.controller.js.map