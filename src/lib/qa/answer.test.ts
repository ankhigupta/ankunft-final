import { describe, expect, it } from "vitest";
import { berlinCorpus, berlinQA, loadCorpus } from "./load";
import { berlinPack } from "../pack/load";
import { asksAboutLea, asksAboutLocation, asksAboutWork, classifyLocation, classifyRefusal, leaAddressPassages, mentionsOtherCity } from "./answer";
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
    for (const q of ["What is the best exchange rate?", "How do I get a driving licence?", "What is the weather like?"])
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

describe("one distinctive word", () => {
  it("answers a full question that has one distinctive content word", () => {
    expect(ids("How much money do I need to show?")).toEqual(expect.arrayContaining(["P050"]));
    expect(ids("how much money do I need")).toEqual(expect.arrayContaining(["P050"]));
  });

  it("still abstains on a bare keyword or a short question", () => {
    for (const q of ["fee", "visa", "register", "What is the fee?", "Do I need it?", "Can I do this?"]) {
      const r = ask(q);
      expect(r.kind).toBe("abstain");
      if (r.kind === "abstain") expect(r.reason).toMatch(/too short/);
    }
  });
});

describe("topics the sources do not cover", () => {
  const abstainsWith = (q: string, re: RegExp) => {
    const r = ask(q);
    expect(r.kind).toBe("abstain");
    if (r.kind === "abstain") expect(r.reason).toMatch(re);
    expect(r).not.toHaveProperty("passages");
  };

  it("abstains on the part-time work question instead of citing unrelated passages", () => {
    for (const q of [
      "Can I work part time on a student visa?",
      "Can I do a part-time job?",
      "How many hours can I work?",
      "Can I have a job while I study?",
      "Can I take a Werkstudent job?",
    ]) {
      abstainsWith(q, /Rules on whether and how much a student may work/);
    }
    // Judgement questions are still refused before the topic guard is reached.
    expect(ask("Am I permitted to work while studying?").kind).toBe("refuse");
  });

  const NO_ADDRESS = /address, opening hours or directions/;

  it("abstains on a Bürgeramt address, opening hours and directions: none of them is in the sources", () => {
    abstainsWith("Where is the Bürgeramt?", NO_ADDRESS);
    for (const q of [
      "Where's the nearest Bürgeramt?",
      "What are the opening hours of the Bürgeramt?",
      "What is the address of the registration office?",
      "Where is the registration office?",
      "How do I get to the Bürgeramt?",
    ]) {
      abstainsWith(q, NO_ADDRESS);
    }
  });

  it("answers where the immigration office is with the address in P020, cited", () => {
    const addressPassage = berlinCorpus.passages.find((p) => p.id === "P020")!;
    const street = /Keplerstraße 2, 10589 Berlin/.exec(addressPassage.text)![0];
    for (const q of [
      "Where is the immigration office?",
      "Where is the LEA?",
      "What is the address of the immigration office?",
      "Where is the Landesamt für Einwanderung?",
    ]) {
      const r = ask(q);
      expect(r.kind, q).toBe("answer");
      if (r.kind !== "answer") continue;
      expect(r.passages.map((p) => p.citation.passageId), q).toEqual(["P020"]);
      expect(r.passages[0].text).toContain(street);
      expect(r.passages[0].citation.sourceId).toBe("S4");
      expect(r.passages[0].citation.url).toMatch(/^https:\/\//);
      expect(r.notices.some((n) => /paraphrase/i.test(n))).toBe(true);
    }
  });

  it("still abstains on hours and directions for the immigration office, which P020 does not give", () => {
    for (const q of [
      "What are the opening hours of the immigration office?",
      "How do I get to the immigration office?",
      "Directions to the LEA",
    ]) {
      abstainsWith(q, NO_ADDRESS);
    }
  });

  it("does not hand the LEA address to a question about another office or another city", () => {
    expect(asksAboutLea("Where is the Bürgeramt?")).toBe(false);
    expect(asksAboutLea("Where is the registration office of the immigration district?")).toBe(false);
    expect(asksAboutLea("Where is the immigration office?")).toBe(true);
    const r = ask("Where is the immigration office in Munich?");
    expect(r.kind === "abstain" && /only covers Berlin/.test(r.reason)).toBe(true);
  });

  it("rests on the corpus: the only street address in the saved passages is the immigration office's", () => {
    const withStreet = berlinCorpus.passages.filter((p) =>
      /\p{Lu}[\p{L}-]*(?:stra(?:ß|ss)e|str\.|allee|platz|ufer|damm|weg)\s+\d+/u.test(p.text),
    );
    expect(withStreet.map((p) => p.id)).toEqual(["P020"]);
    expect(leaAddressPassages(berlinCorpus).map((p) => p.id)).toEqual(["P020"]);
  });

  it("classifies location questions", () => {
    expect(classifyLocation("Where is the immigration office?")).toBe("address");
    expect(classifyLocation("What are the opening hours of the immigration office?")).toBe("hours_or_directions");
    expect(classifyLocation("Where can I register my address online?")).toBeNull();
  });

  it("points to the official pages for locations without inventing one", () => {
    const r = ask("Where is the Bürgeramt?");
    expect(r.kind === "abstain" && /service\.berlin\.de/.test(r.reason) && /berlin\.de\/einwanderung/.test(r.reason)).toBe(true);
  });

  it("does not catch questions the sources do answer", () => {
    expect(asksAboutLocation("Where can I register my address online?")).toBe(false);
    expect(asksAboutLocation("Where does my tax ID number come from?")).toBe(false);
    expect(asksAboutLocation("Do I need Anmeldung to get an LEA appointment?")).toBe(false);
    expect(asksAboutWork("How does the blocked account work?")).toBe(false);
    expect(asksAboutWork("How do I work out the deadline?")).toBe(false);
    expect(asksAboutWork("Can a part-time employment contract be proof of funds?")).toBe(false);
    expect(ids("Where can I register my address online?")).toContain("P010");
    expect(ids("Can a part-time employment contract be proof of funds?")).toContain("P016");
    expect(ids("Can I register at any Bürgeramt?")).toContain("P029");
  });

  it("keeps the city guard first and the refusal rules working", () => {
    const r = ask("Where is the Bürgeramt in Munich?");
    expect(r.kind === "abstain" && /only covers Berlin/.test(r.reason)).toBe(true);
    expect(ask("Is it legal to work on a student visa?").kind).toBe("refuse");
    expect(ask("Am I allowed to work in my first three months?").kind).toBe("refuse");
  });

  it("keeps source conflicts on the questions that still answer", () => {
    const r = ask("Can I apply for the residence permit before my permit or visa expires?");
    expect(r.kind === "answer" && r.conflicts.map((c) => c.id)).toContain("C-EARLIEST");
  });
});
