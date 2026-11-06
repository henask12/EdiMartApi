import { Body, Controller, Post, Req } from "@nestjs/common";
import { PermissionKey } from "@prisma/client";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { BulkImportService } from "./bulk-import.service";
import { viewerFor } from "../permissions/access";
import type { Actor } from "../permissions/permissions.service";
import { IsArray, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

type Authed = { user: Actor };

class PreviewDto {
  @IsString()
  csv!: string;
}

class PreviewRowDto {
  @Type(() => Number)
  row!: number;
  @IsString() name!: string;
  @IsString() category!: string;
  @IsString() sellingPrice!: string;
  @IsOptional() @IsString() costPrice?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() openingQty?: string;
  @IsArray() errors!: string[];
  @IsArray() warnings!: string[];
}

class CommitDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreviewRowDto)
  rows!: PreviewRowDto[];
}

@Controller("imports/products")
export class BulkImportController {
  constructor(private readonly bulk: BulkImportService) {}

  @RequirePermissions(PermissionKey.PRODUCTS_CREATE)
  @Post("preview")
  preview(@Body() body: PreviewDto) {
    return this.bulk.previewCsv(body.csv);
  }

  @RequirePermissions(PermissionKey.PRODUCTS_CREATE)
  @Post("commit")
  commit(@Req() req: Authed, @Body() body: CommitDto) {
    return this.bulk.commitPreview(req.user.userId, body.rows, viewerFor(req.user).includeCost);
  }
}
