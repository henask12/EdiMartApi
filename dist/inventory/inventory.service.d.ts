import { MovementType, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { AuditService } from "../audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ExportService } from "../export/export.service";
export declare class InventoryService {
    private readonly prisma;
    private readonly locations;
    private readonly audit;
    private readonly notifications;
    private readonly exportService;
    constructor(prisma: PrismaService, locations: LocationsService, audit: AuditService, notifications: NotificationsService, exportService: ExportService);
    listMovements(params: {
        productId?: string;
        type?: MovementType;
        from?: string;
        to?: string;
        take?: number;
        skip?: number;
    }): Promise<{
        items: ({
            inventoryItem: {
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
                location: {
                    id: string;
                    createdAt: Date;
                    name: string;
                    code: string;
                };
            } & {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                productId: string;
                locationId: string;
                quantityOnHand: Prisma.Decimal;
                averageCost: Prisma.Decimal;
            };
            stockBatch: {
                id: string;
                productId: string;
                qtyReceived: Prisma.Decimal;
                qtyRemaining: Prisma.Decimal;
                unitCost: Prisma.Decimal;
                expiryDate: Date | null;
                receivedAt: Date;
                receivedByUserId: string | null;
            } | null;
            createdBy: {
                id: string;
                email: string;
                displayName: string | null;
            } | null;
        } & {
            id: string;
            metadata: Prisma.JsonValue | null;
            createdAt: Date;
            type: import("@prisma/client").$Enums.MovementType;
            unitCost: Prisma.Decimal | null;
            inventoryItemId: string;
            stockBatchId: string | null;
            qtyDelta: Prisma.Decimal;
            beforeOnHand: Prisma.Decimal | null;
            afterOnHand: Prisma.Decimal | null;
            refType: string | null;
            refId: string | null;
            notes: string | null;
            createdByUserId: string | null;
        })[];
        total: number;
        skip: number;
        take: number;
    }>;
    getMovement(id: string): Promise<{
        qtyDelta: string;
        beforeOnHand: string | null;
        afterOnHand: string | null;
        unitCost: string | null;
        stockBatch: {
            qtyReceived: string;
            qtyRemaining: string;
            unitCost: string;
            id: string;
            productId: string;
            expiryDate: Date | null;
            receivedAt: Date;
            receivedByUserId: string | null;
        } | null;
        inventoryItem: {
            product: {
                category: {
                    id: string;
                    createdAt: Date;
                    name: string;
                };
                productType: {
                    id: string;
                    createdAt: Date;
                    name: string;
                } | null;
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
            location: {
                id: string;
                createdAt: Date;
                name: string;
                code: string;
            };
        } & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            productId: string;
            locationId: string;
            quantityOnHand: Prisma.Decimal;
            averageCost: Prisma.Decimal;
        };
        createdBy: {
            id: string;
            email: string;
            displayName: string | null;
        } | null;
        id: string;
        metadata: Prisma.JsonValue | null;
        createdAt: Date;
        type: import("@prisma/client").$Enums.MovementType;
        inventoryItemId: string;
        stockBatchId: string | null;
        refType: string | null;
        refId: string | null;
        notes: string | null;
        createdByUserId: string | null;
    }>;
    exportMovements(format: "csv" | "xlsx" | "pdf", params: {
        productId?: string;
        type?: MovementType;
        from?: string;
        to?: string;
    }): Promise<import("../export/export.service").ExportResult>;
    listBatches(productId: string, params?: {
        skip?: number;
        take?: number;
    }): Prisma.PrismaPromise<({
        receivedBy: {
            id: string;
            email: string;
            displayName: string | null;
        } | null;
    } & {
        id: string;
        productId: string;
        qtyReceived: Prisma.Decimal;
        qtyRemaining: Prisma.Decimal;
        unitCost: Prisma.Decimal;
        expiryDate: Date | null;
        receivedAt: Date;
        receivedByUserId: string | null;
    })[]>;
    receiveGoods(userId: string, data: {
        productId: string;
        quantity: string;
        unitCost: string;
        expiryDate?: string;
        notes?: string;
    }): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        productId: string;
        locationId: string;
        quantityOnHand: Prisma.Decimal;
        averageCost: Prisma.Decimal;
    }>;
    adjustStock(userId: string, data: {
        productId: string;
        quantityDelta: string;
        notes?: string;
    }): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        productId: string;
        locationId: string;
        quantityOnHand: Prisma.Decimal;
        averageCost: Prisma.Decimal;
    }>;
    returnToStock(userId: string, data: {
        productId: string;
        quantity: string;
        notes?: string;
        refSaleId?: string;
    }): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        productId: string;
        locationId: string;
        quantityOnHand: Prisma.Decimal;
        averageCost: Prisma.Decimal;
    }>;
}
