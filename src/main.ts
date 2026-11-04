import { webcrypto } from "node:crypto";

// Node 18 on some hosts lacks global crypto; @nestjs/schedule needs randomUUID.
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as Crypto;
}

import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { configureApp } from "./app.setup";

const resolveDatabaseUrl = () => {
  const url =
    process.env.DATABASE_URL?.trim() ||
    process.env.DATABASE_PRIVATE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim();
  if (url && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = url;
  }
  return url;
};

const assertRequiredEnv = () => {
  const missing: string[] = [];
  if (!resolveDatabaseUrl()) {
    missing.push("DATABASE_URL");
  }
  if (!process.env.JWT_SECRET?.trim()) {
    missing.push("JWT_SECRET");
  }
  if (process.env.NODE_ENV === "production" && !process.env.WEB_ORIGIN?.trim()) {
    missing.push("WEB_ORIGIN");
  }
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        "Add them in your hosting dashboard (Render / Railway) → service → Environment, then redeploy.",
    );
    process.exit(1);
  }
};

const bootstrap = async () => {
  assertRequiredEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
  const host = process.env.HOST ?? "0.0.0.0";
  await app.listen(port, host);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://${host}:${port}`);
};

bootstrap();
