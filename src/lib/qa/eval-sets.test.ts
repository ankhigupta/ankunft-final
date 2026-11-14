import { describe, expect, it } from "vitest";
import main from "@/data/qa-gold.json";
import second from "@/data/qa-gold-heldout.json";
import unseen from "../../../eval/qa-unseen.json";
import holdout from "../../../eval/qa-holdout.json";
import batch4 from "../../../eval/qa-batch4.json";
import conversational from "../../../eval/qa-conversational.json";
import { berlinCorpus } from "./load";
import { runConversational, runEval, runUnseen, type ConversationalCase, type GoldCase, type UnseenCase } from "./eval";

const TODAY = "2026-11-14";
const UNSEEN = unseen.cases as UnseenCase[];
const HOLDOUT = holdout.cases as UnseenCase[];
const BATCH4 = batch4.cases as UnseenCase[];
const CONVERSATIONAL = conversational.cases as ConversationalCase[];
const GOLD = [...(main.cases as GoldCase[]), ...(second.cases as GoldCase[])];
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

describe("the new sets are what they say they are", () => {
  it("are separate from the existing gold questions and from each other", () => {
    const gold = new Set(GOLD.map((c) => norm(c.q)));
    for (const c of [...UNSEEN, ...HOLDOUT, ...BATCH4]) expect(gold.has(norm(c.q)), `${c.id} repeats a gold question`).toBe(false);
    const u = new Set(UNSEEN.map((c) => norm(c.q)));
    for (const c of [...HOLDOUT, ...BATCH4]) expect(u.has(norm(c.q)), `${c.id} repeats an unseen question`).toBe(false);
    // Questions that were investigated directly (h08, h12, h19) are deliberately not copied into the batch-4 set:
    // it uses different wording for the same mechanisms.
    const h = new Set(HOLDOUT.map((c) => norm(c.q)));
    for (const c of BATCH4) expect(h.has(norm(c.q)), `${c.id} repeats a holdout question`).toBe(false);
    // The conversational set may repeat a question only to test it under a different amount of entries.
    const seen = new Set<string>();
    for (const c of CONVERSATIONAL) {
      const key = `${norm(c.q)}|${c.state}`;
      expect(seen.has(key), `${c.id} repeats a conversational question with the same entries`).toBe(false);
      seen.add(key);
      expect(gold.has(norm(c.q)), `${c.id} repeats a gold question`).toBe(false);
    }
    expect(new Set(BATCH4.map((c) => c.id)).size).toBe(BATCH4.length);
    expect(new Set(UNSEEN.map((c) => c.id)).size).toBe(UNSEEN.length);
    expect(new Set(HOLDOUT.map((c) => c.id)).size).toBe(HOLDOUT.length);
  });

  it("only name passages that exist, and give every answer case a passage list", () => {
    const ids = new Set(berlinCorpus.passages.map((p) => p.id));
    for (const c of [...UNSEEN, ...HOLDOUT, ...BATCH4]) {
      for (const p of [...(c.passages ?? []), ...(c.first ?? []), ...(c.mustNot ?? [])]) expect(ids.has(p), `${c.id}: ${p}`).toBe(true);
      if (c.expect === "answer") expect((c.passages ?? []).length, c.id).toBeGreaterThan(0);
      for (const f of c.first ?? []) expect(c.passages ?? [], `${c.id}: first must be an acceptable passage`).toContain(f);
    }
  });

  it("cover every kind of case: valid answers, wrong-topic, abstention, refusal, German, typos, location", () => {
    const tags = new Set(UNSEEN.flatMap((c) => c.tags));
    for (const t of ["valid", "wrong-topic", "refusal", "german", "typo", "location", "documents", "amount", "housing", "work"]) expect(tags.has(t), t).toBe(true);
    for (const k of ["answer", "abstain", "refuse"] as const) expect(UNSEEN.some((c) => c.expect === k), k).toBe(true);
  });

  it("the audit's failing examples are in the set", () => {
    const qs = UNSEEN.filter((c) => c.origin === "audit").map((c) => c.q);
    for (const q of ["Where can I find a flat in Berlin?", "What is the minimum amount in the blocked account for 2026?", "Where is the immigration office?", "Do I need an appointment for Anmeldung?"]) expect(qs).toContain(q);
  });
});

