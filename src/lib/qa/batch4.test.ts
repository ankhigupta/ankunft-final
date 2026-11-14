import { describe, expect, it } from "vitest";
import { berlinCorpus, berlinQA } from "./load";
import { Bm25Retriever } from "./retriever";
import { buildCorrector, fold, tokenize } from "./text";

const TODAY = "2026-11-14";
const ask = (q: string) => berlinQA(q, TODAY);
const shown = (q: string) => {
  const r = ask(q);
  return r.kind === "answer" ? r.passages.map((p) => p.citation.passageId) : [];
};
const retriever = new Bm25Retriever(berlinCorpus.passages);

const counts = new Map<string, number>();
for (const p of berlinCorpus.passages)
  for (const w of fold(`${p.text} ${p.questions.join(" ")} ${p.locator}`).replace(/[^a-z0-9]+/g, " ").split(" ")) if (w) counts.set(w, (counts.get(w) ?? 0) + 1);
const q = (s: string) => tokenize(s, buildCorrector(counts));

describe("batch 4, issue 1: a library card is not answered with the enrolment note", () => {
  // The only passage that says "library" (P033) says you cannot use university facilities such as the library
  // until you are enrolled. Nothing in the saved pages is about library cards, so these abstain.
  it.each([
    "How do I get a library card in Berlin?",
    "Where can I get a library card in Berlin?",
    "How do I apply for a library card?",
    "Can I get a library membership?",
    "How much does a library card cost?",
    "Is there a library card for students?",
    "Does my student ID work as a library card?",
    "Can I borrow books from the library?",
  ])("abstains and shows no passage: %s", (question) => {
    const r = ask(question);
    expect(r.kind, question).toBe("abstain");
    expect(r).not.toHaveProperty("passages");
  });

  it("the cause: the best passage matches one word, in its body, and is not about it", () => {
    const s = retriever.search("How do I get a library card in Berlin?", 5);
    expect(s.hits[0].passageId).toBe("P033");
    expect(s.topMatched).toBeLessThanOrEqual(1);
    expect(s.topTopical).toBe(0);
    // Coverage alone passed it: the one matched word, "library", is the rarest and carries most of the weight.
    expect(s.coverage).toBeGreaterThanOrEqual(0.55);
  });

  it("invents nothing about library registration: the response has no passage and does not mention a library", () => {
    for (const question of ["How do I get a library card in Berlin?", "Can I get a library membership?"]) {
      const rest: Record<string, unknown> = { ...ask(question) };
      delete rest.question; // the question itself is echoed back
      expect(JSON.stringify(rest)).not.toMatch(/librar/i);
    }
  });

  it("the passage's own claim is still answered when asked about", () => {
    expect(shown("Can I use the university library before I have enrolled?")).toEqual(["P033"]);
    expect(shown("Can I use the library before enrolment?")).toContain("P033");
    expect(shown("When can I use the library?")).toContain("P033");
  });

  it("a passage that matches only one word is still shown when it is what the passage is about", () => {
    // "tax" is in P039's example questions, so one matched word is enough there.
    const s = retriever.search("How do I get my tax ID?", 5);
    expect(s.topTopical).toBeGreaterThan(0);
    expect(shown("How do I get my tax ID?")).toContain("P039");
  });

  it("does not make questions with other unknown words abstain when a passage truly covers them", () => {
    expect(shown("What documents do I need for Anmeldung?")[0]).toBe("P009");
    expect(shown("How much money must be in a blocked account?")).toContain("P045");
  });

  it("the rule never applies to a one-word-matching top passage when the question has fewer than two words", () => {
    // A too-short question has its own abstention. The rule needs two or more words to compare.
    expect(ask("library").kind).toBe("abstain");
  });
});

