import type { Passage } from "./corpus";
import { buildCorrector, fold, stripExclusions, tokenize, type WordCorrector } from "./text";

export type Hit = { passageId: string; score: number };
export type SearchResult = {
  hits: Hit[];
  /** Share of the question's weight that the best single passage covers (0..1). */
  coverage: number;
  /** How many distinct content words the question had after normalisation. */
  termCount: number;
  /** How many of those words are distinctive: found in some passages, but in fewer than SPECIFIC_TERM_SHARE of them. */
  specificTerms: number;
  /**
   * How many of the question's distinct words the best passage contains at all, and how many of those are what
   * the passage is about (in its example questions or section title) and not only in its body. A passage that
   * matches a single question word, and only in passing, is not an answer. See answer.ts.
   */
  topMatched: number;
  topTopical: number;
};

/** Swappable: an embedding retriever could implement this later without touching answer logic. */
export interface Retriever {
  search(query: string, limit: number): SearchResult;
}

/** How much a passage's section title counts compared with one mention in its text. */
export const LOCATOR_WEIGHT = 0.5;

/**
 * A question that asks for documents ("what do I bring", "list of documents", "which papers") wants the passage
 * that is the document list, not one that mentions documents in passing ("There is no application, no
 * documents and no fee"). A passage's section title says which kind it is ("Unterlagen (documents)"), so a
 * question word that names a kind of section earns a bonus, as a share of the word's weight, when it is in
 * the title.
 *
 * Only words that name a kind of section count. A topic word in a title ("Anmeldung") must not earn it: that
 * would put the passage titled "Anmeldung" first for every question about registering. Small on purpose: it
 * settles close calls and cannot make a passage win that matches nothing else.
 */
export const TITLE_MATCH_BONUS = 0.5;
const SECTION_KIND_WORDS = new Set(["document"]);

const K1 = 1.4;
const B = 0.6;

/**
 * A word found in fewer than this share of the passages says something about the topic ("funds", "fee").
 * A word found in most of them ("register", "office") says almost nothing. Words found in no passage never count.
 */
export const SPECIFIC_TERM_SHARE = 0.2;

/** BM25 over passage text plus its example questions (indexed twice, since they are on-topic). */
export class Bm25Retriever implements Retriever {
  private docs: { id: string; tf: Map<string, number>; len: number; title: Set<string>; topic: Set<string> }[];
  private df = new Map<string, number>();
  private avgLen: number;
  private correct: WordCorrector;

  constructor(passages: Passage[]) {
    this.docs = passages.map((p) => {
      // Weighted term counts. The example questions are on-topic and count double. The section title
      // ("Unterlagen (documents)", "Gebühren (fees)") says what a passage is about, but it is short and would
      // otherwise swamp the text, so it counts for half.
      const tf = new Map<string, number>();
      let len = 0;
      const add = (tokens: string[], weight: number) => {
        for (const t of tokens) {
          tf.set(t, (tf.get(t) ?? 0) + weight);
          len += weight;
        }
      };
      add(tokenize(p.text), 1);
      add(tokenize(p.questions.join(" ")), 2);
      add(tokenize(p.locator), LOCATOR_WEIGHT);
      return { id: p.id, tf, len, title: new Set(tokenize(p.locator)), topic: new Set(tokenize(`${p.questions.join(" ")} ${p.locator}`)) };
    });
    for (const d of this.docs) for (const t of d.tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.avgLen = this.docs.reduce((a, d) => a + d.len, 0) / Math.max(1, this.docs.length);
    const counts = new Map<string, number>();
    for (const p of passages)
      for (const w of fold(`${p.text} ${p.questions.join(" ")} ${p.locator}`).replace(/[^a-z0-9]+/g, " ").split(" "))
        if (w) counts.set(w, (counts.get(w) ?? 0) + 1);
    this.correct = buildCorrector(counts);
  }

  private idf(term: string): number {
    const n = this.docs.length;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  search(query: string, limit: number): SearchResult {
    const terms = [...new Set(tokenize(stripExclusions(query), this.correct))];
    if (terms.length === 0) return { hits: [], coverage: 0, termCount: 0, specificTerms: 0, topMatched: 0, topTopical: 0 };
    const specificTerms = terms.filter((t) => {
      const df = this.df.get(t) ?? 0;
      return df > 0 && df / Math.max(1, this.docs.length) < SPECIFIC_TERM_SHARE;
    }).length;

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
        if (SECTION_KIND_WORDS.has(t) && d.title.has(t)) score += TITLE_MATCH_BONUS * idf;
      }
      return { passageId: d.id, score, covered };
    });
    scored.sort((a, b) => b.score - a.score);
    const top = scored.filter((s) => s.score > 0).slice(0, limit);
    // Coverage is judged on the best few single passages: a question must be answered by one passage.
    const coverage = Math.max(0, ...scored.slice(0, 3).map((s) => s.covered)) / totalWeight;
    const topDoc = top[0] ? this.docs.find((d) => d.id === top[0].passageId) : undefined;
    return {
      hits: top.map(({ passageId, score }) => ({ passageId, score })),
      coverage,
      termCount: terms.length,
      specificTerms,
      topMatched: topDoc ? terms.filter((t) => topDoc.tf.has(t)).length : 0,
      topTopical: topDoc ? terms.filter((t) => topDoc.topic.has(t)).length : 0,
    };
  }
}
