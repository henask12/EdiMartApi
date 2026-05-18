import { Controller, Get } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";

@Controller("health")
export class HealthController {
  @Public()
  @Get()
  get() {
    return { ok: true, service: "edisims-api" };
  }
}
