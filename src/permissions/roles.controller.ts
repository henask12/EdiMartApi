import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { PermissionKey } from ".prisma/client";
import { IsArray, IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { PermissionsService } from "./permissions.service";

class CreateRoleDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsArray()
  @IsEnum(PermissionKey, { each: true })
  permissions?: PermissionKey[];
}

class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(PermissionKey, { each: true })
  permissions?: PermissionKey[];
}

class UpdateRolePermissionsDto {
  @IsArray()
  @IsEnum(PermissionKey, { each: true })
  permissions!: PermissionKey[];
}

@Controller("roles")
export class RolesController {
  constructor(private readonly permissions: PermissionsService) {}

  @RequirePermissions(PermissionKey.ROLES_MANAGE)
  @Get()
  async list() {
    const roles = await this.permissions.listRolesWithPermissions();
    return roles.map((r) => this.permissions.mapRole(r));
  }

  @RequirePermissions(PermissionKey.ROLES_MANAGE)
  @Post()
  create(@Body() body: CreateRoleDto) {
    return this.permissions.createRole(body.name, body.permissions);
  }

  @RequirePermissions(PermissionKey.ROLES_MANAGE)
  @Get(":id")
  async getOne(@Param("id") id: string) {
    const role = await this.permissions.getRoleById(id);
    return this.permissions.mapRole(role);
  }

  @RequirePermissions(PermissionKey.ROLES_MANAGE)
  @Patch(":id")
  update(@Param("id") id: string, @Body() body: UpdateRoleDto) {
    return this.permissions.updateRole(id, body);
  }

  @RequirePermissions(PermissionKey.ROLES_MANAGE)
  @Patch(":id/permissions")
  updatePermissions(@Param("id") id: string, @Body() body: UpdateRolePermissionsDto) {
    return this.permissions.updateRole(id, { permissions: body.permissions });
  }

  @RequirePermissions(PermissionKey.ROLES_MANAGE)
  @Delete(":id")
  delete(@Param("id") id: string) {
    return this.permissions.deleteRole(id);
  }

  @RequirePermissions(PermissionKey.ROLES_MANAGE)
  @Get(":id/users")
  async listUsers(
    @Param("id") id: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    const s = skip ? Number(skip) : 0;
    const t = Math.min(take ? Number(take) : 25, 100);
    const [items, total] = await this.permissions.listUsersForRole(id, s, t);
    return { items, total, skip: s, take: t };
  }
}
