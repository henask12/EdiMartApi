import { PermissionKey } from "@prisma/client";
import { SetMetadata } from "@nestjs/common";

export const PERMISSIONS_KEY = "permissions";

export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
