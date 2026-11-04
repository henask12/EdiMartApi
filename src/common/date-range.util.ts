import { businessDayEnd, businessDayStart } from "./business-time";

/** Parse YYYY-MM-DD as the start of that calendar day in the business time zone. */
export const parseDateStart = (value: string): Date => businessDayStart(value);

/** Parse YYYY-MM-DD as the end of that calendar day (inclusive) in the business time zone. */
export const parseDateEnd = (value: string): Date => businessDayEnd(value);

export const buildCreatedAtRange = (from?: string, to?: string) => {
  if (!from && !to) {
    return undefined;
  }
  const range: { gte?: Date; lte?: Date } = {};
  if (from) {
    range.gte = parseDateStart(from);
  }
  if (to) {
    range.lte = parseDateEnd(to);
  }
  return range;
};
