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
import { RoleName } from "@prisma/client";
import { Roles } from "../common/decorators/roles.decorator";
import { CatalogService } from "./catalog.service";
import { CreateProductDto, UpdateProductDto } from "./dto/catalog.dto";

type Authed = { user: { userId: string } };

@Controller("products")
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  listProducts(
    @Query("q") q?: string,
    @Query("categoryId") categoryId?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.catalog.listProducts({
      q,
      categoryId,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get(":id")
  getProduct(@Param("id") id: string) {
    return this.catalog.getProduct(id);
  }

  @Roles(RoleName.OWNER, RoleName.STORE_STAFF, RoleName.CASHIER)
  @Post()
  createProduct(@Req() req: Authed, @Body() body: CreateProductDto) {
    return this.catalog.createProduct(req.user.userId, body);
  }

  @Roles(RoleName.OWNER, RoleName.STORE_STAFF)
  @Patch(":id")
  updateProduct(
    @Req() req: Authed,
    @Param("id") id: string,
    @Body() body: UpdateProductDto,
  ) {
    return this.catalog.updateProduct(req.user.userId, id, body);
  }
}
