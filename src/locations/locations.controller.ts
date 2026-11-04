import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { PermissionKey } from "@prisma/client";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { AnyAuthenticated } from "../common/decorators/permissions.decorator";
import { LocationsService } from "./locations.service";
import { IsBoolean, IsNumber, IsOptional, IsString } from "class-validator";

type Authed = { user: { userId: string } };

class CreateLocationDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() storeCode?: string;
  @IsOptional() @IsBoolean() sellable?: boolean;
  @IsOptional() @IsNumber() sortOrder?: number;
  @IsOptional() @IsString() binCode?: string;
}

class UpdateLocationDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsBoolean() sellable?: boolean;
  @IsOptional() @IsNumber() sortOrder?: number;
  @IsOptional() @IsString() binCode?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller("locations")
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @AnyAuthenticated()
  @Get()
  list(@Query("includeInactive") includeInactive?: string) {
    return this.locations.listLocations(includeInactive === "true");
  }

  @AnyAuthenticated()
  @Get(":id")
  get(@Param("id") id: string) {
    return this.locations.getLocation(id);
  }

  @RequirePermissions(PermissionKey.LOCATIONS_MANAGE)
  @Post()
  create(@Req() req: Authed, @Body() body: CreateLocationDto) {
    return this.locations.createLocation(req.user.userId, body);
  }

  @RequirePermissions(PermissionKey.LOCATIONS_MANAGE)
  @Patch(":id")
  update(@Req() req: Authed, @Param("id") id: string, @Body() body: UpdateLocationDto) {
    return this.locations.updateLocation(req.user.userId, id, body);
  }
}
