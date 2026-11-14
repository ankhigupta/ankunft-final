import { describe, expect, it } from "vitest";
import { berlinPack } from "./pack/load";
import { defaultState, hasProgress, restoreState, serializeState, STORAGE_KEY } from "./saved-state";

const restore = (raw: string | null) => restoreState(raw, berlinPack);
const json = (x: unknown) => JSON.stringify(x);
const INITIAL = defaultState();

describe("saved state: restoring", () => {
  it("starts from the initial state when nothing was saved", () => {
    const r = restore(null);
    expect(r.outcome).toBe("none");
    expect(r.state).toEqual(INITIAL);
    expect(INITIAL.values.entryType).toBe("national_visa");
  });

  it("restores a valid saved state exactly", () => {
    const saved = {
      values: { entryType: "national_visa", arrivalDate: "2026-11-05", moveInDate: "2026-11-11", visaEndDate: "2027-02-10", hasAdmissionLetter: true },
      done: ["landlord_confirmation", "health_insurance"],
    };
    const r = restore(json(saved));
    expect(r.outcome).toBe("restored");
    expect(r.state).toEqual(saved);
  });

  it("round-trips through serializeState", () => {
    const state = { values: { entryType: "national_visa", moveInDate: "2026-11-11" }, done: ["housing"] };
    expect(restore(serializeState(state)).state).toEqual(state);
  });

  it("keeps an empty choice the person made (no entry type) rather than forcing the default back", () => {
    expect(restore(json({ values: { entryType: "" }, done: [] })).state.values.entryType).toBe("");
  });

  it("ignores a demo date saved by an earlier version, without treating it as damage", () => {
    const r = restore(json({ values: { entryType: "national_visa" }, done: [], demoDate: "2026-11-14" }));
    expect(r.outcome).toBe("restored");
    expect(r.state).not.toHaveProperty("demoDate");
    expect(JSON.parse(serializeState(r.state))).not.toHaveProperty("demoDate");
  });
});

describe("saved state: damaged data falls back safely", () => {
  it.each([
    ["malformed JSON", "{not json"],
    ["empty string", ""],
    ["a JSON string", '"hello"'],
    ["a number", "42"],
    ["null", "null"],
    ["an array", "[1,2,3]"],
    ["an unrelated object", '{"foo":"bar"}'],
    ["truncated JSON", '{"values":{"entryType":"national'],
    ["far too large", "x".repeat(60_000)],
  ])("%s gives the initial state", (_label, raw) => {
    const r = restore(raw);
    expect(r.state).toEqual(INITIAL);
    expect(r.outcome).toBe("reset");
  });

  it("wrong top-level types: values and done are replaced, never used", () => {
    const r = restore(json({ values: "x", done: 5 }));
    expect(r.state).toEqual(INITIAL);
    expect(r.outcome).toBe("reset");
    for (const bad of [{ values: [], done: {} }, { values: null, done: null }, { values: 1, done: "abc" }]) {
      expect(restore(json(bad)).state).toEqual(INITIAL);
    }
  });

  it("wrong types inside values are dropped one by one and the valid ones are kept", () => {
    const r = restore(
      json({
        values: { entryType: 7, moveInDate: "2026-11-11", arrivalDate: 20261105, visaEndDate: ["2027-01-01"], hasAdmissionLetter: "yes" },
        done: ["housing"],
      }),
    );
    expect(r.outcome).toBe("repaired");
    expect(r.state.values).toEqual({ moveInDate: "2026-11-11" });
    expect(r.state.done).toEqual(["housing"]);
  });

  it("invalid values are dropped: unknown options, impossible and extreme dates, unknown keys", () => {
    const r = restore(
      json({
        values: { entryType: "teleport", moveInDate: "2026-02-30", arrivalDate: "9999-12-31", visaEndDate: "1999-01-01", hasAdmissionLetter: true, evil: "x", __proto__: { polluted: true } },
        done: [],
      }),
    );
    expect(r.outcome).toBe("repaired");
    expect(r.state.values).toEqual({ hasAdmissionLetter: true });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("done keeps real trackable steps once each and drops everything else", () => {
    const r = restore(json({ values: { entryType: "national_visa" }, done: ["landlord_confirmation", "landlord_confirmation", "no_such_step", 7, null, "tax_id", "anmeldung"] }));
    expect(r.outcome).toBe("repaired");
    expect(r.state.done).toEqual(["landlord_confirmation", "anmeldung"]); // tax_id is info-only, so it cannot be done
  });

  it("valid progress survives damage elsewhere in the same record", () => {
    const r = restore(json({ values: { entryType: "national_visa", moveInDate: "2026-11-11", visaEndDate: "9999-12-31" }, done: ["landlord_confirmation", "bogus"] }));
    expect(r.state.values).toEqual({ entryType: "national_visa", moveInDate: "2026-11-11" });
    expect(r.state.done).toEqual(["landlord_confirmation"]);
  });

  it("never throws, whatever is stored", () => {
    const nasty = [
      json({ values: { moveInDate: { toString: 1 } }, done: [[]] }),
      json({ values: Object.create(null), done: [] }),
      "\u0000",
      "{\"values\":{\"entryType\":\"national_visa\"},\"done\":[" + "1,".repeat(5000) + "1]}",
      json({ values: { entryType: "national_visa" }, done: Array.from({ length: 3000 }, (_, i) => `t${i}`) }),
    ];
    for (const raw of nasty) expect(() => restore(raw)).not.toThrow();
  });

  it("uses the same storage key as before, so existing users keep their progress", () => {
    expect(STORAGE_KEY).toBe("ankunft.final.v1");
  });
});

describe("saved state: progress", () => {
  it("the untouched initial state is not progress", () => {
    expect(hasProgress(defaultState())).toBe(false);
    expect(hasProgress({ values: {}, done: [] })).toBe(false);
    expect(hasProgress({ values: { entryType: "national_visa", moveInDate: "", hasAdmissionLetter: false }, done: [] })).toBe(false);
  });

  it("a date, a choice, a ticked box or a finished step is progress", () => {
    expect(hasProgress({ values: { entryType: "national_visa", moveInDate: "2026-11-11" }, done: [] })).toBe(true);
    expect(hasProgress({ values: { entryType: "visa_free" }, done: [] })).toBe(true);
    expect(hasProgress({ values: { entryType: "national_visa", hasAdmissionLetter: true }, done: [] })).toBe(true);
    expect(hasProgress({ values: { entryType: "national_visa" }, done: ["housing"] })).toBe(true);
  });
});
