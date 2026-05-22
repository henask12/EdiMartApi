import { ConfigService } from "@nestjs/config";
import { Strategy } from "passport-jwt";
import { PrismaService } from "../../prisma/prisma.service";
import { PermissionsService } from "../../permissions/permissions.service";
type JwtPayload = {
    sub: string;
};
declare const JwtStrategy_base: new (...args: [opt: import("passport-jwt").StrategyOptionsWithRequest] | [opt: import("passport-jwt").StrategyOptionsWithoutRequest]) => Strategy & {
    validate(...args: any[]): unknown;
};
export declare class JwtStrategy extends JwtStrategy_base {
    private readonly prisma;
    private readonly permissions;
    constructor(config: ConfigService, prisma: PrismaService, permissions: PermissionsService);
    validate(payload: JwtPayload): Promise<{
        userId: string;
        email: string;
        displayName: string | null;
        roleName: string;
        permissions: import("@prisma/client").$Enums.PermissionKey[];
    } | null>;
}
export {};
