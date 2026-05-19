/** Parse YYYY-MM-DD as start of local day. */
export const parseDateStart = (value: string): Date => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid date");
  }
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Parse YYYY-MM-DD as end of local day (inclusive). */
export const parseDateEnd = (value: string): Date => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid date");
  }
  d.setHours(23, 59, 59, 999);
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
