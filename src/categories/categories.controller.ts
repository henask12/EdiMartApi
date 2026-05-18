import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { RoleName } from "@prisma/client";
import { IsString, MinLength } from "class-validator";
import { Roles } from "../common/decorators/roles.decorator";
import { CategoriesService } from "./categories.service";

class CategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;
}

type Authed = { user: { userId: string } };

@Controller("categories")
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list() {
    return this.categories.list();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.categories.get(id);
  }

  @Roles(RoleName.OWNER, RoleName.STORE_STAFF)
  @Post()
  create(@Req() req: Authed, @Body() body: CategoryDto) {
    return this.categories.create(req.user.userId, body.name);
  }

  @Roles(RoleName.OWNER, RoleName.STORE_STAFF)
  @Patch(":id")
  update(@Req() req: Authed, @Param("id") id: string, @Body() body: CategoryDto) {
    return this.categories.update(req.user.userId, id, body.name);
  }

  @Roles(RoleName.OWNER)
  @Delete(":id")
  remove(@Req() req: Authed, @Param("id") id: string) {
    return this.categories.remove(req.user.userId, id);
  }
}
