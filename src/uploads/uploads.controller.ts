import {
  BadRequestException,
  Controller,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { UploadsService } from "./uploads.service";
import { PermissionKey } from "@prisma/client";
import { RequirePermissions, RequireAnyPermission } from "../common/decorators/permissions.decorator";

@Controller("uploads")
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @RequireAnyPermission(PermissionKey.PRODUCTS_CREATE, PermissionKey.PRODUCTS_EDIT)
  @Post("product-image")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadProductImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }
    return this.uploads.saveProductImage(file);
  }

  @RequirePermissions(PermissionKey.SALES_CREATE)
  @Post("sale-proof")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadSaleProof(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }
    return this.uploads.saveSaleProof(file);
  }
}
