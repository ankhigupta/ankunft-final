import { describe, expect, it } from "vitest";
import { berlinCorpus, berlinQA } from "./load";
import { asksAboutFamily, asksAboutFundingApplication, asksAboutHousingSearch, asksForRecommendation, classifyRefusal, classifyLocation } from "./answer";

const TODAY = "2026-11-14";
const ask = (q: string) => berlinQA(q, TODAY);
const shown = (q: string) => {
  const r = ask(q);
  return r.kind === "answer" ? r.passages.map((p) => p.citation.passageId) : [];
};
const abstains = (q: string) => expect(ask(q).kind, q).toBe("abstain");

describe("1. wrong-topic answers", () => {
  it("'Where can I find a flat in Berlin?' abstains and shows no insurance or registration passage", () => {
    const r = ask("Where can I find a flat in Berlin?");
    expect(r.kind).toBe("abstain");
    expect(shown("Where can I find a flat in Berlin?")).toEqual([]);
    if (r.kind === "abstain") expect(r.reason).toMatch(/Finding or renting a flat is not covered/);
  });

  it("the cause was 'home-country' being read as a dwelling: an insurance question no longer matches housing words", () => {
    expect(shown("Can I keep my private home-country health insurance?")).toContain("P038");
    expect(shown("Where can I find a flat in Berlin?")).not.toContain("P038");
  });

  it.each([
    "How do I find a room in a shared flat?",
    "Which websites list apartments for rent?",
    "How much is the rent for a flat in Berlin?",
    "Where do I look for student accommodation?",
    "How can I find a flatmate?",
    "Where can I rent an apartment?",
    "Wo finde ich eine Wohnung in Berlin?",
    "Wo kann ich eine Wohnung mieten?",
  ])("housing search abstains: %s", (question) => {
    abstains(question);
    expect(asksAboutHousingSearch(question)).toBe(true);
  });

  it.each([
    "Do I have to find accommodation before I register?",
    "What do I get after registering my flat?",
    "Does a lease replace the landlord's confirmation?",
    "Is a rental contract enough to register my address?",
    "When do I need to register my address after moving into a flat?",
    "Can I register at an address where I do not live?",
  ])("questions the sources do answer are not caught by the housing guard: %s", (question) => {
    expect(asksAboutHousingSearch(question)).toBe(false);
    expect(ask(question).kind).toBe("answer");
  });

  it.each(["How do I apply for a scholarship?", "How do I apply for BAföG?", "How can I get a scholarship?"])("applying for funding abstains: %s", (question) => {
    abstains(question);
    expect(asksAboutFundingApplication(question)).toBe(true);
  });

  it("but a scholarship as proof of funds is answered from the sources", () => {
    expect(asksAboutFundingApplication("Can a scholarship count as proof of funds?")).toBe(false);
    expect(shown("Can a scholarship count as proof of funds?")).toEqual(expect.arrayContaining(["P046"]));
    expect(shown("What is the BAföG rate for the permit?")).toEqual(expect.arrayContaining(["P050"]));
  });

  it("family members' visas abstain, a parent's declaration for funds does not", () => {
    abstains("Can I bring my family to Germany?");
    abstains("How can my spouse join me?");
    expect(asksAboutFamily("Can I bring my family to Germany?")).toBe(true);
    expect(asksAboutFamily("Can my parents provide a declaration for my funds?")).toBe(false);
    expect(shown("Can my parents provide a declaration for my funds?")).toContain("P016");
  });

  it("work questions still abstain (first batch)", () => {
    abstains("Can I work part-time on a student visa?");
    abstains("Darf ich als Student arbeiten?");
  });

  it("valid questions behind the group changes keep their passages (g09 and friends)", () => {
    expect(shown("How much money must I have for the student residence permit?")).toEqual(expect.arrayContaining(["P050"]));
    expect(shown("Is foreign health insurance accepted for the residence permit?")).toContain("P013");
  });
});

describe("1b. 'apart from X' is about everything except X", () => {
  it("does not rank the excluded topic first", () => {
    const got = shown("Apart from a blocked account, how else can I show I can afford my studies?");
    expect(got[0]).not.toBe("P045");
    expect(got).toContain("P016");
  });
  it("the same question without the exclusion does put the blocked account first", () => {
    expect(shown("How can I show I can afford my studies with a blocked account?")[0]).toBe("P045");
  });
});

