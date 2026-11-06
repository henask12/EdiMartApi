import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

/**
 * Rate-limits login attempts per account (the e-mail being tried), not per IP: every browser
 * request reaches the API through the Next.js proxy, so all users share one server IP.
 */
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const body = req.body as { email?: unknown } | undefined;
    const email = typeof body?.email === "string" ? body.email.toLowerCase().trim() : "";
    return `login:${email || String(req.ip)}`;
  }
}
