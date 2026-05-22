import { Type } from "class-transformer";
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from "class-validator";

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  categoryId!: string;

  @IsOptional()
  @IsString()
  productTypeId?: string;

  @IsString()
  sellingPrice!: string;

  @IsOptional()
  @IsString()
  costPrice?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  restockAt?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  restockQty?: number;

  @IsOptional()
  @IsString()
  imagePath?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  originCountry?: string;

  @IsOptional()
  @IsString()
  initialQuantity?: string;

  @IsOptional()
  @IsString()
  initialExpiryDate?: string;

  @IsOptional()
  @IsString()
  expiryDate?: string;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  productTypeId?: string;

  @IsOptional()
  @IsString()
  sellingPrice?: string;

  @IsOptional()
  @IsString()
  costPrice?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  restockAt?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  restockQty?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  imagePath?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  originCountry?: string | null;

  @IsOptional()
  @IsString()
  expiryDate?: string | null;
}
