/**
 * The shop runs in Ethiopia (UTC+3, no daylight saving). Timestamps are stored in UTC;
 * "today", sale numbers, report periods and cron schedules use this business time zone.
 */
export const BUSINESS_TZ = "Africa/Addis_Ababa";

/** Fixed offset of the business zone from UTC, in hours (Ethiopia has no DST). */
const BUSINESS_UTC_OFFSET_HOURS = 3;
const HOUR_MS = 3_600_000;

const dateParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar date (YYYY-MM-DD) of an instant in the business time zone. */
export const businessDateString = (at: Date = new Date()): string => dateParts.format(at);

/** UTC instant of 00:00 business time on the given YYYY-MM-DD date. */
export const businessDayStart = (date: string): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error("Invalid date");
  }
  const [, y, m, d] = match;
  const utcMidnight = Date.UTC(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(utcMidnight)) {
    throw new Error("Invalid date");
  }
  return new Date(utcMidnight - BUSINESS_UTC_OFFSET_HOURS * HOUR_MS);
};

/** UTC instant of the last millisecond of the given business date. */
export const businessDayEnd = (date: string): Date =>
  new Date(businessDayStart(date).getTime() + 24 * HOUR_MS - 1);

/** Add whole days to a YYYY-MM-DD date string. */
export const addDays = (date: string, days: number): string => {
  const start = businessDayStart(date);
  return businessDateString(new Date(start.getTime() + days * 24 * HOUR_MS + 12 * HOUR_MS));
};

/** Monday of the week containing the given business date. */
export const businessWeekStart = (date: string): string => {
  const noon = new Date(businessDayStart(date).getTime() + 12 * HOUR_MS);
  const weekday = noon.getUTCDay(); // business day at noon local is the same UTC day
  const diff = weekday === 0 ? -6 : 1 - weekday;
  return addDays(date, diff);
};

/** First day of the month containing the given business date (YYYY-MM-01). */
export const businessMonthStart = (date: string): string => `${date.slice(0, 7)}-01`;

/** First day of the month after the one containing the given business date. */
export const nextMonthStart = (date: string): string => {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;
};

/** First day of the year containing the given business date, and of the next year. */
export const businessYearStart = (date: string): string => `${date.slice(0, 4)}-01-01`;
export const nextYearStart = (date: string): string => `${Number(date.slice(0, 4)) + 1}-01-01`;
