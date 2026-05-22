import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Post,
} from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { SetupService } from "./setup.service";

@Controller("setup")
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Public()
  @Get("status")
  status() {
    return this.setup.getStatus();
  }

  /** Run once from browser or curl — no Render shell needed. */
  @Public()
  @Post("seed")
  async seed(@Headers("x-setup-key") setupKey?: string) {
    const secret = process.env.SETUP_SECRET?.trim();
    if (!secret || setupKey !== secret) {
      throw new ForbiddenException("Invalid or missing X-Setup-Key header");
    }
    const summary = await this.setup.seedDatabase();
    return {
      ok: true,
      message: "Seed complete",
      login: { email: "owner@edisims.local", password: "Owner123!" },
      summary,
    };
  }
}