describe("2. blocked-account amount, in many phrasings", () => {
  const amount = [
    "What is the minimum amount in the blocked account for 2026?",
    "What is the minimum amount of money I need in a blocked account?",
    "How much money has to be in the blocked account?",
    "How much money must I have in a Sperrkonto?",
    "How many euros must be in my Sperrkonto?",
    "What is the least amount I need to put into a blocked account?",
    "What is the required balance of the blocked account?",
    "What sum do I need to prove for one year of studying?",
    "What amount of money do I have to prove for my living costs?",
    "How many euros per month does a student have to show?",
    "minimum blocked account 2026",
  ];
  it.each(amount)("is answered with the amount passages: %s", (question) => {
    const got = shown(question);
    expect(got.length, question).toBeGreaterThan(0);
    expect(got.some((id) => ["P045", "P050", "P012"].includes(id)), `${question} -> ${got}`).toBe(true);
  });

  it("the passages it shows carry the sources' own figure, which was not touched", () => {
    const text = berlinCorpus.passages.find((p) => p.id === "P050")!.text;
    expect(text).toContain("992 EUR");
    expect(text).toContain("11,904 EUR");
  });

  it("an unrelated question about a blocked account of another kind still abstains", () => {
    abstains("Which bank offers the best blocked account interest rate?");
  });
});

describe("3. document lists", () => {
  it("a document list for Anmeldung starts with the Anmeldung documents and not housing proof for the permit", () => {
    for (const question of [
      "Which documents are needed for Anmeldung?",
      "What documents do I need for Anmeldung?",
      "Which documents are required to register my address?",
      "What papers should I bring to register my address in person?",
    ]) {
      const got = shown(question);
      expect(got[0], question).toBe("P009");
      expect(got, question).not.toContain("P014");
    }
  });

  it("a document list for the residence permit starts with the permit documents, before the housing-proof passage", () => {
    for (const question of ["What documents does the study residence permit need?", "Which documents are needed for the study residence permit?"]) {
      const got = shown(question);
      expect(got[0], question).toBe("P015");
      expect(got.indexOf("P015")).toBeLessThan(got.includes("P014") ? got.indexOf("P014") : 99);
    }
  });

  it("the funds requirement is shown when the question asks for the documents and the money", () => {
    expect(shown("Which documents does the study residence permit need and how much money must I show?")).toContain("P050");
  });

  // Behaviour change in batch 4, on purpose: a plain "what documents does the permit need?" used to show the funds
  // figure (P050) third. Now TU Berlin's own document list for the permit (P036, titled "Documents") takes that
  // place, because a question for documents prefers passages that are document lists. P015 is still first.
  it("a plain permit-documents question shows both document lists, P015 first", () => {
    const got = shown("What documents does the study residence permit need?");
    expect(got[0]).toBe("P015");
    expect(got).toContain("P036");
  });

  it("an appointment question for Anmeldung still ranks P029 first", () => {
    expect(shown("Do I need an appointment for Anmeldung?")[0]).toBe("P029");
    expect(shown("Do I need an appointment for Anmeldung?")).toContain("P010");
    expect(shown("Do I need Anmeldung to get an LEA appointment?")[0]).toBe("P029");
  });

  it("a document and an appointment question are not confused", () => {
    expect(shown("Do I need an appointment for Anmeldung?")[0]).not.toBe("P009");
  });
});

describe("4. German and typos", () => {
  it.each([
    ["Was kostet die Anmeldung?", "P011"],
    ["Welche Unterlagen brauche ich für die Anmeldung?", "P009"],
    ["Wie lange ist die Frist für die Anmeldung?", "P001"],
    ["Brauche ich einen Termin für die Anmeldung?", "P010"],
    ["Wie viel Geld brauche ich auf dem Sperrkonto?", "P045"],
    ["Wann muss ich mich abmelden?", "P003"],
    ["Wie hoch ist die Gebühr für die Anmeldung?", "P011"],
    ["Wie viel kostet die Aufenthaltserlaubnis?", "P019"],
  ])("%s", (question, passage) => {
    expect(shown(question)).toContain(passage);
  });

  it("German questions the sources cannot answer abstain", () => {
    for (const question of ["Wie ist das Wetter in Berlin?", "Darf ich als Student arbeiten?", "Wo finde ich eine Wohnung in Berlin?", "Wie viel kostet ein Zimmer in München?", "Wie bekomme ich einen Führerschein?"]) abstains(question);
  });

  it("no translation is invented: a German question without a supported equivalent is not answered by guesswork", () => {
    abstains("Was ist ein Stipendium?");
    abstains("Wie funktioniert die Krankenkasse bei der Bank?");
  });

  it.each([
    ["how do i regester my adress in berlin", ["P009", "P010", "P011", "P001", "P008", "P031"]],
    ["What documnets do I need for the residense permit?", ["P015", "P036", "P012"]],
    ["Is health insurence required for enrolment?", ["P032", "P037", "P013"]],
    ["how much is the blocked acount?", ["P045", "P050"]],
    ["helth insurance for the permit", ["P013", "P032", "P037"]],
  ])("typos are understood: %s", (question, expected) => {
    expect(shown(question).some((id) => expected.includes(id)), question).toBe(true);
  });

  it("typos in off-topic questions do not turn them into on-topic ones", () => {
    for (const question of ["Waht is the weather in Berlin", "How do I get a drivng licence?", "How do I regester a car?", "wheather in berlin"]) abstains(question);
  });

  it("German judgement questions are refused", () => {
    expect(classifyRefusal("Werde ich abgeschoben, wenn ich mich zu spät anmelde?")).toBe("legal_outcome");
    expect(classifyRefusal("Habe ich Anspruch auf eine Aufenthaltserlaubnis?")).toBe("eligibility");
    expect(classifyRefusal("Werde ich die Aufenthaltserlaubnis bekommen?")).toBe("prediction");
    expect(ask("Habe ich Anspruch auf eine Aufenthaltserlaubnis?").kind).toBe("refuse");
  });

  it("German rule lookups are not refused", () => {
    expect(classifyRefusal("Was kostet die Anmeldung?")).toBeNull();
    expect(classifyRefusal("Welche Unterlagen brauche ich für die Anmeldung?")).toBeNull();
  });
});

