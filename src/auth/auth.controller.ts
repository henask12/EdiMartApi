import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { Public } from "../common/decorators/public.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AllowPasswordChange } from "../common/decorators/allow-password-change.decorator";
import { AnyAuthenticated } from "../common/decorators/permissions.decorator";
import { LoginThrottlerGuard } from "./login-throttler.guard";
import { IsBoolean, IsEmail, IsOptional, IsString, Matches, MinLength } from "class-validator";
import { ApprovalsService, PIN_PATTERN } from "../approvals/approvals.service";
import { PASSWORD_MIN_LENGTH } from "../common/password-policy";

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsString()
  totpCode?: string;
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
  @MinLength(PASSWORD_MIN_LENGTH)
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

class TotpCodeDto {
  @IsString()
  @MinLength(6)
  code!: string;
}

class TotpDisableDto {
  @IsString()
  password!: string;

  @IsString()
  @MinLength(6)
  code!: string;
}

type AuthedReq = {
  user: {
    userId: string;
    email: string;
    roleName: string;
    displayName: string | null;
    permissions: string[];
    mustChangePassword: boolean;
    hasPin: boolean;
    locale: string | null;
    jti?: string;
    totpEnabled?: boolean;
  };
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
};

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
  login(@Body() body: LoginDto, @Req() req: AuthedReq) {
    const forwarded = req.headers["x-forwarded-for"];
    const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim();
    const ua = req.headers["user-agent"];
    return this.auth.login(body.email, body.password, body.totpCode, {
      userAgent: Array.isArray(ua) ? ua[0] : ua,
      ip: forwardedIp || req.ip || req.socket?.remoteAddress,
    });
  }

  @AnyAuthenticated()
  @AllowPasswordChange()
  @UseGuards(JwtAuthGuard)
  @Get("me")
  me(@Req() req: AuthedReq) {
    return {
      id: req.user.userId,
      email: req.user.email,
      displayName: req.user.displayName,
      role: req.user.roleName,
      permissions: req.user.permissions,
      mustChangePassword: req.user.mustChangePassword,
      hasPin: req.user.hasPin,
      locale: req.user.locale ?? "en",
      totpEnabled: Boolean(req.user.totpEnabled),
    };
  }

  @AnyAuthenticated()
  @UseGuards(JwtAuthGuard)
  @Patch("me")
  updateMe(@Req() req: AuthedReq, @Body() body: UpdateProfileDto) {
    return this.auth.updateProfile(req.user.userId, body);
  }

  @AnyAuthenticated()
  @AllowPasswordChange()
  @UseGuards(JwtAuthGuard)
  @Post("change-password")
  changePassword(@Req() req: AuthedReq, @Body() body: ChangePasswordDto) {
    return this.auth.changePassword(req.user.userId, body.currentPassword, body.newPassword);
  }

  /** Set, change or remove your own manager-approval PIN (needs your current password). */
  @AnyAuthenticated()
  @UseGuards(JwtAuthGuard)
  @Put("pin")
  setPin(@Req() req: AuthedReq, @Body() body: SetPinDto) {
    if (!body.remove && !body.pin) {
      throw new BadRequestException("Send a pin, or remove: true to remove it");
    }
    return this.approvals.setOwnPin(req.user.userId, body.currentPassword, body.remove ? null : body.pin!);
  }

  @AnyAuthenticated()
  @UseGuards(JwtAuthGuard)
  @Get("sessions")
  listSessions(@Req() req: AuthedReq) {
    return this.auth.listSessions(req.user.userId, req.user.jti);
  }

  @AnyAuthenticated()
  @UseGuards(JwtAuthGuard)
  @Post("sessions/revoke-others")
  revokeOthers(@Req() req: AuthedReq) {
    return this.auth.revokeOtherSessions(req.user.userId, req.user.jti);
  }

  @AnyAuthenticated()
  @UseGuards(JwtAuthGuard)
  @Post("sessions/:id/revoke")
  revokeOne(@Req() req: AuthedReq, @Param("id") id: string) {
    return this.auth.revokeSession(req.user.userId, id);
  }

  @AnyAuthenticated()
  @UseGuards(JwtAuthGuard)
  @Post("logout")
  logout(@Req() req: AuthedReq) {
    return this.auth.logout(req.user.userId, req.user.jti);
  }

  @AnyAuthenticated()
  @UseGuards(JwtAuthGuard)
  @Post("totp/setup")
  totpSetup(@Req() req: AuthedReq) {
    return this.auth.totpSetup(req.user.userId);
  }

  @AnyAuthenticated()
  @UseGuards(JwtAuthGuard)
  @Post("totp/enable")
  totpEnable(@Req() req: AuthedReq, @Body() body: TotpCodeDto) {
    return this.auth.totpEnable(req.user.userId, body.code);
  }

  @AnyAuthenticated()
  @UseGuards(JwtAuthGuard)
  @Post("totp/disable")
  totpDisable(@Req() req: AuthedReq, @Body() body: TotpDisableDto) {
    return this.auth.totpDisable(req.user.userId, body.password, body.code);
  }
}
