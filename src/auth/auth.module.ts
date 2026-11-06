import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { UsersModule } from "../users/users.module";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { LoginThrottlerGuard } from "./login-throttler.guard";
import { sessionTtlSeconds } from "../common/session";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>("JWT_SECRET"),
        signOptions: { expiresIn: sessionTtlSeconds() },
      }),
    }),
    // Evaluated when the app starts, so LOGIN_RATE_LIMIT can be tuned per environment.
    ThrottlerModule.forRootAsync({
      useFactory: () => [
        {
          name: "login",
          ttl: LOGIN_WINDOW_MS,
          limit: Number(process.env.LOGIN_RATE_LIMIT ?? 8),
        },
      ],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, LoginThrottlerGuard],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
