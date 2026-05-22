"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const bcrypt = __importStar(require("bcryptjs"));
const role_constants_1 = require("../common/role.constants");
const prisma_service_1 = require("../prisma/prisma.service");
const audit_service_1 = require("../audit/audit.service");
let UsersService = class UsersService {
    prisma;
    audit;
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
    }
    findById(id) {
        return this.prisma.user.findUnique({
            where: { id },
            include: { role: true },
        });
    }
    async list(params) {
        const skip = params?.skip ?? 0;
        const take = Math.min(params?.take ?? 50, 100);
        const [items, total] = await Promise.all([
            this.prisma.user.findMany({
                orderBy: { email: "asc" },
                skip,
                take,
                select: {
                    id: true,
                    email: true,
                    displayName: true,
                    isActive: true,
                    createdAt: true,
                    role: { select: { id: true, name: true } },
                },
            }),
            this.prisma.user.count(),
        ]);
        return { items, total, skip, take };
    }
    async create(actorId, data) {
        const email = data.email.trim().toLowerCase();
        const existing = await this.prisma.user.findUnique({ where: { email } });
        if (existing) {
            throw new common_1.BadRequestException("Email already in use");
        }
        const role = await this.prisma.role.findFirst({
            where: { name: data.role.trim().toUpperCase() },
        });
        if (!role) {
            throw new common_1.BadRequestException("Invalid role");
        }
        const passwordHash = await bcrypt.hash(data.password, 10);
        const user = await this.prisma.user.create({
            data: {
                email,
                displayName: data.displayName?.trim() || null,
                passwordHash,
                roleId: role.id,
                isActive: true,
            },
            include: { role: true },
        });
        await this.audit.log(actorId, "CREATE", "User", user.id, { email, role: role.name });
        return this.sanitizeUser(user);
    }
    async update(actorId, id, data) {
        const user = await this.findById(id);
        if (!user) {
            throw new common_1.NotFoundException("User not found");
        }
        if ((0, role_constants_1.isOwnerRoleName)(user.role.name)) {
            if (data.isActive === false) {
                throw new common_1.BadRequestException("Owner accounts cannot be deactivated");
            }
            if (data.role && data.role !== role_constants_1.OWNER_ROLE) {
                throw new common_1.BadRequestException("Owner role cannot be changed");
            }
            if (data.roleId) {
                const target = await this.prisma.role.findUnique({ where: { id: data.roleId } });
                if (target && !(0, role_constants_1.isOwnerRoleName)(target.name)) {
                    throw new common_1.BadRequestException("Owner role cannot be changed");
                }
            }
        }
        let roleId = user.roleId;
        if (data.roleId) {
            const role = await this.prisma.role.findUnique({ where: { id: data.roleId } });
            if (!role) {
                throw new common_1.BadRequestException("Invalid role");
            }
            roleId = role.id;
        }
        else if (data.role) {
            const role = await this.prisma.role.findFirst({
                where: { name: data.role.trim().toUpperCase() },
            });
            if (!role) {
                throw new common_1.BadRequestException("Invalid role");
            }
            roleId = role.id;
        }
        const updated = await this.prisma.user.update({
            where: { id },
            data: {
                displayName: data.displayName !== undefined ? data.displayName.trim() || null : undefined,
                roleId,
                isActive: data.isActive,
            },
            include: { role: true },
        });
        await this.audit.log(actorId, "UPDATE", "User", id, data);
        return this.sanitizeUser(updated);
    }
    async resetPassword(actorId, id, password) {
        const user = await this.findById(id);
        if (!user) {
            throw new common_1.NotFoundException("User not found");
        }
        const passwordHash = await bcrypt.hash(password, 10);
        await this.prisma.user.update({ where: { id }, data: { passwordHash } });
        await this.audit.log(actorId, "RESET_PASSWORD", "User", id);
        return { ok: true };
    }
    async updateProfile(userId, data) {
        const user = await this.findById(userId);
        if (!user) {
            throw new common_1.NotFoundException("User not found");
        }
        if (data.email) {
            const email = data.email.trim().toLowerCase();
            const dup = await this.prisma.user.findFirst({
                where: { email, NOT: { id: userId } },
            });
            if (dup) {
                throw new common_1.BadRequestException("Email already in use");
            }
        }
        const updated = await this.prisma.user.update({
            where: { id: userId },
            data: {
                email: data.email ? data.email.trim().toLowerCase() : undefined,
                displayName: data.displayName !== undefined ? data.displayName.trim() || null : undefined,
            },
            include: { role: true },
        });
        return this.sanitizeUser(updated);
    }
    async changePassword(userId, currentPassword, newPassword) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new common_1.NotFoundException("User not found");
        }
        const ok = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!ok) {
            throw new common_1.BadRequestException("Current password is incorrect");
        }
        const passwordHash = await bcrypt.hash(newPassword, 10);
        await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
        return { ok: true };
    }
    sanitizeUser(user) {
        return {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            isActive: user.isActive,
            role: user.role.name,
            roleId: user.role.id,
        };
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], UsersService);
//# sourceMappingURL=users.service.js.map