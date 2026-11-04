import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { PermissionKey, StockCountStatus, StockCountType } from "@prisma/client";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { StockCountsService } from "./stock-counts.service";
import { IsEnum, IsOptional, IsString } from "class-validator";

type Authed = { user: { userId: string } };

class CreateCountDto {
  @IsOptional() @IsEnum(StockCountType) type?: StockCountType;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() notes?: string;
}

class RecordLineDto {
  @IsString() productId!: string;
  @IsString() countedQty!: string;
  @IsOptional() @IsString() notes?: string;
}

@Controller("stock-counts")
export class StockCountsController {
  constructor(private readonly counts: StockCountsService) {}

  @RequirePermissions(PermissionKey.STOCK_COUNT)
  @Get()
  list(
    @Query("status") status?: StockCountStatus,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.counts.listCounts({
      status,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @RequirePermissions(PermissionKey.STOCK_COUNT)
  @Get(":id")
  get(@Param("id") id: string) {
    return this.counts.getCount(id);
  }

  @RequirePermissions(PermissionKey.STOCK_COUNT)
  @Post()
  create(@Req() req: Authed, @Body() body: CreateCountDto) {
    return this.counts.createCount(req.user.userId, body);
  }

  @RequirePermissions(PermissionKey.STOCK_COUNT)
  @Post(":id/start")
  start(@Req() req: Authed, @Param("id") id: string) {
    return this.counts.startCount(req.user.userId, id);
  }

  @RequirePermissions(PermissionKey.STOCK_COUNT)
  @Post(":id/lines")
  recordLine(@Req() req: Authed, @Param("id") id: string, @Body() body: RecordLineDto) {
    return this.counts.recordCountLine(req.user.userId, id, body);
  }

  @RequirePermissions(PermissionKey.STOCK_COUNT_APPROVE)
  @Post(":id/post")
  post(@Req() req: Authed, @Param("id") id: string) {
    return this.counts.postCount(req.user.userId, id);
  }
}
