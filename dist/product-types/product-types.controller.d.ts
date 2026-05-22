import { ProductTypesService } from "./product-types.service";
declare class ProductTypeDto {
    name: string;
}
type Authed = {
    user: {
        userId: string;
    };
};
export declare class ProductTypesController {
    private readonly productTypes;
    constructor(productTypes: ProductTypesService);
    list(): import("@prisma/client").Prisma.PrismaPromise<({
        _count: {
            products: number;
        };
    } & {
        id: string;
        createdAt: Date;
        name: string;
    })[]>;
    get(id: string): Promise<{
        _count: {
            products: number;
        };
    } & {
        id: string;
        createdAt: Date;
        name: string;
    }>;
    create(req: Authed, body: ProductTypeDto): Promise<{
        id: string;
        createdAt: Date;
        name: string;
    }>;
    update(req: Authed, id: string, body: ProductTypeDto): Promise<{
        id: string;
        createdAt: Date;
        name: string;
    }>;
    remove(req: Authed, id: string): Promise<{
        ok: boolean;
    }>;
}
export {};
