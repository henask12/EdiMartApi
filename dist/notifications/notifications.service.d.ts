import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
export declare class NotificationsService {
    private readonly prisma;
    private readonly locations;
    private readonly logger;
    private resend;
    constructor(prisma: PrismaService, locations: LocationsService);
    listEmails(): Prisma.PrismaPromise<{
        id: string;
        createdAt: Date;
        email: string;
        active: boolean;
    }[]>;
    addEmail(email: string): Promise<{
        id: string;
        createdAt: Date;
        email: string;
        active: boolean;
    }>;
    removeEmail(id: string): Promise<{
        ok: boolean;
    }>;
    toggleEmail(id: string, active: boolean): Promise<{
        id: string;
        createdAt: Date;
        email: string;
        active: boolean;
    }>;
    private recipients;
    private sendMail;
    checkStockAlertsForProduct(productId: string): Promise<void>;
    checkLowStockForProduct(productId: string): Promise<void>;
    private sendOutOfStockAlert;
    private sendLowStockAlert;
    sendExpiryAlerts(): Promise<void>;
}
