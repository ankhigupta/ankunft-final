import { describe, expect, it } from "vitest";
import { berlinPack } from "../pack/load";
import { buildPlan, canMarkDone, DUE_SOON_DAYS, mandatoryTasks, needText, waitingOn, type InputValues, type Need } from "./engine";

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

describe("planner: blocked tasks and deadline urgency", () => {
  const byId = (p: ReturnType<typeof plan>, id: string) => status(p, id);

  it("a blocked task past its own legal deadline stays blocked and is not completable", () => {
    const p = plan({ moveInDate: "2026-10-25" }); // Anmeldung last day 2026-11-08, landlord confirmation not done
    const a = byId(p, "anmeldung");
    expect(a.deadline?.daysLeft).toBe(-6);
    expect(a.status).toBe("blocked");
    expect(canMarkDone(p, "anmeldung")).toBe(false);
    expect(p.next?.task.id).not.toBe("anmeldung");
    expect(p.alsoNow.map((x) => x.task.id)).not.toContain("anmeldung");
  });

  it("names the unmet prerequisite of a blocked task", () => {
    const a = byId(plan({ moveInDate: "2026-10-25" }), "anmeldung");
    expect(waitingOn(a)).toEqual([berlinPack.tasks.find((t) => t.id === "landlord_confirmation")!.title]);
  });

  it("an overdue deadline makes the prerequisite overdue and the next action", () => {
    const p = plan({ moveInDate: "2026-10-25" });
    const lc = byId(p, "landlord_confirmation");
    expect(lc.status).toBe("overdue");
    expect(lc.dueBy).toEqual({ date: "2026-11-08", daysLeft: -6, taskId: "anmeldung" });
    expect(p.next?.task.id).toBe("landlord_confirmation");
    expect(canMarkDone(p, "landlord_confirmation")).toBe(true);
  });

  it("treats due soon the same way: the prerequisite inherits it and the blocked task stays blocked", () => {
    const p = plan({ moveInDate: "2026-11-05" }); // 5 days left
    expect(byId(p, "anmeldung").status).toBe("blocked");
    expect(byId(p, "landlord_confirmation").status).toBe("due_soon");
    expect(p.next?.task.id).toBe("landlord_confirmation");
  });

  it("the last day itself passes urgency on as due soon, the day after as overdue", () => {
    expect(byId(plan({ moveInDate: "2026-10-31" }), "landlord_confirmation").status).toBe("due_soon");
    expect(byId(plan({ moveInDate: "2026-10-30" }), "landlord_confirmation").status).toBe("overdue");
  });

  it("a distant legal deadline is shown on the prerequisite but does not change its status", () => {
    const lc = byId(plan({ moveInDate: "2026-11-11" }), "landlord_confirmation");
    expect(lc.status).toBe("ready");
    expect(lc.dueBy?.date).toBe("2026-11-25");
    expect(lc.dueBy?.taskId).toBe("anmeldung");
  });

  it("once the prerequisite is done the task becomes doable, with the same overdue status", () => {
    const p = plan({ moveInDate: "2026-10-25" }, ["landlord_confirmation"]);
    const a = byId(p, "anmeldung");
    expect(a.status).toBe("overdue");
    expect(a.blockers).toEqual([]);
    expect(p.next?.task.id).toBe("anmeldung");
    expect(canMarkDone(p, "anmeldung")).toBe(true);
    expect(byId(p, "landlord_confirmation").dueBy).toBeNull();
  });

  it("urgency reaches the earliest unmet prerequisite through a chain", () => {
    const pack = JSON.parse(JSON.stringify(berlinPack)) as typeof berlinPack;
    pack.tasks.find((t) => t.id === "anmeldung")!.deadline.triggerInput = "arrivalDate";
    const p = buildPlan({ pack, values: { arrivalDate: "2026-10-20" }, done: [], todayISO: TODAY }); // last day 2026-11-03
    expect(status(p, "anmeldung").status).toBe("blocked");
    expect(status(p, "landlord_confirmation").status).toBe("blocked");
    expect(status(p, "housing").status).toBe("overdue");
    expect(status(p, "housing").dueBy?.taskId).toBe("anmeldung");
    expect(p.next?.task.id).toBe("housing");
  });

  it("urgency does not pass through a choice between alternatives", () => {
    const task = (id: string) => ({ task: id });
    expect(mandatoryTasks({ anyOf: [task("a"), task("b")] })).toEqual([]);
    expect(mandatoryTasks({ anyOf: [{ allOf: [task("a"), task("b")] }, { allOf: [task("a"), task("c")] }] })).toEqual(["a"]);
    expect(mandatoryTasks({ allOf: [task("a"), { anyOf: [task("b"), task("c")] }, { input: "x" }] })).toEqual(["a"]);
  });

  it("guidance dates are not legal deadlines, so they pass no urgency on", () => {
    const values = { moveInDate: "2026-11-01", visaEndDate: "2026-11-10", hasAdmissionLetter: true };
    const p = plan(values, ["landlord_confirmation", "anmeldung"]);
    expect(status(p, "lea_application").deadline?.hard).toBe(false);
    expect(status(p, "health_insurance").dueBy).toBeNull();
    expect(status(p, "livelihood").dueBy).toBeNull();
  });

  it("holds for every move-in date and progress: nothing with an unmet requirement is ever doable", () => {
    const dones = [[], ["landlord_confirmation"], ["landlord_confirmation", "anmeldung"]];
    for (let day = -5; day <= 40; day++) {
      const moveIn = new Date(Date.UTC(2026, 9, 20 + day)).toISOString().slice(0, 10);
      for (const done of dones) {
        const p = plan({ moveInDate: moveIn }, done);
        for (const t of p.tasks) {
          if (t.blockers.length > 0) {
            expect(t.status).toBe("blocked");
            expect(canMarkDone(p, t.task.id)).toBe(false);
          }
          if (t.status === "overdue" || t.status === "due_soon") expect(t.blockers).toEqual([]);
        }
        for (const t of [p.next, ...p.alsoNow]) if (t) expect(t.blockers).toEqual([]);
      }
    }
  });

  it("canMarkDone rejects info-only, finished and unknown tasks", () => {
    const p = plan({ moveInDate: "2026-11-11" }, ["landlord_confirmation"]);
    expect(canMarkDone(p, "tax_id")).toBe(false);
    expect(canMarkDone(p, "landlord_confirmation")).toBe(false);
    expect(canMarkDone(p, "no_such_task")).toBe(false);
    expect(canMarkDone(p, "health_insurance")).toBe(true);
  });
});

