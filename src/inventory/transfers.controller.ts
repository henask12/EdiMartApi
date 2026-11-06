import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { PermissionKey, TransferStatus } from "@prisma/client";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { TransfersService } from "./transfers.service";
import { IsArray, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

type Authed = { user: { userId: string } };

class TransferLineDto {
  @IsString() productId!: string;
  @IsString() quantity!: string;
}

class CreateTransferDto {
  @IsString() fromLocationId!: string;
  @IsString() toLocationId!: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  lines!: TransferLineDto[];
}

@Controller("transfers")
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @RequirePermissions(PermissionKey.STOCK_TRANSFER)
  @Get()
  list(
    @Query("status") status?: TransferStatus,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.transfers.listTransfers({
      status,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @RequirePermissions(PermissionKey.STOCK_TRANSFER)
  @Get(":id")
  get(@Param("id") id: string) {
    return this.transfers.getTransfer(id);
  }

  @RequirePermissions(PermissionKey.STOCK_TRANSFER)
  @Post()
  createDraft(@Req() req: Authed, @Body() body: CreateTransferDto) {
    return this.transfers.createDraft(req.user.userId, body);
  }

  @RequirePermissions(PermissionKey.STOCK_TRANSFER)
  @Post(":id/send")
  send(@Req() req: Authed, @Param("id") id: string) {
    return this.transfers.sendTransfer(req.user.userId, id);
  }

  @RequirePermissions(PermissionKey.STOCK_TRANSFER)
  @Post(":id/receive")
  receive(@Req() req: Authed, @Param("id") id: string) {
    return this.transfers.receiveTransfer(req.user.userId, id);
  }

  @RequirePermissions(PermissionKey.STOCK_TRANSFER)
  @Post(":id/cancel")
  cancel(@Req() req: Authed, @Param("id") id: string) {
    return this.transfers.cancelTransfer(req.user.userId, id);
  }
}
