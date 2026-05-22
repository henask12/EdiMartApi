import { Prisma } from ".prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { AuditService } from "../audit/audit.service";
import { InventoryService } from "../inventory/inventory.service";
import { ExportService } from "../export/export.service";
type StockStatus = "in_stock" | "low stock" | "out of stock";
declare const productInclude: {
    readonly category: true;
    readonly productType: true;
    readonly inventoryItems: {
        readonly include: {
            readonly location: true;
        };
    };
};
type ProductWithRelations = Prisma.ProductGetPayload<{
    include: typeof productInclude;
}>;
type EnrichedProduct = Omit<ProductWithRelations, "sellingPrice" | "costPrice"> & {
    imageUrl: string | null;
    onHand: string;
    reserved: string;
    available: string;
    stockStatus: StockStatus;
    sellingPrice: string;
    costPrice: string;
};
export declare class CatalogService {
    private readonly prisma;
    private readonly locations;
    private readonly audit;
    private readonly inventory;
    private readonly exportService;
    constructor(prisma: PrismaService, locations: LocationsService, audit: AuditService, inventory: InventoryService, exportService: ExportService);
    private stockStatus;
    private enrichProduct;
    private buildWhere;
    listProducts(params: {
        q?: string;
        categoryId?: string;
        productTypeId?: string;
        stockStatus?: string;
        skip?: number;
        take?: number;
    }): Promise<{
        items: (Omit<{
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
            inventoryItems: ({
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
            })[];
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
        }, "sellingPrice" | "costPrice"> & {
            imageUrl: string | null;
            onHand: string;
            reserved: string;
            available: string;
            stockStatus: StockStatus;
            sellingPrice: string;
            costPrice: string;
        })[];
        total: number;
        skip: number;
        take: number;
    }>;
    exportProducts(format: "csv" | "xlsx" | "pdf", params: {
        q?: string;
        categoryId?: string;
        productTypeId?: string;
        stockStatus?: string;
    }): Promise<import("../export/export.service").ExportResult>;
    getProduct(id: string): Promise<EnrichedProduct>;
    createProduct(userId: string, data: {
        name: string;
        categoryId: string;
        productTypeId?: string;
        sellingPrice: string;
        costPrice?: string;
        restockAt?: number;
        restockQty?: number;
        imagePath?: string;
        description?: string;
        originCountry?: string;
        initialQuantity?: string;
        initialExpiryDate?: string;
    }): Promise<EnrichedProduct>;
    updateProduct(userId: string, id: string, data: Partial<{
        name: string;
        categoryId: string;
        productTypeId: string | null;
        sellingPrice: string;
        costPrice: string;
        restockAt: number;
        restockQty: number;
        isActive: boolean;
        imagePath: string;
        description: string;
        originCountry: string;
    }>): Promise<EnrichedProduct>;
    private ensureProduct;
}
export {};
