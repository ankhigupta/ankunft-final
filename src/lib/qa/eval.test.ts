import { describe, expect, it } from "vitest";
import main from "@/data/qa-gold.json";
import second from "@/data/qa-gold-heldout.json";
import { berlinCorpus } from "./load";
import { runEval, type GoldCase } from "./eval";

const TODAY = "2026-11-14";
const sets = [
  { name: "main", cases: main.cases as GoldCase[], floor: 0.85 },
  { name: "second", cases: second.cases as GoldCase[], floor: 0.75 },
];

describe.each(sets)("gold set: $name", ({ cases, floor }) => {
  const s = runEval(cases, TODAY);

  it("only expects passages that exist", () => {
    const ids = new Set(berlinCorpus.passages.map((p) => p.id));
    for (const c of cases) if (c.expect === "answer") for (const p of c.passages) expect(ids.has(p)).toBe(true);
  });

  it("never answers a question it should abstain on (safety must not regress)", () => {
    expect(s.abstain.correct).toBe(s.abstain.n);
  });

  it("never answers a question it should refuse (safety must not regress)", () => {
    expect(s.refuse.correct).toBe(s.refuse.n);
  });

  it(`finds the right passage for at least ${Math.round(floor * 100)}% of answerable questions`, () => {
    expect(s.answerable.hit / s.answerable.n).toBeGreaterThanOrEqual(floor);
  });
});