describe("unseen regression set", () => {
  const s = runUnseen(UNSEEN, TODAY);

  it("never answers a question it should abstain on", () => {
    expect(s.abstain.correct).toBe(s.abstain.n);
    expect(s.abstain.falseAnswer).toBe(0);
  });

  it("refuses every judgement question", () => {
    expect(s.refuse.correct).toBe(s.refuse.n);
  });

  it("shows no wrong-topic passage", () => {
    expect(s.relevance.leaks).toBe(0);
    expect(s.results.filter((r) => r.leaked.length).map((r) => r.id)).toEqual([]);
  });

  it("answers valid questions with a relevant passage, and does not abstain on them", () => {
    expect(s.answer.falseAbstain).toBe(0);
    expect(s.answer.falseRefuse).toBe(0);
    expect(s.answer.correct / s.answer.n).toBeGreaterThanOrEqual(0.95);
  });

  it("puts a relevant passage first and keeps shown passages relevant", () => {
    expect(s.answer.top1 / s.answer.n).toBeGreaterThanOrEqual(0.9);
    expect(s.relevance.meanPrecision).toBeGreaterThanOrEqual(0.8);
  });

  it("keeps the preserved behaviours: LEA address, P029 first for the appointment question", () => {
    const by = (id: string) => s.results.find((r) => r.id === id)!;
    expect(by("a20").returned).toEqual(["P020"]);
    expect(by("a25").returned[0]).toBe("P029");
    expect(by("a05").leaked).toEqual([]);
  });

  it("does well in every group, not only on average", () => {
    for (const [tag, v] of Object.entries(s.byTag)) expect(v.ok / v.n, tag).toBeGreaterThanOrEqual(0.9);
  });
});

describe("holdout (written before the fixes; eight items (h06 h08 h12 h15 h19 h20 h23 h32) are no longer blind, see their notes)", () => {
  const s = runUnseen(HOLDOUT, TODAY);

  it("never shows a wrong-topic passage it is told to avoid, and refuses its judgement questions it can", () => {
    expect(s.relevance.leaks).toBe(0);
    expect(s.answer.falseRefuse).toBe(0);
  });

  it("does not fall below the level reached when this batch was finished", () => {
    expect(s.answer.correct).toBeGreaterThanOrEqual(19);
    expect(s.abstain.correct).toBeGreaterThanOrEqual(12);
    expect(s.refuse.correct).toBeGreaterThanOrEqual(3);
  });
});

describe("batch-4 questions (written after diagnosing the mechanisms, before the fixes; not blind, see the file's note)", () => {
  const s = runUnseen(BATCH4, TODAY);

  it("never answers a question it should abstain on, never shows a wrong-topic passage, refuses what it should", () => {
    expect(s.abstain.correct).toBe(s.abstain.n);
    expect(s.relevance.leaks).toBe(0);
    expect(s.refuse.correct).toBe(s.refuse.n);
    expect(s.answer.falseRefuse).toBe(0);
  });

  it("does not fall below the level reached when this batch was finished", () => {
    expect(s.answer.correct).toBeGreaterThanOrEqual(13);
    expect(s.answer.top1).toBeGreaterThanOrEqual(12);
  });
});

describe("the existing gold sets must not get worse", () => {
  // The levels before batch 4: main 37/38 in the answer, 34 first; second 11/12 in the answer, 10 first.
  const a = runEval(main.cases as GoldCase[], TODAY);
  const b = runEval(second.cases as GoldCase[], TODAY);

  it("abstention and refusal stay at 100% on both", () => {
    expect(a.abstain.correct).toBe(a.abstain.n);
    expect(a.refuse.correct).toBe(a.refuse.n);
    expect(b.abstain.correct).toBe(b.abstain.n);
    expect(b.refuse.correct).toBe(b.refuse.n);
  });

  it("valid answers do not regress, in the answer or in first place", () => {
    expect(a.answerable.hit).toBeGreaterThanOrEqual(37);
    expect(a.answerable.top1).toBeGreaterThanOrEqual(34);
    expect(b.answerable.hit).toBeGreaterThanOrEqual(11);
    expect(b.answerable.top1).toBeGreaterThanOrEqual(10);
  });

  it("no answerable gold question that was answered before now abstains or is refused", () => {
    for (const r of [...a.results, ...b.results].filter((x) => x.expect === "answer")) expect(r.got, `${r.id}: ${r.q}`).toBe("answer");
  });
});


describe("conversational questions (written before the free-form pass, after diagnosing it; not blind)", () => {
  const s = runConversational(CONVERSATIONAL, TODAY);

  it("covers every kind of outcome, with and without the person's entries", () => {
    for (const k of ["answer", "guidance", "abstain", "refuse"] as const) expect(CONVERSATIONAL.some((c) => c.expect === k), k).toBe(true);
    for (const st of ["none", "arrived", "moved"] as const) expect(CONVERSATIONAL.some((c) => c.state === st), st).toBe(true);
    expect(CONVERSATIONAL.some((c) => c.clarify)).toBe(true);
  });

  it("gives every question the outcome it should have", () => {
    expect(s.results.filter((r) => !r.correct).map((r) => `${r.id}: ${r.q} -> ${r.got}`)).toEqual([]);
  });

  it("never answers or guides where it should abstain or refuse", () => {
    expect(s.byExpect.abstain.correct).toBe(s.byExpect.abstain.n);
    expect(s.byExpect.refuse.correct).toBe(s.byExpect.refuse.n);
  });
});
