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
exports.PermissionsService = void 0;
const common_1 = require("@nestjs/common");
const role_constants_1 = require("../common/role.constants");
const role_defaults_1 = require("./role-defaults");
const prisma_service_1 = require("../prisma/prisma.service");
let PermissionsService = class PermissionsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getPermissionsForRole(roleName) {
        if ((0, role_constants_1.isOwnerRoleName)(roleName)) {
            return role_defaults_1.ALL_PERMISSIONS;
        }
        const role = await this.prisma.role.findUnique({
            where: { name: roleName },
            include: { permissions: true },
        });
        if (!role) {
            return role_defaults_1.DEFAULT_ROLE_PERMISSIONS[roleName] ?? [];
        }
        if (role.permissions.length === 0) {
            return role_defaults_1.DEFAULT_ROLE_PERMISSIONS[roleName] ?? [];
        }
        return role.permissions.map((p) => p.permission);
    }
    listRolesWithPermissions() {
        return this.prisma.role.findMany({
            orderBy: { name: "asc" },
            include: {
                permissions: { select: { permission: true } },
                _count: { select: { users: true } },
            },
        });
    }
    async getRoleById(id) {
        const role = await this.prisma.role.findUnique({
            where: { id },
            include: {
                permissions: { select: { permission: true } },
                _count: { select: { users: true } },
            },
        });
        if (!role) {
            throw new common_1.NotFoundException("Role not found");
        }
        return role;
    }
    mapRole(role) {
        return {
            id: role.id,
            name: role.name,
            isProtected: role.isProtected,
            userCount: role._count.users,
            permissions: (0, role_constants_1.isOwnerRoleName)(role.name)
                ? role_defaults_1.ALL_PERMISSIONS
                : role.permissions.map((p) => p.permission),
        };
    }
    async createRole(name, permissions) {
        const trimmed = name.trim().toUpperCase().replace(/\s+/g, "_");
        if (!trimmed || trimmed.length < 2) {
            throw new common_1.BadRequestException("Role name is required");
        }
        if (trimmed === role_constants_1.OWNER_ROLE) {
            throw new common_1.BadRequestException("Cannot create a role named OWNER");
        }
        const existing = await this.prisma.role.findUnique({ where: { name: trimmed } });
        if (existing) {
            throw new common_1.BadRequestException("Role name already exists");
        }
        const perms = permissions?.length
            ? [...new Set(permissions)]
            : role_defaults_1.DEFAULT_ROLE_PERMISSIONS[role_constants_1.CASHIER_ROLE] ?? [];
        const role = await this.prisma.role.create({
            data: {
                name: trimmed,
                isProtected: false,
                permissions: {
                    create: perms.map((permission) => ({ permission })),
                },
            },
            include: {
                permissions: { select: { permission: true } },
                _count: { select: { users: true } },
            },
        });
        return this.mapRole(role);
    }
    async updateRole(id, data) {
        const role = await this.getRoleById(id);
        if (role.isProtected) {
            if (data.name && data.name !== role.name) {
                throw new common_1.BadRequestException("Owner role cannot be renamed");
            }
            if (data.permissions) {
                throw new common_1.BadRequestException("Owner role permissions cannot be changed");
            }
            return this.mapRole(role);
        }
        let name = role.name;
        if (data.name) {
            const trimmed = data.name.trim().toUpperCase().replace(/\s+/g, "_");
            if (trimmed === role_constants_1.OWNER_ROLE) {
                throw new common_1.BadRequestException("Cannot rename to OWNER");
            }
            const dup = await this.prisma.role.findFirst({
                where: { name: trimmed, NOT: { id } },
            });
            if (dup) {
                throw new common_1.BadRequestException("Role name already exists");
            }
            name = trimmed;
        }
        if (data.permissions) {
            const unique = [...new Set(data.permissions)];
            const invalid = unique.filter((p) => !role_defaults_1.ALL_PERMISSIONS.includes(p));
            if (invalid.length > 0) {
                throw new common_1.BadRequestException("Invalid permission");
            }
            await this.prisma.$transaction(async (tx) => {
                await tx.rolePermission.deleteMany({ where: { roleId: id } });
                if (unique.length > 0) {
                    await tx.rolePermission.createMany({
                        data: unique.map((permission) => ({ roleId: id, permission })),
                    });
                }
            });
        }
        const updated = await this.prisma.role.update({
            where: { id },
            data: { name: data.name ? name : undefined },
            include: {
                permissions: { select: { permission: true } },
                _count: { select: { users: true } },
            },
        });
        return this.mapRole(updated);
    }
    async updateRolePermissionsByName(roleName, permissions) {
        const role = await this.prisma.role.findUnique({ where: { name: roleName } });
        if (!role) {
            throw new common_1.NotFoundException("Role not found");
        }
        return this.updateRole(role.id, { permissions });
    }
    async deleteRole(id) {
        const role = await this.getRoleById(id);
        if (role.isProtected || (0, role_constants_1.isOwnerRoleName)(role.name)) {
            throw new common_1.BadRequestException("This role cannot be deleted");
        }
        if (role._count.users > 0) {
            throw new common_1.BadRequestException("Remove or reassign users before deleting this role");
        }
        await this.prisma.role.delete({ where: { id } });
        return { ok: true };
    }
    async listUsersForRole(roleId, skip, take) {
        return Promise.all([
            this.prisma.user.findMany({
                where: { roleId },
                orderBy: { email: "asc" },
                skip,
                take,
                select: {
                    id: true,
                    email: true,
                    displayName: true,
                    isActive: true,
                    createdAt: true,
                    role: { select: { id: true, name: true } },
                },
            }),
            this.prisma.user.count({ where: { roleId } }),
        ]);
    }
};
exports.PermissionsService = PermissionsService;
exports.PermissionsService = PermissionsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PermissionsService);
//# sourceMappingURL=permissions.service.js.map