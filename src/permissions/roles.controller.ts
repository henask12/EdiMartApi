import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { PermissionKey } from "@prisma/client";
import { IsArray, IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { GROUP_ORDER, PERMISSION_CATALOG } from "./permission-catalog";
import { Actor, PermissionsService } from "./permissions.service";

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

type Authed = { user: Actor };

@Controller("roles")
export class RolesController {
  constructor(private readonly permissions: PermissionsService) {}

  @RequirePermissions(PermissionKey.ROLES_MANAGE)
  @Get()
  async list() {
    const roles = await this.permissions.listRolesWithPermissions();
    return roles.map((r) => this.permissions.mapRole(r));
  }

  /** Every permission with its group, plain-language description and sensitivity (for the matrix). */
  @RequirePermissions(PermissionKey.ROLES_MANAGE)
  @Get("permissions")
  catalog() {
    return { groups: GROUP_ORDER, permissions: PERMISSION_CATALOG };
  }

  @RequirePermissions(PermissionKey.ROLES_MANAGE)
  @Post()
  create(@Req() req: Authed, @Body() body: CreateRoleDto) {
    return this.permissions.createRole(req.user, body.name, body.permissions);
  }

  @RequirePermissions(PermissionKey.ROLES_MANAGE)
  @Get(":id")
  async getOne(@Param("id") id: string) {
    const role = await this.permissions.getRoleById(id);
    return this.permissions.mapRole(role);
  }

  @RequirePermissions(PermissionKey.ROLES_MANAGE)
  @Patch(":id")
  update(@Req() req: Authed, @Param("id") id: string, @Body() body: UpdateRoleDto) {
    return this.permissions.updateRole(req.user, id, body);
  }

  @RequirePermissions(PermissionKey.ROLES_MANAGE)
  @Patch(":id/permissions")
  updatePermissions(
    @Req() req: Authed,
    @Param("id") id: string,
    @Body() body: UpdateRolePermissionsDto,
  ) {
    return this.permissions.updateRole(req.user, id, { permissions: body.permissions });
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
