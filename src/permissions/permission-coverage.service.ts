import { Injectable, OnApplicationBootstrap, Type } from "@nestjs/common";
import { DiscoveryService, Reflector } from "@nestjs/core";
import { findUnguardedRoutes } from "./permission-coverage";

/**
 * Refuses to start the API when any route forgot to declare who may call it, so a new endpoint
 * can never ship open to every signed-in user by accident.
 */
@Injectable()
export class PermissionCoverageService implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap() {
    const controllers = this.discovery
      .getControllers()
      .map((wrapper) => wrapper.metatype)
      .filter((metatype): metatype is Type<unknown> => typeof metatype === "function");
    const missing = findUnguardedRoutes(controllers, this.reflector);
    if (missing.length > 0) {
      throw new Error(
        "These routes declare no permission. Add @RequirePermissions(...), @RequireAnyPermission(...), " +
          "@AnyAuthenticated() or @Public():\n" +
          missing.map((m) => `  ${m.route}  (${m.handler})`).join("\n"),
      );
    }
  }
}
