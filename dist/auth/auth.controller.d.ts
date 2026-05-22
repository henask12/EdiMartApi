import { AuthService } from "./auth.service";
declare class LoginDto {
    email: string;
    password: string;
}
declare class UpdateProfileDto {
    displayName?: string;
    email?: string;
}
declare class ChangePasswordDto {
    currentPassword: string;
    newPassword: string;
}
export declare class AuthController {
    private readonly auth;
    constructor(auth: AuthService);
    login(body: LoginDto): Promise<{
        accessToken: string;
        user: {
            id: string;
            email: string;
            displayName: string | null;
            role: string;
        };
    }>;
    me(req: {
        user: {
            userId: string;
            email: string;
            roleName: string;
            displayName: string | null;
            permissions: string[];
        };
    }): {
        id: string;
        email: string;
        displayName: string | null;
        role: string;
        permissions: string[];
    };
    updateMe(req: {
        user: {
            userId: string;
        };
    }, body: UpdateProfileDto): Promise<{
        id: string;
        email: string;
        displayName: string | null;
        isActive: boolean;
        role: string;
        roleId: string;
    }>;
    changePassword(req: {
        user: {
            userId: string;
        };
    }, body: ChangePasswordDto): Promise<{
        ok: boolean;
    }>;
}
export {};
