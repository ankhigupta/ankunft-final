import type { Pack, Source } from "../pack/schema";
import { isPackStale } from "../pack/validate";
import { diffDays } from "../planner/dates";
import type { Corpus, Passage } from "./corpus";
import type { Retriever } from "./retriever";
import { fold, tokenize } from "./text";
import { classifyGuidance, normalise } from "./intent";
import { meanwhileGuidance, nextStepGuidance, planFor, type GuidanceResponse, type Situation } from "./guidance";
import { EXAMPLE_QUESTIONS } from "./examples";

/**
 * Answers are extractive. We show the saved passages that match, each with its
 * source, and never generate a new factual claim. Three outcomes:
 *   answer  - enough evidence in one passage
 *   abstain - not enough evidence, or outside Berlin
 *   refuse  - asks for a judgement on a person's case, a legal outcome or a prediction
 */

export const MIN_COVERAGE = 0.55;
export const MAX_PASSAGES = 3;
/** A question needs at least this many content words, or one common word can match anything. */
export const MIN_TERMS = 2;
/**
 * Exception: one content word is enough when it is distinctive in the corpus (see SPECIFIC_TERM_SHARE)
 * and the question is a full sentence of at least this many words, such as "How much money do I need
 * to show?". A bare keyword ("fee", "visa", "register") stays too ambiguous to answer.
 */
export const MIN_WORDS_SINGLE_TERM = 5;
/** A secondary passage must score at least this share of the best one. */
export const RELATIVE_CUTOFF = 0.7;
/** Pages whose own date is older than this get a warning. */
export const OLD_PAGE_YEARS = 3;

export type Citation = {
  passageId: string;
  sourceId: string;
  title: string;
  publisher: string;
  url: string;
  retrievedOn: string;
  pageDate: string | null;
  locator: string;
  textKind: Passage["textKind"];
  authorityType: Source["authorityType"];
};
export type AnswerPassage = { text: string; score: number; citation: Citation };
export type ConflictNotice = { id: string; topic: string; display: string; sourceIds: string[] };
/**
 * Offered when a question is too vague to match. `options` are example questions taken from the saved passages
 * and checked to be answerable, so choosing one always gets a cited answer.
 */
export type Clarification = { prompt: string; options: string[] };
export type RefusalCategory = "eligibility" | "legal_outcome" | "prediction";

export type QAResponse =
  | { kind: "answer"; question: string; passages: AnswerPassage[]; conflicts: ConflictNotice[]; notices: string[] }
  | { kind: "abstain"; question: string; reason: string; clarify?: Clarification }
  | GuidanceResponse
  | {
      kind: "refuse";
      question: string;
      category: RefusalCategory;
      reason: string;
      pointers: { sourceId: string; title: string; url: string }[];
    };

/** Questions that judge a person's case instead of reporting a rule. Kept narrow on purpose. */
const REFUSAL_RULES: { category: RefusalCategory; pattern: RegExp }[] = [
  {
    category: "eligibility",
    pattern:
      /\b(am i|would i be|do i|does my [a-z ]{1,30}|could i|can i)\s+(be\s+|still\s+)?(eligible|qualify|qualified|entitled|allowed to (work|stay|travel|study|leave|enter)|permitted)\b/,
  },
  { category: "eligibility", pattern: /\b(chances?|odds|likelihood|likely to be (approved|rejected|denied))\b/ },
  {
    category: "prediction",
    pattern:
      /\bwill (i|my [a-z ]{1,30}|the [a-z ]{1,30})\s+(get|be|been)?\s*(approved|accepted|rejected|denied|granted|refused|declined|extended|issued)\b/,
  },
  { category: "prediction", pattern: /\bwill\b[^?.]{0,40}\b(approve|accept|reject|deny|grant|refuse|decline|extend|say yes|say no|agree|allow|issue)\b/ },
  { category: "prediction", pattern: /\b(guarantee|guaranteed|promise|for sure|definitely get)\b/ },
  {
    category: "legal_outcome",
    pattern:
      /\b(deport|deported|deportation|fined|penalt(y|ies)|punish|punished|prosecut\w*|arrested|illegal|unlawful|lawsuit|sue|appeal|widerspruch|klage|lawyer)\b/,
  },
  { category: "legal_outcome", pattern: /\bis it (legal|allowed|ok|okay|a crime)\b/ },
  // The same kinds of judgement question in German: a person's own case, a decision, or a consequence.
  { category: "eligibility", pattern: /\b(habe ich (einen )?anspruch|bin ich berechtigt|stehen mir .* zu|komme ich in frage)\b/ },
  { category: "prediction", pattern: /\bwerde ich\b[^?.]{0,40}\b(genehmigt|abgelehnt|bekommen|erhalten|akzeptiert)\b/ },
  { category: "legal_outcome", pattern: /\b(abgeschoben|abschiebung|abschieben|ausgewiesen|ausweisung|bussgeld|strafbar|anwalt|rechtsanwalt)\b/ },
];

