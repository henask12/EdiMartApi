import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { PermissionKey, PromotionTarget, PromotionType } from "@prisma/client";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import {
  RequireAnyPermission,
  RequirePermissions,
} from "../common/decorators/permissions.decorator";
import type { Actor } from "../permissions/permissions.service";
import { PromotionsService } from "./promotions.service";

class CreatePromotionDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsEnum(PromotionType)
  type!: PromotionType;

  @IsString()
  value!: string;

  @IsOptional()
  @IsString()
  minSpend?: string;

  @IsOptional()
  @IsEnum(PromotionTarget)
  target?: PromotionTarget;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  startsAt?: string;

  @IsOptional()
  @IsString()
  endsAt?: string;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  daysOfWeek?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  startHour?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24)
  endHour?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  stackable?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUses?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUsesPerCustomer?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class UpdatePromotionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  code?: string | null;

  @IsOptional()
  @IsEnum(PromotionType)
  type?: PromotionType;

  @IsOptional()
  @IsString()
  value?: string;

  @IsOptional()
  @IsString()
  minSpend?: string | null;

  @IsOptional()
  @IsEnum(PromotionTarget)
  target?: PromotionTarget;

  @IsOptional()
  @IsString()
  productId?: string | null;

  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  startsAt?: string | null;

  @IsOptional()
  @IsString()
  endsAt?: string | null;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  daysOfWeek?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  startHour?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  endHour?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  stackable?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  maxUses?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  maxUsesPerCustomer?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class EvaluateLineDto {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsString()
  lineTotal!: string;
}

class EvaluateDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvaluateLineDto)
  lines!: EvaluateLineDto[];

  @IsString()
  subtotal!: string;

  @IsOptional()
  @IsString()
  couponCode?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  promotionIds?: string[];

  @IsOptional()
  @IsString()
  now?: string;
}

@Controller("promotions")
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @RequireAnyPermission(PermissionKey.CUSTOMERS_VIEW, PermissionKey.PROMOTIONS_MANAGE)
  @Get()
  list(
    @Query("q") q?: string,
    @Query("activeOnly") activeOnly?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.promotions.list({
      q,
      activeOnly: activeOnly === "false" ? false : true,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @RequireAnyPermission(PermissionKey.CUSTOMERS_VIEW, PermissionKey.PROMOTIONS_MANAGE)
  @Post("evaluate")
  evaluate(@Body() body: EvaluateDto) {
    return this.promotions.evaluate(body);
  }

  @RequireAnyPermission(PermissionKey.CUSTOMERS_VIEW, PermissionKey.PROMOTIONS_MANAGE)
  @Get(":id/usage")
  usage(
    @Param("id") id: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.promotions.usage(id, {
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @RequireAnyPermission(PermissionKey.CUSTOMERS_VIEW, PermissionKey.PROMOTIONS_MANAGE)
  @Get(":id")
  get(@Param("id") id: string) {
    return this.promotions.get(id);
  }

  @RequirePermissions(PermissionKey.PROMOTIONS_MANAGE)
  @Post()
  create(@Req() req: { user: Actor }, @Body() body: CreatePromotionDto) {
    return this.promotions.create(req.user.userId, body);
  }

  @RequirePermissions(PermissionKey.PROMOTIONS_MANAGE)
  @Patch(":id")
  update(
    @Req() req: { user: Actor },
    @Param("id") id: string,
    @Body() body: UpdatePromotionDto,
  ) {
    return this.promotions.update(req.user.userId, id, body);
  }
}
