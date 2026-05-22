import type { Response } from "express";
import { CatalogService } from "./catalog.service";
import { CreateProductDto, UpdateProductDto } from "./dto/catalog.dto";
type Authed = {
    user: {
        userId: string;
    };
};
export declare class CatalogController {
    private readonly catalog;
    constructor(catalog: CatalogService);
    exportProducts(res: Response, format?: string, q?: string, categoryId?: string, productTypeId?: string, stockStatus?: "in_stock" | "low" | "out"): Promise<void>;
    listProducts(q?: string, categoryId?: string, productTypeId?: string, stockStatus?: "in_stock" | "low" | "out", skip?: string, take?: string): Promise<{
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
                quantityOnHand: import(".prisma/client/runtime/library").Decimal;
                averageCost: import(".prisma/client/runtime/library").Decimal;
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
            sellingPrice: import(".prisma/client/runtime/library").Decimal;
            costPrice: import(".prisma/client/runtime/library").Decimal;
            restockAt: number;
            restockQty: number;
            lastOutOfStockAlertAt: Date | null;
        }, "sellingPrice" | "costPrice"> & {
            imageUrl: string | null;
            onHand: string;
            reserved: string;
            available: string;
            stockStatus: "in_stock" | "low stock" | "out of stock";
            sellingPrice: string;
            costPrice: string;
        })[];
        total: number;
        skip: number;
        take: number;
    }>;
    getProduct(id: string): Promise<Omit<{
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
            quantityOnHand: import(".prisma/client/runtime/library").Decimal;
            averageCost: import(".prisma/client/runtime/library").Decimal;
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
        sellingPrice: import(".prisma/client/runtime/library").Decimal;
        costPrice: import(".prisma/client/runtime/library").Decimal;
        restockAt: number;
        restockQty: number;
        lastOutOfStockAlertAt: Date | null;
    }, "sellingPrice" | "costPrice"> & {
        imageUrl: string | null;
        onHand: string;
        reserved: string;
        available: string;
        stockStatus: "in_stock" | "low stock" | "out of stock";
        sellingPrice: string;
        costPrice: string;
    }>;
    createProduct(req: Authed, body: CreateProductDto): Promise<Omit<{
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
            quantityOnHand: import(".prisma/client/runtime/library").Decimal;
            averageCost: import(".prisma/client/runtime/library").Decimal;
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
        sellingPrice: import(".prisma/client/runtime/library").Decimal;
        costPrice: import(".prisma/client/runtime/library").Decimal;
        restockAt: number;
        restockQty: number;
        lastOutOfStockAlertAt: Date | null;
    }, "sellingPrice" | "costPrice"> & {
        imageUrl: string | null;
        onHand: string;
        reserved: string;
        available: string;
        stockStatus: "in_stock" | "low stock" | "out of stock";
        sellingPrice: string;
        costPrice: string;
    }>;
    updateProduct(req: Authed, id: string, body: UpdateProductDto): Promise<Omit<{
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
            quantityOnHand: import(".prisma/client/runtime/library").Decimal;
            averageCost: import(".prisma/client/runtime/library").Decimal;
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
        sellingPrice: import(".prisma/client/runtime/library").Decimal;
        costPrice: import(".prisma/client/runtime/library").Decimal;
        restockAt: number;
        restockQty: number;
        lastOutOfStockAlertAt: Date | null;
    }, "sellingPrice" | "costPrice"> & {
        imageUrl: string | null;
        onHand: string;
        reserved: string;
        available: string;
        stockStatus: "in_stock" | "low stock" | "out of stock";
        sellingPrice: string;
        costPrice: string;
    }>;
}
export {};
