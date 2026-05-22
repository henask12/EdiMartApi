import { PrismaService } from "../prisma/prisma.service";
export declare class AuditService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    log(userId: string | undefined, action: string, entity: string, entityId?: string, metadata?: Record<string, unknown>): Promise<void>;
}
