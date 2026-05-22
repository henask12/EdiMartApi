import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
export declare const getReservedQty: (prisma: PrismaService | Prisma.TransactionClient, productId: string) => Promise<Prisma.Decimal>;
export declare const productStockSnapshot: (prisma: PrismaService | Prisma.TransactionClient, productId: string, locationId: string) => Promise<{
    inv: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        productId: string;
        locationId: string;
        quantityOnHand: Prisma.Decimal;
        averageCost: Prisma.Decimal;
    } | null;
    onHand: Prisma.Decimal;
    reserved: Prisma.Decimal;
    available: Prisma.Decimal;
}>;
