import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../../prisma/prisma.service";
import { PermissionsService } from "../../permissions/permissions.service";
import { AuthService } from "../auth.service";

type JwtPayload = {
  sub: string;
  jti?: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly auth: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>("JWT_SECRET"),
    });
  }

  async validate(payload: JwtPayload) {
    const session = await this.auth.validateSession(payload.jti, payload.sub);
    if (!session) {
      return null;
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    });
    if (!user || !user.isActive) {
      return null;
    }
    const permissions = await this.permissions.getPermissionsForRole(user.role.name);
    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      roleName: user.role.name,
      permissions,
      mustChangePassword: user.mustChangePassword,
      hasPin: Boolean(user.pinHash),
      locale: user.locale,
      jti: session.jti,
      totpEnabled: user.totpEnabled,
    };
  }
}
