import { Injectable, Logger } from "@nestjs/common";
import { Resend } from "resend";
import type {
  EmailMessage,
  MessagingProvider,
  SmsMessage,
  TelegramMessage,
} from "./messaging.types";

@Injectable()
export class ResendEmailProvider implements MessagingProvider {
  private readonly logger = new Logger(ResendEmailProvider.name);
  private readonly resend: Resend | null;

  constructor() {
    const key = process.env.RESEND_API_KEY;
    this.resend = key ? new Resend(key) : null;
  }

  async sendEmail(message: EmailMessage): Promise<void> {
    const from = process.env.RESEND_FROM_EMAIL ?? "receipts@edisims.local";
    const to = Array.isArray(message.to) ? message.to : [message.to];
    if (!to.length) {
      return;
    }
    if (!this.resend) {
      this.logger.warn(`Resend not configured; would email "${message.subject}" to ${to.join(",")}`);
      return;
    }
    await this.resend.emails.send({
      from,
      to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }

  async sendSms(message: SmsMessage): Promise<void> {
    this.logger.warn(`SMS provider not implemented; would send to ${message.to}: ${message.body}`);
  }

  async sendTelegram(message: TelegramMessage): Promise<void> {
    this.logger.warn(
      `Telegram provider not implemented; would send to ${message.chatId}: ${message.text}`,
    );
  }
}
