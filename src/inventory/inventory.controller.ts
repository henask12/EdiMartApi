import { Body, Controller, Get, Headers, Post, Query, Req } from "@nestjs/common";
import { AdjustReason, PermissionKey } from "@prisma/client";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { InventoryService } from "./inventory.service";
import { viewerFor } from "../permissions/access";
import type { Actor } from "../permissions/permissions.service";
import { IsArray, IsEnum, IsOptional, IsString, MinLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

class AdjustDto {
  @IsString() productId!: string;
  @IsString() quantityDelta!: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsEnum(AdjustReason) reasonCode?: AdjustReason;
}

class ReturnDto {
  @IsString() productId!: string;
  @IsString() quantity!: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() refSaleId?: string;
}

class WriteOffDto {
  @IsString() productId!: string;
  @IsString() quantity!: string;
  @IsEnum(AdjustReason) reasonCode!: AdjustReason;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() notes?: string;
}

class QuarantineDto {
  @IsString() productId!: string;
  @IsString() quantity!: string;
  @IsOptional() @IsString() fromLocationId?: string;
  @IsOptional() @IsString() notes?: string;
}

class SnapshotDto {
  @IsOptional() @IsString() date?: string;
}

type Authed = { user: Actor };

@Controller("inventory")
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @RequirePermissions(PermissionKey.STOCK_VIEW)
  @Get("expiry")
  listExpiry(
    @Query("status") status?: "expiring" | "expired" | "all",
    @Query("days") days?: string,
  ) {
    return this.inventory.listExpiry({
      status: status ?? "all",
      days: days ? Number(days) : undefined,
    });
  }

  @RequirePermissions(PermissionKey.STOCK_HISTORY_VIEW)
  @Get("movements")
  listMovements(
    @Req() req: Authed,
    @Query("productId") productId?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.inventory.listMovements(
      {
        productId,
        skip: skip ? Number(skip) : undefined,
        take: take ? Number(take) : undefined,
      },
      viewerFor(req.user).includeCost,
    );
  }

  @RequirePermissions(PermissionKey.STOCK_ADJUST)
  @Post("adjust")
  adjust(
    @Req() req: Authed,
    @Body() body: AdjustDto,
    @Headers("x-approval-token") approvalToken?: string,
  ) {
    return this.inventory.adjustStock(req.user, body, approvalToken?.trim() || undefined);
  }

  @RequirePermissions(PermissionKey.STOCK_ADJUST)
  @Post("return")
  returnToStock(@Req() req: Authed, @Body() body: ReturnDto) {
    return this.inventory.returnToStock(req.user.userId, body);
  }

  @RequirePermissions(PermissionKey.STOCK_WRITE_OFF)
  @Post("write-off")
  writeOff(@Req() req: Authed, @Body() body: WriteOffDto) {
    return this.inventory.writeOff(req.user.userId, body);
  }

  @RequirePermissions(PermissionKey.STOCK_VIEW)
  @Get("overview")
  overview(@Req() req: Authed) {
    return this.inventory.inventoryOverview(viewerFor(req.user).includeCost);
  }

  @RequirePermissions(PermissionKey.STOCK_VIEW)
  @Get("lookup")
  lookup(@Req() req: Authed, @Query("q") q: string) {
    return this.inventory.stockLookup(q, viewerFor(req.user).includeCost);
  }

  @RequirePermissions(PermissionKey.STOCK_ADJUST)
  @Post("quarantine")
  quarantine(@Req() req: Authed, @Body() body: QuarantineDto) {
    return this.inventory.moveToQuarantine(req.user.userId, body);
  }

  @RequirePermissions(PermissionKey.STOCK_VIEW)
  @Get("replenishment")
  replenishment() {
    return this.inventory.replenishmentSuggestions();
  }

  @RequirePermissions(PermissionKey.STOCK_VIEW)
  @Post("snapshot")
  snapshot(@Body() body: SnapshotDto) {
    return this.inventory.takeDailySnapshot(body?.date);
  }
}
