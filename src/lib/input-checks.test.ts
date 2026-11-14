import { describe, expect, it } from "vitest";
import { checkInputs } from "./input-checks";

const TODAY = "2026-11-14";
const ids = (values: Parameters<typeof checkInputs>[0], today = TODAY) => checkInputs(values, today).map((i) => i.id);
const one = (values: Parameters<typeof checkInputs>[0], id: string, today = TODAY) => checkInputs(values, today).find((i) => i.id === id);

describe("date consistency checks (C6)", () => {
  it("raises nothing for a consistent situation", () => {
    expect(ids({ entryType: "national_visa", arrivalDate: "2026-11-05", moveInDate: "2026-11-11", visaEndDate: "2027-02-10" })).toEqual([]);
    expect(ids({})).toEqual([]);
    expect(ids({ arrivalDate: "2026-11-14", moveInDate: "2026-11-14" })).toEqual([]); // same day is fine
  });

  it("flags a move-in date before the arrival date, on the move-in field", () => {
    const i = one({ arrivalDate: "2026-11-10", moveInDate: "2026-10-01" }, "move-in-before-arrival")!;
    expect(i.field).toBe("moveInDate");
    expect(i.severity).toBe("warning");
    expect(i.message).toContain("10 Nov 2026");
  });

  it("flags a visa that ends before the arrival date", () => {
    const i = one({ arrivalDate: "2026-11-10", visaEndDate: "2026-11-01" }, "visa-end-before-arrival")!;
    expect(i.field).toBe("visaEndDate");
    expect(i.severity).toBe("warning");
  });

  it("flags a visa end date that has passed, without drawing a legal conclusion", () => {
    const i = one({ visaEndDate: "2026-01-01" }, "visa-end-passed")!;
    expect(i.field).toBe("visaEndDate");
    expect(i.severity).toBe("warning");
    expect(i.message).toMatch(/already passed/);
    expect(i.message).toMatch(/LEA/);
    expect(i.message).toMatch(/cannot say what applies/);
    expect(i.message).not.toMatch(/illegal|unlawful|expired|overstay|deport|fine|penalt|must leave|entitled|eligible/i);
    expect(i.message).not.toMatch(/\d+ days/); // no day count that reads like a missed deadline
  });

  it("does not call today or a later day a passed visa", () => {
    expect(ids({ visaEndDate: TODAY })).not.toContain("visa-end-passed");
    expect(ids({ visaEndDate: "2026-11-15" })).not.toContain("visa-end-passed");
    expect(ids({ visaEndDate: "2026-11-13" })).toContain("visa-end-passed");
  });

  it("follows the date it is given, so an example date changes the result", () => {
    expect(ids({ visaEndDate: "2026-11-20" }, "2026-11-14")).toEqual([]);
    expect(ids({ visaEndDate: "2026-11-20" }, "2026-12-01")).toContain("visa-end-passed");
  });

  it("notes a move-in or arrival date that is still in the future, as information", () => {
    expect(one({ moveInDate: "2026-12-01" }, "move-in-future")).toMatchObject({ field: "moveInDate", severity: "info" });
    expect(one({ arrivalDate: "2026-12-01" }, "arrival-future")).toMatchObject({ field: "arrivalDate", severity: "info" });
    expect(ids({ moveInDate: TODAY })).not.toContain("move-in-future");
  });

  it("an arrival in the future with a move-in in the past is an inconsistency", () => {
    expect(ids({ arrivalDate: "2026-12-01", moveInDate: "2026-11-01" })).toContain("move-in-before-arrival");
  });

  it("skips dates that are missing, impossible or out of range: those are the field's own problem", () => {
    expect(ids({ arrivalDate: "2026-11-10", moveInDate: "9999-12-31", visaEndDate: "nope" })).toEqual([]);
    expect(ids({ arrivalDate: "2026-02-30", moveInDate: "2026-01-01" })).toEqual([]);
    expect(ids({ visaEndDate: "1999-01-01" })).toEqual([]);
  });

  it("never throws on damaged input", () => {
    expect(() => checkInputs(null as never, TODAY)).not.toThrow();
    expect(() => checkInputs({ arrivalDate: 5, moveInDate: {}, visaEndDate: true } as never, TODAY)).not.toThrow();
    expect(() => checkInputs({ visaEndDate: "2026-01-01" }, "not a date")).not.toThrow();
  });
});
