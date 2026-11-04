import { Injectable, Logger } from "@nestjs/common";

export type FiscalSaleInput = {
  id: string;
  saleNumber: string;
  grandTotal: string;
  taxTotal: string;
};

export type FiscalRegisterResult = {
  status: "NONE" | "PENDING" | "REGISTERED" | "FAILED";
  registrationNumber?: string;
  qrPayload?: string;
};

/**
 * Slot for a future tax-authority / e-invoicing driver. The default driver is a no-op so
 * checkout can call it without blocking sales.
 */
@Injectable()
export class FiscalService {
  private readonly logger = new Logger(FiscalService.name);

  async registerSale(_sale: FiscalSaleInput): Promise<FiscalRegisterResult> {
    return { status: "NONE" };
  }

  /** Fire-and-forget after checkout; errors must never fail the sale. */
  async registerSaleSafe(sale: FiscalSaleInput): Promise<void> {
    try {
      await this.registerSale(sale);
    } catch (err) {
      this.logger.warn(`Fiscal register ignored for ${sale.saleNumber}: ${String(err)}`);
    }
  }
}
