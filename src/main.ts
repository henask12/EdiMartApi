import { webcrypto } from "node:crypto";

// Node 18 on some hosts lacks global crypto; @nestjs/schedule needs randomUUID.
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as Crypto;
}

import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { configureApp } from "./app.setup";
import { PinoLogger } from "./common/pino-logger";

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

const initSentry = async () => {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    return;
  }
  const Sentry = await import("@sentry/node");
  const sampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0");
  Sentry.init({
    dsn,
    tracesSampleRate: Number.isFinite(sampleRate) ? sampleRate : 0,
    environment: process.env.NODE_ENV || "development",
  });
};

const bootstrap = async () => {
  assertRequiredEnv();
  await initSentry();
  const logger = new PinoLogger();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger });
  configureApp(app);
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
  const host = process.env.HOST ?? "0.0.0.0";
  await app.listen(port, host);
  logger.log(`API listening on http://${host}:${port}`, "Bootstrap");
};

bootstrap();
