import { PermissionKey } from "@prisma/client";
import { SetMetadata } from "@nestjs/common";

export const PERMISSIONS_KEY = "permissions";
export const ANY_PERMISSIONS_KEY = "anyPermissions";
export const ANY_AUTHENTICATED_KEY = "anyAuthenticated";

/** The caller needs ALL of these permissions (the owner always passes). */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** The caller needs AT LEAST ONE of these permissions (the owner always passes). */
export const RequireAnyPermission = (...permissions: PermissionKey[]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissions);

/**
 * Any signed-in user may call this route (their own profile, their own password...). It must be
 * written out explicitly: a route with no permission declaration at all is refused at startup.
 */
export const AnyAuthenticated = () => SetMetadata(ANY_AUTHENTICATED_KEY, true);
