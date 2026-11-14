import { berlinQA } from "./load";

export type GoldCase =
  | { id: string; q: string; expect: "answer"; passages: string[]; note?: string }
  | { id: string; q: string; expect: "abstain" | "refuse"; note?: string };

export type CaseResult = {
  id: string;
  q: string;
  expect: GoldCase["expect"];
  got: "answer" | "abstain" | "refuse";
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
