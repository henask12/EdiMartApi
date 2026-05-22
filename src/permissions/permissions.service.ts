import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PermissionKey } from "@prisma/client";
import { CASHIER_ROLE, isOwnerRoleName, OWNER_ROLE } from "../common/role.constants";
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from "./role-defaults";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPermissionsForRole(roleName: string): Promise<PermissionKey[]> {
    if (isOwnerRoleName(roleName)) {
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
      include: {
        permissions: { select: { permission: true } },
        _count: { select: { users: true } },
      },
    });
  }

  async getRoleById(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        permissions: { select: { permission: true } },
        _count: { select: { users: true } },
      },
    });
    if (!role) {
      throw new NotFoundException("Role not found");
    }
    return role;
  }

  mapRole(role: {
    id: string;
    name: string;
    isProtected: boolean;
    permissions: { permission: PermissionKey }[];
    _count: { users: number };
  }) {
    return {
      id: role.id,
      name: role.name,
      isProtected: role.isProtected,
      userCount: role._count.users,
      permissions: isOwnerRoleName(role.name)
        ? ALL_PERMISSIONS
        : role.permissions.map((p) => p.permission),
    };
  }

  async createRole(name: string, permissions?: PermissionKey[]) {
    const trimmed = name.trim().toUpperCase().replace(/\s+/g, "_");
    if (!trimmed || trimmed.length < 2) {
      throw new BadRequestException("Role name is required");
    }
    if (trimmed === OWNER_ROLE) {
      throw new BadRequestException("Cannot create a role named OWNER");
    }
    const existing = await this.prisma.role.findUnique({ where: { name: trimmed } });
    if (existing) {
      throw new BadRequestException("Role name already exists");
    }
    const perms = permissions?.length
      ? [...new Set(permissions)]
      : DEFAULT_ROLE_PERMISSIONS[CASHIER_ROLE] ?? [];
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

  async updateRole(
    id: string,
    data: { name?: string; permissions?: PermissionKey[] },
  ) {
    const role = await this.getRoleById(id);
    if (role.isProtected) {
      if (data.name && data.name !== role.name) {
        throw new BadRequestException("Owner role cannot be renamed");
      }
      if (data.permissions) {
        throw new BadRequestException("Owner role permissions cannot be changed");
      }
      return this.mapRole(role);
    }
    let name = role.name;
    if (data.name) {
      const trimmed = data.name.trim().toUpperCase().replace(/\s+/g, "_");
      if (trimmed === OWNER_ROLE) {
        throw new BadRequestException("Cannot rename to OWNER");
      }
      const dup = await this.prisma.role.findFirst({
        where: { name: trimmed, NOT: { id } },
      });
      if (dup) {
        throw new BadRequestException("Role name already exists");
      }
      name = trimmed;
    }
    if (data.permissions) {
      const unique = [...new Set(data.permissions)];
      const invalid = unique.filter((p) => !ALL_PERMISSIONS.includes(p));
      if (invalid.length > 0) {
        throw new BadRequestException("Invalid permission");
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

  async updateRolePermissionsByName(roleName: string, permissions: PermissionKey[]) {
    const role = await this.prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
      throw new NotFoundException("Role not found");
    }
    return this.updateRole(role.id, { permissions });
  }

  async deleteRole(id: string) {
    const role = await this.getRoleById(id);
    if (role.isProtected || isOwnerRoleName(role.name)) {
      throw new BadRequestException("This role cannot be deleted");
    }
    if (role._count.users > 0) {
      throw new BadRequestException("Remove or reassign users before deleting this role");
    }
    await this.prisma.role.delete({ where: { id } });
    return { ok: true };
  }

  async listUsersForRole(roleId: string, skip: number, take: number) {
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
}
