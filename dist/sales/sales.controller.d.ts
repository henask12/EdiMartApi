import type { Response } from "express";
import { SalesService } from "./sales.service";
declare class CheckoutLineDto {
    productId: string;
    quantity: string;
}
declare class CheckoutDto {
    lines: CheckoutLineDto[];
    notes?: string;
    proofImagePaths?: string[];
}
type Authed = {
    user: {
        userId: string;
    };
};
export declare class SalesController {
    private readonly sales;
    constructor(sales: SalesService);
    export(res: Response, format?: string, from?: string, to?: string): Promise<void>;
    list(skip?: string, take?: string, from?: string, to?: string): Promise<{
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
                    sellingPrice: import(".prisma/client/runtime/library").Decimal;
                    costPrice: import(".prisma/client/runtime/library").Decimal;
                    restockAt: number;
                    restockQty: number;
                    lastOutOfStockAlertAt: Date | null;
                };
            } & {
                id: string;
                productId: string;
                quantity: import(".prisma/client/runtime/library").Decimal;
                saleId: string;
                unitPrice: import(".prisma/client/runtime/library").Decimal;
                lineDiscount: import(".prisma/client/runtime/library").Decimal;
                taxAmount: import(".prisma/client/runtime/library").Decimal;
                lineTotal: import(".prisma/client/runtime/library").Decimal;
            })[];
            id: string;
            createdAt: Date;
            status: string;
            createdByUserId: string;
            saleNumber: string;
            discountTotal: import(".prisma/client/runtime/library").Decimal;
            taxTotal: import(".prisma/client/runtime/library").Decimal;
        }[];
        total: number;
        skip: number;
        take: number;
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
    get(id: string): Promise<{
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
                sellingPrice: import(".prisma/client/runtime/library").Decimal;
                costPrice: import(".prisma/client/runtime/library").Decimal;
                restockAt: number;
                restockQty: number;
                lastOutOfStockAlertAt: Date | null;
            };
        } & {
            id: string;
            productId: string;
            quantity: import(".prisma/client/runtime/library").Decimal;
            saleId: string;
            unitPrice: import(".prisma/client/runtime/library").Decimal;
            lineDiscount: import(".prisma/client/runtime/library").Decimal;
            taxAmount: import(".prisma/client/runtime/library").Decimal;
            lineTotal: import(".prisma/client/runtime/library").Decimal;
        })[];
        id: string;
        createdAt: Date;
        status: string;
        createdByUserId: string;
        saleNumber: string;
        discountTotal: import(".prisma/client/runtime/library").Decimal;
        taxTotal: import(".prisma/client/runtime/library").Decimal;
    }>;
    checkout(req: Authed, body: CheckoutDto): Promise<{
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
                    sellingPrice: import(".prisma/client/runtime/library").Decimal;
                    costPrice: import(".prisma/client/runtime/library").Decimal;
                    restockAt: number;
                    restockQty: number;
                    lastOutOfStockAlertAt: Date | null;
                };
            } & {
                id: string;
                productId: string;
                quantity: import(".prisma/client/runtime/library").Decimal;
                saleId: string;
                unitPrice: import(".prisma/client/runtime/library").Decimal;
                lineDiscount: import(".prisma/client/runtime/library").Decimal;
                taxAmount: import(".prisma/client/runtime/library").Decimal;
                lineTotal: import(".prisma/client/runtime/library").Decimal;
            })[];
            id: string;
            createdAt: Date;
            status: string;
            createdByUserId: string;
            saleNumber: string;
            discountTotal: import(".prisma/client/runtime/library").Decimal;
            taxTotal: import(".prisma/client/runtime/library").Decimal;
        };
        digitalReceipt: string;
    }>;
}
export {};