/** Rules differ between cities, and the same words would match Berlin passages, so say so. */
const OTHER_PLACES =
  /\b(munich|munchen|hamburg|frankfurt|cologne|koln|stuttgart|dusseldorf|leipzig|dresden|heidelberg|bonn|aachen|karlsruhe|hannover|hanover|nuremberg|nurnberg|freiburg|bremen|potsdam|mannheim|mainz|jena|gottingen|kiel)\b/;

export function mentionsOtherCity(question: string): boolean {
  const q = fold(question);
  return OTHER_PLACES.test(q) && !/\bberlin\b/.test(q);
}

/**
 * Topics the saved sources do not cover. The generic words in such questions ("visa", "student", "office")
 * would otherwise match unrelated passages and produce a cited answer to a question nobody has answered.
 * Kept narrow on purpose, and every pattern has a test for what it must not catch.
 */

/** Employment, in the sense of a person working. "How does the blocked account work?" is not this. */
const WORK_WORDS =
  /\b(jobs?|employ(ed|er|ers|ment)|part ?time|full ?time|werkstudent\w*|minijob\w*|mini ?jobs?|side ?jobs?|freelanc\w*|self ?employ\w*|wages?|salary|salaries|paid work|earn(ing)? money)\b/;
const WORK_VERB = /\b(i|we|students?|can|may|could|allowed to|permitted to|able to|want to|to|while)\s+(also\s+|still\s+)?(work|working)\b(?!\s+out\b)/;
const WORK_HOURS = /\b(hours?\b.*\b(work|working|job)|(work|working|job)\b.*\bhours?)\b/;
/** Proving funds with an employment contract is covered by the sources (P016), so it goes to retrieval. */
const WORK_AS_PROOF = /\b(proof|prove|funds|financ\w*|livelihood|blocked account|sperrkonto|scholarship)\b/;

export function asksAboutWork(question: string): boolean {
  const q = fold(question);
  if (WORK_HOURS.test(q)) return true;
  if (!(WORK_WORDS.test(q) || WORK_VERB.test(q))) return false;
  return !WORK_AS_PROOF.test(q);
}

/**
 * Where an office is, when it is open, how to get there. The saved sources hold one street address, for the
 * immigration office (LEA). They hold no Bürgeramt address, no opening hours and no directions, so only an
 * address question about an office that really has an address in the corpus is answered; the rest abstain.
 */
/**
 * Offices first, then other places a newcomer asks the way to. The sources give one street address (the
 * immigration office), so an address, hours or directions question about any other place has no answer in them,
 * and the words of such a question ("university", "library") must not send it to a passage that merely mentions them.
 */
const OFFICE_PLACES = "office|burgeramt|amt|lea|landesamt|auslanderbehorde|behorde|embassy|consulate|bank|branch|building|campus";
const OTHER_PLACES_ASKED =
  "librar(?:y|ies)|canteens?|mensa|cafeterias?|cafes?|university|uni|hospitals?|clinics?|pharmac(?:y|ies)|doctors?|supermarkets?|" +
  "stations?|airport|dormitor(?:y|ies)|dorms?|registrar|gym|post box|postbox|mailbox|shops?|stores?|malls?";
