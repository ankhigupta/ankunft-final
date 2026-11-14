/**
 * Text normalisation for the lexical retriever. Deliberately simple and
 * inspectable: fold accents, lowercase, drop filler words, reduce plurals and
 * a few suffixes, and map a short list of synonyms to one shared token.
 */

export function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase();
}

const STOPWORDS = new Set(
  (
    "a an the and or of to in on at for from with by is are was were be been am do does did " +
    "i my me we our you your it its this that these those there here what which who whom whose how when where why " +
    "can could should would will may might must shall if then than so as not no any some " +
    "about into over under up out off per also just only very much many more most other such " +
    "get got need needs want tell show best way find know check alone thing things fur " +
    "please s has have had gave give given make made take took until they them their information " +
    // question framing, not topic: "is it possible to...", "apart from X, how else...", "how far ahead..."
    "possible possibly able apart else far ahead besides already ever complete completing finish bring bringing along berlin happen happens never " +
    // "a list of documents" and "a checklist of documents" ask for the documents; "list" says how to present them
    "list checklist " +
    // Contractions, written without their apostrophe ("haven't" is "havent"), and "yet" as in "not registered yet".
    // Split at the apostrophe they left a stray "t" or "s" and a word that is nothing on its own ("haven").
    "havent hasnt hadnt isnt arent wasnt werent dont doesnt didnt wont wouldnt couldnt shouldnt cant " +
    "im ive ill youre theyre weve whats thats theres heres wheres hows lets yet " +
    // German function words and question words (no topic words here)
    "hoch hohe wie was wann wo welche welcher welches brauche brauchen braucht muss musst kann kannst darf ich mich mir du die der " +
    "das den dem des ein eine einen einem einer fur auf zu zum zur im ist sind wird habe hat und oder nicht noch viel " +
    "lange wenn mein meine meinen bei mit von vom als nach"
  ).split(/\s+/),
);

/** German compounds and common spellings, split into the words the passages use. */
const EXPAND: Record<string, string[]> = {
  anmeldung: ["register", "address"],
  wohnungsgeberbestatigung: ["landlord", "confirmation"],
  meldebestatigung: ["registration", "confirmation"],
  aufenthaltserlaubnis: ["residence", "permit"],
  fiktionsbescheinigung: ["fiktionsbescheinigung", "interim", "certificate"],
  rundfunkbeitrag: ["broadcasting", "contribution"],
  krankenversicherung: ["health", "insurance"],
  immatrikulation: ["enrollment"],
  sperrkonto: ["blocked", "account"],
  auslanderbehorde: ["lea", "immigration", "office"],
  burgeramt: ["registration", "office"],
  meldebehorde: ["registration", "office"],
  visum: ["visa"],
  anmelden: ["register", "address"],
  anzumelden: ["register", "address"],
  abmelden: ["deregister"],
  abzumelden: ["deregister"],
};

/** Each group collapses to its first member so related wording matches. */
const GROUPS: string[][] = [
  ["register", "registration", "registering", "registered", "anmeldung", "sign"],
  // German words below appear in the corpus itself (locators such as "Gebühren (fees)", "Unterlagen (documents)",
  // "Frist (deadline)") or are plain dictionary equivalents of the English word in the same group.
  ["fee", "cost", "price", "pay", "charge", "free", "costs", "kosten", "kostet", "gebuhr", "gebuhren"],
  ["apply", "application", "submit", "request"],
  // "home" is not here: it is mostly "home-country" or "home university", and it pulled in unrelated passages.
  ["dwelling", "flat", "apartment", "housing", "accommodation", "wohnung"],
  ["lease", "rental", "tenancy", "rent"],
  ["deregister", "abmeldung", "cancel", "unregister"],
  ["withdraw", "withdrawal", "withdrawing", "limit", "maximum", "cap"],
  ["leave", "leaving", "depart", "move"],
  ["proof", "evidence", "certificate", "confirmation", "prove", "proving"],
  // A list of documents is not the same thing as proof or a confirmation, and merging them made every passage
  // that mentions a confirmation look like a document list.
  ["document", "paper", "unterlagen", "dokumente"],
  ["enough", "sufficient", "adequate"],
  ["valid", "accept", "accepted", "recognised", "recognized"],
  ["expire", "end", "ends", "run", "runs", "expiry", "expires", "lapse"],
  ["mail", "post", "deliver", "delivery", "letter"],
  ["start", "begin", "commence"],
  ["earliest", "soonest", "early", "advance"],
  ["deadline", "days", "weeks", "time", "long", "late", "period", "frist"],
  ["arrive", "arrival", "land", "enter", "entry"],
  ["india", "indian", "foreign", "abroad", "overseas"],
  ["ignore", "respond", "reply", "answer"],
  ["parent", "parents", "family", "parental"],
  ["card", "plastic", "eat", "electronic"],
  ["insurance", "insured", "insurer"],
  ["funds", "money", "financing", "livelihood", "finances", "afford", "geld"],
  ["online", "internet", "web"],
  // "deposit" is what is paid into a blocked account, which the passages call "the full amount ... paid in".
  // No passage is about any other deposit (rent, bikes), so the word has no other meaning in the corpus.
  ["amount", "sum", "minimum", "least", "lowest", "balance", "deposit", "deposited", "big", "size", "large"],
  // The sources say "exempt from the insurance obligation"; people say "skip", "avoid" or "opt out of".
  ["exempt", "exemption", "exempted", "skip", "skipping", "avoid", "waive", "waiver", "opt", "bypass"],
  ["euro", "euros", "eur"],
  ["appointment", "termin", "termine"],
  ["address", "adresse"],
];

