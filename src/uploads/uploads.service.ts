import { Injectable } from "@nestjs/common";
import { mkdir, writeFile } from "fs/promises";
import { join, extname } from "path";
import { randomUUID } from "crypto";

@Injectable()
export class UploadsService {
  private readonly uploadDir =
    process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads");

  getPublicUrl(filename: string) {
    const base = process.env.PUBLIC_API_URL ?? "http://127.0.0.1:4000";
    return `${base.replace(/\/$/, "")}/uploads/${filename}`;
  }

  async saveProductImage(file: Express.Multer.File) {
    await mkdir(this.uploadDir, { recursive: true });
    const ext = extname(file.originalname).toLowerCase() || ".jpg";
    const allowed = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
    const safeExt = allowed.includes(ext) ? ext : ".jpg";
    const filename = `${randomUUID()}${safeExt}`;
    await writeFile(join(this.uploadDir, filename), file.buffer);
    return {
      filename,
      path: `/uploads/${filename}`,
      url: this.getPublicUrl(filename),
    };
  }
}
