import { describe, expect, it } from "vitest";
import { addDays, dateProblem, diffDays, isPlausibleDate, isValidISO, MAX_DATE, MIN_DATE, todayLocalISO } from "./dates";

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

  describe("accepted range", () => {
    it("accepts real dates inside the range, including its edges", () => {
      for (const d of [MIN_DATE, MAX_DATE, "2026-11-14", "2028-02-29"]) expect(isPlausibleDate(d), d).toBe(true);
    });

    it("rejects extreme, impossible and malformed values without throwing", () => {
      for (const d of ["9999-12-31", "1999-12-31", "2101-01-01", "0001-01-01", "0000-00-00", "2026-02-30", "2026-13-45", "26-11-14", "", "abc", " 2026-11-14", "2026-11-14T00:00"])
        expect(isPlausibleDate(d), d).toBe(false);
      for (const d of [undefined, null, 20261114, true, {}, []]) expect(isPlausibleDate(d)).toBe(false);
    });

    it("explains why a date cannot be used, and says nothing for empty or good dates", () => {
      expect(dateProblem("")).toBeNull();
      expect(dateProblem(undefined)).toBeNull();
      expect(dateProblem("2026-11-14")).toBeNull();
      expect(dateProblem("9999-12-31")).toMatch(/between 1 Jan 2000 and 31 Dec 2100/);
      expect(dateProblem("1999-01-01")).toMatch(/between 1 Jan 2000 and 31 Dec 2100/);
      expect(dateProblem("2026-02-30")).toMatch(/not a real date/);
      expect(dateProblem(42)).toMatch(/not a real date/);
    });
  });
});
