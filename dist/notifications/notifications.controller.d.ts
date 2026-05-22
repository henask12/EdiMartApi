import { NotificationsService } from "./notifications.service";
declare class EmailDto {
    email: string;
}
declare class ToggleDto {
    active: boolean;
}
export declare class NotificationsController {
    private readonly notifications;
    constructor(notifications: NotificationsService);
    list(): import("@prisma/client").Prisma.PrismaPromise<{
        id: string;
        createdAt: Date;
        email: string;
        active: boolean;
    }[]>;
    add(body: EmailDto): Promise<{
        id: string;
        createdAt: Date;
        email: string;
        active: boolean;
    }>;
    toggle(id: string, body: ToggleDto): Promise<{
        id: string;
        createdAt: Date;
        email: string;
        active: boolean;
    }>;
    remove(id: string): Promise<{
        ok: boolean;
    }>;
}
export {};
