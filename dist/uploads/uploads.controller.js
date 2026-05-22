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
exports.UploadsController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const role_constants_1 = require("../common/role.constants");
const multer_1 = require("multer");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const uploads_service_1 = require("./uploads.service");
let UploadsController = class UploadsController {
    uploads;
    constructor(uploads) {
        this.uploads = uploads;
    }
    uploadProductImage(file) {
        if (!file) {
            return { message: "No file uploaded" };
        }
        return this.uploads.saveProductImage(file);
    }
    uploadSaleProof(file) {
        if (!file) {
            return { message: "No file uploaded" };
        }
        return this.uploads.saveSaleProof(file);
    }
};
exports.UploadsController = UploadsController;
__decorate([
    (0, roles_decorator_1.Roles)(role_constants_1.OWNER_ROLE, role_constants_1.STORE_STAFF_ROLE),
    (0, common_1.Post)("product-image"),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)("file", {
        storage: (0, multer_1.memoryStorage)(),
        limits: { fileSize: 5 * 1024 * 1024 },
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], UploadsController.prototype, "uploadProductImage", null);
__decorate([
    (0, roles_decorator_1.Roles)(role_constants_1.OWNER_ROLE, role_constants_1.CASHIER_ROLE, role_constants_1.STORE_STAFF_ROLE),
    (0, common_1.Post)("sale-proof"),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)("file", {
        storage: (0, multer_1.memoryStorage)(),
        limits: { fileSize: 5 * 1024 * 1024 },
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], UploadsController.prototype, "uploadSaleProof", null);
exports.UploadsController = UploadsController = __decorate([
    (0, common_1.Controller)("uploads"),
    __metadata("design:paramtypes", [uploads_service_1.UploadsService])
], UploadsController);
//# sourceMappingURL=uploads.controller.js.map