import { Module, forwardRef } from "@nestjs/common";
import { ReservationsController } from "./reservations.controller";
import { ReservationsService } from "./reservations.service";
import { SalesModule } from "../sales/sales.module";
import { LocationsModule } from "../locations/locations.module";

@Module({
  imports: [forwardRef(() => SalesModule), LocationsModule],
  controllers: [ReservationsController],
  providers: [ReservationsService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
