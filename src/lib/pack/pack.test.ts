import { describe, expect, it } from "vitest";
import raw from "@/data/berlin-student.pack.json";
import { loadPack } from "./load";
import { validatePack, isPackStale } from "./validate";
import { PackSchema } from "./schema";

const clone = () => JSON.parse(JSON.stringify(raw));

describe("pack", () => {
  it("loads the Berlin pack without errors", () => {
    const pack = loadPack();
    expect(pack.tasks).toHaveLength(12);
    expect(validatePack(pack).filter((i) => i.level === "error")).toEqual([]);
  });

  it("rejects an unknown task reference", () => {
    const bad = clone();
    bad.tasks[2].requirements[0].expr = { task: "does_not_exist" };
    expect(() => loadPack(bad)).toThrow(/unknown task/);
  });

  it("rejects a requirement that claims authority without a source", () => {
    const bad = clone();
    bad.tasks[2].requirements[0].sourceIds = [];
    expect(() => loadPack(bad)).toThrow(/needs at least one source/);
  });

  it("rejects a dependency cycle", () => {
    const bad = clone();
    const housing = bad.tasks.find((t: { id: string }) => t.id === "housing");
    housing.requirements = [
      { id: "h-1", label: "cycle", expr: { task: "anmeldung" }, basis: "inferred", sourceIds: [] },
    ];
    expect(() => loadPack(bad)).toThrow(/cycle/);
  });

  it("rejects a deadline with no source", () => {
    const bad = clone();
    const t = bad.tasks.find((x: { id: string }) => x.id === "anmeldung");
    t.deadline.sourceIds = [];
    expect(() => loadPack(bad)).toThrow(/needs a source/);
  });

  it("rejects an invented date rule on a none_found deadline", () => {
    const bad = clone();
    const t = bad.tasks.find((x: { id: string }) => x.id === "housing");
    t.deadline.offsetDays = 5;
    t.deadline.triggerInput = "moveInDate";
    expect(() => loadPack(bad)).toThrow(/none_found/);
  });

  it("schema rejects malformed dates", () => {
    const bad = clone();
    bad.verifiedOn = "23/10/2026";
    expect(PackSchema.safeParse(bad).success).toBe(false);
  });

  it("flags a stale pack after the configured number of days", () => {
    const pack = loadPack();
    expect(isPackStale(pack, "2026-11-14")).toBe(false);
    expect(isPackStale(pack, "2027-02-01")).toBe(true);
  });
});
