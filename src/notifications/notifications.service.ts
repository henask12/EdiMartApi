import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { NotificationType, Prisma } from "@prisma/client";
import { Resend } from "resend";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { productStockSnapshot } from "../common/stock.util";

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private resend: Resend | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
  ) {
    const key = process.env.RESEND_API_KEY;
    if (key) {
      this.resend = new Resend(key);
    }
  }

  listEmails() {
    return this.prisma.notificationEmail.findMany({ orderBy: { email: "asc" } });
  }

  async addEmail(email: string) {
    const trimmed = email.trim().toLowerCase();
    return this.prisma.notificationEmail.upsert({
      where: { email: trimmed },
      update: { active: true },
      create: { email: trimmed, active: true },
    });
  }

  async removeEmail(id: string) {
    await this.prisma.notificationEmail.delete({ where: { id } });
    return { ok: true };
  }

  async toggleEmail(id: string, active: boolean) {
    return this.prisma.notificationEmail.update({ where: { id }, data: { active } });
  }

  private async recipients() {
    return this.prisma.notificationEmail.findMany({
      where: { active: true },
      select: { email: true },
    });
  }

  private async sendMail(subject: string, html: string, type: NotificationType, metadata?: object) {
    const to = (await this.recipients()).map((r) => r.email);
    if (!to.length) {
      return;
    }
    const from = process.env.RESEND_FROM_EMAIL ?? "alerts@edisims.local";
    if (!this.resend) {
      this.logger.warn(`Resend not configured; would email: ${subject}`);
      await this.prisma.notificationLog.create({
        data: { type, subject, body: html, metadata: metadata ?? {} },
      });
      return;
    }
    await this.resend.emails.send({ from, to, subject, html });
    await this.prisma.notificationLog.create({
      data: { type, subject, body: html, metadata: metadata ?? {} },
    });
  }

  async checkLowStockForProduct(productId: string) {
    const defaultLoc = await this.locations.getDefault();
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return;
    }
    const { available } = await productStockSnapshot(this.prisma, productId, defaultLoc.id);
    if (available.gt(product.restockAt)) {
      return;
    }
    const subject = `Low stock: ${product.name}`;
    const html = `<p><strong>${product.name}</strong> is low.</p>
      <p>Available: ${available.toString()} (alert at ${product.restockAt})</p>
      <p>Suggested reorder: ${product.restockQty} units</p>`;
    await this.sendMail(subject, html, NotificationType.LOW_STOCK, { productId });
  }

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async sendExpiryAlerts() {
    const days = Number(process.env.EXPIRY_ALERT_DAYS ?? 7);
    const until = new Date();
    until.setDate(until.getDate() + days);
    const batches = await this.prisma.stockBatch.findMany({
      where: {
        expiryDate: { lte: until, gte: new Date() },
        qtyRemaining: { gt: 0 },
      },
      include: { product: true },
      orderBy: { expiryDate: "asc" },
    });
    if (!batches.length) {
      return;
    }
    const lines = batches
      .map(
        (b) =>
          `<li>${b.product.name}: ${b.qtyRemaining.toString()} units expiring ${b.expiryDate?.toISOString().slice(0, 10)}</li>`,
      )
      .join("");
    await this.sendMail(
      `Expiry alert (${batches.length} batches)`,
      `<p>These batches expire within ${days} days:</p><ul>${lines}</ul>`,
      NotificationType.EXPIRY,
      { count: batches.length },
    );
  }
}