export function stem(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 5 && w.endsWith("ly")) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

const canonical = new Map<string, string>();
for (const g of GROUPS) for (const w of g) { canonical.set(w, g[0]); canonical.set(stem(w), g[0]); }

/**
 * "Apart from a blocked account, how else can I show my funds?" asks about everything except the blocked
 * account. Keeping those words would rank the blocked-account passage first. The excluded clause is dropped
 * up to the next comma or the end of the question.
 */
export function stripExclusions(question: string): string {
  return question.replace(/\b(apart from|aside from|other than|besides|instead of|except for|except|not counting)\b[^,;?.]*[,;]?/gi, " ");
}

/** Maps a typed word to the word the saved texts use, or returns it unchanged. See buildCorrector. */
export type WordCorrector = (word: string) => string;

/**
 * Words that only mean something when a person asks. "What do I bring to ...?" asks for documents, but "bring" is
 * everyday framing in the saved texts, so it is a stopword there and is read as "documents" only in a question.
 */
const QUESTION_ONLY: Record<string, string[]> = {
  bring: ["document"],
  bringing: ["document"],
};

export function tokenize(text: string, correct?: WordCorrector): string[] {
  const cleaned = fold(text)
    .replace(/visa-free/g, "visafree")
    // "home-country" is one idea; split, its "home" would be read as a dwelling.
    .replace(/home[- ]country/g, "homecountry")
    .replace(/['\u2019]/g, "") // haven't -> havent, landlord's -> landlords
    .replace(/\b\d+(st|nd|rd|th)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ");
  const out: string[] = [];
  for (const raw of cleaned.split(" ")) {
    const asked = correct ? QUESTION_ONLY[raw] : undefined; // only questions pass a corrector
    if (!raw || (STOPWORDS.has(raw) && !asked)) continue;
    const word = correct ? correct(raw) : raw;
    const parts = asked ?? EXPAND[word] ?? [word];
    for (const p of parts) {
      if (STOPWORDS.has(p)) continue;
      const base = canonical.get(p) ?? canonical.get(stem(p)) ?? stem(p);
      const norm = canonical.get(base) ?? base;
      // "needed" is not a stopword as typed, but it becomes "need", which is one. Check again after normalising.
      if (STOPWORDS.has(norm)) continue;
      out.push(norm);
    }
  }
  return out;
}

/** True if the words differ by at most one edit: a substitution, an insertion, a deletion, or two letters swapped. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // one letter differs
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // two neighbours swapped
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

/** Every word form the vocabulary tables know, so a typo can be matched to a real word and not only to the corpus. */
export const LEXICON: string[] = [...new Set([...GROUPS.flat(), ...Object.keys(EXPAND)])];

/**
 * Fixes a likely typo by matching it to a word the saved texts or the vocabulary tables already use. It is
 * deliberately cautious: the word must be unknown, at least five letters, share its first letter with exactly
 * one best candidate that is one edit away. Anything else is left alone, so an unknown word stays unknown
 * and the question still abstains. `counts` is how often each real word appears in the saved texts.
 */
/** Shorter words are too easily another real word one letter away. */
const MIN_TYPO_LENGTH = 5;

export function buildCorrector(counts: Map<string, number>): WordCorrector {
  const known = new Map<string, number>(counts);
  for (const w of LEXICON) if (!known.has(w)) known.set(w, 0);
  const isKnown = (w: string) => known.has(w) || canonical.has(w) || canonical.has(stem(w)) || w in EXPAND;
  return (word) => {
    if (word.length < MIN_TYPO_LENGTH || /\d/.test(word) || isKnown(word)) return word;
    const hits = [...known].filter(([w]) => w[0] === word[0] && w.length >= 5 && withinOneEdit(word, w));
    if (hits.length === 0) return word;
    hits.sort((x, y) => y[1] - x[1]);
    if (hits.length > 1 && hits[0][1] === hits[1][1]) return word; // two equally good guesses: do not guess
    return hits[0][0];
  };
}
