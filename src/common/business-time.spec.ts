import { sessionTtlSeconds } from "./session";
import {
  addDays,
  businessDateString,
  businessDayEnd,
  businessDayStart,
  businessMonthStart,
  businessWeekStart,
  nextMonthStart,
} from "./business-time";
import { buildCreatedAtRange } from "./date-range.util";

describe("business time (Africa/Addis_Ababa, UTC+3)", () => {
  it("turns over to the next day at 21:00 UTC, not at UTC midnight", () => {
    expect(businessDateString(new Date("2025-11-03T20:59:59Z"))).toBe("2025-11-03");
    expect(businessDateString(new Date("2025-11-03T21:00:00Z"))).toBe("2025-11-04");
    // 01:30 in Addis is still the previous UTC day
    expect(businessDateString(new Date("2025-11-03T22:30:00Z"))).toBe("2025-11-04");
    // and an afternoon sale is the same date in both
    expect(businessDateString(new Date("2025-11-03T12:00:00Z"))).toBe("2025-11-03");
  });

  it("maps a business date to the exact UTC instants of its start and end", () => {
    expect(businessDayStart("2025-11-04").toISOString()).toBe("2025-11-03T21:00:00.000Z");
    expect(businessDayEnd("2025-11-04").toISOString()).toBe("2025-11-04T20:59:59.999Z");
    expect(() => businessDayStart("04/11/2025")).toThrow("Invalid date");
  });

  it("report ranges follow the business day", () => {
    const range = buildCreatedAtRange("2025-11-04", "2025-11-04")!;
    expect(range.gte!.toISOString()).toBe("2025-11-03T21:00:00.000Z");
    expect(range.lte!.toISOString()).toBe("2025-11-04T20:59:59.999Z");
  });

  it("does day, week and month arithmetic on business dates", () => {
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
    expect(addDays("2025-01-01", -1)).toBe("2024-12-31");
    // Monday 2025-11-03 .. Sunday 2025-11-09
    expect(businessWeekStart("2025-11-03")).toBe("2025-11-03");
    expect(businessWeekStart("2025-11-09")).toBe("2025-11-03");
    expect(businessWeekStart("2025-11-10")).toBe("2025-11-10");
    expect(businessMonthStart("2025-11-17")).toBe("2025-11-01");
    expect(nextMonthStart("2025-12-31")).toBe("2026-01-01");
    expect(nextMonthStart("2025-01-31")).toBe("2025-02-01");
  });
});

describe("session length", () => {
  it("defaults to 8 hours and is driven by SESSION_TTL_HOURS", () => {
    expect(sessionTtlSeconds({})).toBe(8 * 3600);
    expect(sessionTtlSeconds({ SESSION_TTL_HOURS: "12" })).toBe(12 * 3600);
    expect(sessionTtlSeconds({ SESSION_TTL_HOURS: "0.5" })).toBe(1800);
  });
  it("refuses nonsense instead of silently using a default", () => {
    expect(() => sessionTtlSeconds({ SESSION_TTL_HOURS: "abc" })).toThrow();
    expect(() => sessionTtlSeconds({ SESSION_TTL_HOURS: "0" })).toThrow();
    expect(() => sessionTtlSeconds({ SESSION_TTL_HOURS: "-3" })).toThrow();
  });
});
