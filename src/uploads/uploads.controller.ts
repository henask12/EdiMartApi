import {
  Controller,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { RoleName } from "@prisma/client";
import { memoryStorage } from "multer";
import { Roles } from "../common/decorators/roles.decorator";
import { UploadsService } from "./uploads.service";

@Controller("uploads")
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Roles(RoleName.OWNER, RoleName.STORE_STAFF)
  @Post("product-image")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadProductImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      return { message: "No file uploaded" };
    }
    return this.uploads.saveProductImage(file);
  }

  @Roles(RoleName.OWNER, RoleName.CASHIER, RoleName.STORE_STAFF)
  @Post("sale-proof")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadSaleProof(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      return { message: "No file uploaded" };
    }
    return this.uploads.saveSaleProof(file);
  }
}
