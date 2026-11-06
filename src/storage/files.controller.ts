import { Controller, Get, NotFoundException, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../common/decorators/public.decorator";
import { StorageService } from "./storage.service";

/**
 * Serves private files (payment proofs) for the local storage driver. The signature in the URL
 * is the credential: it is HMAC-signed, tied to one file and expires after a few minutes.
 * With the S3 driver, signed URLs point at the bucket and this route is unused.
 */
@Controller("files")
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Public()
  @Get("*key")
  serve(
    @Param("key") keyParts: string | string[],
    @Query("exp") exp: string,
    @Query("sig") sig: string,
    @Res() res: Response,
  ) {
    const local = this.storage.local;
    const key = Array.isArray(keyParts) ? keyParts.join("/") : keyParts;
    if (!local || !local.verify(key, Number(exp), sig)) {
      throw new NotFoundException();
    }
    const full = local.resolveKey(key);
    if (!full) {
      throw new NotFoundException();
    }
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(full, (err) => {
      if (err && !res.headersSent) {
        res.status(404).end();
      }
    });
  }
}
