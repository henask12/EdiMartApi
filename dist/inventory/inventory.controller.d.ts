import { InventoryService } from "./inventory.service";
declare class ReceiveDto {
    productId: string;
    quantity: string;
    unitCost: string;
    notes?: string;
}
declare class AdjustDto {
    productId: string;
    quantityDelta: string;
    notes?: string;
}
declare class ReturnDto {
    productId: string;
    quantity: string;
    notes?: string;
    refSaleId?: string;
}
type Authed = {
    user: {
        userId: string;
    };
};
export declare class InventoryController {
    private readonly inventory;
    constructor(inventory: InventoryService);
    listMovements(productId?: string, skip?: string, take?: string): Promise<{
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
            type: import("@prisma/client").$Enums.MovementType;
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
    receive(req: Authed, body: ReceiveDto): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        productId: string;
        locationId: string;
        quantityOnHand: import(".prisma/client/runtime/library").Decimal;
        averageCost: import(".prisma/client/runtime/library").Decimal;
    }>;
    adjust(req: Authed, body: AdjustDto): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        productId: string;
        locationId: string;
        quantityOnHand: import(".prisma/client/runtime/library").Decimal;
        averageCost: import(".prisma/client/runtime/library").Decimal;
    }>;
    returnToStock(req: Authed, body: ReturnDto): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        productId: string;
        locationId: string;
        quantityOnHand: import(".prisma/client/runtime/library").Decimal;
        averageCost: import(".prisma/client/runtime/library").Decimal;
    }>;
}
export {};
