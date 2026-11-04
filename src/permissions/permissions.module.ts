import { Global, Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { PermissionCoverageService } from "./permission-coverage.service";
import { PermissionsService } from "./permissions.service";
import { RolesController } from "./roles.controller";

@Global()
@Module({
  imports: [DiscoveryModule],
  controllers: [RolesController],
  providers: [PermissionsService, PermissionCoverageService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
