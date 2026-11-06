import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { PermissionKey, ShiftStatus } from "@prisma/client";
import { IsObject, IsOptional, IsString } from "class-validator";
import {
  RequireAnyPermission,
  RequirePermissions,
} from "../common/decorators/permissions.decorator";
import type { Actor } from "../permissions/permissions.service";
import { ShiftsService, type DenominationMap } from "./shifts.service";

class OpenShiftDto {
  @IsOptional()
  @IsString()
  registerId?: string;

  @IsObject()
  denominations!: DenominationMap;

  @IsOptional()
  @IsString()
  notes?: string;
}

class CashMovementDto {
  @IsString()
  amount!: string;

  @IsString()
  reason!: string;
}

class NoSaleDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

class CloseShiftDto {
  @IsObject()
  denominations!: DenominationMap;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  approvalToken?: string;
}

@Controller("shifts")
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @RequireAnyPermission(PermissionKey.SHIFT_MANAGE, PermissionKey.SHIFT_VIEW_ALL)
  @Get()
  list(
    @Req() req: { user: Actor },
    @Query("status") status?: ShiftStatus,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("registerId") registerId?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.shifts.listShifts(req.user, {
      status,
      from,
      to,
      registerId,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @RequirePermissions(PermissionKey.SHIFT_MANAGE)
  @Get("current")
  current(@Req() req: { user: Actor }, @Query("registerId") registerId?: string) {
    return this.shifts.getCurrentShift(req.user, registerId);
  }

  @RequirePermissions(PermissionKey.SHIFT_MANAGE)
  @Post("open")
  open(@Req() req: { user: Actor }, @Body() body: OpenShiftDto) {
    return this.shifts.openShift(req.user, body);
  }

  @RequireAnyPermission(PermissionKey.SHIFT_MANAGE, PermissionKey.SHIFT_VIEW_ALL)
  @Get(":id/x-report")
  xReport(@Req() req: { user: Actor }, @Param("id") id: string) {
    return this.shifts.xReport(req.user, id);
  }

  @RequireAnyPermission(PermissionKey.SHIFT_MANAGE, PermissionKey.SHIFT_VIEW_ALL)
  @Get(":id/z-report")
  zReport(@Req() req: { user: Actor }, @Param("id") id: string) {
    return this.shifts.zReport(req.user, id);
  }

  @RequirePermissions(PermissionKey.SHIFT_MANAGE)
  @Post(":id/cash-in")
  cashIn(@Req() req: { user: Actor }, @Param("id") id: string, @Body() body: CashMovementDto) {
    return this.shifts.cashIn(req.user, id, body);
  }

  @RequirePermissions(PermissionKey.SHIFT_MANAGE)
  @Post(":id/cash-out")
  cashOut(@Req() req: { user: Actor }, @Param("id") id: string, @Body() body: CashMovementDto) {
    return this.shifts.cashOut(req.user, id, body);
  }

  @RequirePermissions(PermissionKey.SHIFT_MANAGE)
  @Post(":id/no-sale")
  noSale(
    @Req() req: { user: Actor },
    @Param("id") id: string,
    @Body() body: NoSaleDto,
    @Headers("x-approval-token") approvalToken?: string,
  ) {
    return this.shifts.noSale(req.user, id, body, approvalToken?.trim());
  }

  @RequirePermissions(PermissionKey.SHIFT_MANAGE)
  @Post(":id/close")
  close(
    @Req() req: { user: Actor },
    @Param("id") id: string,
    @Body() body: CloseShiftDto,
    @Headers("x-approval-token") approvalHeader?: string,
  ) {
    const approvalToken = body.approvalToken?.trim() || approvalHeader?.trim();
    return this.shifts.closeShift(req.user, id, { ...body, approvalToken });
  }

  @RequireAnyPermission(PermissionKey.SHIFT_MANAGE, PermissionKey.SHIFT_VIEW_ALL)
  @Get(":id")
  get(@Req() req: { user: Actor }, @Param("id") id: string) {
    return this.shifts.getShift(req.user, id);
  }
}
