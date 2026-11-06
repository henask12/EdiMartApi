import { RequestMethod, Type } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import {
  ANY_AUTHENTICATED_KEY,
  ANY_PERMISSIONS_KEY,
  PERMISSIONS_KEY,
} from "../common/decorators/permissions.decorator";
import { IS_PUBLIC_KEY } from "../common/decorators/public.decorator";

export type RouteRef = { route: string; handler: string };

const joinPath = (...parts: unknown[]) =>
  "/" +
  parts
    .flatMap((p) => (Array.isArray(p) ? p : [p]))
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/^\//, "");

/** Every route handler of the given controllers that declares no authorisation at all. */
export const findUnguardedRoutes = (controllers: Type<unknown>[], reflector: Reflector): RouteRef[] => {
  const missing: RouteRef[] = [];
  for (const controller of controllers) {
    const base = Reflect.getMetadata(PATH_METADATA, controller);
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = controller.prototype[name] as (...args: unknown[]) => unknown;
      if (typeof handler !== "function") continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined) continue;
      const targets = [handler, controller];
      const declared =
        reflector.getAllAndOverride(IS_PUBLIC_KEY, targets) ||
        reflector.getAllAndOverride(ANY_AUTHENTICATED_KEY, targets) ||
        (reflector.getAllAndOverride<unknown[]>(PERMISSIONS_KEY, targets) ?? []).length > 0 ||
        (reflector.getAllAndOverride<unknown[]>(ANY_PERMISSIONS_KEY, targets) ?? []).length > 0;
      if (!declared) {
        const path = joinPath(base, Reflect.getMetadata(PATH_METADATA, handler));
        missing.push({ route: `${RequestMethod[method]} ${path}`, handler: `${controller.name}.${name}` });
      }
    }
  }
  return missing;
};
