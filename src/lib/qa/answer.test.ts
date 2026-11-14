import { describe, expect, it } from "vitest";
import { berlinCorpus, berlinQA, loadCorpus } from "./load";
import { berlinPack } from "../pack/load";
import { classifyRefusal, mentionsOtherCity } from "./answer";
import { validateCorpus } from "./corpus";
import { tokenize } from "./text";

const TODAY = "2026-11-14";
const ask = (q: string, today = TODAY) => berlinQA(q, today);
const ids = (q: string) => {
  const r = ask(q);
  return r.kind === "answer" ? r.passages.map((p) => p.citation.passageId) : [];
};

describe("answers", () => {
  it("answers the Anmeldung deadline from the statute passage", () => {
    expect(ids("How many days do I have to register my address?")).toContain("P001");
  });

  it("does not mistake 'free' for 'visa-free'", () => {
    expect(ids("Is Anmeldung free?")).toContain("P011");
  });

  it("answers fee questions with the registration fee passage in the answer", () => {
    expect(ids("What is the fee for registering my flat?")).toContain("P011");
  });

  it("every answer carries a source, a locator and a link", () => {
    for (const q of ["How do I register my address?", "What documents does the study residence permit need?"]) {
      const r = ask(q);
      expect(r.kind).toBe("answer");
      if (r.kind !== "answer") continue;
      for (const p of r.passages) {
        expect(p.citation.url).toMatch(/^https:\/\//);
        expect(p.citation.locator.length).toBeGreaterThan(0);
        expect(p.citation.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("says plainly that passages are paraphrases", () => {
    const r = ask("How do I register my address?");
    expect(r.kind === "answer" && r.notices.some((n) => /paraphrase/i.test(n))).toBe(true);
  });

  it("surfaces a documented source conflict instead of picking a side", () => {
    const r = ask("Can I apply for the residence permit before my permit or visa expires?");
    expect(r.kind).toBe("answer");
    if (r.kind === "answer") expect(r.conflicts.map((c) => c.id)).toContain("C-EARLIEST");
  });

  it("warns when a cited page carries an old date", () => {
    const r = ask("Can I apply for the residence permit before my permit or visa expires?");
    if (r.kind !== "answer") throw new Error("expected answer");
    const cited = r.passages.map((p) => p.citation.sourceId);
    const old = berlinPack.sources.filter((s) => cited.includes(s.id) && s.pageDate && s.pageDate < "2023-01-01");
    if (old.length) expect(r.notices.some((n) => /out of date/.test(n))).toBe(true);
  });

  it("warns when the pack is stale", () => {
    const r = ask("How do I register my address?", "2027-03-01");
    expect(r.kind === "answer" && r.notices.some((n) => /last checked/.test(n))).toBe(true);
  });
});

describe("abstain and refuse", () => {
  it("abstains on off-topic questions rather than guessing", () => {
    for (const q of ["What is the best exchange rate?", "How do I get a driving licence?", "Where should I start?"])
      expect(ask(q).kind).toBe("abstain");
  });

  it("abstains for other cities", () => {
    expect(mentionsOtherCity("How do I register in Munich?")).toBe(true);
    expect(mentionsOtherCity("Munich or Berlin: where do I register?")).toBe(false);
    expect(ask("How do I register in Hamburg?").kind).toBe("abstain");
  });

  it("refuses judgements about the person's own case", () => {
    expect(classifyRefusal("Am I eligible for the residence permit?")).toBe("eligibility");
    expect(classifyRefusal("What are my chances of approval?")).toBe("eligibility");
    expect(classifyRefusal("Will LEA approve my application?")).toBe("prediction");
    expect(classifyRefusal("Will I be deported if I miss the deadline?")).toBe("legal_outcome");
    expect(classifyRefusal("Is it legal to work on a student visa?")).toBe("legal_outcome");
  });

  it("does not refuse plain rule lookups", () => {
    expect(classifyRefusal("Who is eligible for a Fiktionsbescheinigung?")).toBeNull();
    expect(classifyRefusal("What documents does the permit need?")).toBeNull();
  });

  it("a refusal points to the offices that can decide", () => {
    const r = ask("Will LEA approve my application?");
    expect(r.kind).toBe("refuse");
    if (r.kind === "refuse") expect(r.pointers.length).toBeGreaterThan(0);
  });
});

describe("corpus integrity", () => {
  it("every passage points at a real source and has a locator", () => {
    expect(validateCorpus(berlinCorpus, berlinPack)).toEqual([]);
    for (const p of berlinCorpus.passages) expect(p.locator.length).toBeGreaterThan(0);
  });

  it("rejects a passage with an unknown source", () => {
    const bad = JSON.parse(JSON.stringify(berlinCorpus));
    bad.passages[0].sourceId = "S999";
    expect(() => loadCorpus(bad)).toThrow(/unknown source/);
  });

  it("no passage is labelled verbatim unless it is an exact quote", () => {
    expect(berlinCorpus.passages.filter((p) => p.textKind === "verbatim")).toEqual([]);
  });
});

describe("text", () => {
  it("folds accents and splits German compounds", () => {
    expect(tokenize("Wohnungsgeberbestätigung")).toEqual(expect.arrayContaining(["landlord"]));
    expect(tokenize("Meldebescheinigung and fees")).toContain("fee");
  });
});
