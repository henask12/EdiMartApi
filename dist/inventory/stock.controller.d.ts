import { MovementType } from ".prisma/client";
import type { Response } from "express";
import { InventoryService } from "./inventory.service";
declare class ReceiveStockDto {
    productId: string;
    quantity: string;
    unitCost: string;
    expiryDate?: string;
    notes?: string;
}
type Authed = {
    user: {
        userId: string;
    };
};
export declare class StockController {
    private readonly inventory;
    constructor(inventory: InventoryService);
    receive(req: Authed, body: ReceiveStockDto): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        productId: string;
        locationId: string;
        quantityOnHand: import(".prisma/client/runtime/library").Decimal;
        averageCost: import(".prisma/client/runtime/library").Decimal;
    }>;
    exportHistory(res: Response, format?: string, productId?: string, type?: MovementType, from?: string, to?: string): Promise<void>;
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
                sellingPrice: import(".prisma/client/runtime/library").Decimal;
                costPrice: import(".prisma/client/runtime/library").Decimal;
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
            quantityOnHand: import(".prisma/client/runtime/library").Decimal;
            averageCost: import(".prisma/client/runtime/library").Decimal;
        };
        createdBy: {
            id: string;
            email: string;
            displayName: string | null;
        } | null;
        id: string;
        metadata: import(".prisma/client/runtime/library").JsonValue | null;
        createdAt: Date;
        type: import(".prisma/client").$Enums.MovementType;
        inventoryItemId: string;
        stockBatchId: string | null;
        refType: string | null;
        refId: string | null;
        notes: string | null;
        createdByUserId: string | null;
    }>;
    history(productId?: string, type?: MovementType, from?: string, to?: string, skip?: string, take?: string): Promise<{
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
                    sellingPrice: import(".prisma/client/runtime/library").Decimal;
                    costPrice: import(".prisma/client/runtime/library").Decimal;
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
                quantityOnHand: import(".prisma/client/runtime/library").Decimal;
                averageCost: import(".prisma/client/runtime/library").Decimal;
            };
            stockBatch: {
                id: string;
                productId: string;
                qtyReceived: import(".prisma/client/runtime/library").Decimal;
                qtyRemaining: import(".prisma/client/runtime/library").Decimal;
                unitCost: import(".prisma/client/runtime/library").Decimal;
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
            metadata: import(".prisma/client/runtime/library").JsonValue | null;
            createdAt: Date;
            type: import(".prisma/client").$Enums.MovementType;
            unitCost: import(".prisma/client/runtime/library").Decimal | null;
            inventoryItemId: string;
            stockBatchId: string | null;
            qtyDelta: import(".prisma/client/runtime/library").Decimal;
            beforeOnHand: import(".prisma/client/runtime/library").Decimal | null;
            afterOnHand: import(".prisma/client/runtime/library").Decimal | null;
            refType: string | null;
            refId: string | null;
            notes: string | null;
            createdByUserId: string | null;
        })[];
        total: number;
        skip: number;
        take: number;
    }>;
    batches(productId: string, skip?: string, take?: string): import(".prisma/client").Prisma.PrismaPromise<({
        receivedBy: {
            id: string;
            email: string;
            displayName: string | null;
        } | null;
    } & {
        id: string;
        productId: string;
        qtyReceived: import(".prisma/client/runtime/library").Decimal;
        qtyRemaining: import(".prisma/client/runtime/library").Decimal;
        unitCost: import(".prisma/client/runtime/library").Decimal;
        expiryDate: Date | null;
        receivedAt: Date;
        receivedByUserId: string | null;
    })[]>;
}
export {};
