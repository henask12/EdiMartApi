import {
  Controller,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CASHIER_ROLE, OWNER_ROLE, STORE_STAFF_ROLE } from "../common/role.constants";
import { memoryStorage } from "multer";
import { Roles } from "../common/decorators/roles.decorator";
import { UploadsService } from "./uploads.service";

@Controller("uploads")
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Roles(OWNER_ROLE, STORE_STAFF_ROLE)
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

  @Roles(OWNER_ROLE, CASHIER_ROLE, STORE_STAFF_ROLE)
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
