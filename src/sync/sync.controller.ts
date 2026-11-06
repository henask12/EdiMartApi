import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { PermissionKey } from "@prisma/client";
import { IsBoolean, IsObject, IsOptional, IsString, MinLength } from "class-validator";
import {
  AnyAuthenticated,
  RequireAnyPermission,
} from "../common/decorators/permissions.decorator";
import type { Actor } from "../permissions/permissions.service";
import { SyncService } from "./sync.service";

class CreateConflictDto {
  @IsString()
  @MinLength(1)
  kind!: string;

  @IsOptional()
  @IsString()
  clientRef?: string;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  errorCode?: string;

  @IsOptional()
  @IsString()
  errorMessage?: string;
}

class ResolveConflictDto {
  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsBoolean()
  dismiss?: boolean;
}

type Authed = { user: Actor };

@Controller("sync")
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /**
   * Client posts here when an offline outbox item cannot be applied (checkout /
   * stock-count / goods-receipt against their normal endpoints failed). Prefer
   * calling those endpoints first; never silently drop failed offline work.
   */
  @AnyAuthenticated()
  @Post("conflicts")
  create(@Req() req: Authed, @Body() body: CreateConflictDto) {
    return this.sync.createConflict(req.user, body);
  }

  @RequireAnyPermission(
    PermissionKey.SALES_VIEW_ALL,
    PermissionKey.SETTINGS_MANAGE,
    PermissionKey.AUDIT_VIEW,
  )
  @Get("conflicts")
  list(
    @Query("status") status?: string,
    @Query("kind") kind?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.sync.listConflicts({
      status,
      kind,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @RequireAnyPermission(PermissionKey.SETTINGS_MANAGE, PermissionKey.AUDIT_VIEW)
  @Post("conflicts/:id/resolve")
  resolve(@Req() req: Authed, @Param("id") id: string, @Body() body: ResolveConflictDto) {
    return this.sync.resolveConflict(req.user, id, body);
  }
}
