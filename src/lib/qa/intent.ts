import { fold, tokenize } from "./text";

/**
 * Questions that are not lookups. "Just landed, what should I do?" has no fact to retrieve: it asks what to do
 * next, which depends on the person, and only the planner can answer it. Matching its words against the saved
 * pages answers a different question (or says "too short"), so it is recognised here, before retrieval.
 *
 * Deliberately narrow, and deliberately topic-free: a question that names a topic ("what should I do first about
 * my residence permit?") is a question about that topic and goes to retrieval. Every pattern has tests for what
 * it must not catch.
 */

export type GuidanceIntent =
  /** "What should I do first / next?" with nothing else asked. */
  | { kind: "next_step" }
  /** "Can I do anything while waiting for X?" `waitingFor` is the words after "waiting for", possibly empty. */
  | { kind: "meanwhile"; waitingFor: string };

/** Lowercase, no accents, no apostrophes, single spaces, and the contractions that matter written out. */
export function normalise(question: string): string {
  return fold(question)
    .replace(/['’]/g, "")
    .replace(/\bwhats\b/g, "what is")
    .replace(/\bim\b/g, "i am")
    .replace(/\bive\b/g, "i have")
    .replace(/\bdont\b/g, "do not")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const NEXT_STEP_ASKS: RegExp[] = [
  /\bwhat (should|do|shall|can|must|to) (i |we )?(now |just )?(do|start|begin)\b/,
  /\bwhat (do|should) (i|we) (need|have|ought) to do\b/,
  /\bwhat (is|are) (my |the |our )?(next|first)( steps?| moves?| things?)?\b/,
  /\bwhat (now|next|first|comes next)\b/,
  /\bwhere (do|should|shall|can) (i|we) (even |actually )?(start|begin)\b/,
  /\bhow (do|should|can) (i|we) (even )?(start|get started|begin)\b/,
  /\b(my |the )?(next|first) steps?\b/,
];

/**
 * Words that frame an arrival or a request for order and name no topic. If anything else is left in the
 * question after normalisation, it is about something and is not a request for general guidance.
 */
const FRAMING_TOKENS = new Set([
  "arrive", "arrival", "today", "tonight", "yesterday", "morning", "next", "first", "start", "begin", "step",
  "thing", "now", "then", "soon", "new", "student", "even", "actual", "ought", "get",
]);

/** The same ask in German, matched on the whole question so that nothing else can be in it. */
const GERMAN_NEXT_STEP_FULL: RegExp[] = [
  /^(und )?was (soll|muss|kann) ich (jetzt |nun |zuerst |zunachst |als erstes |als nachstes )?(tun|machen)$/,
  /^was (ist|kommt) (jetzt |als )?(nachstes|erstes|zuerst)$/,
  /^wo (fange|beginne) ich (damit )?an$/,
  /^ich bin (gerade |heute |eben )?angekommen was (nun|jetzt|soll ich (jetzt |zuerst )?(tun|machen))$/,
];

const MEANWHILE_WHILE = /\b(while|during|until)\b[^?.]{0,12}\b(wait|waiting|awaiting|waits)\b/;
const MEANWHILE_ASK = /\b(can|could|should|may|might) (i|we) (do|prepare)\b|\banything\b|\bsomething\b|\bwhat (can|should|do) (i|we)\b/;
const WAITING_FOR = /\b(?:waiting|wait|awaiting)\b(?: for| on)? (.+)$/;

export function classifyGuidance(question: string): GuidanceIntent | null {
  const q = normalise(question);
  if (!q) return null;

  if (GERMAN_NEXT_STEP_FULL.some((r) => r.test(q))) return { kind: "next_step" };

  if (MEANWHILE_WHILE.test(q) && MEANWHILE_ASK.test(q)) {
    const m = WAITING_FOR.exec(q);
    return { kind: "meanwhile", waitingFor: m ? m[1] : "" };
  }

  if (NEXT_STEP_ASKS.some((r) => r.test(q))) {
    // Nothing but framing may be left: a topic word makes it a question about that topic.
    if (tokenize(question).every((t) => FRAMING_TOKENS.has(t))) return { kind: "next_step" };
  }
  return null;
}
