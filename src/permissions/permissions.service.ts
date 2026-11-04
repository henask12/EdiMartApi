import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PermissionKey } from "@prisma/client";
import { CASHIER_ROLE, isOwnerRoleName, OWNER_ROLE } from "../common/role.constants";
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from "./role-defaults";
import { PrismaService } from "../prisma/prisma.service";

/** The signed-in person doing a role or user change. */
export type Actor = { userId: string; roleName: string; permissions: PermissionKey[] };

export const actorIsOwner = (actor: Pick<Actor, "roleName">) => isOwnerRoleName(actor.roleName);

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Exactly the permissions stored for the role; only the owner role is automatic. */
  async getPermissionsForRole(roleName: string): Promise<PermissionKey[]> {
    if (isOwnerRoleName(roleName)) {
      return ALL_PERMISSIONS;
    }
    const role = await this.prisma.role.findUnique({
      where: { name: roleName },
      include: { permissions: true },
    });
    return role ? role.permissions.map((p) => p.permission) : [];
  }

  /**
   * Nobody can hand out more than they hold: without this, anyone allowed to edit roles could give
   * themselves (or a friend) any permission, including cost/profit and stock corrections. The owner
   * is exempt, and nobody but the owner may edit their own role.
   */
  assertCanGrant(actor: Actor, granting: PermissionKey[], targetRoleName?: string) {
    if (actorIsOwner(actor)) {
      return;
    }
    if (targetRoleName && targetRoleName === actor.roleName) {
      throw new ForbiddenException("You cannot change the permissions of your own role");
    }
    const missing = granting.filter((p) => !actor.permissions.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `You can only grant permissions you have yourself (missing: ${missing.join(", ")})`,
      );
    }
  }

  /** May this actor put a user into this role? (the owner role is only for the owner) */
  assertCanAssignRole(actor: Actor, role: { name: string; permissions: { permission: PermissionKey }[] }) {
    if (actorIsOwner(actor)) {
      return;
    }
    if (isOwnerRoleName(role.name)) {
      throw new ForbiddenException("Only an owner can assign the owner role");
    }
    this.assertCanGrant(
      actor,
      role.permissions.map((p) => p.permission),
    );
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

  async createRole(actor: Actor, name: string, permissions?: PermissionKey[]) {
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
      : (DEFAULT_ROLE_PERMISSIONS[CASHIER_ROLE] ?? []).filter(
          // a new role starts with what the owner could hand over, never more than the creator has
          (p) => actorIsOwner(actor) || actor.permissions.includes(p),
        );
    this.assertCanGrant(actor, perms);
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
    actor: Actor,
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
      const before = new Set(role.permissions.map((p) => p.permission));
      this.assertCanGrant(
        actor,
        unique.filter((p) => !before.has(p)),
        role.name,
      );
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
