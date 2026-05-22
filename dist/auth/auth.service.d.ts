import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";
export declare class AuthService {
    private readonly prisma;
    private readonly jwt;
    private readonly users;
    constructor(prisma: PrismaService, jwt: JwtService, users: UsersService);
    login(email: string, password: string): Promise<{
        accessToken: string;
        user: {
            id: string;
            email: string;
            displayName: string | null;
            role: string;
        };
    }>;
    updateProfile(userId: string, data: {
        displayName?: string;
        email?: string;
    }): Promise<{
        id: string;
        email: string;
        displayName: string | null;
        isActive: boolean;
        role: string;
        roleId: string;
    }>;
    changePassword(userId: string, currentPassword: string, newPassword: string): Promise<{
        ok: boolean;
    }>;
}
