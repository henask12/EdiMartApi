import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { PermissionKey } from "@prisma/client";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import type { Actor } from "../permissions/permissions.service";
import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from "class-validator";
import { PASSWORD_MIN_LENGTH } from "../common/password-policy";
import { UsersService } from "./users.service";

class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsString()
  role!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  password!: string;
}

class UpdateUserDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  roleId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class ResetPasswordDto {
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  password!: string;
}

type Authed = { user: Actor };

@Controller("users")
@RequirePermissions(PermissionKey.USERS_MANAGE)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query("skip") skip?: string, @Query("take") take?: string) {
    return this.users.list({
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Post()
  create(@Req() req: Authed, @Body() body: CreateUserDto) {
    return this.users.create(req.user, body);
  }

  @Patch(":id")
  update(@Req() req: Authed, @Param("id") id: string, @Body() body: UpdateUserDto) {
    return this.users.update(req.user, id, body);
  }

  @Post(":id/reset-password")
  resetPassword(@Req() req: Authed, @Param("id") id: string, @Body() body: ResetPasswordDto) {
    return this.users.resetPassword(req.user, id, body.password);
  }
}
