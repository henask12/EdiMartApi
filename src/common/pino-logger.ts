import { LoggerService } from "@nestjs/common";
import pino, { Logger } from "pino";

/**
 * Thin Nest LoggerService over pino. Used instead of nestjs-pino so tests stay
 * synchronous and do not need LoggerModule wiring.
 */
export class PinoLogger implements LoggerService {
  private readonly logger: Logger;

  constructor(level = process.env.LOG_LEVEL?.trim() || "info") {
    this.logger = pino({
      level,
      base: { service: "edimart-api" },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }

  log(message: unknown, ...optionalParams: unknown[]) {
    this.logger.info({ context: optionalParams[0] }, String(message));
  }

  error(message: unknown, ...optionalParams: unknown[]) {
    const trace = typeof optionalParams[0] === "string" ? optionalParams[0] : undefined;
    const context = optionalParams[1] ?? optionalParams[0];
    this.logger.error({ context, trace }, String(message));
  }

  warn(message: unknown, ...optionalParams: unknown[]) {
    this.logger.warn({ context: optionalParams[0] }, String(message));
  }

  debug?(message: unknown, ...optionalParams: unknown[]) {
    this.logger.debug({ context: optionalParams[0] }, String(message));
  }

  verbose?(message: unknown, ...optionalParams: unknown[]) {
    this.logger.trace({ context: optionalParams[0] }, String(message));
  }
}
