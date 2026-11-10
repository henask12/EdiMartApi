import { Body, Controller, Get, Patch, Req } from "@nestjs/common";
import { PermissionKey } from "@prisma/client";
import { IsOptional, IsString } from "class-validator";
import {
  AnyAuthenticated,
  RequirePermissions,
} from "../common/decorators/permissions.decorator";
import type { Actor } from "../permissions/permissions.service";
import { StoreSettingsService } from "./store-settings.service";

class UpdateStoreSettingsDto {
  /** Birr. Stock corrections worth more than this need a manager's PIN. */
  @IsOptional()
  @IsString()
  adjustmentApprovalThreshold?: string;

  @IsOptional()
  @IsString()
  vatRate?: string;

  @IsOptional()
  @IsString()
  pricesIncludeVat?: string;

  @IsOptional()
  @IsString()
  discountLimitPercent?: string;

  @IsOptional()
  @IsString()
  returnWindowDays?: string;

  @IsOptional()
  @IsString()
  receiptFooter?: string;

  @IsOptional()
  @IsString()
  receiptTin?: string;

  @IsOptional()
  @IsString()
  shopName?: string;

  @IsOptional()
  @IsString()
  shopAddress?: string;

  @IsOptional()
  @IsString()
  shopPhone?: string;

  @IsOptional()
  @IsString()
  scannerBeep?: string;

  @IsOptional()
  @IsString()
  favourites?: string;

  @IsOptional()
  @IsString()
  paymentMethods?: string;

  @IsOptional()
  @IsString()
  cashDenominations?: string;

  @IsOptional()
  @IsString()
  labelAsTaxInvoice?: string;

  @IsOptional()
  @IsString()
  requireOpenShift?: string;

  @IsOptional()
  @IsString()
  varianceApprovalThreshold?: string;

  @IsOptional()
  @IsString()
  eodEmailEnabled?: string;
}

@Controller("settings/store")
export class StoreSettingsController {
  constructor(private readonly settings: StoreSettingsService) {}

  /** Cashiers need VAT / denomination / shift rules on the till — read is open to any signed-in user. */
  @AnyAuthenticated()
  @Get()
  get() {
    return this.settings.getAll();
  }

  @RequirePermissions(PermissionKey.SETTINGS_MANAGE)
  @Patch()
  update(@Req() req: { user: Actor }, @Body() body: UpdateStoreSettingsDto) {
    return this.settings.update(req.user.userId, body);
  }
}
