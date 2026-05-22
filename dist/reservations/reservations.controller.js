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
exports.ReservationsController = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require(".prisma/client");
const role_constants_1 = require("../common/role.constants");
const class_validator_1 = require("class-validator");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const reservations_service_1 = require("./reservations.service");
class CreateReservationDto {
    productId;
    quantity;
    customerName;
    expiresAt;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateReservationDto.prototype, "productId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateReservationDto.prototype, "quantity", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateReservationDto.prototype, "customerName", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateReservationDto.prototype, "expiresAt", void 0);
let ReservationsController = class ReservationsController {
    reservations;
    constructor(reservations) {
        this.reservations = reservations;
    }
    list(status, productId, skip, take) {
        return this.reservations.list({
            status,
            productId,
            skip: skip ? Number(skip) : undefined,
            take: take ? Number(take) : undefined,
        });
    }
    create(req, body) {
        return this.reservations.create(req.user.userId, body);
    }
    cancel(req, id) {
        return this.reservations.cancel(req.user.userId, id);
    }
    complete(req, id) {
        return this.reservations.completeAsSale(req.user.userId, id);
    }
};
exports.ReservationsController = ReservationsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)("status")),
    __param(1, (0, common_1.Query)("productId")),
    __param(2, (0, common_1.Query)("skip")),
    __param(3, (0, common_1.Query)("take")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], ReservationsController.prototype, "list", null);
__decorate([
    (0, roles_decorator_1.Roles)(role_constants_1.OWNER_ROLE, role_constants_1.CASHIER_ROLE, role_constants_1.STORE_STAFF_ROLE),
    (0, common_1.Post)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CreateReservationDto]),
    __metadata("design:returntype", void 0)
], ReservationsController.prototype, "create", null);
__decorate([
    (0, roles_decorator_1.Roles)(role_constants_1.OWNER_ROLE, role_constants_1.CASHIER_ROLE, role_constants_1.STORE_STAFF_ROLE),
    (0, common_1.Post)(":id/cancel"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ReservationsController.prototype, "cancel", null);
__decorate([
    (0, roles_decorator_1.Roles)(role_constants_1.OWNER_ROLE, role_constants_1.CASHIER_ROLE),
    (0, common_1.Post)(":id/complete"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ReservationsController.prototype, "complete", null);
exports.ReservationsController = ReservationsController = __decorate([
    (0, common_1.Controller)("reservations"),
    __metadata("design:paramtypes", [reservations_service_1.ReservationsService])
], ReservationsController);
//# sourceMappingURL=reservations.controller.js.map