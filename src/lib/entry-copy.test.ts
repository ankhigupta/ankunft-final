import { describe, expect, it } from "vitest";
import { berlinPack } from "./pack/load";
import { notCoveredNotice } from "./entry-copy";
import { buildPlan, type InputValues } from "./planner/engine";

const plan = (values: InputValues) => buildPlan({ pack: berlinPack, values, done: [], todayISO: "2026-11-14" });

describe("entry route not covered (B6)", () => {
  const unsure = notCoveredNotice(plan({ entryType: "unsure" }));

  it("'not sure' does not show the visa-free message", () => {
    expect(`${unsure.title} ${unsure.body}`).not.toMatch(/visa-free|without a visa/i);
    expect(unsure.title).not.toBe("Not covered yet.");
  });

  it("'not sure' explains that the planner supports German national study visas", () => {
    expect(unsure.body).toMatch(/German national study visa/);
    expect(unsure.body).toMatch(/currently plans only/);
  });

  it("tells the person where to find out, and what to pick if it applies", () => {
    expect(unsure.body).toMatch(/embassy/);
    expect(unsure.body).toMatch(/immigration office \(LEA\)/);
    expect(unsure.body).toMatch(/choose .*National study visa/i);
  });

  it("does not claim eligibility, entitlement or a legal conclusion", () => {
    expect(unsure.body).not.toMatch(/\b(eligible|entitled|qualif|allowed|illegal|unlawful|you (must|need to)|you will)\b/i);
    expect(unsure.body).toMatch(/cannot tell/);
  });

  it("visa-free entry keeps the pack's own text, which was written for it", () => {
    const n = notCoveredNotice(plan({ entryType: "visa_free" }));
    expect(n.title).toBe("Not covered yet.");
    expect(n.body).toBe(berlinPack.supportedWhen[0].unsupportedMessage);
    expect(n.body).toMatch(/Visa-free entry/);
  });

  it("the research pack itself was not changed for this", () => {
    expect(berlinPack.supportedWhen[0].unsupportedMessage).toMatch(/Visa-free entry follows different rules/);
  });
});
