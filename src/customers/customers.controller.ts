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
import { PermissionKey } from "@prisma/client";
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
} from "class-validator";
import {
  RequirePermissions,
} from "../common/decorators/permissions.decorator";
import type { Actor } from "../permissions/permissions.service";
import { CustomersService } from "./customers.service";

class CreateCustomerDto {
  @IsString()
  name!: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  birthday?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  creditLimit?: string;

  @IsOptional()
  @IsBoolean()
  marketingOptOut?: boolean;
}

class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string | null;

  @IsOptional()
  @IsString()
  birthday?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  marketingOptOut?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  loyaltyTier?: string | null;
}

class RepayDto {
  @IsString()
  amount!: string;

  @IsOptional()
  @IsString()
  method?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class CreditLimitDto {
  @IsString()
  creditLimit!: string;
}

class AdjustStoreCreditDto {
  @IsString()
  amount!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

@Controller("customers")
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @RequirePermissions(PermissionKey.CUSTOMERS_VIEW)
  @Get()
  list(
    @Query("q") q?: string,
    @Query("activeOnly") activeOnly?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.customers.list({
      q,
      activeOnly: activeOnly === "false" ? false : true,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @RequirePermissions(PermissionKey.CUSTOMERS_VIEW)
  @Get("overdue")
  overdue(@Query("skip") skip?: string, @Query("take") take?: string) {
    return this.customers.listOverdue({
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @RequirePermissions(PermissionKey.CUSTOMERS_VIEW)
  @Get(":id/ledger")
  ledger(
    @Param("id") id: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.customers.ledger(id, {
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @RequirePermissions(PermissionKey.CUSTOMERS_VIEW)
  @Get(":id/loyalty")
  loyalty(
    @Param("id") id: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.customers.loyalty(id, {
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @RequirePermissions(PermissionKey.CUSTOMERS_VIEW)
  @Get(":id/statement")
  statement(@Param("id") id: string) {
    return this.customers.statement(id);
  }

  @RequirePermissions(PermissionKey.CUSTOMERS_VIEW)
  @Get(":id")
  get(@Param("id") id: string) {
    return this.customers.getProfile(id);
  }

  @RequirePermissions(PermissionKey.CUSTOMERS_MANAGE)
  @Post()
  create(@Req() req: { user: Actor }, @Body() body: CreateCustomerDto) {
    return this.customers.create(req.user.userId, body);
  }

  @RequirePermissions(PermissionKey.CUSTOMERS_MANAGE)
  @Patch(":id")
  update(
    @Req() req: { user: Actor },
    @Param("id") id: string,
    @Body() body: UpdateCustomerDto,
  ) {
    return this.customers.update(req.user.userId, id, body);
  }

  @RequirePermissions(PermissionKey.CUSTOMER_CREDIT_MANAGE)
  @Post(":id/repay")
  repay(
    @Req() req: { user: Actor },
    @Param("id") id: string,
    @Body() body: RepayDto,
  ) {
    return this.customers.repay(req.user.userId, id, body);
  }

  @RequirePermissions(PermissionKey.CUSTOMER_CREDIT_MANAGE)
  @Post(":id/credit-limit")
  creditLimit(
    @Req() req: { user: Actor },
    @Param("id") id: string,
    @Body() body: CreditLimitDto,
  ) {
    return this.customers.setCreditLimit(req.user.userId, id, body.creditLimit);
  }

  @RequirePermissions(PermissionKey.CUSTOMER_CREDIT_MANAGE)
  @Post(":id/adjust-store-credit")
  adjustStoreCredit(
    @Req() req: { user: Actor },
    @Param("id") id: string,
    @Body() body: AdjustStoreCreditDto,
  ) {
    return this.customers.adjustStoreCredit(req.user.userId, id, body);
  }
}
