import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { PaymentMethod, PermissionKey, SupplierBillStatus } from "@prisma/client";
import { IsArray, IsEnum, IsOptional, IsString } from "class-validator";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import type { Actor } from "../permissions/permissions.service";
import { BillsService } from "./bills.service";

class CreateBillDto {
  @IsString()
  supplierId!: string;

  @IsOptional()
  @IsString()
  purchaseOrderId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  goodsReceiptIds?: string[];

  @IsOptional()
  @IsString()
  supplierInvoiceRef?: string;

  @IsString()
  amountDue!: string;

  @IsOptional()
  @IsString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class PaymentDto {
  @IsString()
  amount!: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  paidAt?: string;
}

@Controller("supplier-bills")
export class BillsController {
  constructor(private readonly bills: BillsService) {}

  @RequirePermissions(PermissionKey.SUPPLIER_PAYMENTS_MANAGE)
  @Get("aged-payables")
  aged() {
    return this.bills.agedPayables();
  }

  @RequirePermissions(PermissionKey.SUPPLIER_PAYMENTS_MANAGE)
  @Get()
  list(
    @Query("supplierId") supplierId?: string,
    @Query("status") status?: SupplierBillStatus,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.bills.list({
      supplierId,
      status,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @RequirePermissions(PermissionKey.SUPPLIER_PAYMENTS_MANAGE)
  @Post()
  create(@Req() req: { user: Actor }, @Body() body: CreateBillDto) {
    return this.bills.create(req.user.userId, body);
  }

  @RequirePermissions(PermissionKey.SUPPLIER_PAYMENTS_MANAGE)
  @Get(":id")
  get(@Param("id") id: string) {
    return this.bills.get(id);
  }

  @RequirePermissions(PermissionKey.SUPPLIER_PAYMENTS_MANAGE)
  @Post(":id/payments")
  pay(@Req() req: { user: Actor }, @Param("id") id: string, @Body() body: PaymentDto) {
    return this.bills.recordPayment(req.user.userId, id, body);
  }
}
