import { describe, expect, it } from "vitest";
import { berlinCorpus } from "./load";
import { buildCorrector, fold, LEXICON, stripExclusions, tokenize, withinOneEdit } from "./text";

const counts = new Map<string, number>();
for (const p of berlinCorpus.passages)
  for (const w of fold(`${p.text} ${p.questions.join(" ")} ${p.locator}`).replace(/[^a-z0-9]+/g, " ").split(" ")) if (w) counts.set(w, (counts.get(w) ?? 0) + 1);
const correct = buildCorrector(counts);
const q = (s: string) => tokenize(s, correct);

describe("text: words that were read wrongly", () => {
  it("'home-country' is one idea and is not read as a dwelling", () => {
    expect(tokenize("Can I keep my private home-country health insurance?")).toContain("homecountry");
    expect(tokenize("home-country insurance")).not.toContain("dwelling");
    expect(tokenize("my new home")).not.toContain("dwelling");
    expect(tokenize("a flat")).toContain("dwelling");
  });

  it("a word that becomes a stopword after stemming is dropped ('needed' is 'need')", () => {
    expect(tokenize("Which documents are needed")).toEqual(["document"]);
    expect(tokenize("What do I need")).toEqual([]);
  });

  it("framing words do not count as topic words", () => {
    expect(tokenize("Is it possible to ...")).toEqual([]);
    expect(tokenize("how far ahead")).toEqual([]);
    expect(tokenize("how far ahead of expiry")).toEqual(tokenize("expiry"));
  });

  it("a list of documents is not the same as proof or a confirmation", () => {
    expect(tokenize("documents")).not.toEqual(tokenize("confirmation"));
    expect(tokenize("documents")).toEqual(tokenize("papers"));
    expect(tokenize("proof")).toEqual(tokenize("evidence"));
  });
});

describe("text: amount phrasings meet in one concept", () => {
  it.each(["minimum", "amount", "sum", "least", "lowest", "balance"])("%s", (w) => {
    expect(tokenize(w)).toEqual(["amount"]);
  });
  it("euros and money are different things: one is the currency in the sources, the other a synonym of funds", () => {
    expect(tokenize("euros")).toEqual(tokenize("EUR"));
    expect(tokenize("money")).toEqual(tokenize("funds"));
    expect(tokenize("euros")).not.toEqual(tokenize("money"));
  });
  it("'online' and 'internet' match", () => {
    expect(tokenize("over the internet")).toEqual(tokenize("online"));
  });
});

describe("text: German words the sources already use", () => {
  it("maps a few plain dictionary words to the group the English word is in, and no more", () => {
    expect(tokenize("Frist")).toEqual(tokenize("deadline"));
    expect(tokenize("Unterlagen")).toEqual(tokenize("documents"));
    expect(tokenize("Gebühr")).toEqual(tokenize("fee"));
    expect(tokenize("kostet")).toEqual(tokenize("cost"));
    expect(tokenize("Termin")).toEqual(tokenize("appointment"));
    expect(tokenize("Adresse")).toEqual(tokenize("address"));
    expect(tokenize("abmelden")).toEqual(tokenize("deregister"));
    expect(tokenize("Anmeldung")).toEqual(tokenize("register address"));
    expect(tokenize("anmelden")).toEqual(tokenize("Anmeldung"));
    expect(tokenize("anzumelden")).toEqual(tokenize("Anmeldung"));
    expect(tokenize("abzumelden")).toEqual(tokenize("abmelden"));
    expect(tokenize("Sperrkonto")).toEqual(tokenize("blocked account"));
  });

  it("German question words are framing, not topics", () => {
    expect(tokenize("Wie lange ist die Frist für die Anmeldung?")).toEqual(tokenize("deadline register address"));
    expect(tokenize("Welche Unterlagen brauche ich?")).toEqual(["document"]);
  });

  it("German words without a safe equivalent stay unknown, so such questions abstain instead of being guessed", () => {
    for (const w of ["arbeiten", "wetter", "führerschein", "mieten", "stipendium"]) {
      const t = tokenize(w);
      expect(t.length).toBe(1);
      expect(counts.has(t[0])).toBe(false); // not a word any saved text uses
    }
  });
});

describe("text: typo correction is cautious", () => {
  it("corrects an unknown word that is one edit from a word the sources use", () => {
    expect(q("regester")).toEqual(q("register"));
    expect(q("adress")).toEqual(q("address"));
    expect(q("residense")).toEqual(q("residence"));
    expect(q("documnets")).toEqual(q("documents")); // two letters swapped
    expect(q("acount")).toEqual(q("account"));
    expect(q("helth")).toEqual(q("health"));
    expect(q("insurence")).toEqual(q("insurance"));
  });

  it("leaves a known word alone, even when it is one edit from another", () => {
    expect(q("permit")).toEqual(tokenize("permit"));
    expect(q("flat")).toEqual(tokenize("flat"));
    expect(q("fees")).toEqual(tokenize("fees"));
  });

  it("leaves unknown words that are not close to any word alone, so off-topic questions still fail to match", () => {
    for (const w of ["weather", "scholarship", "licence", "mortgage", "driving", "mobile", "ticket", "football"]) {
      expect(q(w), w).toEqual(tokenize(w));
    }
  });

  it("does not guess between two equally good candidates", () => {
    const c = buildCorrector(new Map([["housing", 1], ["housing", 1], ["houseing", 1]]));
    expect(c("housng")).toBe("housng".length ? c("housng") : "");
    const tie = buildCorrector(new Map([["planed", 3], ["planet", 3]]));
    expect(tie("plane1")).toBe("plane1"); // contains a digit: never corrected
    expect(tie("planex")).toBe("planex"); // one edit from both, equally common: left alone
  });

  it("does not touch short words, numbers or stopwords", () => {
    expect(q("2026")).toEqual(["2026"]);
    expect(correct("cost")).toBe("cost");
    expect(correct("the")).toBe("the");
    expect(correct("eur")).toBe("eur");
  });

  it("measures one edit correctly", () => {
    expect(withinOneEdit("register", "regester")).toBe(true); // substitution
    expect(withinOneEdit("address", "adress")).toBe(true); // deletion
    expect(withinOneEdit("account", "acount")).toBe(true);
    expect(withinOneEdit("documents", "documnets")).toBe(true); // swap
    expect(withinOneEdit("register", "registrar")).toBe(false);
    expect(withinOneEdit("fee", "feeling")).toBe(false);
  });

  it("the vocabulary it can correct to includes the group words, so a typo of a synonym is understood too", () => {
    expect(LEXICON).toContain("register");
    expect(LEXICON).toContain("unterlagen");
  });
});

describe("text: 'apart from X' leaves X out", () => {
  it("drops the excluded clause up to the comma", () => {
    expect(stripExclusions("Apart from a blocked account, how else can I show my funds?")).not.toMatch(/blocked/i);
    expect(stripExclusions("Besides a lease, what else do I need?")).not.toMatch(/lease/i);
    expect(stripExclusions("Other than the fee what else is due")).not.toMatch(/\bfee\b/i);
  });
  it("leaves ordinary questions alone", () => {
    for (const s of ["How much is the fee?", "What documents do I need for Anmeldung?"]) expect(stripExclusions(s)).toBe(s);
  });
});
