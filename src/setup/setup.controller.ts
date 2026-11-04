import { timingSafeEqual } from "crypto";
import {
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Post,
} from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { SeedRefusedError } from "../seed/seed-runner";
import { SetupService } from "./setup.service";

const secretMatches = (given: string | undefined, secret: string) => {
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
};

@Controller("setup")
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Public()
  @Get("status")
  status() {
    return this.setup.getStatus();
  }

  /**
   * First-run seed for hosts without a shell. Credentials are never returned here: they are
   * taken from ADMIN_INITIAL_PASSWORD or generated and printed once to the server log.
   */
  @Public()
  @Post("seed")
  async seed(@Headers("x-setup-key") setupKey?: string) {
    const secret = process.env.SETUP_SECRET?.trim();
    if (!secret || !secretMatches(setupKey, secret)) {
      throw new ForbiddenException("Invalid or missing X-Setup-Key header");
    }
    try {
      const summary = await this.setup.seedDatabase();
      return {
        ok: true,
        message: "Seed complete. The owner login was written to the server log.",
        summary,
      };
    } catch (err) {
      if (err instanceof SeedRefusedError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }
}
