import { BadRequestException } from "@nestjs/common";
import {
  addDays,
  businessDateString,
  businessDayEnd,
  businessDayStart,
  businessMonthStart,
  businessWeekStart,
  nextMonthStart,
} from "../common/business-time";

export type DatePreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "last_month"
  | "custom";

export type ResolvedDateRange = {
  preset: DatePreset;
  from: string;
  to: string;
  comparisonFrom: string;
  comparisonTo: string;
  start: Date;
  end: Date;
  comparisonStart: Date;
  comparisonEnd: Date;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const assertDate = (value: string, label: string): string => {
  if (!DATE_RE.test(value)) {
    throw new BadRequestException(`${label} must be YYYY-MM-DD`);
  }
  try {
    businessDayStart(value);
  } catch {
    throw new BadRequestException(`Invalid ${label}`);
  }
  return value;
};

/** Inclusive day count between two business dates. */
export const daysInclusive = (from: string, to: string): number => {
  const ms = businessDayStart(to).getTime() - businessDayStart(from).getTime();
  return Math.floor(ms / (24 * 3600 * 1000)) + 1;
};

const previousEqualPeriod = (from: string, to: string) => {
  const count = daysInclusive(from, to);
  const comparisonTo = addDays(from, -1);
  const comparisonFrom = addDays(comparisonTo, -(count - 1));
  return { comparisonFrom, comparisonTo };
};

/**
 * Parse preset / from / to into a business-date window plus the previous
 * equal-length comparison window.
 */
export const resolveReportRange = (opts: {
  preset?: string;
  from?: string;
  to?: string;
  today?: string;
}): ResolvedDateRange => {
  const today = opts.today ?? businessDateString();
  const rawPreset = (opts.preset ?? "today").toLowerCase();
  const allowed: DatePreset[] = [
    "today",
    "yesterday",
    "this_week",
    "this_month",
    "last_month",
    "custom",
  ];
  if (!allowed.includes(rawPreset as DatePreset)) {
    throw new BadRequestException(
      `preset must be one of ${allowed.join(", ")}`,
    );
  }
  const preset = rawPreset as DatePreset;

  let from: string;
  let to: string;

  switch (preset) {
    case "today":
      from = today;
      to = today;
      break;
    case "yesterday":
      from = addDays(today, -1);
      to = from;
      break;
    case "this_week":
      from = businessWeekStart(today);
      to = today;
      break;
    case "this_month":
      from = businessMonthStart(today);
      to = today;
      break;
    case "last_month": {
      const thisMonth = businessMonthStart(today);
      to = addDays(thisMonth, -1);
      from = businessMonthStart(to);
      break;
    }
    case "custom": {
      if (!opts.from || !opts.to) {
        throw new BadRequestException("custom preset requires from and to");
      }
      from = assertDate(opts.from, "from");
      to = assertDate(opts.to, "to");
      if (from > to) {
        throw new BadRequestException("from must be on or before to");
      }
      break;
    }
  }

  // Allow from/to overrides on non-custom presets when both are provided.
  if (preset !== "custom" && opts.from && opts.to) {
    from = assertDate(opts.from, "from");
    to = assertDate(opts.to, "to");
    if (from > to) {
      throw new BadRequestException("from must be on or before to");
    }
  }

  const { comparisonFrom, comparisonTo } = previousEqualPeriod(from, to);
  return {
    preset,
    from,
    to,
    comparisonFrom,
    comparisonTo,
    start: businessDayStart(from),
    end: businessDayEnd(to),
    comparisonStart: businessDayStart(comparisonFrom),
    comparisonEnd: businessDayEnd(comparisonTo),
  };
};

/** Percent change of current vs previous; null when previous is zero and current is not. */
export const deltaPct = (current: number, previous: number): number | null => {
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }
  return Number((((current - previous) / previous) * 100).toFixed(2));
};

/** Iterate YYYY-MM-DD from `from` through `to` inclusive. */
export const eachBusinessDate = (from: string, to: string): string[] => {
  const out: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
};

/** Next calendar month's first day after `from` (re-export convenience). */
export { nextMonthStart };
