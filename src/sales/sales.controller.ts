import { Body, Controller, Get, Post, Query, Req } from "@nestjs/common";
import { RoleName } from "@prisma/client";
import { Type } from "class-transformer";
import { IsArray, IsOptional, IsString, ValidateNested } from "class-validator";
import { Roles } from "../common/decorators/roles.decorator";
import { SalesService } from "./sales.service";

class CheckoutLineDto {
  @IsString()
  productId!: string;

  @IsString()
  quantity!: string;
}

class CheckoutDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckoutLineDto)
  lines!: CheckoutLineDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}

type Authed = { user: { userId: string } };

@Controller("sales")
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Roles(RoleName.OWNER, RoleName.CASHIER, RoleName.STORE_STAFF)
  @Get()
  list(
    @Query("skip") skip?: string,
    @Query("take") take?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.sales.listSales({
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
      from,
      to,
    });
  }

  @Roles(RoleName.OWNER, RoleName.CASHIER, RoleName.STORE_STAFF)
  @Post("checkout")
  checkout(@Req() req: Authed, @Body() body: CheckoutDto) {
    return this.sales.checkout(req.user.userId, body);
  }

  @Roles(RoleName.OWNER, RoleName.CASHIER, RoleName.STORE_STAFF)
  @Get("today-summary")
  todaySummary() {
    return this.sales.todaySummary();
  }
}
