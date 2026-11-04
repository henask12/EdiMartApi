import { BadRequestException, Body, Controller, Get, HttpCode, Patch, Post, Put, Req, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { Public } from "../common/decorators/public.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AllowPasswordChange } from "../common/decorators/allow-password-change.decorator";
import { AnyAuthenticated } from "../common/decorators/permissions.decorator";
import { LoginThrottlerGuard } from "./login-throttler.guard";
import { IsBoolean, IsEmail, IsOptional, IsString, Matches, MinLength } from "class-validator";
import { ApprovalsService, PIN_PATTERN } from "../approvals/approvals.service";

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

  @IsOptional()
  @IsString()
  locale?: string;
}

class ChangePasswordDto {
  @IsString()
  @MinLength(6)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

class SetPinDto {
  @IsString()
  currentPassword!: string;

  /** 4 to 6 digits. Omit when removing the PIN. */
  @IsOptional()
  @Matches(PIN_PATTERN, { message: "The PIN must be 4 to 6 digits" })
  pin?: string;

  @IsOptional()
  @IsBoolean()
  remove?: boolean;
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly approvals: ApprovalsService,
  ) {}

  @Public()
  @UseGuards(LoginThrottlerGuard)
  @HttpCode(200)
  @Post("login")
  login(@Body() body: LoginDto) {
    return this.auth.login(body.email, body.password);
  }

  @AnyAuthenticated()
  @AllowPasswordChange()
  @UseGuards(JwtAuthGuard)
  @Get("me")
  me(
    @Req()
    req: {
      user: {
        userId: string;
        email: string;
        roleName: string;
        displayName: string | null;
        permissions: string[];
        mustChangePassword: boolean;
        hasPin: boolean;
        locale: string | null;
      };
    },
  ) {
    return {
      id: req.user.userId,
      email: req.user.email,
      displayName: req.user.displayName,
      role: req.user.roleName,
      permissions: req.user.permissions,
      mustChangePassword: req.user.mustChangePassword,
      hasPin: req.user.hasPin,
      locale: req.user.locale ?? "en",
    };
  }

  @AnyAuthenticated()
  @UseGuards(JwtAuthGuard)
  @Patch("me")
  updateMe(
    @Req() req: { user: { userId: string } },
    @Body() body: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(req.user.userId, body);
  }

  @AnyAuthenticated()
  @AllowPasswordChange()
  @UseGuards(JwtAuthGuard)
  @Post("change-password")
  changePassword(
    @Req() req: { user: { userId: string } },
    @Body() body: ChangePasswordDto,
  ) {
    return this.auth.changePassword(req.user.userId, body.currentPassword, body.newPassword);
  }

  /** Set, change or remove your own manager-approval PIN (needs your current password). */
  @AnyAuthenticated()
  @UseGuards(JwtAuthGuard)
  @Put("pin")
  setPin(@Req() req: { user: { userId: string } }, @Body() body: SetPinDto) {
    if (!body.remove && !body.pin) {
      throw new BadRequestException("Send a pin, or remove: true to remove it");
    }
    return this.approvals.setOwnPin(req.user.userId, body.currentPassword, body.remove ? null : body.pin!);
  }
}
