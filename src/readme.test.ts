import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import main from "@/data/qa-gold.json";
import second from "@/data/qa-gold-heldout.json";
import unseen from "../eval/qa-unseen.json";
import holdout from "../eval/qa-holdout.json";
import batch4 from "../eval/qa-batch4.json";
import conversational from "../eval/qa-conversational.json";
import { runConversational, runEval, runUnseen, type ConversationalCase, type GoldCase, type UnseenCase } from "./lib/qa/eval";

/**
 * The README's evaluation tables are quoted numbers. They went stale once, so this test recomputes them and
 * fails when the README disagrees, in either direction.
 */
const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const TODAY = "2026-11-14";
const EXPOSED = new Set(["h06", "h08", "h12", "h15", "h19", "h20", "h23", "h32"]);
const row = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;

describe("README evaluation tables match the evaluation", () => {
  it("existing gold sets", () => {
    for (const [label, set] of [
      ["Main (38 answerable, 10 abstain, 6 refuse)", main],
      ["Second (12 answerable, 5 abstain, 3 refuse)", second],
    ] as const) {
      const s = runEval(set.cases as GoldCase[], TODAY);
      const a = s.answerable;
      expect(README, label).toContain(row([label, `${a.hit}/${a.n}`, `${a.top1}/${a.n}`, `${s.abstain.correct}/${s.abstain.n}`, `${s.refuse.correct}/${s.refuse.n}`]));
    }
  });

  it("tuned regression sets", () => {
    for (const [file, set] of [["qa-unseen.json", unseen], ["qa-batch4.json", batch4]] as const) {
      const cases = set.cases as UnseenCase[];
      const s = runUnseen(cases, TODAY);
      expect(README, file).toContain(
        row([`\`${file}\``, cases.length, `${s.answer.correct}/${s.answer.n}`, `${s.answer.top1}/${s.answer.n}`, `${s.abstain.correct}/${s.abstain.n}`, `${s.refuse.correct}/${s.refuse.n}`, s.relevance.leaks]),
      );
    }
    const c = runConversational(conversational.cases as ConversationalCase[], TODAY);
    const by = (k: string) => `${c.byExpect[k].correct}/${c.byExpect[k].n}`;
    expect(README).toContain(`${c.correct}/${c.total} correct outcome (guidance ${by("guidance")}, answer ${by("answer")}, abstain ${by("abstain")}, refuse ${by("refuse")})`);
  });

  it("holdout, split into exposed and not exposed", () => {
    const all = holdout.cases as UnseenCase[];
    for (const [label, cases] of [
      ["All", all],
      ["Not exposed", all.filter((x) => !EXPOSED.has(x.id))],
      ["Exposed", all.filter((x) => EXPOSED.has(x.id))],
    ] as const) {
      const s = runUnseen(cases, TODAY);
      expect(README, label).toContain(row([label, cases.length, `${s.answer.correct}/${s.answer.n}`, `${s.answer.top1}/${s.answer.n}`, `${s.abstain.correct}/${s.abstain.n}`, `${s.refuse.correct}/${s.refuse.n}`]));
    }
  });

  it("the holdout notes and the README agree on which cases are exposed", () => {
    const noted = (holdout.cases as (UnseenCase & { note?: string })[]).filter((c) => c.note && /no longer blind|Exposed in batch 4|Exposed in batch 3|exposed/i.test(c.note)).map((c) => c.id);
    for (const id of EXPOSED) expect(noted, id).toContain(id);
  });

  it("says plainly that no result is independent, and does not present tuned results as generalisation", () => {
    expect(README).toMatch(/None of them is independent evidence/);
    expect(README).toMatch(/Genuinely blind results/);
    expect(README).toMatch(/no evaluation by anyone other than the builder/);
  });
});
