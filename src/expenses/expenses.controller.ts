import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { PermissionKey } from "@prisma/client";
import { IsOptional, IsString } from "class-validator";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { CASHIER_ROLE, OWNER_ROLE, STORE_STAFF_ROLE } from "../common/role.constants";
import { ExpensesService } from "./expenses.service";

class CreateExpenseDto {
  @IsString()
  detail!: string;

  @IsString()
  amount!: string;

  @IsString()
  expenseDate!: string;
}

class UpdateExpenseDto {
  @IsOptional()
  @IsString()
  detail?: string;

  @IsOptional()
  @IsString()
  amount?: string;

  @IsOptional()
  @IsString()
  expenseDate?: string;
}

type Authed = { user: { userId: string } };

@Controller("expenses")
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Roles(OWNER_ROLE, CASHIER_ROLE, STORE_STAFF_ROLE)
  @RequirePermissions(PermissionKey.EXPENSES_MANAGE)
  @Get()
  list(
    @Query("skip") skip?: string,
    @Query("take") take?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.expenses.list({
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
      from,
      to,
    });
  }

  @Roles(OWNER_ROLE, CASHIER_ROLE, STORE_STAFF_ROLE)
  @RequirePermissions(PermissionKey.EXPENSES_MANAGE)
  @Post()
  create(@Req() req: Authed, @Body() body: CreateExpenseDto) {
    return this.expenses.create(req.user.userId, body);
  }

  @Roles(OWNER_ROLE, CASHIER_ROLE, STORE_STAFF_ROLE)
  @RequirePermissions(PermissionKey.EXPENSES_MANAGE)
  @Patch(":id")
  update(@Param("id") id: string, @Body() body: UpdateExpenseDto) {
    return this.expenses.update(id, body);
  }

  @Roles(OWNER_ROLE, CASHIER_ROLE, STORE_STAFF_ROLE)
  @RequirePermissions(PermissionKey.EXPENSES_MANAGE)
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.expenses.remove(id);
  }
}
