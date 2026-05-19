import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { RoleName } from "@prisma/client";
import { IsString, MinLength } from "class-validator";
import { Roles } from "../common/decorators/roles.decorator";
import { ProductTypesService } from "./product-types.service";

class ProductTypeDto {
  @IsString()
  @MinLength(1)
  name!: string;
}

type Authed = { user: { userId: string } };

@Controller("product-types")
export class ProductTypesController {
  constructor(private readonly productTypes: ProductTypesService) {}

  @Get()
  list() {
    return this.productTypes.list();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.productTypes.get(id);
  }

  @Roles(RoleName.OWNER, RoleName.STORE_STAFF)
  @Post()
  create(@Req() req: Authed, @Body() body: ProductTypeDto) {
    return this.productTypes.create(req.user.userId, body.name);
  }

  @Roles(RoleName.OWNER, RoleName.STORE_STAFF)
  @Patch(":id")
  update(@Req() req: Authed, @Param("id") id: string, @Body() body: ProductTypeDto) {
    return this.productTypes.update(req.user.userId, id, body.name);
  }

  @Roles(RoleName.OWNER)
  @Delete(":id")
  remove(@Req() req: Authed, @Param("id") id: string) {
    return this.productTypes.remove(req.user.userId, id);
  }
}
