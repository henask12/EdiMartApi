import { Prisma, ReservationStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { AuditService } from "../audit/audit.service";
import { SalesService } from "../sales/sales.service";
export declare class ReservationsService {
    private readonly prisma;
    private readonly locations;
    private readonly audit;
    private readonly sales;
    constructor(prisma: PrismaService, locations: LocationsService, audit: AuditService, sales: SalesService);
    list(params: {
        status?: ReservationStatus;
        productId?: string;
        skip?: number;
        take?: number;
    }): Promise<{
        items: ({
            product: {
                category: {
                    id: string;
                    createdAt: Date;
                    name: string;
                };
            } & {
                id: string;
                createdAt: Date;
                name: string;
                isActive: boolean;
                updatedAt: Date;
                sku: string | null;
                categoryId: string;
                productTypeId: string | null;
                imagePath: string | null;
                description: string | null;
                originCountry: string | null;
                sellingPrice: Prisma.Decimal;
                costPrice: Prisma.Decimal;
                restockAt: number;
                restockQty: number;
                lastOutOfStockAlertAt: Date | null;
            };
            createdBy: {
                id: string;
                email: string;
                displayName: string | null;
            };
        } & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            productId: string;
            status: import("@prisma/client").$Enums.ReservationStatus;
            quantity: Prisma.Decimal;
            createdByUserId: string;
            customerName: string | null;
            expiresAt: Date | null;
        })[];
        total: number;
        skip: number;
        take: number;
    }>;
    create(userId: string, data: {
        productId: string;
        quantity: string;
        customerName?: string;
        expiresAt?: string;
    }): Promise<{
        product: {
            id: string;
            createdAt: Date;
            name: string;
            isActive: boolean;
            updatedAt: Date;
            sku: string | null;
            categoryId: string;
            productTypeId: string | null;
            imagePath: string | null;
            description: string | null;
            originCountry: string | null;
            sellingPrice: Prisma.Decimal;
            costPrice: Prisma.Decimal;
            restockAt: number;
            restockQty: number;
            lastOutOfStockAlertAt: Date | null;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        productId: string;
        status: import("@prisma/client").$Enums.ReservationStatus;
        quantity: Prisma.Decimal;
        createdByUserId: string;
        customerName: string | null;
        expiresAt: Date | null;
    }>;
    cancel(userId: string, id: string): Promise<{
        product: {
            id: string;
            createdAt: Date;
            name: string;
            isActive: boolean;
            updatedAt: Date;
            sku: string | null;
            categoryId: string;
            productTypeId: string | null;
            imagePath: string | null;
            description: string | null;
            originCountry: string | null;
            sellingPrice: Prisma.Decimal;
            costPrice: Prisma.Decimal;
            restockAt: number;
            restockQty: number;
            lastOutOfStockAlertAt: Date | null;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        productId: string;
        status: import("@prisma/client").$Enums.ReservationStatus;
        quantity: Prisma.Decimal;
        createdByUserId: string;
        customerName: string | null;
        expiresAt: Date | null;
    }>;
    completeAsSale(userId: string, id: string): Promise<{
        sale: {
            grandTotal: string;
            subtotal: string;
            attachments: {
                id: string;
                imagePath: string;
                imageUrl: string;
                createdAt: Date;
            }[];
            createdBy: {
                id: string;
                email: string;
                displayName: string | null;
            };
            lines: ({
                product: {
                    id: string;
                    createdAt: Date;
                    name: string;
                    isActive: boolean;
                    updatedAt: Date;
                    sku: string | null;
                    categoryId: string;
                    productTypeId: string | null;
                    imagePath: string | null;
                    description: string | null;
                    originCountry: string | null;
                    sellingPrice: Prisma.Decimal;
                    costPrice: Prisma.Decimal;
                    restockAt: number;
                    restockQty: number;
                    lastOutOfStockAlertAt: Date | null;
                };
            } & {
                id: string;
                productId: string;
                quantity: Prisma.Decimal;
                saleId: string;
                unitPrice: Prisma.Decimal;
                lineDiscount: Prisma.Decimal;
                taxAmount: Prisma.Decimal;
                lineTotal: Prisma.Decimal;
            })[];
            id: string;
            createdAt: Date;
            status: string;
            createdByUserId: string;
            saleNumber: string;
            discountTotal: Prisma.Decimal;
            taxTotal: Prisma.Decimal;
        };
        digitalReceipt: string;
        reservation: {
            status: "COMPLETED";
            id: string;
            createdAt: Date;
            updatedAt: Date;
            productId: string;
            quantity: Prisma.Decimal;
            createdByUserId: string;
            customerName: string | null;
            expiresAt: Date | null;
        };
    }>;
}
