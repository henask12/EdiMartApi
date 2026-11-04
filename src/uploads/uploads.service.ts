import { Injectable } from "@nestjs/common";
import { StorageService } from "../storage/storage.service";

@Injectable()
export class UploadsService {
  constructor(private readonly storage: StorageService) {}

  saveProductImage(file: Express.Multer.File) {
    return this.storage.saveProductImage(file);
  }

  saveSaleProof(file: Express.Multer.File) {
    return this.storage.saveSaleProof(file);
  }
}
