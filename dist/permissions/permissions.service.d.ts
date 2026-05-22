import { PermissionKey } from ".prisma/client";
import { PrismaService } from "../prisma/prisma.service";
export declare class PermissionsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getPermissionsForRole(roleName: string): Promise<PermissionKey[]>;
    listRolesWithPermissions(): import(".prisma/client").Prisma.PrismaPromise<({
        permissions: {
            permission: import(".prisma/client").$Enums.PermissionKey;
        }[];
        _count: {
            users: number;
        };
    } & {
        id: string;
        createdAt: Date;
        name: string;
        isProtected: boolean;
    })[]>;
    getRoleById(id: string): Promise<{
        permissions: {
            permission: import(".prisma/client").$Enums.PermissionKey;
        }[];
        _count: {
            users: number;
        };
    } & {
        id: string;
        createdAt: Date;
        name: string;
        isProtected: boolean;
    }>;
    mapRole(role: {
        id: string;
        name: string;
        isProtected: boolean;
        permissions: {
            permission: PermissionKey;
        }[];
        _count: {
            users: number;
        };
    }): {
        id: string;
        name: string;
        isProtected: boolean;
        userCount: number;
        permissions: import(".prisma/client").$Enums.PermissionKey[];
    };
    createRole(name: string, permissions?: PermissionKey[]): Promise<{
        id: string;
        name: string;
        isProtected: boolean;
        userCount: number;
        permissions: import(".prisma/client").$Enums.PermissionKey[];
    }>;
    updateRole(id: string, data: {
        name?: string;
        permissions?: PermissionKey[];
    }): Promise<{
        id: string;
        name: string;
        isProtected: boolean;
        userCount: number;
        permissions: import(".prisma/client").$Enums.PermissionKey[];
    }>;
    updateRolePermissionsByName(roleName: string, permissions: PermissionKey[]): Promise<{
        id: string;
        name: string;
        isProtected: boolean;
        userCount: number;
        permissions: import(".prisma/client").$Enums.PermissionKey[];
    }>;
    deleteRole(id: string): Promise<{
        ok: boolean;
    }>;
    listUsersForRole(roleId: string, skip: number, take: number): Promise<[{
        role: {
            id: string;
            name: string;
        };
        id: string;
        createdAt: Date;
        email: string;
        displayName: string | null;
        isActive: boolean;
    }[], number]>;
}
