import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { RegistersController } from "./registers.controller";
import { ShiftsController } from "./shifts.controller";
import { ShiftsService } from "./shifts.service";

@Module({
  imports: [NotificationsModule],
  controllers: [RegistersController, ShiftsController],
  providers: [ShiftsService],
  exports: [ShiftsService],
})
export class ShiftsModule {}
