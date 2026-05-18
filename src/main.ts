import { webcrypto } from "node:crypto";

// Node 18 on some hosts lacks global crypto; @nestjs/schedule needs randomUUID.
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as Crypto;
}

import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import { join } from "path";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";

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
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        "Add them in Railway → EdiMartApi service → Variables, then redeploy.",
    );
    process.exit(1);
  }
};

const bootstrap = async () => {
  assertRequiredEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  const uploadDir = process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads");
  app.useStaticAssets(uploadDir, { prefix: "/uploads/" });
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  app.enableCors({
    origin: webOrigin.split(",").map((o) => o.trim()),
    credentials: true,
  });
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
  // eslint-disable-next-line no-console
  console.log(`API listening on http://127.0.0.1:${port}`);
};

bootstrap();
