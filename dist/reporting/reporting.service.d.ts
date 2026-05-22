import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { SalesService } from "../sales/sales.service";
export declare class ReportingService {
    private readonly prisma;
    private readonly locations;
    private readonly sales;
    constructor(prisma: PrismaService, locations: LocationsService, sales: SalesService);
    dashboard(): Promise<{
        today: {
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
        };
        week: {
            grandTotal: string;
            saleCount: number;
        };
        month: {
            grandTotal: string;
            saleCount: number;
        };
        year: {
            grandTotal: string;
            saleCount: number;
        };
        needsRestock: {
            id: string;
            name: string;
            quantityOnHand: string;
            available: string;
            reserved: string;
            restockAt: number;
            restockQty: number;
            sellingPrice: string;
            status: "OUT" | "LOW";
        }[];
        expiringSoon: {
            id: string;
            productName: string;
            qtyRemaining: string;
            expiryDate: string | undefined;
        }[];
        openReservations: {
            id: string;
            productName: string;
            quantity: string;
            customerName: string | null;
            createdAt: string;
        }[];
        stockValue: string;
        productCount: number;
    }>;
    salesByPeriod(period: "day" | "week" | "month" | "year", date?: string): Promise<{
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
}
