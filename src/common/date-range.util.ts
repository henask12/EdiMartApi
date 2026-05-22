/** Parse YYYY-MM-DD as start of local calendar day. */
export const parseDateStart = (value: string): Date => {
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error("Invalid date");
  }
  const [year, month, day] = parts;
  const d = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid date");
  }
  return d;
};

/** Parse YYYY-MM-DD as end of local calendar day (inclusive). */
export const parseDateEnd = (value: string): Date => {
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error("Invalid date");
  }
  const [year, month, day] = parts;
  const d = new Date(year, month - 1, day, 23, 59, 59, 999);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid date");
  }
  return d;
};

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
