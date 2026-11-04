import { randomUUID } from "crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { join } from "path";
import { LocalStorageDriver } from "./local-storage.driver";
import { S3StorageDriver } from "./s3-storage.driver";
import type { StorageDriver } from "./storage.driver";

/** Database rows keep `/uploads/<key>` so the stored value does not depend on the driver. */
const PATH_PREFIX = "/uploads/";
const PROOF_URL_TTL_SECONDS = 600;

type Sniffed = { ext: string; contentType: string };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decide the real image type from the file's bytes; the client-supplied name/type is not trusted. */
export const sniffImage = (buf: Buffer): Sniffed | null => {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: ".jpg", contentType: "image/jpeg" };
  }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { ext: ".png", contentType: "image/png" };
  }
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString("latin1"))) {
    return { ext: ".gif", contentType: "image/gif" };
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return { ext: ".webp", contentType: "image/webp" };
  }
  return null;
};

@Injectable()
export class StorageService {
  readonly driver: StorageDriver;

  constructor() {
    this.driver = StorageService.createDriver();
  }

  static createDriver(env: NodeJS.ProcessEnv = process.env): StorageDriver {
    if ((env.STORAGE_DRIVER ?? "local") === "s3") {
      const required = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;
      const missing = required.filter((k) => !env[k]?.trim());
      if (missing.length > 0) {
        throw new Error(`STORAGE_DRIVER=s3 needs ${missing.join(", ")}`);
      }
      return new S3StorageDriver({
        bucket: env.S3_BUCKET!,
        region: env.S3_REGION?.trim() || "auto",
        endpoint: env.S3_ENDPOINT?.trim() || undefined,
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
        forcePathStyle: env.S3_FORCE_PATH_STYLE === "1",
        publicBaseUrl: env.S3_PUBLIC_BASE_URL?.trim() || undefined,
      });
    }
    return new LocalStorageDriver(
      env.UPLOAD_DIR ?? join(process.cwd(), "uploads"),
      env.PUBLIC_API_URL ?? "http://127.0.0.1:4000",
      env.FILE_URL_SECRET?.trim() || env.JWT_SECRET || "dev-only-secret",
    );
  }

  get local(): LocalStorageDriver | null {
    return this.driver instanceof LocalStorageDriver ? this.driver : null;
  }

  /** `/uploads/products/x.png` -> `products/x.png` (also accepts legacy `/uploads/x.png`). */
  keyFromPath(path: string): string {
    return path.startsWith(PATH_PREFIX) ? path.slice(PATH_PREFIX.length) : path;
  }

  private async saveImage(folder: "products" | "proofs", file: Express.Multer.File) {
    const sniffed = sniffImage(file.buffer);
    if (!sniffed) {
      throw new BadRequestException("Only JPEG, PNG, WebP or GIF images are accepted");
    }
    const key = `${folder}/${randomUUID()}${sniffed.ext}`;
    await this.driver.put(key, file.buffer, sniffed.contentType);
    return key;
  }

  async saveProductImage(file: Express.Multer.File) {
    const key = await this.saveImage("products", file);
    return { key, path: `${PATH_PREFIX}${key}`, url: await this.driver.publicUrl(key) };
  }

  async saveSaleProof(file: Express.Multer.File) {
    const key = await this.saveImage("proofs", file);
    return {
      key,
      path: `${PATH_PREFIX}${key}`,
      url: await this.driver.signedUrl(key, PROOF_URL_TTL_SECONDS),
    };
  }

  /** Public URL for a stored product image path (null when there is none). */
  async publicUrl(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    if (/^https?:\/\//.test(path)) return path;
    return this.driver.publicUrl(this.keyFromPath(path));
  }

  /** Short-lived signed URL for a private file such as a payment proof. */
  async privateUrl(path: string): Promise<string> {
    if (/^https?:\/\//.test(path)) return path;
    return this.driver.signedUrl(this.keyFromPath(path), PROOF_URL_TTL_SECONDS);
  }
}
