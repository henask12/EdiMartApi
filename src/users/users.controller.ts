import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { PermissionKey, RoleName } from "@prisma/client";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { UsersService } from "./users.service";

class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsEnum(RoleName)
  role!: RoleName;

  @IsString()
  @MinLength(6)
  password!: string;
}

class UpdateUserDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsEnum(RoleName)
  role?: RoleName;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class ResetPasswordDto {
  @IsString()
  @MinLength(6)
  password!: string;
}

type Authed = { user: { userId: string } };

@Controller("users")
@RequirePermissions(PermissionKey.USERS_MANAGE)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(@Req() req: Authed, @Body() body: CreateUserDto) {
    return this.users.create(req.user.userId, body);
  }

  @Patch(":id")
  update(@Req() req: Authed, @Param("id") id: string, @Body() body: UpdateUserDto) {
    return this.users.update(req.user.userId, id, body);
  }

  @Post(":id/reset-password")
  resetPassword(@Req() req: Authed, @Param("id") id: string, @Body() body: ResetPasswordDto) {
    return this.users.resetPassword(req.user.userId, id, body.password);
  }
}
