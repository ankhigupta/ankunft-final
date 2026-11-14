import { describe, expect, it } from "vitest";
import { berlinPack } from "../pack/load";
import { buildPlan, DUE_SOON_DAYS, type InputValues } from "./engine";

const TODAY = "2026-11-14";
const plan = (values: InputValues, done: string[] = [], today = TODAY) =>
  buildPlan({ pack: berlinPack, values, done, todayISO: today });
const status = (p: ReturnType<typeof plan>, id: string) => p.tasks.find((t) => t.task.id === id)!;

describe("planner: dependencies", () => {
  it("starts with housing and keeps dependent steps blocked", () => {
    const p = plan({});
    expect(p.next?.task.id).toBe("housing");
    expect(status(p, "landlord_confirmation").status).toBe("blocked");
    expect(status(p, "anmeldung").status).toBe("blocked");
    expect(status(p, "lea_appointment").status).toBe("blocked");
  });

  it("explains what is missing, naming tasks and inputs", () => {
    const b = status(plan({}), "landlord_confirmation").blockers;
    const ids = b.flatMap((x) => x.missing.map((m) => m.id));
    expect(ids).toContain("housing");
    expect(ids).toContain("moveInDate");
  });

  it("completes housing from a reached move-in date", () => {
    const p = plan({ moveInDate: "2026-11-11" });
    expect(status(p, "housing").status).toBe("done");
    expect(status(p, "landlord_confirmation").status).toBe("ready");
  });

  it("a future move-in date does not complete housing", () => {
    const p = plan({ moveInDate: "2026-12-01" });
    expect(status(p, "housing").status).not.toBe("done");
  });

  it("unlocks anmeldung only after the landlord confirmation is marked done", () => {
    const values = { moveInDate: "2026-11-11" };
    expect(status(plan(values), "anmeldung").status).toBe("blocked");
    expect(status(plan(values, ["landlord_confirmation"]), "anmeldung").status).toBe("ready");
  });

  it("lists what a task unlocks", () => {
    expect(status(plan({}), "housing").unlocks).toContain("landlord_confirmation");
  });

  it("info-only tasks are never tracked, blocked or done", () => {
    const p = plan({}, ["tax_id"]);
    expect(status(p, "tax_id").status).toBe("info_only");
    expect(status(p, "tax_id").blockers).toEqual([]);
  });

  it("the residence permit application stays blocked until every prerequisite is done", () => {
    const values = { moveInDate: "2026-11-11", hasAdmissionLetter: true, visaEndDate: "2027-01-10" };
    const done = ["landlord_confirmation", "anmeldung", "health_insurance", "enrollment", "livelihood"];
    expect(status(plan(values, done.slice(0, 4)), "lea_application").status).toBe("blocked");
    expect(["ready", "due_soon"]).toContain(status(plan(values, done), "lea_application").status);
  });
});

describe("planner: deadlines", () => {
  const base = { moveInDate: "2026-11-11" };
  const done = ["landlord_confirmation"];

  it("computes the Anmeldung deadline as move-in + 14 days", () => {
    const t = status(plan(base, done), "anmeldung");
    expect(t.deadline?.date).toBe("2026-11-25");
    expect(t.deadline?.hard).toBe(true);
    expect(t.deadline?.daysLeft).toBe(11);
  });

  it("is ready with more than a week left and due soon inside the window", () => {
    expect(status(plan(base, done), "anmeldung").status).toBe("ready");
    const soon = plan({ moveInDate: "2026-11-05" }, done);
    expect(status(soon, "anmeldung").deadline?.daysLeft).toBe(5);
    expect(status(soon, "anmeldung").status).toBe("due_soon");
    expect(DUE_SOON_DAYS).toBe(7);
  });

  it("the last day itself is not overdue; the next day is", () => {
    expect(status(plan({ moveInDate: "2026-10-31" }, done), "anmeldung").status).toBe("due_soon");
    expect(status(plan({ moveInDate: "2026-10-30" }, done), "anmeldung").status).toBe("overdue");
  });

  it("an overdue statutory task becomes the next action", () => {
    const p = plan({ moveInDate: "2026-10-20" }, done);
    expect(status(p, "anmeldung").status).toBe("overdue");
    expect(p.next?.task.id).toBe("anmeldung");
  });

  it("a university-stated date is guidance and never marks a task overdue", () => {
    const values = { moveInDate: "2026-11-01", visaEndDate: "2026-11-10", hasAdmissionLetter: true };
    const all = ["landlord_confirmation", "anmeldung", "health_insurance", "enrollment", "livelihood"];
    const t = status(plan(values, all), "lea_application");
    expect(t.deadline?.date).toBe("2026-11-10");
    expect(t.deadline?.hard).toBe(false);
    expect(t.status).not.toBe("overdue");
  });

  it("never invents a date when the pack has none", () => {
    const p = plan({ moveInDate: "2026-11-11", arrivalDate: "2026-11-01" }, done);
    for (const id of ["housing", "health_insurance", "enrollment", "livelihood", "rundfunkbeitrag", "bank_account"])
      expect(status(p, id).deadline).toBeNull();
  });

  it("gives no computed deadline without a move-in date", () => {
    expect(status(plan({}), "anmeldung").deadline).toBeNull();
  });
});

describe("planner: scope and ordering", () => {
  it("refuses unsupported entry types instead of planning", () => {
    const p = plan({ entryType: "visa_free" });
    expect(p.supported).toBe(false);
    expect(p.unsupportedMessage).toMatch(/not covered/i);
    expect(p.tasks).toEqual([]);
    expect(p.next).toBeNull();
  });

  it("supports a national visa", () => {
    expect(plan({ entryType: "national_visa" }).supported).toBe(true);
  });

  it("is deterministic", () => {
    const a = plan({ moveInDate: "2026-11-11" }, ["landlord_confirmation"]);
    const b = plan({ moveInDate: "2026-11-11" }, ["landlord_confirmation"]);
    expect(a).toEqual(b);
  });

  it("puts overdue before due soon before ready", () => {
    const p = plan({ moveInDate: "2026-10-20" }, ["landlord_confirmation"]);
    const order = [p.next, ...p.alsoNow].map((x) => x!.status);
    const rank = { overdue: 0, due_soon: 1, ready: 2 } as const;
    const ranks = order.map((s) => rank[s as keyof typeof rank]);
    expect([...ranks].sort()).toEqual(ranks);
  });
});
