import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PermissionKey, RoleName } from "@prisma/client";
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from "./role-defaults";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPermissionsForRole(roleName: RoleName): Promise<PermissionKey[]> {
    if (roleName === RoleName.OWNER) {
      return ALL_PERMISSIONS;
    }
    const role = await this.prisma.role.findUnique({
      where: { name: roleName },
      include: { permissions: true },
    });
    if (!role) {
      return DEFAULT_ROLE_PERMISSIONS[roleName] ?? [];
    }
    if (role.permissions.length === 0) {
      return DEFAULT_ROLE_PERMISSIONS[roleName] ?? [];
    }
    return role.permissions.map((p) => p.permission);
  }

  listRolesWithPermissions() {
    return this.prisma.role.findMany({
      orderBy: { name: "asc" },
      include: { permissions: { select: { permission: true } } },
    });
  }

  async updateRolePermissions(roleName: RoleName, permissions: PermissionKey[]) {
    const role = await this.prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
      throw new NotFoundException("Role not found");
    }
    if (role.isProtected || roleName === RoleName.OWNER) {
      throw new BadRequestException("The owner role permissions cannot be changed");
    }
    const unique = [...new Set(permissions)];
    const invalid = unique.filter((p) => !ALL_PERMISSIONS.includes(p));
    if (invalid.length > 0) {
      throw new BadRequestException("Invalid permission");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (unique.length > 0) {
        await tx.rolePermission.createMany({
          data: unique.map((permission) => ({ roleId: role.id, permission })),
        });
      }
    });
    return this.getPermissionsForRole(roleName);
  }
}