describe("5. LEA address and Bürgeramt guard together", () => {
  it.each([
    "Where is the immigration office?",
    "Where is the LEA?",
    "What is the address of the immigration office?",
    "What is the address of the Landesamt für Einwanderung?",
    "Wo ist die Ausländerbehörde?",
    "Wie ist die Adresse der Ausländerbehörde?",
  ])("the LEA address is answered from P020: %s", (question) => {
    expect(shown(question)).toEqual(["P020"]);
  });

  it.each([
    "Where is the Bürgeramt?",
    "Where is the nearest Bürgeramt?",
    "What is the address of the Bürgeramt in Neukölln?",
    "What are the opening hours of the Bürgeramt?",
    "What are the opening hours of the immigration office?",
    "When is the registration office open on Saturdays?",
    "How do I get to the Bürgeramt from Alexanderplatz?",
    "How do I get to the immigration office?",
    "Wo ist das Bürgeramt?",
    "Öffnungszeiten der Ausländerbehörde",
    "Wie komme ich zum Bürgeramt?",
  ])("addresses, hours and directions that the sources lack abstain: %s", (question) => {
    abstains(question);
    expect(classifyLocation(question)).not.toBeNull();
  });

  it("questions that mention an office without asking where it is are not caught", () => {
    expect(classifyLocation("Do I need an appointment at the Bürgeramt?")).toBeNull();
    expect(classifyLocation("Can I register at any Bürgeramt?")).toBeNull();
    expect(shown("Can I register at any Bürgeramt?")).toContain("P029");
  });
});

describe("6. requests the sources cannot meet", () => {
  it.each(["What is the best bank for students?", "Which is the cheapest health insurance?", "Can you recommend a blocked account provider?", "What is the best exchange rate?"])("a request for the best or a recommendation abstains: %s", (question) => {
    abstains(question);
    expect(asksForRecommendation(question)).toBe(true);
  });

  it("'the best way to ...' is an ordinary how-question and is still answered", () => {
    expect(asksForRecommendation("What is the best way to apply for the residence permit?")).toBe(false);
    expect(ask("What is the best way to apply for the residence permit?").kind).toBe("answer");
  });

  it.each(["What time does the Bürgeramt open?", "What time does the immigration office close?", "Until when is the registration office open?"])("opening times abstain: %s", (question) => {
    abstains(question);
    expect(classifyLocation(question)).toBe("hours_or_directions");
  });

  it("an LEA address question in other words is answered, and the same words about another office abstain", () => {
    expect(shown("Where is the immigration office located?")).toEqual(["P020"]);
    expect(shown("Where does the Landesamt für Einwanderung sit?")).toEqual(["P020"]);
    abstains("Where is the Bürgeramt located?");
    abstains("Where does the registration office sit?");
  });

  it("another way to ask a prediction question is refused", () => {
    expect(ask("Will the immigration office say yes to my permit?").kind).toBe("refuse");
    expect(classifyRefusal("Will the immigration office say yes to my permit?")).toBe("prediction");
    expect(classifyRefusal("Will LEA issue my permit?")).toBe("prediction");
  });

  it("'what happens if' is framing: the question is matched on what follows", () => {
    expect(shown("What happens if the tax ID letter never arrives?")).toContain("P040");
  });
});
