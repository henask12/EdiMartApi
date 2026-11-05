import { Module } from "@nestjs/common";
import { MessagingService } from "./messaging.service";
import { ResendEmailProvider } from "./resend-email.provider";

@Module({
  providers: [ResendEmailProvider, MessagingService],
  exports: [MessagingService, ResendEmailProvider],
})
export class MessagingModule {}
