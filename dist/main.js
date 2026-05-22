"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = require("node:crypto");
if (!globalThis.crypto) {
    globalThis.crypto = node_crypto_1.webcrypto;
}
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const path_1 = require("path");
const app_module_1 = require("./app.module");
const resolveDatabaseUrl = () => {
    const url = process.env.DATABASE_URL?.trim() ||
        process.env.DATABASE_PRIVATE_URL?.trim() ||
        process.env.POSTGRES_URL?.trim();
    if (url && !process.env.DATABASE_URL) {
        process.env.DATABASE_URL = url;
    }
    return url;
};
const assertRequiredEnv = () => {
    const missing = [];
    if (!resolveDatabaseUrl()) {
        missing.push("DATABASE_URL");
    }
    if (!process.env.JWT_SECRET?.trim()) {
        missing.push("JWT_SECRET");
    }
    if (missing.length > 0) {
        console.error(`Missing required environment variable(s): ${missing.join(", ")}. ` +
            "Add them in Railway → EdiMartApi service → Variables, then redeploy.");
        process.exit(1);
    }
};
const bootstrap = async () => {
    assertRequiredEnv();
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.use((0, cookie_parser_1.default)());
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
    }));
    const uploadDir = process.env.UPLOAD_DIR ?? (0, path_1.join)(process.cwd(), "uploads");
    app.useStaticAssets(uploadDir, { prefix: "/uploads/" });
    const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
    app.enableCors({
        origin: webOrigin.split(",").map((o) => o.trim()),
        credentials: true,
    });
    const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
    const host = process.env.HOST ?? "0.0.0.0";
    await app.listen(port, host);
    console.log(`API listening on http://${host}:${port} (public URL uses Railway PORT=${port})`);
};
bootstrap();
//# sourceMappingURL=main.js.map