describe("planner: invalid and extreme dates never crash it", () => {
  const BAD = ["9999-12-31", "1999-12-31", "0001-01-01", "2101-01-01", "2026-02-30", "2026-13-45", "abc", "", "14/11/2026"];
  const empty = plan({ entryType: "national_visa" });
  const summary = (p: ReturnType<typeof plan>) => p.tasks.map((t) => [t.task.id, t.status, t.deadline?.date ?? null]);

  it.each(BAD)("a move-in date of %j is ignored, exactly as if it were empty", (bad) => {
    const p = plan({ entryType: "national_visa", moveInDate: bad });
    expect(summary(p)).toEqual(summary(empty));
    expect(status(p, "anmeldung").deadline).toBeNull();
    expect(p.next?.task.id).toBe(empty.next?.task.id);
  });

  it.each(BAD)("an arrival or visa end date of %j does not throw and gives no deadline", (bad) => {
    const p = plan({ entryType: "national_visa", arrivalDate: bad, visaEndDate: bad, hasAdmissionLetter: true });
    expect(status(p, "lea_application").deadline).toBeNull();
  });

  it("values that are not strings are ignored too", () => {
    const wrong = { entryType: "national_visa", moveInDate: 20261114, visaEndDate: true, arrivalDate: {} } as unknown as InputValues;
    expect(() => plan(wrong)).not.toThrow();
    expect(status(plan(wrong), "anmeldung").deadline).toBeNull();
  });

  it("an out-of-range move-in date does not complete housing", () => {
    expect(status(plan({ entryType: "national_visa", moveInDate: "1999-01-01" }), "housing").status).not.toBe("done");
  });

  it("the edges of the range still work", () => {
    expect(status(plan({ entryType: "national_visa", moveInDate: "2000-01-01" }), "anmeldung").deadline?.date).toBe("2000-01-15");
    expect(status(plan({ entryType: "national_visa", moveInDate: "2100-12-31" }), "anmeldung").deadline?.date).toBe("2101-01-14");
  });

  it("an invalid 'today' falls back to the real date instead of throwing", () => {
    for (const today of ["9999-12-31", "nope", "", "2026-02-30"]) {
      expect(() => plan({ entryType: "national_visa", moveInDate: "2026-11-11" }, [], today)).not.toThrow();
    }
  });

  it("damaged input shapes degrade to an empty plan", () => {
    const damaged = { pack: berlinPack, values: "x", done: 5, todayISO: TODAY } as unknown as Parameters<typeof buildPlan>[0];
    expect(() => buildPlan(damaged)).not.toThrow();
    expect(buildPlan(damaged).next?.task.id).toBe("housing");
    const nulls = { pack: berlinPack, values: null, done: null, todayISO: TODAY } as unknown as Parameters<typeof buildPlan>[0];
    expect(buildPlan(nulls).next?.task.id).toBe("housing");
  });

  it("valid dates beside an invalid one are still used", () => {
    const p = plan({ entryType: "national_visa", moveInDate: "2026-11-11", visaEndDate: "9999-12-31" });
    expect(status(p, "anmeldung").deadline?.date).toBe("2026-11-25");
  });
});

