import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { PermissionKey } from "@prisma/client";
import { IsBoolean, IsOptional, IsString } from "class-validator";
import { AnyAuthenticated, RequirePermissions } from "../common/decorators/permissions.decorator";
import type { Actor } from "../permissions/permissions.service";
import { ShiftsService } from "./shifts.service";

class CreateRegisterDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  storeCode?: string;

  @IsOptional()
  @IsString()
  deviceTokenHint?: string;
}

class UpdateRegisterDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  storeCode?: string;

  @IsOptional()
  @IsString()
  deviceTokenHint?: string | null;
}

@Controller("registers")
export class RegistersController {
  constructor(private readonly shifts: ShiftsService) {}

  @AnyAuthenticated()
  @Get()
  list(@Query("includeInactive") includeInactive?: string) {
    return this.shifts.listRegisters(includeInactive === "true");
  }

  @RequirePermissions(PermissionKey.SETTINGS_MANAGE)
  @Post()
  create(@Req() req: { user: Actor }, @Body() body: CreateRegisterDto) {
    return this.shifts.createRegister(req.user.userId, body);
  }

  @RequirePermissions(PermissionKey.SETTINGS_MANAGE)
  @Patch(":id")
  update(@Req() req: { user: Actor }, @Param("id") id: string, @Body() body: UpdateRegisterDto) {
    return this.shifts.updateRegister(req.user.userId, id, body);
  }
}
