import { describe, expect, it } from "vitest";
import { askReducer, describeFailure, initialAskState, shouldSend, type AskAction, type AskState } from "./ask-state";
import type { QAResponse } from "./qa/answer";

const answer = (question: string): QAResponse => ({ kind: "abstain", question, reason: "x" });
const run = (actions: AskAction[], from: AskState = initialAskState) => actions.reduce(askReducer, from);

describe("Ask state: a new question never shows the old answer", () => {
  it("editing the box after an answer hides the answer", () => {
    const shown = run([
      { type: "submit", text: "first question", requestId: 1 },
      { type: "success", requestId: 1, result: answer("first question") },
    ]);
    expect(shown.phase).toBe("done");
    expect(shown.result).not.toBeNull();
    const typing = askReducer(shown, { type: "edit", text: "first question, and" });
    expect(typing.result).toBeNull();
    expect(typing.error).toBeNull();
    expect(typing.phase).toBe("idle");
    expect(typing.text).toBe("first question, and");
  });

  it("an error is hidden the same way", () => {
    const failed = run([
      { type: "submit", text: "q", requestId: 1 },
      { type: "failure", requestId: 1, message: "boom" },
    ]);
    expect(failed.error).toBe("boom");
    expect(askReducer(failed, { type: "edit", text: "qq" }).error).toBeNull();
  });

  it("typing the same question again (a trailing space) does not discard what is shown", () => {
    const shown = run([
      { type: "submit", text: "q", requestId: 1 },
      { type: "success", requestId: 1, result: answer("q") },
    ]);
    expect(askReducer(shown, { type: "edit", text: "q " }).result).not.toBeNull();
  });

  it("submitting clears the previous result straight away, before the new one arrives", () => {
    const shown = run([
      { type: "submit", text: "one", requestId: 1 },
      { type: "success", requestId: 1, result: answer("one") },
    ]);
    const next = askReducer(shown, { type: "submit", text: "two", requestId: 2 });
    expect(next.phase).toBe("loading");
    expect(next.result).toBeNull();
    expect(next.asked).toBe("two");
  });
});

describe("Ask state: requests cannot overwrite each other", () => {
  it("a slow answer to an earlier question is dropped when a newer one was asked", () => {
    const s = run([
      { type: "submit", text: "slow", requestId: 1 },
      { type: "submit", text: "fast", requestId: 2 },
      { type: "success", requestId: 2, result: answer("fast") },
      { type: "success", requestId: 1, result: answer("slow") }, // arrives last
    ]);
    expect(s.phase).toBe("done");
    expect(s.result?.question).toBe("fast");
  });

  it("an early answer to the old question is dropped while the new one is still loading", () => {
    const s = run([
      { type: "submit", text: "slow", requestId: 1 },
      { type: "submit", text: "fast", requestId: 2 },
      { type: "success", requestId: 1, result: answer("slow") },
    ]);
    expect(s.phase).toBe("loading");
    expect(s.result).toBeNull();
  });

  it("an old failure cannot replace a newer result either", () => {
    const s = run([
      { type: "submit", text: "a", requestId: 1 },
      { type: "submit", text: "b", requestId: 2 },
      { type: "success", requestId: 2, result: answer("b") },
      { type: "failure", requestId: 1, message: "late error" },
    ]);
    expect(s.result?.question).toBe("b");
    expect(s.error).toBeNull();
  });

  it("a response for a request abandoned by editing the box is dropped", () => {
    const s = run([
      { type: "submit", text: "question", requestId: 1 },
      { type: "edit", text: "something else" },
      { type: "success", requestId: 1, result: answer("question") },
    ]);
    expect(s.phase).toBe("idle");
    expect(s.result).toBeNull();
  });

  it("a response that arrives when nothing is loading is dropped", () => {
    expect(askReducer(initialAskState, { type: "success", requestId: 0, result: answer("x") })).toEqual(initialAskState);
  });
});

describe("Ask state: repeated submissions", () => {
  it("the same question is not sent twice while it is loading", () => {
    const loading = askReducer(initialAskState, { type: "submit", text: "q", requestId: 1 });
    expect(shouldSend(loading, "q")).toBe(false);
    expect(shouldSend(loading, "  q  ")).toBe(false);
    expect(askReducer(loading, { type: "submit", text: "q", requestId: 2 })).toBe(loading);
  });

  it("a different question replaces the one in flight", () => {
    const loading = askReducer(initialAskState, { type: "submit", text: "q", requestId: 1 });
    expect(shouldSend(loading, "another")).toBe(true);
    expect(askReducer(loading, { type: "submit", text: "another", requestId: 2 }).requestId).toBe(2);
  });

  it("an empty question is never sent, and the same question can be asked again once it has finished", () => {
    expect(shouldSend(initialAskState, "   ")).toBe(false);
    const done = run([
      { type: "submit", text: "q", requestId: 1 },
      { type: "success", requestId: 1, result: answer("q") },
    ]);
    expect(shouldSend(done, "q")).toBe(true);
  });
});

describe("Ask state: errors are friendly", () => {
  it("never shows a browser's own message", () => {
    const messages = [
      describeFailure({ network: true }),
      describeFailure({ status: 500 }),
      describeFailure({ status: 502, body: "<html>Bad gateway</html>" }),
      describeFailure({ status: 429 }),
      describeFailure({ status: 400 }),
      describeFailure({ status: 400, body: { error: "x".repeat(500) } }),
      describeFailure({ status: 400, body: null }),
    ];
    for (const m of messages) {
      expect(m).not.toMatch(/failed to fetch|unexpected token|networkerror|json|undefined|<html/i);
      expect(m.length).toBeGreaterThan(10);
    }
  });

  it("passes on the API's own short, written-for-people 400 message", () => {
    expect(describeFailure({ status: 400, body: { error: "Keep it under 500 characters." } })).toBe("Keep it under 500 characters.");
  });

  it("tells a lost connection from a problem on our side", () => {
    expect(describeFailure({ network: true })).toMatch(/connection/);
    expect(describeFailure({ status: 500 })).toMatch(/our side/);
  });
});
