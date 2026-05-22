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
exports.RolesController = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require(".prisma/client");
const class_validator_1 = require("class-validator");
const permissions_decorator_1 = require("../common/decorators/permissions.decorator");
const permissions_service_1 = require("./permissions.service");
class CreateRoleDto {
    name;
    permissions;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(2),
    __metadata("design:type", String)
], CreateRoleDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsEnum)(client_1.PermissionKey, { each: true }),
    __metadata("design:type", Array)
], CreateRoleDto.prototype, "permissions", void 0);
class UpdateRoleDto {
    name;
    permissions;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(2),
    __metadata("design:type", String)
], UpdateRoleDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsEnum)(client_1.PermissionKey, { each: true }),
    __metadata("design:type", Array)
], UpdateRoleDto.prototype, "permissions", void 0);
class UpdateRolePermissionsDto {
    permissions;
}
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsEnum)(client_1.PermissionKey, { each: true }),
    __metadata("design:type", Array)
], UpdateRolePermissionsDto.prototype, "permissions", void 0);
let RolesController = class RolesController {
    permissions;
    constructor(permissions) {
        this.permissions = permissions;
    }
    async list() {
        const roles = await this.permissions.listRolesWithPermissions();
        return roles.map((r) => this.permissions.mapRole(r));
    }
    create(body) {
        return this.permissions.createRole(body.name, body.permissions);
    }
    async getOne(id) {
        const role = await this.permissions.getRoleById(id);
        return this.permissions.mapRole(role);
    }
    update(id, body) {
        return this.permissions.updateRole(id, body);
    }
    updatePermissions(id, body) {
        return this.permissions.updateRole(id, { permissions: body.permissions });
    }
    delete(id) {
        return this.permissions.deleteRole(id);
    }
    async listUsers(id, skip, take) {
        const s = skip ? Number(skip) : 0;
        const t = Math.min(take ? Number(take) : 25, 100);
        const [items, total] = await this.permissions.listUsersForRole(id, s, t);
        return { items, total, skip: s, take: t };
    }
};
exports.RolesController = RolesController;
__decorate([
    (0, permissions_decorator_1.RequirePermissions)(client_1.PermissionKey.ROLES_MANAGE),
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], RolesController.prototype, "list", null);
__decorate([
    (0, permissions_decorator_1.RequirePermissions)(client_1.PermissionKey.ROLES_MANAGE),
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CreateRoleDto]),
    __metadata("design:returntype", void 0)
], RolesController.prototype, "create", null);
__decorate([
    (0, permissions_decorator_1.RequirePermissions)(client_1.PermissionKey.ROLES_MANAGE),
    (0, common_1.Get)(":id"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RolesController.prototype, "getOne", null);
__decorate([
    (0, permissions_decorator_1.RequirePermissions)(client_1.PermissionKey.ROLES_MANAGE),
    (0, common_1.Patch)(":id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, UpdateRoleDto]),
    __metadata("design:returntype", void 0)
], RolesController.prototype, "update", null);
__decorate([
    (0, permissions_decorator_1.RequirePermissions)(client_1.PermissionKey.ROLES_MANAGE),
    (0, common_1.Patch)(":id/permissions"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, UpdateRolePermissionsDto]),
    __metadata("design:returntype", void 0)
], RolesController.prototype, "updatePermissions", null);
__decorate([
    (0, permissions_decorator_1.RequirePermissions)(client_1.PermissionKey.ROLES_MANAGE),
    (0, common_1.Delete)(":id"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], RolesController.prototype, "delete", null);
__decorate([
    (0, permissions_decorator_1.RequirePermissions)(client_1.PermissionKey.ROLES_MANAGE),
    (0, common_1.Get)(":id/users"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Query)("skip")),
    __param(2, (0, common_1.Query)("take")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], RolesController.prototype, "listUsers", null);
exports.RolesController = RolesController = __decorate([
    (0, common_1.Controller)("roles"),
    __metadata("design:paramtypes", [permissions_service_1.PermissionsService])
], RolesController);
//# sourceMappingURL=roles.controller.js.map