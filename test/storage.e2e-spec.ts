import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import request from "supertest";
import { LocalStorageDriver } from "../src/storage/local-storage.driver";
import { StorageService, sniffImage } from "../src/storage/storage.service";
import {
  TestApp,
  bearer,
  checkout,
  close,
  createProduct,
  createTestApp,
  login,
  resetData,
  seedBasics,
} from "./helpers";

// 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe("image sniffing", () => {
  it("recognises real images by their bytes", () => {
    expect(sniffImage(PNG)?.ext).toBe(".png");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.ext).toBe(".jpg");
    expect(sniffImage(Buffer.from("GIF89a....", "latin1"))?.ext).toBe(".gif");
    expect(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))?.ext).toBe(".webp");
  });
  it("rejects everything else, whatever it is called", () => {
    expect(sniffImage(Buffer.from("<svg onload=alert(1)></svg>"))).toBeNull();
    expect(sniffImage(Buffer.from("<?php echo 1; ?>"))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe("local storage driver", () => {
  const root = mkdtempSync(join(tmpdir(), "edimart-storage-"));
  const driver = new LocalStorageDriver(root, "https://api.example.com/", "secret-1");

  it("refuses keys that escape the storage folder", async () => {
    expect(driver.resolveKey("../outside.txt")).toBeNull();
    expect(driver.resolveKey("proofs/../../outside.txt")).toBeNull();
    expect(driver.resolveKey("proofs/ok.png")).not.toBeNull();
    await expect(driver.put("../outside.txt", Buffer.from("x"))).rejects.toThrow();
  });

  it("signs URLs that verify only for the same file, unexpired, untampered", async () => {
    const url = new URL(await driver.signedUrl("proofs/a.png", 60));
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig")!;
    expect(url.pathname).toBe("/files/proofs/a.png");
    expect(driver.verify("proofs/a.png", exp, sig)).toBe(true);
    expect(driver.verify("proofs/b.png", exp, sig)).toBe(false);
    expect(driver.verify("proofs/a.png", exp + 1, sig)).toBe(false);
    const flipLastChar = (s: string) => s.slice(0, -1) + (s.endsWith("0") ? "1" : "0");
    expect(driver.verify("proofs/a.png", exp, flipLastChar(sig))).toBe(false);
    expect(driver.verify("proofs/a.png", exp, "")).toBe(false);
    const other = new LocalStorageDriver(root, "https://api.example.com", "secret-2");
    expect(other.verify("proofs/a.png", exp, sig)).toBe(false);
  });

  it("does not honour an expired signature", async () => {
    const url = new URL(await driver.signedUrl("proofs/a.png", -5));
    expect(driver.verify("proofs/a.png", Number(url.searchParams.get("exp")), url.searchParams.get("sig")!)).toBe(false);
  });
});

describe("storage configuration", () => {
  it("defaults to local and demands credentials for the S3 driver", () => {
    expect(() => StorageService.createDriver({ STORAGE_DRIVER: "s3" })).toThrow(/S3_BUCKET/);
    expect(() =>
      StorageService.createDriver({
        STORAGE_DRIVER: "s3",
        S3_BUCKET: "b",
        S3_ACCESS_KEY_ID: "k",
        S3_SECRET_ACCESS_KEY: "s",
        S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
      }),
    ).not.toThrow();
    expect(StorageService.createDriver({ UPLOAD_DIR: tmpdir() })).toBeInstanceOf(LocalStorageDriver);
  });

  it("S3 signed URLs are produced locally and expire", async () => {
    const driver = StorageService.createDriver({
      STORAGE_DRIVER: "s3",
      S3_BUCKET: "bucket",
      S3_ACCESS_KEY_ID: "AKIATEST",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
      S3_PUBLIC_BASE_URL: "https://img.example.com/",
    });
    expect(await driver.publicUrl("products/x.png")).toBe("https://img.example.com/products/x.png");
    const signed = new URL(await driver.signedUrl("proofs/y.png", 600));
    expect(signed.hostname).toContain("r2.cloudflarestorage.com");
    expect(signed.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(signed.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });
});

describe("uploads over HTTP", () => {
  let t: TestApp;
  let staffToken: string;
  let cashierToken: string;
  let locationId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => close(t));
  beforeEach(async () => {
    await resetData(t.prisma);
    const basics = await seedBasics(t.prisma);
    locationId = basics.location.id;
    staffToken = await login(t, "store_staff@test.local");
    cashierToken = await login(t, "cashier@test.local");
  });

  it("stores product images publicly under /uploads/products", async () => {
    const res = await request(t.http())
      .post("/uploads/product-image")
      .set(bearer(staffToken))
      .attach("file", PNG, { filename: "whatever.exe", contentType: "text/plain" });
    expect(res.status).toBe(201);
    expect(res.body.path).toMatch(/^\/uploads\/products\/[0-9a-f-]+\.png$/);
    const fetched = await request(t.http()).get(res.body.path);
    expect(fetched.status).toBe(200);
    expect(fetched.headers["content-type"]).toContain("image/png");
  });

  it("rejects files that are not images, and a missing file", async () => {
    const html = await request(t.http())
      .post("/uploads/product-image")
      .set(bearer(staffToken))
      .attach("file", Buffer.from("<html><script>alert(1)</script></html>"), "photo.png");
    expect(html.status).toBe(400);
    const none = await request(t.http()).post("/uploads/product-image").set(bearer(staffToken));
    expect(none.status).toBe(400);
  });

  it("keeps payment proofs private: no public URL, signed links only", async () => {
    const up = await request(t.http())
      .post("/uploads/sale-proof")
      .set(bearer(cashierToken))
      .attach("file", PNG, "proof.png");
    expect(up.status).toBe(201);
    expect(up.body.path).toMatch(/^\/uploads\/proofs\//);

    // The old public path no longer serves proofs.
    expect((await request(t.http()).get(up.body.path)).status).toBe(404);

    // The signed link works...
    const signed = new URL(up.body.url);
    const ok = await request(t.http()).get(`${signed.pathname}${signed.search}`);
    expect(ok.status).toBe(200);
    expect(ok.headers["cache-control"]).toContain("private");

    // ...but not when tampered with, for another file, or without a signature.
    const tampered = signed.search.replace(/sig=(.)/, (_m, c: string) => `sig=${c === "a" ? "b" : "a"}`);
    expect((await request(t.http()).get(`${signed.pathname}${tampered}`)).status).toBe(404);
    expect((await request(t.http()).get(signed.pathname)).status).toBe(404);
    expect((await request(t.http()).get(`/files/proofs/other.png${signed.search}`)).status).toBe(404);
    expect((await request(t.http()).get(`/files/..%2F..%2Fpackage.json${signed.search}`)).status).toBe(404);
  });

  it("shows a signed proof link on the sale, and ignores proof paths with traversal", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 3 });
    const up = await request(t.http())
      .post("/uploads/sale-proof")
      .set(bearer(cashierToken))
      .attach("file", PNG, "proof.png");
    const res = await checkout(t, cashierToken, {
      lines: [{ productId: product.id, quantity: "1" }],
      proofImagePaths: [up.body.path, "/uploads/../../etc/passwd"],
    });
    expect(res.status).toBe(201);
    expect(res.body.sale.attachments).toHaveLength(1);
    const link = new URL(res.body.sale.attachments[0].imageUrl);
    expect(link.pathname.startsWith("/files/proofs/")).toBe(true);
    expect((await request(t.http()).get(`${link.pathname}${link.search}`)).status).toBe(200);
  });
});
