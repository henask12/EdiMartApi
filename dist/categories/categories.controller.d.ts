import { CategoriesService } from "./categories.service";
declare class CategoryDto {
    name: string;
}
type Authed = {
    user: {
        userId: string;
    };
};
export declare class CategoriesController {
    private readonly categories;
    constructor(categories: CategoriesService);
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
    create(req: Authed, body: CategoryDto): Promise<{
        id: string;
        createdAt: Date;
        name: string;
    }>;
    update(req: Authed, id: string, body: CategoryDto): Promise<{
        id: string;
        createdAt: Date;
        name: string;
    }>;
    remove(req: Authed, id: string): Promise<{
        ok: boolean;
    }>;
}
export {};
