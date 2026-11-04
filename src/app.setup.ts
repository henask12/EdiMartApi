import { ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { StorageService } from "./storage/storage.service";

/**
 * Everything that must be identical in production and in tests: security headers, CORS locked
 * to the web app, request validation, and the static route for public product images.
 */
export const configureApp = (app: NestExpressApplication) => {
  // Product photos are loaded cross-origin by the web app, so allow that for resources.
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const storage = app.get(StorageService);
  if (storage.local) {
    // Payment proofs are private: they are only reachable through short-lived signed /files URLs.
    app.use("/uploads/proofs", (_req: unknown, res: { status: (n: number) => { end: () => void } }) => {
      res.status(404).end();
    });
    app.useStaticAssets(storage.local.rootDir, { prefix: "/uploads/" });
  }

  const webOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: webOrigins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
};
