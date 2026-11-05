export type EmailMessage = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
};

export type SmsMessage = {
  to: string;
  body: string;
};

export type TelegramMessage = {
  chatId: string;
  text: string;
};

export interface MessagingProvider {
  sendEmail(message: EmailMessage): Promise<void>;
  sendSms(message: SmsMessage): Promise<void>;
  sendTelegram(message: TelegramMessage): Promise<void>;
}

export type MessageKind = "transactional" | "marketing";
