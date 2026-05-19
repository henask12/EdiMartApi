import { Module } from "@nestjs/common";
import { ProductTypesController } from "./product-types.controller";
import { ProductTypesService } from "./product-types.service";

@Module({
  controllers: [ProductTypesController],
  providers: [ProductTypesService],
  exports: [ProductTypesService],
})
export class ProductTypesModule {}
