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
exports.InventoryController = void 0;
const common_1 = require("@nestjs/common");
const role_constants_1 = require("../common/role.constants");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const inventory_service_1 = require("./inventory.service");
const class_validator_1 = require("class-validator");
class ReceiveDto {
    productId;
    quantity;
    unitCost;
    notes;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReceiveDto.prototype, "productId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReceiveDto.prototype, "quantity", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReceiveDto.prototype, "unitCost", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReceiveDto.prototype, "notes", void 0);
class AdjustDto {
    productId;
    quantityDelta;
    notes;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AdjustDto.prototype, "productId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AdjustDto.prototype, "quantityDelta", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AdjustDto.prototype, "notes", void 0);
class ReturnDto {
    productId;
    quantity;
    notes;
    refSaleId;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReturnDto.prototype, "productId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReturnDto.prototype, "quantity", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReturnDto.prototype, "notes", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReturnDto.prototype, "refSaleId", void 0);
let InventoryController = class InventoryController {
    inventory;
    constructor(inventory) {
        this.inventory = inventory;
    }
    listMovements(productId, skip, take) {
        return this.inventory.listMovements({
            productId,
            skip: skip ? Number(skip) : undefined,
            take: take ? Number(take) : undefined,
        });
    }
    receive(req, body) {
        return this.inventory.receiveGoods(req.user.userId, body);
    }
    adjust(req, body) {
        return this.inventory.adjustStock(req.user.userId, body);
    }
    returnToStock(req, body) {
        return this.inventory.returnToStock(req.user.userId, body);
    }
};
exports.InventoryController = InventoryController;
__decorate([
    (0, common_1.Get)("movements"),
    __param(0, (0, common_1.Query)("productId")),
    __param(1, (0, common_1.Query)("skip")),
    __param(2, (0, common_1.Query)("take")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "listMovements", null);
__decorate([
    (0, roles_decorator_1.Roles)(role_constants_1.OWNER_ROLE, role_constants_1.STORE_STAFF_ROLE),
    (0, common_1.Post)("receive"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, ReceiveDto]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "receive", null);
__decorate([
    (0, roles_decorator_1.Roles)(role_constants_1.OWNER_ROLE, role_constants_1.STORE_STAFF_ROLE),
    (0, common_1.Post)("adjust"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, AdjustDto]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "adjust", null);
__decorate([
    (0, roles_decorator_1.Roles)(role_constants_1.OWNER_ROLE, role_constants_1.CASHIER_ROLE, role_constants_1.STORE_STAFF_ROLE),
    (0, common_1.Post)("return"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, ReturnDto]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "returnToStock", null);
exports.InventoryController = InventoryController = __decorate([
    (0, common_1.Controller)("inventory"),
    __metadata("design:paramtypes", [inventory_service_1.InventoryService])
], InventoryController);
//# sourceMappingURL=inventory.controller.js.map