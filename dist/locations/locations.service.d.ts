import { PrismaService } from "../prisma/prisma.service";
export declare class LocationsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getDefault(): Promise<{
        id: string;
        createdAt: Date;
        name: string;
        code: string;
    }>;
}
