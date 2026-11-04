import { Body, Controller, Get, Post, Query, Req } from "@nestjs/common";
import { IsIn, IsString, Matches } from "class-validator";
import { AnyAuthenticated } from "../common/decorators/permissions.decorator";
import type { Actor } from "../permissions/permissions.service";
import {
  APPROVAL_ACTIONS,
  ApprovalAction,
  ApprovalsService,
  PIN_PATTERN,
  isApprovalAction,
} from "./approvals.service";
import { BadRequestException } from "@nestjs/common";

const ACTION_NAMES = Object.keys(APPROVAL_ACTIONS);

class ApproveDto {
  @IsString()
  managerId!: string;

  @Matches(PIN_PATTERN, { message: "The PIN must be 4 to 6 digits" })
  pin!: string;

  @IsIn(ACTION_NAMES)
  action!: ApprovalAction;
}

type Authed = { user: Actor };

/**
 * Any signed-in person (typically a cashier) can ask a manager to approve something. What matters
 * is who approves: the manager must hold the permission that action needs.
 */
@Controller("approvals")
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  /** The managers who could approve this action (for the "who is approving?" picker). */
  @AnyAuthenticated()
  @Get("managers")
  managers(@Req() req: Authed, @Query("action") action: string) {
    if (!isApprovalAction(action)) {
      throw new BadRequestException(`action must be one of: ${ACTION_NAMES.join(", ")}`);
    }
    return this.approvals.listManagers(req.user, action);
  }

  @AnyAuthenticated()
  @Post()
  approve(@Req() req: Authed, @Body() body: ApproveDto) {
    return this.approvals.approve(req.user, body);
  }
}
