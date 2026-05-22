import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
export declare class UsersService {
    private readonly prisma;
    private readonly audit;
    constructor(prisma: PrismaService, audit: AuditService);
    findById(id: string): import("@prisma/client").Prisma.Prisma__UserClient<({
        role: {
            id: string;
            createdAt: Date;
            name: string;
            isProtected: boolean;
        };
    } & {
        id: string;
        createdAt: Date;
        email: string;
        passwordHash: string;
        displayName: string | null;
        isActive: boolean;
        roleId: string;
        updatedAt: Date;
    }) | null, null, import(".prisma/client/runtime/library").DefaultArgs, import("@prisma/client").Prisma.PrismaClientOptions>;
    list(params?: {
        skip?: number;
        take?: number;
    }): Promise<{
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
    create(actorId: string, data: {
        email: string;
        displayName?: string;
        role: string;
        password: string;
    }): Promise<{
        id: string;
        email: string;
        displayName: string | null;
        isActive: boolean;
        role: string;
        roleId: string;
    }>;
    update(actorId: string, id: string, data: {
        displayName?: string;
        role?: string;
        roleId?: string;
        isActive?: boolean;
    }): Promise<{
        id: string;
        email: string;
        displayName: string | null;
        isActive: boolean;
        role: string;
        roleId: string;
    }>;
    resetPassword(actorId: string, id: string, password: string): Promise<{
        ok: boolean;
    }>;
    updateProfile(userId: string, data: {
        displayName?: string;
        email?: string;
    }): Promise<{
        id: string;
        email: string;
        displayName: string | null;
        isActive: boolean;
        role: string;
        roleId: string;
    }>;
    changePassword(userId: string, currentPassword: string, newPassword: string): Promise<{
        ok: boolean;
    }>;
    private sanitizeUser;
}