describe("batch 4, issue 2: Anmeldung document lists rank the document passage first", () => {
  it.each([
    "List of documents for registering a flat.",
    "What do I need to bring to the Bürgeramt?",
    "What do I need to bring to the Anmeldung?",
    "Checklist of documents for the Anmeldung",
    "List the documents required to register an address",
    "Which papers does the registration office want from me for Anmeldung?",
    "What documents do I need for Anmeldung?",
  ])("P009 first: %s", (question) => {
    expect(shown(question)[0], question).toBe("P009");
  });

  it("the cause: 'list' was matched in other passages ('listing your personal details') and a passing mention won", () => {
    expect(tokenize("List of documents for registering a flat.")).toEqual(["document", "register", "dwelling"]);
    expect(tokenize("Checklist of documents")).toEqual(["document"]);
    expect(tokenize("bring along")).toEqual([]);
    // P039 says "no documents", in passing. P009 is the document list and is titled so.
    const s = retriever.search("What do I need to bring to the Bürgeramt?", 5);
    expect(s.hits.map((h) => h.passageId).slice(0, 2)).toEqual(["P009", "P039"]);
  });

  it("an appointment question for Anmeldung still ranks P029 or P010 first, not the documents", () => {
    expect(shown("Do I need an appointment for Anmeldung?")[0]).toBe("P029");
    expect(shown("Do I need Anmeldung to get an LEA appointment?")[0]).toBe("P029");
    expect(shown("Can I get an LEA appointment without Anmeldung?")[0]).toBe("P029");
    expect(shown("Can I register at any Bürgeramt?")).toContain("P029");
  });

  it("residence-permit document questions still start with P015", () => {
    for (const question of [
      "What documents do I need for the residence permit?",
      "What documents does the study residence permit need?",
      "List of documents for the residence permit application",
      "Which documents are needed for the study residence permit?",
    ]) {
      expect(shown(question)[0], question).toBe("P015");
    }
  });

  it("P009 is not first for every question that mentions Anmeldung or a Bürgeramt", () => {
    // The bonus is for the word 'document' only. A topic word in a title ("Anmeldung") earns nothing.
    for (const question of [
      "How do I register my address?",
      "Does Anmeldung cost anything?",
      "Where can I register my address online?",
      "Can I register at any Bürgeramt?",
      "When do I need to register my address?",
      "how do i regester my adress in berlin",
    ]) {
      expect(shown(question)[0], question).not.toBe("P009");
    }
    // P029 is titled "Anmeldung". A bonus for that title word would put it first for every registration question.
    for (const question of ["how do i regester my adress in berlin", "How do I register my address?", "When do I need to register my address?"]) {
      expect(shown(question)[0], question).not.toBe("P029");
    }
    expect(shown("Does Anmeldung cost anything?")[0]).toBe("P011");
    expect(shown("Where can I register my address online?")[0]).toBe("P010");
  });

  it("a question that is about a document but not a document list still goes to the right passage", () => {
    expect(shown("Does a lease replace the landlord's confirmation?")[0]).toBe("P009");
    expect(shown("What do I get after registering?")[0]).toBe("P011");
  });
});

describe("batch 4, issue 3: paraphrases the corpus does support", () => {
  it.each([
    "How big a deposit does the blocked account need?",
    "How large a deposit is required for a blocked account?",
    "What sum has to be paid into a Sperrkonto?",
    "How big does my blocked account balance need to be?",
  ])("answers the blocked-account amount: %s", (question) => {
    const got = shown(question);
    expect(got[0], question).toBe("P045");
    const r = ask(question);
    if (r.kind === "answer") expect(r.passages[0].text).toContain("11,904");
  });

  it.each([
    "skip German cover",
    "Can I keep my insurance from home and skip German cover?",
    "Can I skip German health insurance?",
    "Can I opt out of German health insurance and use my policy from my home country?",
  ])("answers the exemption question from the health-insurance passages: %s", (question) => {
    const got = shown(question);
    expect(got, question).toContain("P038");
    for (const id of got) expect(["P038", "P037", "P032", "P013", "P012"], `${question}: ${id}`).toContain(id);
  });

  it("the causes: 'deposit' and 'skip' are in no passage, so they sank the question's coverage", () => {
    expect(q("How big a deposit does the blocked account need?")).toEqual(expect.arrayContaining(["amount", "block", "account"]));
    expect(q("skip German cover")).toEqual(expect.arrayContaining(["exempt", "german", "cover"]));
    expect(tokenize("exempt from the insurance obligation")).toContain("exempt");
    expect(tokenize("my home country insurance")).toContain("homecountry");
    expect(tokenize("home-country insurance")).toContain("homecountry");
  });

  it("'deposit' has no meaning in the saved pages other than the blocked-account amount: rent deposits abstain", () => {
    for (const question of [
      "How much is the rental deposit for a flat in Berlin?",
      "What is the Kaution for a rental flat?",
      "Where do I pay a deposit for renting a bike?",
      "How big is a typical student flat in Berlin?",
    ]) {
      expect(ask(question).kind, question).toBe("abstain");
    }
  });

  it("'skip' does not answer what the sources do not say", () => {
    expect(ask("Can I skip the Anmeldung?").kind).toBe("abstain");
    expect(ask("What is the best health insurance cover for students?").kind).toBe("abstain");
  });

  it("'cover' is left alone in the sources' other sense", () => {
    expect(tokenize("it does not cover the whole stay")).not.toContain("insurance");
    expect(shown("Does the blocked account cover my rent?")[0]).toBe("P045");
  });

  it("'whose' is a question word, not a topic word (it was read as 'whos' and matched an unrelated passage)", () => {
    expect(tokenize("Whose name has to be on the move-in confirmation?")).not.toContain("whos");
    expect(shown("Whose name has to be on the move-in confirmation?")).toContain("P005");
  });
});

describe("batch 4: safety is unchanged", () => {
  it("still refuses and still abstains where it did", () => {
    expect(ask("Will LEA approve my application?").kind).toBe("refuse");
    expect(ask("Am I eligible for the residence permit?").kind).toBe("refuse");
    expect(ask("Where is the Bürgeramt?").kind).toBe("abstain");
    expect(ask("How do I register in Munich?").kind).toBe("abstain");
    expect(ask("Can I work part time on a student visa?").kind).toBe("abstain");
    expect(ask("Where can I find a flat in Berlin?").kind).toBe("abstain");
    expect(shown("Where is the immigration office?")).toEqual(["P020"]);
  });
});
