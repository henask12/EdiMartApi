"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var NotificationsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const client_1 = require("@prisma/client");
const resend_1 = require("resend");
const prisma_service_1 = require("../prisma/prisma.service");
const locations_service_1 = require("../locations/locations.service");
const stock_util_1 = require("../common/stock.util");
let NotificationsService = NotificationsService_1 = class NotificationsService {
    prisma;
    locations;
    logger = new common_1.Logger(NotificationsService_1.name);
    resend = null;
    constructor(prisma, locations) {
        this.prisma = prisma;
        this.locations = locations;
        const key = process.env.RESEND_API_KEY;
        if (key) {
            this.resend = new resend_1.Resend(key);
        }
    }
    listEmails() {
        return this.prisma.notificationEmail.findMany({ orderBy: { email: "asc" } });
    }
    async addEmail(email) {
        const trimmed = email.trim().toLowerCase();
        return this.prisma.notificationEmail.upsert({
            where: { email: trimmed },
            update: { active: true },
            create: { email: trimmed, active: true },
        });
    }
    async removeEmail(id) {
        await this.prisma.notificationEmail.delete({ where: { id } });
        return { ok: true };
    }
    async toggleEmail(id, active) {
        return this.prisma.notificationEmail.update({ where: { id }, data: { active } });
    }
    async recipients() {
        return this.prisma.notificationEmail.findMany({
            where: { active: true },
            select: { email: true },
        });
    }
    async sendMail(subject, html, type, metadata) {
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
    async checkStockAlertsForProduct(productId) {
        const defaultLoc = await this.locations.getDefault();
        const product = await this.prisma.product.findUnique({ where: { id: productId } });
        if (!product) {
            return;
        }
        const { available } = await (0, stock_util_1.productStockSnapshot)(this.prisma, productId, defaultLoc.id);
        if (available.lte(0)) {
            await this.sendOutOfStockAlert(product.id, product.name, available);
            return;
        }
        if (product.lastOutOfStockAlertAt) {
            await this.prisma.product.update({
                where: { id: productId },
                data: { lastOutOfStockAlertAt: null },
            });
        }
        if (available.lte(product.restockAt)) {
            await this.sendLowStockAlert(product, available);
        }
    }
    async checkLowStockForProduct(productId) {
        return this.checkStockAlertsForProduct(productId);
    }
    async sendOutOfStockAlert(productId, productName, available) {
        const product = await this.prisma.product.findUnique({ where: { id: productId } });
        if (!product?.lastOutOfStockAlertAt) {
            const subject = `Out of stock: ${productName}`;
            const html = `<p><strong>${productName}</strong> is now out of stock.</p>
        <p>Available: ${available.toString()}</p>
        <p>Please restock as soon as possible.</p>`;
            await this.sendMail(subject, html, client_1.NotificationType.OUT_OF_STOCK, { productId });
            await this.prisma.product.update({
                where: { id: productId },
                data: { lastOutOfStockAlertAt: new Date() },
            });
        }
    }
    async sendLowStockAlert(product, available) {
        const subject = `Low stock: ${product.name}`;
        const html = `<p><strong>${product.name}</strong> is low.</p>
      <p>Available: ${available.toString()} (alert at ${product.restockAt})</p>
      <p>Suggested reorder: ${product.restockQty} units</p>`;
        await this.sendMail(subject, html, client_1.NotificationType.LOW_STOCK, { productId: product.id });
    }
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
            .map((b) => `<li>${b.product.name}: ${b.qtyRemaining.toString()} units expiring ${b.expiryDate?.toISOString().slice(0, 10)}</li>`)
            .join("");
        await this.sendMail(`Expiry alert (${batches.length} batches)`, `<p>These batches expire within ${days} days:</p><ul>${lines}</ul>`, client_1.NotificationType.EXPIRY, { count: batches.length });
    }
};
exports.NotificationsService = NotificationsService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_DAY_AT_8AM),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], NotificationsService.prototype, "sendExpiryAlerts", null);
exports.NotificationsService = NotificationsService = NotificationsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        locations_service_1.LocationsService])
], NotificationsService);
//# sourceMappingURL=notifications.service.js.map