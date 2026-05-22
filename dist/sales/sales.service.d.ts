import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { AuditService } from "../audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ExportService } from "../export/export.service";
type CheckoutLineInput = {
    productId: string;
    quantity: string;
    reservationId?: string;
};
export declare class SalesService {
    private readonly prisma;
    private readonly locations;
    private readonly audit;
    private readonly notifications;
    private readonly exportService;
    constructor(prisma: PrismaService, locations: LocationsService, audit: AuditService, notifications: NotificationsService, exportService: ExportService);
    private mapSale;
    listSales(params: {
        skip?: number;
        take?: number;
        from?: string;
        to?: string;
    }): Promise<{
        items: {
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
        }[];
        total: number;
        skip: number;
        take: number;
    }>;
    getSale(id: string): Promise<{
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
    }>;
    exportSales(format: "csv" | "xlsx" | "pdf", params: {
        from?: string;
        to?: string;
    }): Promise<import("../export/export.service").ExportResult>;
    checkout(userId: string, input: {
        lines: CheckoutLineInput[];
        notes?: string;
        proofImagePaths?: string[];
    }): Promise<{
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
    }>;
    todaySummary(): Promise<{
        period: string;
        start: string;
        end: string;
        saleCount: number;
        grandTotal: string;
        topProducts: {
            name: string;
            quantity: string;
            revenue: string;
        }[];
    }>;
    salesInRange(range: {
        start: Date;
        end: Date;
        label: string;
    }): Promise<{
        period: string;
        start: string;
        end: string;
        saleCount: number;
        grandTotal: string;
        topProducts: {
            name: string;
            quantity: string;
            revenue: string;
        }[];
    }>;
    salesForPeriod(period: "day" | "week" | "month" | "year", anchor?: string): Promise<{
        period: string;
        start: string;
        end: string;
        saleCount: number;
        grandTotal: string;
        topProducts: {
            name: string;
            quantity: string;
            revenue: string;
        }[];
    }>;
    private dayBounds;
    private weekBounds;
    private monthBounds;
    private yearBounds;
    private buildReceiptText;
}
export {};
