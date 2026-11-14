import { describe, expect, it } from "vitest";
import { addDays, diffDays, isValidISO, todayLocalISO } from "./dates";

describe("dates", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-11-25", 14)).toBe("2026-12-09");
    expect(addDays("2026-12-25", 14)).toBe("2027-01-08");
  });
  it("handles leap years", () => {
    expect(addDays("2028-02-20", 14)).toBe("2028-03-05");
    expect(addDays("2027-02-20", 14)).toBe("2027-03-06");
  });
  it("diffs in whole days, sign shows direction", () => {
    expect(diffDays("2026-11-15", "2026-11-14")).toBe(1);
    expect(diffDays("2026-11-14", "2026-11-15")).toBe(-1);
    expect(diffDays("2026-11-14", "2026-11-14")).toBe(0);
  });
  it("rejects impossible dates", () => {
    expect(isValidISO("2026-02-30")).toBe(false);
    expect(isValidISO("14/11/2026")).toBe(false);
    expect(isValidISO("2026-11-14")).toBe(true);
    expect(() => addDays("nope", 1)).toThrow();
  });
  it("formats local dates without a time zone shift", () => {
    expect(todayLocalISO(new Date(2026, 10, 14, 23, 59))).toBe("2026-11-14");
    expect(todayLocalISO(new Date(2026, 10, 14, 0, 1))).toBe("2026-11-14");
  });
});
