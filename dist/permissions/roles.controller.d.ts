import { PermissionKey } from ".prisma/client";
import { PermissionsService } from "./permissions.service";
declare class CreateRoleDto {
    name: string;
    permissions?: PermissionKey[];
}
declare class UpdateRoleDto {
    name?: string;
    permissions?: PermissionKey[];
}
declare class UpdateRolePermissionsDto {
    permissions: PermissionKey[];
}
export declare class RolesController {
    private readonly permissions;
    constructor(permissions: PermissionsService);
    list(): Promise<{
        id: string;
        name: string;
        isProtected: boolean;
        userCount: number;
        permissions: import(".prisma/client").$Enums.PermissionKey[];
    }[]>;
    create(body: CreateRoleDto): Promise<{
        id: string;
        name: string;
        isProtected: boolean;
        userCount: number;
        permissions: import(".prisma/client").$Enums.PermissionKey[];
    }>;
    getOne(id: string): Promise<{
        id: string;
        name: string;
        isProtected: boolean;
        userCount: number;
        permissions: import(".prisma/client").$Enums.PermissionKey[];
    }>;
    update(id: string, body: UpdateRoleDto): Promise<{
        id: string;
        name: string;
        isProtected: boolean;
        userCount: number;
        permissions: import(".prisma/client").$Enums.PermissionKey[];
    }>;
    updatePermissions(id: string, body: UpdateRolePermissionsDto): Promise<{
        id: string;
        name: string;
        isProtected: boolean;
        userCount: number;
        permissions: import(".prisma/client").$Enums.PermissionKey[];
    }>;
    delete(id: string): Promise<{
        ok: boolean;
    }>;
    listUsers(id: string, skip?: string, take?: string): Promise<{
        items: {
            role: {
                id: string;
                name: string;
            };
            id: string;
            createdAt: Date;
            email: string;
            displayName: string | null;
            isActive: boolean;
        }[];
        total: number;
        skip: number;
        take: number;
    }>;
}
export {};
