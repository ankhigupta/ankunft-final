import { berlinQA } from "./load";
import type { QAResponse } from "./answer";
import type { Situation } from "./guidance";

export type GoldCase =
  | { id: string; q: string; expect: "answer"; passages: string[]; note?: string }
  | { id: string; q: string; expect: "abstain" | "refuse"; note?: string };

export type CaseResult = {
  id: string;
  q: string;
  expect: GoldCase["expect"];
  got: QAResponse["kind"];
  returned: string[];
  /** For answerable cases: any expected passage within the returned set? */
  hit: boolean;
  /** First returned passage is an expected one. */
  top1: boolean;
};

export type EvalSummary = {
  total: number;
  answerable: { n: number; hit: number; top1: number };
  abstain: { n: number; correct: number };
  refuse: { n: number; correct: number };
  results: CaseResult[];
};

export function runEval(cases: GoldCase[], todayISO: string): EvalSummary {
  const results: CaseResult[] = cases.map((c) => {
    const r = berlinQA(c.q, todayISO);
    const returned = r.kind === "answer" ? r.passages.map((p) => p.citation.passageId) : [];
    const want = c.expect === "answer" ? c.passages : [];
    return {
      id: c.id,
      q: c.q,
      expect: c.expect,
      got: r.kind,
      returned,
      hit: returned.some((id) => want.includes(id)),
      top1: returned.length > 0 && want.includes(returned[0]),
    };
  });
  const pick = (k: GoldCase["expect"]) => results.filter((r) => r.expect === k);
  const ans = pick("answer");
  return {
    total: results.length,
    answerable: { n: ans.length, hit: ans.filter((r) => r.hit && r.got === "answer").length, top1: ans.filter((r) => r.top1).length },
    abstain: { n: pick("abstain").length, correct: pick("abstain").filter((r) => r.got === "abstain").length },
    refuse: { n: pick("refuse").length, correct: pick("refuse").filter((r) => r.got === "refuse").length },
    results,
  };
}

