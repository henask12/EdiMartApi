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
exports.SalesController = void 0;
const common_1 = require("@nestjs/common");
const role_constants_1 = require("../common/role.constants");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const export_response_util_1 = require("../export/export-response.util");
const sales_service_1 = require("./sales.service");
class CheckoutLineDto {
    productId;
    quantity;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CheckoutLineDto.prototype, "productId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CheckoutLineDto.prototype, "quantity", void 0);
class CheckoutDto {
    lines;
    notes;
    proofImagePaths;
}
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => CheckoutLineDto),
    __metadata("design:type", Array)
], CheckoutDto.prototype, "lines", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CheckoutDto.prototype, "notes", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], CheckoutDto.prototype, "proofImagePaths", void 0);
let SalesController = class SalesController {
    sales;
    constructor(sales) {
        this.sales = sales;
    }
    async export(res, format, from, to) {
        const result = await this.sales.exportSales((0, export_response_util_1.parseExportFormat)(format), { from, to });
        (0, export_response_util_1.sendExport)(res, result);
    }
    list(skip, take, from, to) {
        return this.sales.listSales({
            skip: skip ? Number(skip) : undefined,
            take: take ? Number(take) : undefined,
            from,
            to,
        });
    }
    todaySummary() {
        return this.sales.todaySummary();
    }
    get(id) {
        return this.sales.getSale(id);
    }
    checkout(req, body) {
        return this.sales.checkout(req.user.userId, body);
    }
};
exports.SalesController = SalesController;
__decorate([
    (0, roles_decorator_1.Roles)(role_constants_1.OWNER_ROLE, role_constants_1.CASHIER_ROLE, role_constants_1.STORE_STAFF_ROLE),
    (0, common_1.Get)("export"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Query)("format")),
    __param(2, (0, common_1.Query)("from")),
    __param(3, (0, common_1.Query)("to")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", Promise)
], SalesController.prototype, "export", null);
__decorate([
    (0, roles_decorator_1.Roles)(role_constants_1.OWNER_ROLE, role_constants_1.CASHIER_ROLE, role_constants_1.STORE_STAFF_ROLE),
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)("skip")),
    __param(1, (0, common_1.Query)("take")),
    __param(2, (0, common_1.Query)("from")),
    __param(3, (0, common_1.Query)("to")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], SalesController.prototype, "list", null);
__decorate([
    (0, roles_decorator_1.Roles)(role_constants_1.OWNER_ROLE, role_constants_1.CASHIER_ROLE, role_constants_1.STORE_STAFF_ROLE),
    (0, common_1.Get)("today-summary"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SalesController.prototype, "todaySummary", null);
__decorate([
    (0, roles_decorator_1.Roles)(role_constants_1.OWNER_ROLE, role_constants_1.CASHIER_ROLE, role_constants_1.STORE_STAFF_ROLE),
    (0, common_1.Get)(":id"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SalesController.prototype, "get", null);
__decorate([
    (0, roles_decorator_1.Roles)(role_constants_1.OWNER_ROLE, role_constants_1.CASHIER_ROLE, role_constants_1.STORE_STAFF_ROLE),
    (0, common_1.Post)("checkout"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CheckoutDto]),
    __metadata("design:returntype", void 0)
], SalesController.prototype, "checkout", null);
exports.SalesController = SalesController = __decorate([
    (0, common_1.Controller)("sales"),
    __metadata("design:paramtypes", [sales_service_1.SalesService])
], SalesController);
//# sourceMappingURL=sales.controller.js.map