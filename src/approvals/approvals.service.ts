import { createHash, randomBytes } from "crypto";
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { PermissionKey, Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { AuditService } from "../audit/audit.service";
import { isOwnerRoleName } from "../common/role.constants";
import { PrismaService } from "../prisma/prisma.service";
import type { Actor } from "../permissions/permissions.service";
import { PermissionsService } from "../permissions/permissions.service";

/**
 * Things a manager can approve with their PIN, and the permission the approver must hold.
 * Only STOCK_ADJUST_OVER_LIMIT is consumed today; the rest are wired when their screens exist
 * (discounts and voids in Phase 4, the cash drawer in Phase 5).
 */
export const APPROVAL_ACTIONS = {
  STOCK_ADJUST_OVER_LIMIT: PermissionKey.STOCK_COUNT_APPROVE,
  DISCOUNT_OVER_LIMIT: PermissionKey.DISCOUNT_ABOVE_LIMIT,
  PRICE_OVERRIDE: PermissionKey.PRICE_OVERRIDE,
  SALE_VOID: PermissionKey.SALES_VOID,
  REFUND_OUTSIDE_WINDOW: PermissionKey.SALES_REFUND,
  NO_SALE_DRAWER_OPEN: PermissionKey.CASH_DRAWER_OPEN,
} as const;

export type ApprovalAction = keyof typeof APPROVAL_ACTIONS;
export const isApprovalAction = (value: string): value is ApprovalAction => value in APPROVAL_ACTIONS;

export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 15;
export const APPROVAL_TTL_SECONDS = 120;
export const PIN_PATTERN = /^\d{4,6}$/;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** All one digit (0000), or a straight run up or down (1234, 6543): too easy to guess. */
const isWeakPin = (pin: string) => {
  const digits = [...pin].map(Number);
  const step = digits[1] - digits[0];
  return digits.every((d, i) => i === 0 || d - digits[i - 1] === step) && Math.abs(step) <= 1;
};

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  /** Set, change or remove your own approval PIN. Needs your current password. */
  async setOwnPin(userId: string, currentPassword: string, pin: string | null) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new BadRequestException("Current password is incorrect");
    }
    if (pin !== null) {
      if (!PIN_PATTERN.test(pin)) {
        throw new BadRequestException("The PIN must be 4 to 6 digits");
      }
      if (isWeakPin(pin)) {
        throw new BadRequestException("Choose a PIN that is not a repeated digit or a straight run like 1234");
      }
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        pinHash: pin === null ? null : await bcrypt.hash(pin, 10),
        pinFailedAttempts: 0,
        pinLockedUntil: null,
      },
    });
    await this.audit.log(userId, pin === null ? "REMOVE_PIN" : "SET_PIN", "User", userId);
    return { ok: true, hasPin: pin !== null };
  }

  /** Active people with a PIN who hold the permission this action needs (never the requester). */
  async listManagers(requester: Actor, action: ApprovalAction) {
    const needed = APPROVAL_ACTIONS[action];
    const candidates = await this.prisma.user.findMany({
      where: { isActive: true, pinHash: { not: null }, id: { not: requester.userId } },
      include: { role: { include: { permissions: true } } },
      orderBy: { displayName: "asc" },
    });
    return candidates
      .filter(
        (u) => isOwnerRoleName(u.role.name) || u.role.permissions.some((p) => p.permission === needed),
      )
      .map((u) => ({ id: u.id, name: u.displayName ?? u.email }));
  }

  /**
   * A manager approves one action with their PIN. Five wrong PINs lock that manager's PIN for
   * 15 minutes; the attempt is counted before the PIN is checked, so parallel guesses cannot get
   * extra tries. Returns a single-use token that is valid for two minutes, for this action only
   * and only for the person who asked.
   */
  async approve(requester: Actor, input: { managerId: string; pin: string; action: ApprovalAction }) {
    const generic = () => new UnauthorizedException("That manager or PIN is not valid for this approval");
    const manager = await this.prisma.user.findUnique({
      where: { id: input.managerId },
      include: { role: true },
    });
    if (!manager || !manager.isActive || !manager.pinHash || manager.id === requester.userId) {
      throw generic();
    }
    const managerPermissions = await this.permissions.getPermissionsForRole(manager.role.name);
    const needed = APPROVAL_ACTIONS[input.action];
    if (!isOwnerRoleName(manager.role.name) && !managerPermissions.includes(needed)) {
      throw generic();
    }

    // Claim an attempt atomically; the fifth claim also sets the lock for everyone after it.
    const claimed = await this.prisma.$queryRaw<{ pinFailedAttempts: number }[]>`
      UPDATE "User"
         SET "pinFailedAttempts" = "pinFailedAttempts" + 1,
             "pinLockedUntil" = CASE WHEN "pinFailedAttempts" + 1 >= ${MAX_PIN_ATTEMPTS}
                                     THEN NOW() + (${PIN_LOCK_MINUTES} * INTERVAL '1 minute')
                                     ELSE "pinLockedUntil" END
       WHERE "id" = ${manager.id}
         AND ("pinLockedUntil" IS NULL OR "pinLockedUntil" <= NOW())
   RETURNING "pinFailedAttempts"`;
    if (claimed.length === 0) {
      await this.audit.log(requester.userId, "APPROVAL_PIN_LOCKED", "User", manager.id, { action: input.action });
      throw new HttpException(
        `This PIN is locked after too many wrong tries. Try again in ${PIN_LOCK_MINUTES} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!(await bcrypt.compare(input.pin, manager.pinHash))) {
      await this.audit.log(requester.userId, "APPROVAL_PIN_FAILED", "User", manager.id, {
        action: input.action,
        attempt: claimed[0].pinFailedAttempts,
      });
      throw generic();
    }

    await this.prisma.user.update({
      where: { id: manager.id },
      data: { pinFailedAttempts: 0, pinLockedUntil: null },
    });
    const token = randomBytes(24).toString("base64url");
    await this.prisma.approval.create({
      data: {
        tokenHash: hashToken(token),
        action: input.action,
        approverId: manager.id,
        requesterId: requester.userId,
        expiresAt: new Date(Date.now() + APPROVAL_TTL_SECONDS * 1000),
      },
    });
    await this.audit.log(requester.userId, "APPROVAL_GRANTED", "User", manager.id, {
      action: input.action,
      approvedByUserId: manager.id,
    });
    return {
      token,
      expiresInSeconds: APPROVAL_TTL_SECONDS,
      approver: { id: manager.id, name: manager.displayName ?? manager.email },
    };
  }

  /**
   * Use up an approval token inside the caller's transaction (so a failed action gives the token
   * back). Fails unless the token is unused, unexpired, for this action and for this requester.
   * Returns the approving manager, who must be recorded in the audit log.
   */
  async consume(
    tx: Prisma.TransactionClient,
    token: string,
    action: ApprovalAction,
    requesterId: string,
  ): Promise<{ approverId: string }> {
    const tokenHash = hashToken(token);
    const used = await tx.approval.updateMany({
      where: { tokenHash, action, requesterId, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (used.count !== 1) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "Forbidden",
        code: "APPROVAL_INVALID",
        message: "The manager approval is missing, expired, already used, or for something else",
      });
    }
    const approval = await tx.approval.findUniqueOrThrow({ where: { tokenHash } });
    return { approverId: approval.approverId };
  }
}