const TRACKED = berlinPack.tasks.filter((t) => t.mode === "tracked").map((t) => t.id);
const title = (id: string) => berlinPack.tasks.find((t) => t.id === id)!.title;

describe("planner: all steps done (B5)", () => {
  it("is complete when every tracked step is done, with no next step and nothing left to start", () => {
    const p = plan({ entryType: "national_visa", moveInDate: "2026-11-01", hasAdmissionLetter: true }, TRACKED);
    expect(p.complete).toBe(true);
    expect(p.next).toBeNull();
    expect(p.alsoNow).toEqual([]);
    expect(p.tasks.filter((t) => t.task.mode === "tracked").every((t) => t.status === "done")).toBe(true);
    expect(p.tasks.filter((t) => t.task.mode === "info_only").every((t) => t.status === "info_only")).toBe(true);
  });

  it("is not complete while any tracked step is open, and then names it as next", () => {
    const p = plan({ entryType: "national_visa", moveInDate: "2026-11-01", hasAdmissionLetter: true }, TRACKED.filter((id) => id !== "rundfunkbeitrag"));
    expect(p.complete).toBe(false);
    expect(p.next?.task.id).toBe("rundfunkbeitrag");
  });

  it("marking every step is not enough when the facts behind them are missing", () => {
    const p = plan({ entryType: "national_visa" }, TRACKED); // no move-in date, so housing and everything after it cannot be done
    expect(p.complete).toBe(false);
  });

  it("an empty or unsupported plan is not complete", () => {
    expect(plan({}).complete).toBe(false);
    expect(plan({ entryType: "visa_free" }).complete).toBe(false);
    expect(plan({ entryType: "unsure" }).complete).toBe(false);
  });
});

describe("planner: unsupported entry types (B6)", () => {
  it("records which entry was not covered, so the screen can explain the right thing", () => {
    expect(plan({ entryType: "unsure" })).toMatchObject({ supported: false, unsupportedValue: "unsure", tasks: [], next: null });
    expect(plan({ entryType: "visa_free" })).toMatchObject({ supported: false, unsupportedValue: "visa_free" });
    expect(plan({ entryType: "national_visa" })).toMatchObject({ supported: true, unsupportedValue: null });
  });
});

