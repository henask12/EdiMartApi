import { Body, Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import { MovementType, PermissionKey } from "@prisma/client";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import type { Response } from "express";
import { IsOptional, IsString } from "class-validator";
import { parseExportFormat, sendExport } from "../export/export-response.util";
import { InventoryService } from "./inventory.service";
import { viewerFor } from "../permissions/access";
import type { Actor } from "../permissions/permissions.service";

class ReceiveStockDto {
  @IsString()
  productId!: string;

  @IsString()
  quantity!: string;

  @IsString()
  unitCost!: string;

  @IsOptional()
  @IsString()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

type Authed = { user: Actor };

@Controller("stock")
export class StockController {
  constructor(private readonly inventory: InventoryService) {}

  @RequirePermissions(PermissionKey.STOCK_RECEIVE)
  @Post("receive")
  receive(@Req() req: Authed, @Body() body: ReceiveStockDto) {
    return this.inventory.receiveGoods(req.user.userId, body);
  }

  @RequirePermissions(PermissionKey.STOCK_HISTORY_VIEW)
  @Get("history/export")
  async exportHistory(
    @Res() res: Response,
    @Query("format") format?: string,
    @Query("productId") productId?: string,
    @Query("type") type?: MovementType,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const result = await this.inventory.exportMovements(parseExportFormat(format), {
      productId,
      type,
      from,
      to,
    });
    sendExport(res, result);
  }

  @RequirePermissions(PermissionKey.STOCK_HISTORY_VIEW)
  @Get("history/:id")
  getMovement(@Req() req: Authed, @Param("id") id: string) {
    return this.inventory.getMovement(id, viewerFor(req.user).includeCost);
  }

  @RequirePermissions(PermissionKey.STOCK_HISTORY_VIEW)
  @Get("history")
  history(
    @Req() req: Authed,
    @Query("productId") productId?: string,
    @Query("type") type?: MovementType,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.inventory.listMovements(
      {
        productId,
        type,
        from,
        to,
        skip: skip ? Number(skip) : undefined,
        take: take ? Number(take) : undefined,
      },
      viewerFor(req.user).includeCost,
    );
  }

  @RequirePermissions(PermissionKey.STOCK_HISTORY_VIEW)
  @Get("batches")
  batches(
    @Req() req: Authed,
    @Query("productId") productId: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.inventory.listBatches(
      productId,
      {
        skip: skip ? Number(skip) : undefined,
        take: take ? Number(take) : undefined,
      },
      viewerFor(req.user).includeCost,
    );
  }
}
