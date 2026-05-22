import { ReservationStatus } from ".prisma/client";
import { ReservationsService } from "./reservations.service";
declare class CreateReservationDto {
    productId: string;
    quantity: string;
    customerName?: string;
    expiresAt?: string;
}
type Authed = {
    user: {
        userId: string;
    };
};
export declare class ReservationsController {
    private readonly reservations;
    constructor(reservations: ReservationsService);
    list(status?: ReservationStatus, productId?: string, skip?: string, take?: string): Promise<{
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
                sellingPrice: import(".prisma/client/runtime/library").Decimal;
                costPrice: import(".prisma/client/runtime/library").Decimal;
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
            status: import(".prisma/client").$Enums.ReservationStatus;
            quantity: import(".prisma/client/runtime/library").Decimal;
            createdByUserId: string;
            customerName: string | null;
            expiresAt: Date | null;
        })[];
        total: number;
        skip: number;
        take: number;
    }>;
    create(req: Authed, body: CreateReservationDto): Promise<{
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
        createdAt: Date;
        updatedAt: Date;
        productId: string;
        status: import(".prisma/client").$Enums.ReservationStatus;
        quantity: import(".prisma/client/runtime/library").Decimal;
        createdByUserId: string;
        customerName: string | null;
        expiresAt: Date | null;
    }>;
    cancel(req: Authed, id: string): Promise<{
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
        createdAt: Date;
        updatedAt: Date;
        productId: string;
        status: import(".prisma/client").$Enums.ReservationStatus;
        quantity: import(".prisma/client/runtime/library").Decimal;
        createdByUserId: string;
        customerName: string | null;
        expiresAt: Date | null;
    }>;
    complete(req: Authed, id: string): Promise<{
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
        reservation: {
            status: "COMPLETED";
            id: string;
            createdAt: Date;
            updatedAt: Date;
            productId: string;
            quantity: import(".prisma/client/runtime/library").Decimal;
            createdByUserId: string;
            customerName: string | null;
            expiresAt: Date | null;
        };
    }>;
}
export {};