describe("planner: alternatives are shown as alternatives (B7)", () => {
  const withOpenLea = () => plan({ entryType: "national_visa", moveInDate: "2026-11-11" }, ["health_insurance", "livelihood"]);
  const blocker = (p: ReturnType<typeof plan>, task: string, req: string) => status(p, task).blockers.find((b) => b.requirementId === req);

  it("keeps an any-of requirement as one group of alternatives", () => {
    const b = blocker(withOpenLea(), "lea_application", "la-residence")!;
    expect(b.need.type).toBe("any");
    if (b.need.type !== "any") return;
    expect(b.need.of.map((n) => (n.type === "item" ? n.item.id : "?")).sort()).toEqual(["anmeldung", "landlord_confirmation"]);
  });

  it("says that either alternative is enough", () => {
    const b = blocker(withOpenLea(), "lea_application", "la-residence")!;
    expect(needText(b.need)).toBe(`either ${title("anmeldung")} or ${title("landlord_confirmation")} (one is enough)`);
  });

  it("mixes a task and an input as alternatives", () => {
    const b = blocker(withOpenLea(), "lea_application", "la-study-place")!;
    expect(needText(b.need)).toMatch(/^either .+ or I have an admission or conditional admission letter \(one is enough\)$/);
  });

  it("one alternative is enough: meeting either clears the requirement", () => {
    expect(blocker(plan({ entryType: "national_visa", moveInDate: "2026-11-11" }, ["health_insurance", "livelihood", "landlord_confirmation"]), "lea_application", "la-residence")).toBeUndefined();
    expect(blocker(plan({ entryType: "national_visa", moveInDate: "2026-11-11" }, ["health_insurance", "livelihood", "landlord_confirmation", "anmeldung"]), "lea_application", "la-residence")).toBeUndefined();
    expect(blocker(plan({ entryType: "national_visa", hasAdmissionLetter: true }), "lea_application", "la-study-place")).toBeUndefined();
  });

  it("required parts are joined with 'and', never shown as alternatives", () => {
    const b = blocker(plan({ entryType: "national_visa" }), "anmeldung", "an-1")!;
    expect(b.need.type).toBe("all");
    expect(needText(b.need)).toBe(`${title("housing")} and ${title("landlord_confirmation")}`);
    expect(needText(b.need)).not.toMatch(/either|one is enough/);
  });

  it("describes nested groups unambiguously", () => {
    const item = (label: string): Need => ({ type: "item", item: { kind: "task", id: label, label } });
    expect(needText({ type: "all", of: [item("A"), { type: "any", of: [item("B"), item("C")] }] })).toBe("A and either B or C");
    expect(needText({ type: "any", of: [{ type: "all", of: [item("A"), item("B")] }, item("C")] })).toBe("either (A and B) or C (one is enough)");
    expect(needText(item("A"))).toBe("A");
  });

  it("'waiting on' text keeps alternatives together instead of listing each as required", () => {
    const w = waitingOn(status(withOpenLea(), "lea_application"));
    expect(w).toContain(`either ${title("anmeldung")} or ${title("landlord_confirmation")} (one is enough)`);
    expect(w).not.toContain(title("anmeldung"));
  });

  it("still lists every unmet leaf in the flat list", () => {
    const b = blocker(withOpenLea(), "lea_application", "la-residence")!;
    expect(b.missing.map((m) => m.id).sort()).toEqual(["anmeldung", "landlord_confirmation"]);
  });
});

