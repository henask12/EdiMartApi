import { Body, Controller, Get, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { Public } from "../common/decorators/public.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

class ChangePasswordDto {
  @IsString()
  @MinLength(6)
  currentPassword!: string;

  @IsString()
  @MinLength(6)
  newPassword!: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  login(@Body() body: LoginDto) {
    return this.auth.login(body.email, body.password);
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  me(@Req() req: { user: { userId: string; email: string; roleName: string; displayName: string | null } }) {
    return {
      id: req.user.userId,
      email: req.user.email,
      displayName: req.user.displayName,
      role: req.user.roleName,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch("me")
  updateMe(
    @Req() req: { user: { userId: string } },
    @Body() body: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(req.user.userId, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post("change-password")
  changePassword(
    @Req() req: { user: { userId: string } },
    @Body() body: ChangePasswordDto,
  ) {
    return this.auth.changePassword(req.user.userId, body.currentPassword, body.newPassword);
  }
}