const LOCATION_PLACE = `(${OFFICE_PLACES}|${OTHER_PLACES_ASKED})`;
const ADDRESS_RULES: RegExp[] = [
  new RegExp(`\\bwhere (is|are|s) (the |my |a |an )?(nearest |closest )?(\\w+ ){0,3}?${LOCATION_PLACE}\\b`),
  new RegExp(`\\b(nearest|closest) (\\w+ ){0,2}${LOCATION_PLACE}\\b`),
  new RegExp(`\\b(address|location) (of|for|to) (the )?(\\w+ ){0,3}${LOCATION_PLACE}\\b`),
  // "Where does the immigration office sit / is the office located / based?"
  new RegExp(`\\bwhere (does|do|is|are) (the |my |a )?(\\w+ ){0,3}?${LOCATION_PLACE}( \\w+){0,2} (sit|sits|located|situated|based|found|stand|stands)\\b`),
  // German: "Wo ist das Bürgeramt?", "Wie ist die Adresse der Ausländerbehörde?"
  new RegExp(`\\bwo (ist|sind|befindet sich|liegt) (das |die |der |den |dem )?(\\w+ ){0,3}?${LOCATION_PLACE}\\b`),
  new RegExp(`\\b(adresse|anschrift|standort) (von |vom |der |des |die |das )?(\\w+ ){0,3}${LOCATION_PLACE}\\b`),
];
/** Never in the sources, whichever office is meant. */
const HOURS_OR_DIRECTIONS_RULES: RegExp[] = [
  /\b(opening|office|business) hours\b/,
  /\bwhat time\b[^?.]{0,40}\b(open|opens|close|closes|closed)\b/,
  /\b(until|till|from) when\b[^?.]{0,30}\bopen\b/,
  /\bopen (on|at|until|today|tomorrow|saturday|sunday|monday|tuesday|wednesday|thursday|friday)\b/,
  new RegExp(`\\bdirections? (of|for|to) (the )?(\\w+ ){0,3}${LOCATION_PLACE}\\b`),
  new RegExp(`\\bhow (do|can) i (get|go|find my way) to (the )?(\\w+ ){0,3}${LOCATION_PLACE}\\b`),
  /\b(offnungszeiten|geoffnet|sprechzeiten)\b/,
  new RegExp(`\\bwie (komme|gelange) ich (zum|zur|zu) (\\w+ ){0,3}${LOCATION_PLACE}\\b`),
];

export type LocationAsk = "address" | "hours_or_directions";

