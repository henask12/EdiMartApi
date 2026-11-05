import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";
import { sessionTtlSeconds } from "../common/session";
import { generateTotpSecret, verifyTotpCode } from "../common/totp";
import { AuditService } from "../audit/audit.service";

const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

export type LoginMeta = {
  userAgent?: string;
  ip?: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, totpCode: string | undefined, meta: LoginMeta = {}) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { role: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Invalid credentials");
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException("Invalid credentials");
    }

    if (user.totpEnabled) {
      if (!totpCode?.trim() || !user.totpSecret) {
        throw new UnauthorizedException({
          statusCode: 401,
          error: "Unauthorized",
          code: "TOTP_REQUIRED",
          message: "Two-factor authentication code required",
        });
      }
      if (!verifyTotpCode(user.totpSecret, totpCode)) {
        throw new UnauthorizedException({
          statusCode: 401,
          error: "Unauthorized",
          code: "TOTP_REQUIRED",
          message: "Invalid two-factor authentication code",
        });
      }
    }

    const jti = randomUUID();
    const ttlSeconds = sessionTtlSeconds();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await this.prisma.authSession.create({
      data: {
        jti,
        userId: user.id,
        userAgent: meta.userAgent?.slice(0, 500) || null,
        ip: meta.ip?.slice(0, 64) || null,
        expiresAt,
      },
    });

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      role: user.role.name,
      jti,
    });
    return {
      accessToken,
      expiresInSeconds: ttlSeconds,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role.name,
        mustChangePassword: user.mustChangePassword,
        totpEnabled: user.totpEnabled,
      },
    };
  }

  async validateSession(jti: string | undefined, userId: string) {
    if (!jti) {
      return null;
    }
    const session = await this.prisma.authSession.findUnique({ where: { jti } });
    if (!session || session.userId !== userId) {
      return null;
    }
    if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    const age = Date.now() - session.lastSeenAt.getTime();
    if (age >= LAST_SEEN_THROTTLE_MS) {
      await this.prisma.authSession
        .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    }
    return session;
  }

  async listSessions(userId: string, currentJti?: string) {
    const sessions = await this.prisma.authSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      select: {
        id: true,
        jti: true,
        createdAt: true,
        lastSeenAt: true,
        userAgent: true,
        ip: true,
      },
    });
    return sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      userAgent: s.userAgent,
      ip: s.ip,
      current: Boolean(currentJti && s.jti === currentJti),
    }));
  }

  async revokeSession(userId: string, sessionId: string) {
    const session = await this.prisma.authSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) {
      throw new NotFoundException("Session not found");
    }
    if (!session.revokedAt) {
      await this.prisma.authSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(userId, "REVOKE_SESSION", "AuthSession", session.id);
    }
    return { ok: true };
  }

  async revokeOtherSessions(userId: string, currentJti: string | undefined) {
    if (!currentJti) {
      throw new BadRequestException("Current session is missing");
    }
    const result = await this.prisma.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        NOT: { jti: currentJti },
      },
      data: { revokedAt: new Date() },
    });
    await this.audit.log(userId, "REVOKE_OTHER_SESSIONS", "AuthSession", undefined, {
      count: result.count,
    });
    return { ok: true, revoked: result.count };
  }

  async logout(userId: string, jti: string | undefined) {
    if (!jti) {
      return { ok: true };
    }
    await this.prisma.authSession.updateMany({
      where: { userId, jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.log(userId, "LOGOUT", "AuthSession", undefined, { jti });
    return { ok: true };
  }

  async totpSetup(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabled) {
      throw new BadRequestException("Two-factor authentication is already enabled");
    }
    const { secret, otpauthUrl } = generateTotpSecret(user.email);
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: secret, totpEnabled: false },
    });
    await this.audit.log(userId, "TOTP_SETUP", "User", userId);
    return { secret, otpauthUrl };
  }

  async totpEnable(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabled) {
      throw new BadRequestException("Two-factor authentication is already enabled");
    }
    if (!user.totpSecret) {
      throw new BadRequestException("Call /auth/totp/setup first");
    }
    if (!verifyTotpCode(user.totpSecret, code)) {
      throw new BadRequestException("Invalid authentication code");
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: true },
    });
    await this.audit.log(userId, "TOTP_ENABLE", "User", userId);
    return { ok: true, totpEnabled: true };
  }

  async totpDisable(userId: string, password: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpEnabled || !user.totpSecret) {
      throw new BadRequestException("Two-factor authentication is not enabled");
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new BadRequestException("Current password is incorrect");
    }
    if (!verifyTotpCode(user.totpSecret, code)) {
      throw new BadRequestException("Invalid authentication code");
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: false, totpSecret: null },
    });
    await this.audit.log(userId, "TOTP_DISABLE", "User", userId);
    return { ok: true, totpEnabled: false };
  }

  updateProfile(userId: string, data: { displayName?: string; email?: string; locale?: string }) {
    return this.users.updateProfile(userId, data);
  }

  changePassword(userId: string, currentPassword: string, newPassword: string) {
    return this.users.changePassword(userId, currentPassword, newPassword);
  }
}
