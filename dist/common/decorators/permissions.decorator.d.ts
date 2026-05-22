import { PermissionKey } from "@prisma/client";
export declare const PERMISSIONS_KEY = "permissions";
export declare const RequirePermissions: (...permissions: PermissionKey[]) => import("@nestjs/common").CustomDecorator<string>;
