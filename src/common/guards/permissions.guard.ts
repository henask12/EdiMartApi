import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermissionKey } from ".prisma/client";
import { isOwnerRoleName } from "../role.constants";
import { PERMISSIONS_KEY } from "../decorators/permissions.decorator";

export type RequestUser = {
  roleName: string;
  permissions: PermissionKey[];
};

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException();
    }
    if (isOwnerRoleName(user.roleName)) {
      return true;
    }
    const hasAll = required.every((p) => user.permissions.includes(p));
    if (!hasAll) {
      throw new ForbiddenException("Missing required permission");
    }
    return true;
  }
}
