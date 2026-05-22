import { Global, Module } from "@nestjs/common";
import { PermissionsService } from "./permissions.service";
import { RolesController } from "./roles.controller";

@Global()
@Module({
  controllers: [RolesController],
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