const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${Math.round((100 * a) / b)}%`);

export function formatReport(title: string, s: EvalSummary): string {
  const lines = [
    `${title}`,
    `  answerable  in answer ${s.answerable.hit}/${s.answerable.n} (${pct(s.answerable.hit, s.answerable.n)})   first ${s.answerable.top1}/${s.answerable.n} (${pct(s.answerable.top1, s.answerable.n)})`,
    `  abstain     correct   ${s.abstain.correct}/${s.abstain.n}`,
    `  refuse      correct   ${s.refuse.correct}/${s.refuse.n}`,
  ];
  const misses = s.results.filter((r) =>
    r.expect === "answer" ? !(r.hit && r.got === "answer") : r.got !== r.expect,
  );
  for (const m of misses) lines.push(`  MISS ${m.id} [want ${m.expect}, got ${m.got}] ${m.q}  -> ${m.returned.join(",") || "-"}`);
  const notFirst = s.results.filter((r) => r.expect === "answer" && r.hit && !r.top1);
  if (notFirst.length) lines.push(`  not first: ${notFirst.map((r) => r.id).join(", ")}`);
  return lines.join("\n");
}

/**
 * The unseen regression set (eval/qa-unseen.json). It measures what the original gold sets lump together:
 * whether the answer is right, whether the passages shown are relevant, whether wrong-topic passages leak,
 * and whether the system abstains and refuses when it should.
 */
export type UnseenCase = {
  id: string;
  q: string;
  expect: "answer" | "abstain" | "refuse";
  /** Passages that legitimately answer the question. */
  passages?: string[];
  /** If given, the first passage returned must be one of these. */
  first?: string[];
  /** Passages that must not be shown at all: the wrong-topic matches a keyword search would give. */
  mustNot?: string[];
  tags: string[];
  origin: "audit" | "fresh";
  note?: string;
};

export type UnseenCaseResult = {
  id: string;
  q: string;
  expect: UnseenCase["expect"];
  got: QAResponse["kind"];
  returned: string[];
  /** Answer cases: answered, and at least one legitimate passage is shown. */
  correct: boolean;
  /** Answer cases: the first passage shown is acceptable (a `first` list wins over the passage list). */
  top1: boolean;
  /** Answer cases that were answered: share of shown passages that are legitimate. */
  precision: number | null;
  /** Wrong-topic passages that were shown. */
  leaked: string[];
  tags: string[];
};

export type UnseenSummary = {
  total: number;
  answer: { n: number; correct: number; top1: number; falseAbstain: number; falseRefuse: number };
  relevance: { answered: number; meanPrecision: number; leaks: number };
  abstain: { n: number; correct: number; falseAnswer: number };
  refuse: { n: number; correct: number };
  byTag: Record<string, { n: number; ok: number }>;
  results: UnseenCaseResult[];
};

export function runUnseen(cases: UnseenCase[], todayISO: string): UnseenSummary {
  const results: UnseenCaseResult[] = cases.map((c) => {
    const r = berlinQA(c.q, todayISO);
    const returned = r.kind === "answer" ? r.passages.map((p) => p.citation.passageId) : [];
    const want = c.passages ?? [];
    const hit = c.expect === "answer" && returned.some((id) => want.includes(id));
    const firstOk = (c.first ?? want).length === 0 ? true : returned.length > 0 && (c.first ?? want).includes(returned[0]);
    return {
      id: c.id,
      q: c.q,
      expect: c.expect,
      got: r.kind,
      returned,
      correct: c.expect === "answer" && r.kind === "answer" && hit,
      top1: c.expect === "answer" && r.kind === "answer" && firstOk,
      precision: c.expect === "answer" && r.kind === "answer" && returned.length ? returned.filter((id) => want.includes(id)).length / returned.length : null,
      leaked: returned.filter((id) => (c.mustNot ?? []).includes(id)),
      tags: c.tags,
    };
  });
  const of = (k: UnseenCase["expect"]) => results.filter((r) => r.expect === k);
  const answers = of("answer");
  const answered = answers.filter((r) => r.precision !== null);
  const byTag: UnseenSummary["byTag"] = {};
  for (const r of results) {
    const ok = r.expect === "answer" ? r.correct : r.got === r.expect;
    for (const t of r.tags) {
      byTag[t] ??= { n: 0, ok: 0 };
      byTag[t].n++;
      if (ok) byTag[t].ok++;
    }
  }
  return {
    total: results.length,
    answer: {
      n: answers.length,
      correct: answers.filter((r) => r.correct).length,
      top1: answers.filter((r) => r.top1).length,
      falseAbstain: answers.filter((r) => r.got === "abstain").length,
      falseRefuse: answers.filter((r) => r.got === "refuse").length,
    },
    relevance: {
      answered: answered.length,
      meanPrecision: answered.length ? answered.reduce((a, r) => a + (r.precision ?? 0), 0) / answered.length : 0,
      leaks: results.filter((r) => r.leaked.length > 0).length,
    },
    abstain: { n: of("abstain").length, correct: of("abstain").filter((r) => r.got === "abstain").length, falseAnswer: of("abstain").filter((r) => r.got === "answer").length },
    refuse: { n: of("refuse").length, correct: of("refuse").filter((r) => r.got === "refuse").length },
    byTag,
    results,
  };
}

export function formatUnseen(title: string, s: UnseenSummary): string {
  const lines = [
    title,
    `  answer correctness   ${s.answer.correct}/${s.answer.n} (${pct(s.answer.correct, s.answer.n)})   first passage ok ${s.answer.top1}/${s.answer.n} (${pct(s.answer.top1, s.answer.n)})   false abstain ${s.answer.falseAbstain}, false refuse ${s.answer.falseRefuse}`,
    `  passage relevance    mean precision ${(s.relevance.meanPrecision * 100).toFixed(0)}% over ${s.relevance.answered} answers   wrong-topic leaks ${s.relevance.leaks}`,
    `  abstention           ${s.abstain.correct}/${s.abstain.n} (${pct(s.abstain.correct, s.abstain.n)})   answered when it should not ${s.abstain.falseAnswer}`,
    `  refusal              ${s.refuse.correct}/${s.refuse.n} (${pct(s.refuse.correct, s.refuse.n)})`,
    `  by tag               ${Object.entries(s.byTag).sort().map(([t, v]) => `${t} ${v.ok}/${v.n}`).join("  ")}`,
  ];
  for (const r of s.results) {
    const bad = r.expect === "answer" ? !r.correct : r.got !== r.expect;
    if (bad || r.leaked.length) lines.push(`  MISS ${r.id} [want ${r.expect}, got ${r.got}${r.leaked.length ? `, LEAK ${r.leaked.join("+")}` : ""}] ${r.q}  -> ${r.returned.join(",") || "-"}`);
    else if (r.expect === "answer" && !r.top1) lines.push(`  not first: ${r.id} [${r.returned.join(",")}] ${r.q}`);
  }
  return lines.join("\n");
}


/**
 * The conversational set (eval/qa-conversational.json): free-form questions, each asked with a stated amount of
 * the person's own entries. It scores what the other sets cannot, because a question like "what should I do
 * first?" is not answered by a passage: guidance (from the plan or the pack), an answer, a clarification, an
 * abstention and a refusal are different outcomes, and each case says which one is right.
 */
export type ConversationalCase = {
  id: string;
  q: string;
  /** none: nothing entered. arrived: entry type and arrival date. moved: arrival and move-in date. */
  state: "none" | "arrived" | "moved";
  expect: "answer" | "guidance" | "abstain" | "refuse";
  passages?: string[];
  /** An abstention that must also offer options to choose from. */
  clarify?: boolean;
  tags: string[];
};

export function situationFor(state: ConversationalCase["state"]): Situation | undefined {
  if (state === "none") return undefined;
  const values = { entryType: "national_visa", arrivalDate: "2026-11-10", ...(state === "moved" ? { moveInDate: "2026-11-12" } : {}) };
  return { values, done: [] };
}

export type ConversationalResult = {
  id: string;
  q: string;
  expect: ConversationalCase["expect"];
  got: QAResponse["kind"];
  returned: string[];
  correct: boolean;
  clarified: boolean;
  tags: string[];
};

export type ConversationalSummary = {
  total: number;
  correct: number;
  byExpect: Record<string, { n: number; correct: number }>;
  results: ConversationalResult[];
};

export function runConversational(cases: ConversationalCase[], todayISO: string): ConversationalSummary {
  const results: ConversationalResult[] = cases.map((c) => {
    const r = berlinQA(c.q, todayISO, situationFor(c.state));
    const returned = r.kind === "answer" ? r.passages.map((p) => p.citation.passageId) : [];
    const clarified = r.kind === "abstain" && (r.clarify?.options.length ?? 0) >= 2;
    let correct = r.kind === c.expect;
    if (correct && c.expect === "answer" && c.passages) correct = returned.some((id) => c.passages!.includes(id));
    if (correct && c.expect === "abstain" && c.clarify) correct = clarified;
    return { id: c.id, q: c.q, expect: c.expect, got: r.kind, returned, correct, clarified, tags: c.tags };
  });
  const byExpect: ConversationalSummary["byExpect"] = {};
  for (const r of results) {
    const b = (byExpect[r.expect] ??= { n: 0, correct: 0 });
    b.n++;
    if (r.correct) b.correct++;
  }
  return { total: results.length, correct: results.filter((r) => r.correct).length, byExpect, results };
}

export function formatConversational(title: string, s: ConversationalSummary): string {
  const lines = [title, `  correct outcome ${s.correct}/${s.total}   ` + Object.entries(s.byExpect).map(([k, v]) => `${k} ${v.correct}/${v.n}`).join("  ")];
  for (const r of s.results.filter((x) => !x.correct)) lines.push(`  MISS ${r.id} [want ${r.expect}, got ${r.got}${r.returned.length ? " " + r.returned.join(",") : ""}] ${r.q}`);
  return lines.join("\n");
}
