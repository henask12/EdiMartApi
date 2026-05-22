import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
export declare class ProductTypesService {
    private readonly prisma;
    private readonly audit;
    constructor(prisma: PrismaService, audit: AuditService);
    list(): import("@prisma/client").Prisma.PrismaPromise<({
        _count: {
            products: number;
        };
    } & {
        id: string;
        createdAt: Date;
        name: string;
    })[]>;
    get(id: string): Promise<{
        _count: {
            products: number;
        };
    } & {
        id: string;
        createdAt: Date;
        name: string;
    }>;
    create(userId: string, name: string): Promise<{
        id: string;
        createdAt: Date;
        name: string;
    }>;
    update(userId: string, id: string, name: string): Promise<{
        id: string;
        createdAt: Date;
        name: string;
    }>;
    remove(userId: string, id: string): Promise<{
        ok: boolean;
    }>;
}
