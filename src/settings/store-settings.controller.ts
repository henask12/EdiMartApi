import { Body, Controller, Get, Patch, Req } from "@nestjs/common";
import { PermissionKey } from "@prisma/client";
import { IsOptional, IsString } from "class-validator";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import type { Actor } from "../permissions/permissions.service";
import { StoreSettingsService } from "./store-settings.service";

class UpdateStoreSettingsDto {
  /** Birr. Stock corrections worth more than this need a manager's PIN. */
  @IsOptional()
  @IsString()
  adjustmentApprovalThreshold?: string;
}

@Controller("settings/store")
export class StoreSettingsController {
  constructor(private readonly settings: StoreSettingsService) {}

  @RequirePermissions(PermissionKey.SETTINGS_MANAGE)
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
