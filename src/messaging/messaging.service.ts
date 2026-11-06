import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type {
  EmailMessage,
  MessageKind,
  SmsMessage,
  TelegramMessage,
} from "./messaging.types";
import { ResendEmailProvider } from "./resend-email.provider";

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: ResendEmailProvider,
  ) {}

  /**
   * Marketing messages are skipped when the customer opted out.
   * Transactional messages (e.g. digital receipt) still send.
   */
  async sendToCustomer(
    customerId: string,
    kind: MessageKind,
    channels: {
      email?: EmailMessage;
      sms?: SmsMessage;
      telegram?: TelegramMessage;
    },
  ) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      this.logger.warn(`Messaging skipped: customer ${customerId} not found`);
      return { sent: false, reason: "customer_not_found" as const };
    }
    if (kind === "marketing" && customer.marketingOptOut) {
      return { sent: false, reason: "opted_out" as const };
    }

    if (channels.email) {
      const to = channels.email.to || customer.email;
      if (to) {
        try {
          await this.provider.sendEmail({ ...channels.email, to });
        } catch (err) {
          this.logger.error(`Email failed for customer ${customerId}: ${String(err)}`);
        }
      }
    }
    if (channels.sms) {
      try {
        await this.provider.sendSms({
          ...channels.sms,
          to: channels.sms.to || customer.phone,
        });
      } catch (err) {
        this.logger.error(`SMS failed for customer ${customerId}: ${String(err)}`);
      }
    }
    if (channels.telegram) {
      try {
        await this.provider.sendTelegram(channels.telegram);
      } catch (err) {
        this.logger.error(`Telegram failed for customer ${customerId}: ${String(err)}`);
      }
    }
    return { sent: true as const };
  }

  sendEmail(message: EmailMessage) {
    return this.provider.sendEmail(message);
  }

  sendSms(message: SmsMessage) {
    return this.provider.sendSms(message);
  }

  sendTelegram(message: TelegramMessage) {
    return this.provider.sendTelegram(message);
  }
}
