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
    "i my me we our you your it its this that these those there here what which who whom how when where why " +
    "can could should would will may might must shall if then than so as not no any some " +
    "about into over under up out off per also just only very much many more most other such " +
    "get got need needs want tell show best way find know check alone thing things fur " +
    "please s has have had gave give given make made take took until they them their information"
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
};

/** Each group collapses to its first member so related wording matches. */
const GROUPS: string[][] = [
  ["register", "registration", "registering", "registered", "anmeldung", "sign"],
  ["fee", "cost", "price", "pay", "charge", "free", "costs"],
  ["apply", "application", "submit", "request"],
  ["dwelling", "flat", "apartment", "home", "housing", "accommodation"],
  ["lease", "rental", "tenancy", "rent"],
  ["deregister", "abmeldung", "cancel", "unregister"],
  ["withdraw", "withdrawal", "withdrawing", "limit", "maximum", "cap"],
  ["leave", "leaving", "depart", "move"],
  ["proof", "evidence", "document", "certificate", "confirmation", "prove", "proving"],
  ["enough", "sufficient", "adequate"],
  ["valid", "accept", "accepted", "recognised", "recognized"],
  ["expire", "end", "ends", "run", "runs", "expiry", "expires", "lapse"],
  ["mail", "post", "deliver", "delivery", "letter"],
  ["start", "begin", "commence"],
  ["earliest", "soonest", "early", "advance"],
  ["deadline", "days", "weeks", "time", "long", "late", "period"],
  ["arrive", "arrival", "land", "enter", "entry"],
  ["india", "indian", "foreign", "abroad", "overseas"],
  ["ignore", "respond", "reply", "answer"],
  ["parent", "parents", "family", "parental"],
  ["card", "plastic", "eat", "electronic"],
  ["insurance", "insured", "insurer"],
  ["funds", "money", "financing", "livelihood", "finances"],
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

export function tokenize(text: string): string[] {
  const cleaned = fold(text)
    .replace(/visa-free/g, "visafree")
    .replace(/\b\d+(st|nd|rd|th)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ");
  const out: string[] = [];
  for (const raw of cleaned.split(" ")) {
    if (!raw || STOPWORDS.has(raw)) continue;
    const parts = EXPAND[raw] ?? [raw];
    for (const p of parts) {
      if (STOPWORDS.has(p)) continue;
      const base = canonical.get(p) ?? canonical.get(stem(p)) ?? stem(p);
      out.push(canonical.get(base) ?? base);
    }
  }
  return out;
}
