import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { isOwnerRoleName, OWNER_ROLE } from "../common/role.constants";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { Actor, actorIsOwner, PermissionsService } from "../permissions/permissions.service";
import { ForbiddenException } from "@nestjs/common";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * Managing someone means being at least as powerful as them: an owner account can only be
   * touched by an owner, and nobody can reset the password of (or edit) a user whose role grants
   * more than their own.
   */
  private async assertCanManage(actor: Actor, target: { roleId: string; role: { name: string } }) {
    if (actorIsOwner(actor)) {
      return;
    }
    if (target.role.name === OWNER_ROLE) {
      throw new ForbiddenException("Only an owner can change an owner account");
    }
    const role = await this.prisma.role.findUniqueOrThrow({
      where: { id: target.roleId },
      include: { permissions: true },
    });
    this.permissions.assertCanAssignRole(actor, role);
  }

  findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
  }

  async list(params?: { skip?: number; take?: number }) {
    const skip = params?.skip ?? 0;
    const take = Math.min(params?.take ?? 50, 100);
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
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
      this.prisma.user.count(),
    ]);
    return { items, total, skip, take };
  }

  async create(
    actor: Actor,
    data: { email: string; displayName?: string; role: string; password: string },
  ) {
    const actorId = actor.userId;
    const email = data.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException("Email already in use");
    }
    const role = await this.prisma.role.findFirst({
      where: { name: data.role.trim().toUpperCase() },
      include: { permissions: true },
    });
    if (!role) {
      throw new BadRequestException("Invalid role");
    }
    this.permissions.assertCanAssignRole(actor, role);
    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email,
        displayName: data.displayName?.trim() || null,
        passwordHash,
        roleId: role.id,
        isActive: true,
        // The admin chose this password, so the person it is for must replace it.
        mustChangePassword: true,
      },
      include: { role: true },
    });
    await this.audit.log(actorId, "CREATE", "User", user.id, { email, role: role.name });
    return this.sanitizeUser(user);
  }

  async update(
    actor: Actor,
    id: string,
    data: { displayName?: string; role?: string; roleId?: string; isActive?: boolean },
  ) {
    const actorId = actor.userId;
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException("User not found");
    }
    await this.assertCanManage(actor, user);
    if (isOwnerRoleName(user.role.name)) {
      if (data.isActive === false) {
        throw new BadRequestException("Owner accounts cannot be deactivated");
      }
      if (data.role && data.role !== OWNER_ROLE) {
        throw new BadRequestException("Owner role cannot be changed");
      }
      if (data.roleId) {
        const target = await this.prisma.role.findUnique({ where: { id: data.roleId } });
        if (target && !isOwnerRoleName(target.name)) {
          throw new BadRequestException("Owner role cannot be changed");
        }
      }
    }
    let roleId = user.roleId;
    if (data.roleId) {
      const role = await this.prisma.role.findUnique({
        where: { id: data.roleId },
        include: { permissions: true },
      });
      if (!role) {
        throw new BadRequestException("Invalid role");
      }
      this.permissions.assertCanAssignRole(actor, role);
      roleId = role.id;
    } else if (data.role) {
      const role = await this.prisma.role.findFirst({
        where: { name: data.role.trim().toUpperCase() },
        include: { permissions: true },
      });
      if (!role) {
        throw new BadRequestException("Invalid role");
      }
      this.permissions.assertCanAssignRole(actor, role);
      roleId = role.id;
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        displayName: data.displayName !== undefined ? data.displayName.trim() || null : undefined,
        roleId,
        isActive: data.isActive,
      },
      include: { role: true },
    });
    await this.audit.log(actorId, "UPDATE", "User", id, data);
    return this.sanitizeUser(updated);
  }

  async resetPassword(actor: Actor, id: string, password: string) {
    const actorId = actor.userId;
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException("User not found");
    }
    await this.assertCanManage(actor, user);
    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true },
    });
    await this.audit.log(actorId, "RESET_PASSWORD", "User", id);
    return { ok: true };
  }

  async updateProfile(
    userId: string,
    data: { displayName?: string; email?: string; locale?: string },
  ) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException("User not found");
    }
    if (data.email) {
      const email = data.email.trim().toLowerCase();
      const dup = await this.prisma.user.findFirst({
        where: { email, NOT: { id: userId } },
      });
      if (dup) {
        throw new BadRequestException("Email already in use");
      }
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        email: data.email ? data.email.trim().toLowerCase() : undefined,
        displayName:
          data.displayName !== undefined ? data.displayName.trim() || null : undefined,
        locale: data.locale !== undefined ? (data.locale || null) : undefined,
      },
      include: { role: true },
    });
    return this.sanitizeUser(updated);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      throw new BadRequestException("Current password is incorrect");
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException("Choose a new password that is different from the current one");
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });
    await this.audit.log(userId, "CHANGE_PASSWORD", "User", userId);
    return { ok: true };
  }

  private sanitizeUser(user: {
    id: string;
    email: string;
    displayName: string | null;
    isActive: boolean;
    role: { id: string; name: string };
  }) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isActive: user.isActive,
      role: user.role.name,
      roleId: user.role.id,
    };
  }
}
