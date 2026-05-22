"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadsService = void 0;
const common_1 = require("@nestjs/common");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const crypto_1 = require("crypto");
let UploadsService = class UploadsService {
    uploadDir = process.env.UPLOAD_DIR ?? (0, path_1.join)(process.cwd(), "uploads");
    getPublicUrl(filename) {
        const base = process.env.PUBLIC_API_URL ?? "http://127.0.0.1:4000";
        return `${base.replace(/\/$/, "")}/uploads/${filename}`;
    }
    async saveImage(file) {
        await (0, promises_1.mkdir)(this.uploadDir, { recursive: true });
        const ext = (0, path_1.extname)(file.originalname).toLowerCase() || ".jpg";
        const allowed = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
        const safeExt = allowed.includes(ext) ? ext : ".jpg";
        const filename = `${(0, crypto_1.randomUUID)()}${safeExt}`;
        await (0, promises_1.writeFile)((0, path_1.join)(this.uploadDir, filename), file.buffer);
        return {
            filename,
            path: `/uploads/${filename}`,
            url: this.getPublicUrl(filename),
        };
    }
    saveProductImage(file) {
        return this.saveImage(file);
    }
    saveSaleProof(file) {
        return this.saveImage(file);
    }
};
exports.UploadsService = UploadsService;
exports.UploadsService = UploadsService = __decorate([
    (0, common_1.Injectable)()
], UploadsService);
//# sourceMappingURL=uploads.service.js.map