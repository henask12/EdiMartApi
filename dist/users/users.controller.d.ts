import { UsersService } from "./users.service";
declare class CreateUserDto {
    email: string;
    displayName?: string;
    role: string;
    password: string;
}
declare class UpdateUserDto {
    displayName?: string;
    role?: string;
    roleId?: string;
    isActive?: boolean;
}
declare class ResetPasswordDto {
    password: string;
}
type Authed = {
    user: {
        userId: string;
    };
};
export declare class UsersController {
    private readonly users;
    constructor(users: UsersService);
    list(skip?: string, take?: string): Promise<{
        items: {
            role: {
                id: string;
                name: string;
            };
            id: string;
            createdAt: Date;
            email: string;
            displayName: string | null;
            isActive: boolean;
        }[];
        total: number;
        skip: number;
        take: number;
    }>;
    create(req: Authed, body: CreateUserDto): Promise<{
        id: string;
        email: string;
        displayName: string | null;
        isActive: boolean;
        role: string;
        roleId: string;
    }>;
    update(req: Authed, id: string, body: UpdateUserDto): Promise<{
        id: string;
        email: string;
        displayName: string | null;
        isActive: boolean;
        role: string;
        roleId: string;
    }>;
    resetPassword(req: Authed, id: string, body: ResetPasswordDto): Promise<{
        ok: boolean;
    }>;
}
export {};
