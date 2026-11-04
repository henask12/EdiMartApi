import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermissionKey } from "@prisma/client";
import { isOwnerRoleName } from "../role.constants";
import {
  ANY_AUTHENTICATED_KEY,
  ANY_PERMISSIONS_KEY,
  PERMISSIONS_KEY,
} from "../decorators/permissions.decorator";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

export type RequestUser = {
  userId?: string;
  roleName: string;
  permissions: PermissionKey[];
};

/**
 * The only authorisation rule in the API: permissions. Every route declares one of
 * @Public(), @AnyAuthenticated(), @RequirePermissions(...) or @RequireAnyPermission(...); the owner
 * role is the one automatic bypass. A route that declares nothing is refused (and the app does
 * not even start with one, see PermissionCoverageService).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }
    const user = context.switchToHttp().getRequest<{ user?: RequestUser }>().user;
    if (!user) {
      throw new ForbiddenException();
    }
    if (this.reflector.getAllAndOverride<boolean>(ANY_AUTHENTICATED_KEY, targets)) {
      return true;
    }

    const all = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, targets) ?? [];
    const any = this.reflector.getAllAndOverride<PermissionKey[]>(ANY_PERMISSIONS_KEY, targets) ?? [];
    if (all.length === 0 && any.length === 0) {
      throw new ForbiddenException("This route does not declare a permission");
    }
    if (isOwnerRoleName(user.roleName)) {
      return true;
    }
    if (!all.every((p) => user.permissions.includes(p))) {
      throw new ForbiddenException("Missing required permission");
    }
    if (any.length > 0 && !any.some((p) => user.permissions.includes(p))) {
      throw new ForbiddenException("Missing required permission");
    }
    return true;
  }
}
