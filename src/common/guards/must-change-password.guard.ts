import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ALLOW_PASSWORD_CHANGE_KEY } from "../decorators/allow-password-change.decorator";

/**
 * Users flagged `mustChangePassword` (seeded accounts, admin-created or reset accounts) can do
 * nothing except read their own profile and change their password until they have done so.
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: { mustChangePassword?: boolean } }>();
    if (!request.user?.mustChangePassword) {
      return true;
    }
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) {
      return true;
    }
    throw new ForbiddenException({
      statusCode: 403,
      error: "Forbidden",
      code: "PASSWORD_CHANGE_REQUIRED",
      message: "You must change your password before continuing",
    });
  }
}
