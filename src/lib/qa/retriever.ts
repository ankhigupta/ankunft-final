import type { Passage } from "./corpus";
import { tokenize } from "./text";

export type Hit = { passageId: string; score: number };
export type SearchResult = {
  hits: Hit[];
  /** Share of the question's weight that the best single passage covers (0..1). */
  coverage: number;
  /** How many distinct content words the question had after normalisation. */
  termCount: number;
};

/** Swappable: an embedding retriever could implement this later without touching answer logic. */
export interface Retriever {
  search(query: string, limit: number): SearchResult;
}

const K1 = 1.4;
const B = 0.6;

/** BM25 over passage text plus its example questions (indexed twice, since they are on-topic). */
export class Bm25Retriever implements Retriever {
  private docs: { id: string; tf: Map<string, number>; len: number }[];
  private df = new Map<string, number>();
  private avgLen: number;

  constructor(passages: Passage[]) {
    this.docs = passages.map((p) => {
      const tokens = [...tokenize(p.text), ...tokenize(p.questions.join(" ")), ...tokenize(p.questions.join(" "))];
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      return { id: p.id, tf, len: tokens.length };
    });
    for (const d of this.docs) for (const t of d.tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.avgLen = this.docs.reduce((a, d) => a + d.len, 0) / Math.max(1, this.docs.length);
  }

  private idf(term: string): number {
    const n = this.docs.length;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  search(query: string, limit: number): SearchResult {
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0) return { hits: [], coverage: 0, termCount: 0 };

    const totalWeight = terms.reduce((a, t) => a + this.idf(t), 0);
    const scored = this.docs.map((d) => {
      let score = 0;
      let covered = 0;
      for (const t of terms) {
        const f = d.tf.get(t);
        if (!f) continue;
        const idf = this.idf(t);
        covered += idf;
        score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / this.avgLen)));
      }
      return { passageId: d.id, score, covered };
    });
    scored.sort((a, b) => b.score - a.score);
    const top = scored.filter((s) => s.score > 0).slice(0, limit);
    // Coverage is judged on the best few single passages: a question must be answered by one passage.
    const coverage = Math.max(0, ...scored.slice(0, 3).map((s) => s.covered)) / totalWeight;
    return { hits: top.map(({ passageId, score }) => ({ passageId, score })), coverage, termCount: terms.length };
  }
}
