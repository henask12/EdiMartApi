import { createHmac, timingSafeEqual } from "crypto";
import { mkdir, rm, writeFile } from "fs/promises";
import { dirname, resolve, sep } from "path";
import type { StorageDriver } from "./storage.driver";

const trimSlash = (url: string) => url.replace(/\/$/, "");

/** Development / single-server driver: files on local disk, private files via signed API URLs. */
export class LocalStorageDriver implements StorageDriver {
  constructor(
    readonly rootDir: string,
    private readonly publicApiUrl: string,
    private readonly signingSecret: string,
  ) {}

  /** Absolute path of a key, or null if the key would escape the storage root. */
  resolveKey(key: string): string | null {
    const full = resolve(this.rootDir, key);
    return full.startsWith(resolve(this.rootDir) + sep) ? full : null;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const full = this.resolveKey(key);
    if (!full) {
      throw new Error("Invalid storage key");
    }
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  publicUrl(key: string): string {
    return `${trimSlash(this.publicApiUrl)}/uploads/${key}`;
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = this.sign(key, exp);
    return `${trimSlash(this.publicApiUrl)}/files/${key}?exp=${exp}&sig=${sig}`;
  }

  async delete(key: string): Promise<void> {
    const full = this.resolveKey(key);
    if (full) {
      await rm(full, { force: true });
    }
  }

  verify(key: string, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
      return false;
    }
    const expected = Buffer.from(this.sign(key, exp));
    const given = Buffer.from(sig ?? "");
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private sign(key: string, exp: number) {
    return createHmac("sha256", this.signingSecret).update(`${key}\n${exp}`).digest("hex");
  }
}
