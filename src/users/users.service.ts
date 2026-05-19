import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { RoleName } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
  }

  list() {
    return this.prisma.user.findMany({
      orderBy: { email: "asc" },
      select: {
        id: true,
        email: true,
        displayName: true,
        isActive: true,
        createdAt: true,
        role: { select: { id: true, name: true } },
      },
    });
  }

  async create(
    actorId: string,
    data: { email: string; displayName?: string; role: RoleName; password: string },
  ) {
    const email = data.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException("Email already in use");
    }
    const role = await this.prisma.role.findUnique({ where: { name: data.role } });
    if (!role) {
      throw new BadRequestException("Invalid role");
    }
    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email,
        displayName: data.displayName?.trim() || null,
        passwordHash,
        roleId: role.id,
        isActive: true,
      },
      include: { role: true },
    });
    await this.audit.log(actorId, "CREATE", "User", user.id, { email, role: data.role });
    return this.sanitizeUser(user);
  }

  async update(
    actorId: string,
    id: string,
    data: { displayName?: string; role?: RoleName; isActive?: boolean },
  ) {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException("User not found");
    }
    let roleId = user.roleId;
    if (data.role) {
      const role = await this.prisma.role.findUnique({ where: { name: data.role } });
      if (!role) {
        throw new BadRequestException("Invalid role");
      }
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

  async resetPassword(actorId: string, id: string, password: string) {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException("User not found");
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    await this.audit.log(actorId, "RESET_PASSWORD", "User", id);
    return { ok: true };
  }

  async updateProfile(
    userId: string,
    data: { displayName?: string; email?: string },
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
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { ok: true };
  }

  private sanitizeUser(user: {
    id: string;
    email: string;
    displayName: string | null;
    isActive: boolean;
    role: { name: RoleName };
  }) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isActive: user.isActive,
      role: user.role.name,
    };
  }
}
