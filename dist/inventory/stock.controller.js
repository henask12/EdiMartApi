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
exports.StockController = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require(".prisma/client");
const role_constants_1 = require("../common/role.constants");
const class_validator_1 = require("class-validator");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const export_response_util_1 = require("../export/export-response.util");
const inventory_service_1 = require("./inventory.service");
class ReceiveStockDto {
    productId;
    quantity;
    unitCost;
    expiryDate;
    notes;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReceiveStockDto.prototype, "productId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReceiveStockDto.prototype, "quantity", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReceiveStockDto.prototype, "unitCost", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReceiveStockDto.prototype, "expiryDate", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReceiveStockDto.prototype, "notes", void 0);
let StockController = class StockController {
    inventory;
    constructor(inventory) {
        this.inventory = inventory;
    }
    receive(req, body) {
        return this.inventory.receiveGoods(req.user.userId, body);
    }
    async exportHistory(res, format, productId, type, from, to) {
        const result = await this.inventory.exportMovements((0, export_response_util_1.parseExportFormat)(format), {
            productId,
            type,
            from,
            to,
        });
        (0, export_response_util_1.sendExport)(res, result);
    }
    getMovement(id) {
        return this.inventory.getMovement(id);
    }
    history(productId, type, from, to, skip, take) {
        return this.inventory.listMovements({
            productId,
            type,
            from,
            to,
            skip: skip ? Number(skip) : undefined,
            take: take ? Number(take) : undefined,
        });
    }
    batches(productId, skip, take) {
        return this.inventory.listBatches(productId, {
            skip: skip ? Number(skip) : undefined,
            take: take ? Number(take) : undefined,
        });
    }
};
exports.StockController = StockController;
__decorate([
    (0, roles_decorator_1.Roles)(role_constants_1.OWNER_ROLE, role_constants_1.STORE_STAFF_ROLE),
    (0, common_1.Post)("receive"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, ReceiveStockDto]),
    __metadata("design:returntype", void 0)
], StockController.prototype, "receive", null);
__decorate([
    (0, common_1.Get)("history/export"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Query)("format")),
    __param(2, (0, common_1.Query)("productId")),
    __param(3, (0, common_1.Query)("type")),
    __param(4, (0, common_1.Query)("from")),
    __param(5, (0, common_1.Query)("to")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], StockController.prototype, "exportHistory", null);
__decorate([
    (0, common_1.Get)("history/:id"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], StockController.prototype, "getMovement", null);
__decorate([
    (0, common_1.Get)("history"),
    __param(0, (0, common_1.Query)("productId")),
    __param(1, (0, common_1.Query)("type")),
    __param(2, (0, common_1.Query)("from")),
    __param(3, (0, common_1.Query)("to")),
    __param(4, (0, common_1.Query)("skip")),
    __param(5, (0, common_1.Query)("take")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], StockController.prototype, "history", null);
__decorate([
    (0, common_1.Get)("batches"),
    __param(0, (0, common_1.Query)("productId")),
    __param(1, (0, common_1.Query)("skip")),
    __param(2, (0, common_1.Query)("take")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], StockController.prototype, "batches", null);
exports.StockController = StockController = __decorate([
    (0, common_1.Controller)("stock"),
    __metadata("design:paramtypes", [inventory_service_1.InventoryService])
], StockController);
//# sourceMappingURL=stock.controller.js.map