export function classifyLocation(question: string): LocationAsk | null {
  const q = fold(question).replace(/['\u2019]/g, " ");
  if (HOURS_OR_DIRECTIONS_RULES.some((r) => r.test(q))) return "hours_or_directions";
  if (ADDRESS_RULES.some((r) => r.test(q))) return "address";
  return null;
}

export function asksAboutLocation(question: string): boolean {
  return classifyLocation(question) !== null;
}

const LEA_WORDS = /\b(lea|landesamt|einwanderung|auslanderbehorde|immigration|foreigners?)\b/;
const OTHER_OFFICE_WORDS = /\b(burgeramt|buergeramt|burgeramter|registration|citizens?|service berlin|bank|embassy|consulate|campus|building|branch)\b/;

/** The immigration office, and only it: a question that also names another kind of office is not this. */
export function asksAboutLea(question: string): boolean {
  const q = fold(question);
  return LEA_WORDS.test(q) && !OTHER_OFFICE_WORDS.test(q);
}

/** A street, house number, postcode and city: for example "Keplerstraße 2, 10589 Berlin". */
const STREET_ADDRESS = /\p{Lu}[\p{L}-]*(?:stra(?:ß|ss)e|str\.|allee|platz|ufer|damm|weg)\s+\d+\s?\p{L}?,\s*\d{5}\s+\p{Lu}\p{L}+/u;

/** Saved passages that give the immigration office's own address. Found by content, never written into the code. */
export function leaAddressPassages(corpus: Corpus): Passage[] {
  return corpus.passages.filter((p) => STREET_ADDRESS.test(p.text) && /Landesamt für Einwanderung|\bLEA\b/.test(p.text));
}

/**
 * Two more topics the saved sources do not cover. They are about getting something (a flat, a scholarship), not
 * about the rules the sources describe, and their everyday words ("flat", "apply", "Berlin") would otherwise
 * match registration or permit passages and show them as if they answered. Narrow, with tests for what they
 * must not catch: the sources do say you register once you have found accommodation, and that a scholarship
 * can count as proof of funds.
 */
const HOME = "(flats?|apartments?|rooms?|housing|accommodations?|wg|sublets?|flatmates?|roommates?|wohnung(en)?|zimmer|wohnheim)";
const HOUSING_SEARCH_RULES: RegExp[] = [
  // "Where can I find / look for a flat?", "How do I search for a room?"
  new RegExp(`\\b(where|how|which)\\b[^?.]{0,30}\\b(find|look for|looking for|search|searching|hunt|rent|buy)\\b[^?.]{0,40}\\b${HOME}\\b`),
  // "Which websites list apartments for rent?"
  new RegExp(`\\b(websites?|portals?|apps?|listings?|agenc(y|ies)|brokers?|classifieds)\\b[^?.]{0,40}\\b${HOME}\\b`),
  new RegExp(`\\b${HOME}\\b[^?.]{0,40}\\b(for rent|to rent|for sale|listings?|websites?)\\b`),
  // "How much is the rent?"
  /\b(how much|what)( is| are| does)?( the)? (rent|rents|rental prices?)\b|\brent (for|of|in)\b/,
  // German, either word order: "Wo finde ich eine Wohnung?", "Wo kann ich eine Wohnung mieten?"
  /\bwo\b[^?.]{0,30}\b(finde|finden|suche|suchen|mieten|bekomme)\b[^?.]{0,30}\b(wohnung(en)?|zimmer|wg)\b/,
  /\bwo\b[^?.]{0,30}\b(wohnung(en)?|zimmer|wg)\b[^?.]{0,30}\b(finde|finden|suche|suchen|mieten|bekomme)\b/,
  /\b(miete|mieten)\b[^?.]{0,20}\b(wohnung|zimmer|wg)\b|\b(wohnung|zimmer|wg)\b[^?.]{0,20}\b(miete|mieten)\b/,
];
const FUNDING_APPLICATION_RULES: RegExp[] = [
  /\b(apply|applying|application)\b[^?.]{0,20}\b(for|to)\b[^?.]{0,25}\b(scholarships?|grants?|bafog|loans?|stipend\w*|funding)\b/,
  /\bhow (do|can|could) (i|we|you) (get|obtain|win)\b[^?.]{0,15}\b(a |an )?(scholarships?|grants?|bafog|loans?|stipend\w*)\b/,
];

/**
 * The sources report rules. They do not recommend, rank or compare providers, so a question that asks for the
 * best, cheapest or a recommended one has no answer in them, however many of its words appear in a passage.
 * "The best way to apply" is an ordinary way of asking how, so it is left alone.
 */
const RECOMMENDATION_RULES: RegExp[] = [
  /\b(best|cheapest|worst|most popular|top rated|top-rated)\b(?! way\b)/,
  /\brecommend\w*\b/,
  /\b(which|what)\b[^?.]{0,25}\b(should i|would you|do you) (choose|pick|use|take|go for|prefer)\b/,
];

export function asksForRecommendation(question: string): boolean {
  const q = fold(question);
  return RECOMMENDATION_RULES.some((r) => r.test(q));
}

/** Family members' visas and residence: the sources describe the student's own permit only. */
const FAMILY_RULES: RegExp[] = [
  /\b(bring|take|join|move|reunif\w*|sponsor|visa for|permit for)\b[^?.]{0,25}\b(my |our |the )?(family|spouse|wife|husband|partner|children|kids|child|dependants?|dependents?)\b/,
  /\b(my |our )?(family|spouse|wife|husband|partner|children|kids)\b[^?.]{0,25}\b(visa|join me|come with me|move with me|residence permit)\b/,
];

export function asksAboutFamily(question: string): boolean {
  const q = fold(question);
  return FAMILY_RULES.some((r) => r.test(q));
}

export function asksAboutHousingSearch(question: string): boolean {
  const q = fold(question);
  return HOUSING_SEARCH_RULES.some((r) => r.test(q));
}

export function asksAboutFundingApplication(question: string): boolean {
  const q = fold(question);
  return FUNDING_APPLICATION_RULES.some((r) => r.test(q));
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function classifyRefusal(question: string): RefusalCategory | null {
  const q = fold(question);
  for (const r of REFUSAL_RULES) if (r.pattern.test(q)) return r.category;
  return null;
}

function cite(p: Passage, s: Source): Citation {
  return {
    passageId: p.id,
    sourceId: s.id,
    title: s.title,
    publisher: s.publisher,
    url: s.url,
    retrievedOn: s.retrievedOn,
    pageDate: s.pageDate,
    locator: p.locator,
    textKind: p.textKind,
    authorityType: s.authorityType,
  };
}

/** Where a person should go for a decision about their own case (LEA appointments, Service Berlin). */
const DECISION_SOURCES = ["S4", "S6"];

/** The question that general arrival guidance falls back on when the person has entered nothing. */
const GENERAL_STEPS_QUESTION = "What are the steps after arriving in Germany?";

/**
 * Nothing of the person's own to build a plan from, so the best honest answer is what the sources say in general
 * about the steps after arrival, cited, with a plain note that it is not ordered for them.
 */
function generalSteps(q: string, ctx: AnswerContext): QAResponse {
  const hit = ctx.retriever.search(GENERAL_STEPS_QUESTION, 1).hits[0];
  const answer = hit ? buildAnswer(q, [{ passageId: hit.passageId, score: hit.score }], ctx) : null;
  if (!answer || answer.kind !== "answer") {
    return {
      kind: "abstain",
      question: q,
      reason:
        "I do not know your situation yet, and the saved sources have no general list of first steps. " +
        "Add how you entered Germany and your dates on the Plan tab, then ask again.",
    };
  }
  answer.notices.unshift(
    "I do not know your situation yet, so this is the general list, not an order for you. " +
      "Add how you entered Germany and your dates on the Plan tab and ask again to see your own next step.",
  );
  return answer;
}

/** "What do I need?" / "what will I need to bring?" as the question's last clause. */
const NEEDS_ASK = /\bwhat (do|will|would|should) (i|we) (still |also )?(need|have to (bring|have|get|prepare|do|register|apply|enrol|enroll))( to (bring|have|get|prepare|do|register|apply|enrol|enroll))?$/;
/** The same words with nothing before them name no topic, so there is nothing to add "documents" to. */
const isBareNeed = (q: string) => tokenize(q).length === 0;

/**
 * Options for a question that is too vague. They are the saved passages' own example questions, each checked to
 * be answered, so none is a dead end. With no matching passage, the page's example questions are offered.
 */
function clarification(ctx: AnswerContext, passageIds: string[]): Clarification {
  const byId = new Map(ctx.corpus.passages.map((p) => [p.id, p]));
  const answers = (question: string) => answerQuestion(question, { ...ctx, situation: undefined }).kind === "answer";
  const options: string[] = [];
  for (const id of passageIds) {
    const candidate = byId.get(id)?.questions[0];
    if (candidate && !options.includes(candidate) && answers(candidate)) options.push(candidate);
    if (options.length === 3) break;
  }
  if (options.length > 0) return { prompt: "Did you mean one of these?", options };
  const examples = EXAMPLE_QUESTIONS.filter((e) => e.expect === "answer").map((e) => e.q).filter(answers);
  return { prompt: "Tell me a little more. For example:", options: examples.slice(0, 4) };
}

export type AnswerContext = {
  pack: Pack;
  corpus: Corpus;
  retriever: Retriever;
  todayISO: string;
  /** The person's own entries, if the caller has them. Only guidance questions use it. */
  situation?: Situation;
};

export function answerQuestion(question: string, ctx: AnswerContext): QAResponse {
  const q = question.trim();
  const { pack, corpus, retriever } = ctx;

  const category = classifyRefusal(q);
  if (category) {
    const pointers = DECISION_SOURCES.flatMap((id) => {
      const s = pack.sources.find((x) => x.id === id);
      return s ? [{ sourceId: s.id, title: s.title, url: s.url }] : [];
    });
    return {
      kind: "refuse",
      question: q,
      category,
      reason:
        "This asks for a judgement about your own case, a legal outcome or a prediction. " +
        "That depends on your documents and on the authority's decision, and Ankunft does not give legal advice. " +
        'You can ask what the sources say about a requirement, for example "what documents does the study residence permit need?". ' +
        "For a decision about your case, contact the immigration office (LEA) or a recognised advice service or lawyer.",
      pointers,
    };
  }

  if (mentionsOtherCity(q)) {
    return {
      kind: "abstain",
      question: q,
      reason:
        "Ankunft only covers Berlin so far, and rules differ between cities and registration offices. " +
        "Ask the local registration office or your university's international office.",
    };
  }

  if (asksAboutWork(q)) {
    return {
      kind: "abstain",
      question: q,
      reason:
        "Rules on whether and how much a student may work are not covered by the sources I have saved, so I will not guess. " +
        "Ask your university's international office or the immigration office (LEA).",
    };
  }

  if (asksAboutHousingSearch(q)) {
    return {
      kind: "abstain",
      question: q,
      reason:
        "Finding or renting a flat is not covered by the sources I have saved, so I will not guess. " +
        "Your university's international office or housing service can point you to options. " +
        "I can tell you what the sources say about registering once you have moved in.",
    };
  }

  if (asksForRecommendation(q)) {
    return {
      kind: "abstain",
      question: q,
      reason:
        "The sources I have saved describe rules, not recommendations or comparisons, so I will not pick a best option. " +
        "Your university's international office can often suggest providers for students.",
    };
  }

  if (asksAboutFamily(q)) {
    return {
      kind: "abstain",
      question: q,
      reason:
        "Visas and residence rules for family members are not covered by the sources I have saved, so I will not guess. " +
        "Ask the immigration office (LEA) or the German embassy.",
    };
  }

  if (asksAboutFundingApplication(q)) {
    return {
      kind: "abstain",
      question: q,
      reason:
        "How to apply for a scholarship, BAföG or another form of funding is not covered by the sources I have saved, so I will not guess. " +
        "Ask your university or the funding provider. I can tell you what the sources say about proving that your living costs are covered.",
    };
  }

  const location = classifyLocation(q);
  if (location) {
    if (location === "address" && asksAboutLea(q)) {
      const found = leaAddressPassages(corpus);
      // Score is the retrieval score; an address lookup has none, so every hit counts as a full match.
      if (found.length > 0) return buildAnswer(q, found.slice(0, MAX_PASSAGES).map((p) => ({ passageId: p.id, score: 1 })), ctx);
    }
    const offices = new RegExp(`\\b(${OFFICE_PLACES})\\b`).test(fold(q).replace(/['\u2019]/g, " "));
    return {
      kind: "abstain",
      question: q,
      reason:
        "I do not have an address, opening hours or directions for that in the sources I have saved, so I will not guess. " +
        (offices
          ? "Look them up on the official pages: service.berlin.de for citizens' offices (Bürgerämter) and " +
            "berlin.de/einwanderung for the immigration office (LEA)."
          : "Look it up on the website of the place itself, or ask your university's international office."),
    };
  }

  // Not a lookup: "what should I do first?", "can I do anything while I wait?". These ask what to do, which depends
  // on the person. They come after every topic guard above, so "just landed, can I work part time?" still abstains.
  const guidance = classifyGuidance(q);
  if (guidance) {
    const plan = planFor(pack, ctx.situation, ctx.todayISO);
    if (guidance.kind === "meanwhile") {
      const out = meanwhileGuidance(q, pack, guidance, plan);
      if (out.type === "guidance") return out.value;
      if (out.type === "abstain") return { kind: "abstain", question: q, reason: out.reason };
      // No step could be named, so say what is known about the question instead of guessing one.
    }
    if (plan && ctx.situation) {
      const out = nextStepGuidance(q, pack, plan, ctx.situation);
      if (out.type === "guidance") {
        if (guidance.kind === "meanwhile")
          out.value.notices.unshift("I could not tell which step you are waiting for, so this is what your plan says to do now.");
        return out.value;
      }
      if (out.type === "abstain") return { kind: "abstain", question: q, reason: out.reason };
    }
    return generalSteps(q, ctx);
  }

  // "I haven't registered yet. What do I need?": the question after a topic is bare "what do I need?", which asks
  // for the documents. Said on its own it names nothing, and "need" is not a topic word, so add the word it means.
  const searchText = NEEDS_ASK.test(normalise(q)) && !isBareNeed(q) ? `${q} documents` : q;

  const result = retriever.search(searchText, MAX_PASSAGES + 2);
  const top = result.hits[0];
  // One word is ambiguous even when it expands to two ("Anmeldung" is "register" and "address").
  if ((result.termCount < MIN_TERMS || wordCount(q) < 2) && !(result.specificTerms > 0 && wordCount(q) >= MIN_WORDS_SINGLE_TERM)) {
    return {
      kind: "abstain",
      question: q,
      reason:
        "That question is too short for me to match against the sources without guessing. " +
        'Add a little detail, for example "what documents does Anmeldung need?".',
      clarify: clarification(ctx, result.hits.map((h) => h.passageId)),
    };
  }
  if (!top || result.coverage < MIN_COVERAGE) {
    return {
      kind: "abstain",
      question: q,
      reason:
        "I could not find this in the official pages I have saved, so I will not guess. " +
        "Try asking about registering your address, the landlord's confirmation, health insurance, " +
        "proof of funds, or the study residence permit.",
    };
  }

  // The best passage contains one word of the question, and only in passing. "How do I get a library card?"
  // matches the enrolment note that says the library is closed until you enrol: nothing there is about
  // library cards. A passage that is about the question matches through its example questions or its title,
  // or contains more than one of its words.
  if (result.termCount >= 2 && result.topMatched <= 1 && result.topTopical === 0) {
    return {
      kind: "abstain",
      question: q,
      reason:
        "The only page that mentions a word from your question does so in passing, and is not about what you asked, so I will not show it as an answer. " +
        "Try asking about registering your address, the landlord's confirmation, health insurance, " +
        "proof of funds, or the study residence permit.",
    };
  }

  const chosen = result.hits.filter((h, i) => i === 0 || h.score >= top.score * RELATIVE_CUTOFF).slice(0, MAX_PASSAGES);
  return buildAnswer(q, chosen, ctx);
}

/** Turn chosen passages into a cited answer: citations, source conflicts, and the notices a reader needs. */
function buildAnswer(q: string, chosen: { passageId: string; score: number }[], ctx: AnswerContext): QAResponse {
  const { pack, corpus, todayISO } = ctx;
  const byId = new Map(corpus.passages.map((p) => [p.id, p]));
  const srcById = new Map(pack.sources.map((s) => [s.id, s]));

  const passages: AnswerPassage[] = [];
  for (const h of chosen) {
    const p = byId.get(h.passageId);
    const s = p ? srcById.get(p.sourceId) : undefined;
    if (!p || !s) continue; // a validated corpus cannot reach here; never show an uncited passage
    passages.push({ text: p.text, score: Number(h.score.toFixed(3)), citation: cite(p, s) });
  }
  if (passages.length === 0) return { kind: "abstain", question: q, reason: "No citable passage matched." };

  const conflictIds = new Set(chosen.flatMap((h) => byId.get(h.passageId)?.conflictIds ?? []));
  const conflicts: ConflictNotice[] = pack.conflicts
    .filter((c) => conflictIds.has(c.id))
    .map((c) => ({
      id: c.id,
      topic: c.topic,
      display: c.display,
      sourceIds: [...new Set(c.statements.flatMap((s) => s.sourceIds))],
    }));

  const notices: string[] = [];
  if (passages.some((p) => p.citation.textKind === "paraphrase")) {
    notices.push(
      "These passages are our paraphrase of the source pages as retrieved on the dates shown, not exact quotes. Open the source before acting.",
    );
  }
  for (const p of passages) {
    if (p.citation.pageDate && diffDays(todayISO, p.citation.pageDate) > OLD_PAGE_YEARS * 365) {
      notices.push(`${p.citation.title}: the page's own date is ${p.citation.pageDate}, so parts may be out of date.`);
    }
  }
  if (isPackStale(pack, todayISO)) {
    notices.push(
      `Our sources were last checked on ${pack.verifiedOn}, which is more than ${pack.staleAfterDays} days ago. Re-check the linked pages.`,
    );
  }
  return { kind: "answer", question: q, passages, conflicts, notices: [...new Set(notices)] };
}
