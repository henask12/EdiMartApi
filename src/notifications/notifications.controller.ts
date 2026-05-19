import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { OWNER_ROLE } from "../common/role.constants";
import { IsBoolean, IsEmail, IsString } from "class-validator";
import { Roles } from "../common/decorators/roles.decorator";
import { NotificationsService } from "./notifications.service";

class EmailDto {
  @IsEmail()
  email!: string;
}

class ToggleDto {
  @IsBoolean()
  active!: boolean;
}

@Controller("settings/notification-emails")
@Roles(OWNER_ROLE)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list() {
    return this.notifications.listEmails();
  }

  @Post()
  add(@Body() body: EmailDto) {
    return this.notifications.addEmail(body.email);
  }

  @Patch(":id")
  toggle(@Param("id") id: string, @Body() body: ToggleDto) {
    return this.notifications.toggleEmail(id, body.active);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.notifications.removeEmail(id);
  }
}