describe("planner: a task is done only if what it needs is done (B9)", () => {
  it("ignores a done mark whose prerequisites are missing, in the logic itself", () => {
    const p = plan({ entryType: "national_visa" }, ["landlord_confirmation", "anmeldung"]); // no move-in date: housing is not done
    for (const id of ["landlord_confirmation", "anmeldung"]) {
      expect(status(p, id).status).toBe("blocked");
      expect(status(p, id).doneMarkIgnored).toBe(true);
      expect(canMarkDone(p, id)).toBe(false);
    }
    expect(p.complete).toBe(false);
  });

  it("keeps valid completion states", () => {
    const p = plan({ entryType: "national_visa", moveInDate: "2026-11-11" }, ["landlord_confirmation", "anmeldung", "health_insurance"]);
    for (const id of ["housing", "landlord_confirmation", "anmeldung", "health_insurance"]) {
      expect(status(p, id).status).toBe("done");
      expect(status(p, id).doneMarkIgnored).toBe(false);
    }
  });

  it("clearing a prerequisite fact withdraws the steps built on it, and restoring it brings them back", () => {
    const done = ["landlord_confirmation", "anmeldung"];
    expect(status(plan({ entryType: "national_visa", moveInDate: "2026-11-11" }, done), "anmeldung").status).toBe("done");
    expect(status(plan({ entryType: "national_visa", moveInDate: "" }, done), "anmeldung").status).toBe("blocked");
    expect(status(plan({ entryType: "national_visa", moveInDate: "2026-11-11" }, done), "anmeldung").status).toBe("done");
  });

  it("a step in the middle of a chain needs the step before it", () => {
    const values = { entryType: "national_visa", moveInDate: "2026-11-11" };
    expect(status(plan(values, ["anmeldung"]), "anmeldung").status).toBe("blocked");
    expect(status(plan(values, ["anmeldung"]), "anmeldung").doneMarkIgnored).toBe(true);
    expect(status(plan(values, ["anmeldung", "landlord_confirmation"]), "anmeldung").status).toBe("done");
  });

  it("a later step marked done early does not count until its alternatives or requirements are met", () => {
    const values = { entryType: "national_visa", moveInDate: "2026-11-11" };
    expect(status(plan(values, ["lea_application"]), "lea_application").status).toBe("blocked");
    expect(status(plan(values, ["lea_appointment"]), "lea_appointment").status).toBe("blocked");
    expect(status(plan({ ...values, hasAdmissionLetter: true }, ["landlord_confirmation", "health_insurance", "livelihood", "lea_application"]), "lea_application").status).toBe("done");
  });

  it("a withdrawn mark no longer unlocks or counts as done for what depends on it", () => {
    const p = plan({ entryType: "national_visa" }, ["landlord_confirmation"]); // landlord mark is stale
    expect(status(p, "landlord_confirmation").status).toBe("blocked");
    expect(status(p, "anmeldung").status).toBe("blocked");
  });

  it("never reports a task as done while a requirement is unmet, for any marks and any move-in situation", () => {
    const moveIns = [undefined, "2026-10-01", "2026-11-14", "2026-12-25"];
    for (const moveInDate of moveIns) {
      for (let mask = 0; mask < 1 << TRACKED.length; mask++) {
        const done = TRACKED.filter((_, i) => mask & (1 << i));
        const p = plan({ entryType: "national_visa", ...(moveInDate ? { moveInDate } : {}), hasAdmissionLetter: mask % 2 === 0 }, done);
        for (const t of p.tasks) {
          if (t.status !== "done") continue;
          expect(t.blockers, `${t.task.id} done with blockers (mask ${mask}, move-in ${moveInDate})`).toEqual([]);
          for (const r of t.task.requirements)
            for (const dep of mandatoryTasks(r.expr)) expect(status(p, dep).status, `${t.task.id} needs ${dep}`).toBe("done");
        }
      }
    }
  });
});

describe("planner: a move-in date that has not arrived yet (B10)", () => {
  const future = { entryType: "national_visa", moveInDate: "2026-11-20" }; // today is 2026-11-14
  const missingOf = (p: ReturnType<typeof plan>, task: string) => status(p, task).blockers.flatMap((b) => b.missing);

  it("does not report the entered date as missing: it says the date is still in the future", () => {
    const m = missingOf(plan(future), "landlord_confirmation").find((x) => x.id === "moveInDate")!;
    expect(m.notYet).toBe("2026-11-20");
    const text = status(plan(future), "landlord_confirmation").blockers.map((b) => needText(b.need)).join(" ");
    expect(text).toContain("Move-in date: 20 Nov 2026 is still in the future");
    expect(text).not.toMatch(/Move-in date(?!:)/);
  });

  it("still calls a date nobody entered missing", () => {
    const m = missingOf(plan({ entryType: "national_visa" }), "landlord_confirmation").find((x) => x.id === "moveInDate")!;
    expect(m.notYet).toBeUndefined();
    expect(m.label).toBe("Move-in date");
  });

  it("keeps the steps that need a move-in on hold, and computes the deadline from the entered date", () => {
    const p = plan(future);
    expect(status(p, "housing").status).not.toBe("done");
    expect(status(p, "rundfunkbeitrag").status).toBe("blocked");
    expect(missingOf(p, "rundfunkbeitrag")[0].notYet).toBe("2026-11-20");
    expect(status(p, "anmeldung").deadline).toMatchObject({ date: "2026-12-04", daysLeft: 20, hard: true });
  });

  it("follows the actual date: once it arrives the steps open up and nothing is marked 'not yet'", () => {
    const p = plan(future, [], "2026-11-25");
    expect(status(p, "housing").status).toBe("done");
    expect(status(p, "landlord_confirmation").status).toBe("ready");
    expect(status(p, "anmeldung").deadline?.daysLeft).toBe(9);
    expect(p.tasks.flatMap((t) => t.blockers.flatMap((b) => b.missing)).some((m) => m.notYet)).toBe(false);
  });
});
