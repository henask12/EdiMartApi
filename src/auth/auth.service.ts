import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";
import { sessionTtlSeconds } from "../common/session";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  async login(email: string, password: string) {
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
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      role: user.role.name,
    });
    return {
      accessToken,
      // The web app uses this for the cookie lifetime, so it always matches the token.
      expiresInSeconds: sessionTtlSeconds(),
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role.name,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  updateProfile(userId: string, data: { displayName?: string; email?: string; locale?: string }) {
    return this.users.updateProfile(userId, data);
  }

  changePassword(userId: string, currentPassword: string, newPassword: string) {
    return this.users.changePassword(userId, currentPassword, newPassword);
  }
}
