import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { PermissionKey, RoleName } from "@prisma/client";
import { IsArray, IsEnum } from "class-validator";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { PermissionsService } from "./permissions.service";

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
    return roles.map((r) => ({
      name: r.name,
      isProtected: r.isProtected,
      permissions:
        r.name === RoleName.OWNER
          ? Object.values(PermissionKey)
          : r.permissions.map((p) => p.permission),
    }));
  }

  @RequirePermissions(PermissionKey.ROLES_MANAGE)
  @Patch(":name/permissions")
  update(
    @Param("name") name: RoleName,
    @Body() body: UpdateRolePermissionsDto,
  ) {
    return this.permissions.updateRolePermissions(name, body.permissions);
  }
}
