import { describe, expect, it } from "vitest";
import { berlinQA } from "./load";
import { EXAMPLE_QUESTIONS } from "./examples";

const TODAY = "2026-11-14";

describe("example question chips", () => {
  it("there are chips to test", () => {
    expect(EXAMPLE_QUESTIONS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(EXAMPLE_QUESTIONS.map((e) => e.q)).size).toBe(EXAMPLE_QUESTIONS.length);
  });

  describe.each(EXAMPLE_QUESTIONS)("$q", (example) => {
    const r = berlinQA(example.q, TODAY);

    it(`gets the expected outcome: ${example.expect}`, () => {
      expect(r.kind).toBe(example.expect);
    });

    if (example.expect === "answer") {
      it("cites at least one of the expected passages, each with a source and locator", () => {
        if (r.kind !== "answer") throw new Error("expected an answer");
        const got = r.passages.map((p) => p.citation.passageId);
        expect(got.some((id) => example.passages.includes(id))).toBe(true);
        for (const p of r.passages) {
          expect(p.citation.url).toMatch(/^https:\/\//);
          expect(p.citation.locator.length).toBeGreaterThan(0);
        }
      });
    } else {
      it("points to the offices that can decide", () => {
        if (r.kind !== "refuse") throw new Error("expected a refusal");
        expect(r.pointers.length).toBeGreaterThan(0);
      });
    }
  });
});
