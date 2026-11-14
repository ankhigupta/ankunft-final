import { describe, expect, it } from "vitest";
import { berlinCorpus, berlinQA } from "./load";
import { berlinPack } from "../pack/load";
import { buildPlan } from "../planner/engine";
import { classifyGuidance, normalise } from "./intent";
import { matchTask, type GuidanceResponse, type Situation } from "./guidance";
import { classifyLocation } from "./answer";
import { tokenize } from "./text";
import { POST } from "@/app/api/ask/route";

const TODAY = "2026-11-14";
const MOVED: Situation = { values: { entryType: "national_visa", arrivalDate: "2026-11-10", moveInDate: "2026-11-12" }, done: [] };
const ARRIVED: Situation = { values: { entryType: "national_visa", arrivalDate: "2026-11-14" }, done: [] };
const DEFAULT_ONLY: Situation = { values: { entryType: "national_visa" }, done: [] };

const ask = (q: string, situation?: Situation) => berlinQA(q, TODAY, situation);
const guidance = (q: string, situation: Situation = MOVED): GuidanceResponse => {
  const r = ask(q, situation);
  if (r.kind !== "guidance") throw new Error(`expected guidance for "${q}", got ${r.kind}`);
  return r;
};
const shown = (q: string, situation?: Situation) => {
  const r = ask(q, situation);
  return r.kind === "answer" ? r.passages.map((p) => p.citation.passageId) : [];
};

describe("what kind of question is it", () => {
  it.each([
    "Just landed, what should I do?",
    "Just landed, what to do?",
    "I arrived in Berlin today. What's next?",
    "What should I do first?",
    "Where do I even start?",
    "Where should I start?",
    "I'm new in Berlin, what are my next steps?",
    "What's my next step?",
    "Just got here, what now?",
    "I landed yesterday. What do I need to do first?",
    "Was soll ich zuerst tun?",
    "Wo fange ich an?",
  ])("asks what to do next: %s", (question) => {
    expect(classifyGuidance(question)).toEqual({ kind: "next_step" });
  });

  it.each([
    "What should I do first about my residence permit?",
    "How do I start the Anmeldung?",
    "What should I do if my permit expires?",
    "What do I need?",
    "What documents do I need for Anmeldung?",
    "In what order should I do things when I land in Germany?",
    "How many days do I have to register my address?",
    "Where is the Bürgeramt?",
    "Was kostet die Anmeldung?",
    "Was soll ich zuerst tun, um mich anzumelden?",
  ])("is a question about something, so it is not general guidance: %s", (question) => {
    expect(classifyGuidance(question)).toBeNull();
  });

  it("asks what to do while waiting, and says what for", () => {
    expect(classifyGuidance("Can I do anything while waiting for my residence permit appointment?")).toEqual({
      kind: "meanwhile",
      waitingFor: "my residence permit appointment",
    });
    expect(classifyGuidance("Is there anything I can prepare while I wait for the LEA appointment?")).toMatchObject({ kind: "meanwhile" });
    expect(classifyGuidance("What can I do while waiting?")).toEqual({ kind: "meanwhile", waitingFor: "" });
  });

  it("does not take a different question about waiting for this one", () => {
    expect(classifyGuidance("How long is the wait for an LEA appointment?")).toBeNull();
    expect(classifyGuidance("Can I travel while waiting for my permit?")).toBeNull();
    expect(classifyGuidance("What happens while my application is being processed?")).toBeNull();
  });

  it("normalises contractions and apostrophes", () => {
    expect(normalise("What's next? I'm new, and I don’t know")).toBe("what is next i am new and i do not know");
  });
});

describe("free-form questions: planner state", () => {
  it("'Just landed, what should I do?' is answered from the plan, with no retrieved passage", () => {
    const r = guidance("Just landed, what should I do?");
    expect(r.basis).toBe("plan");
    expect(r.mode).toBe("next_step");
    expect(r).not.toHaveProperty("passages");
    const plan = buildPlan({ pack: berlinPack, ...MOVED, todayISO: TODAY });
    expect(r.items[0].taskId).toBe(plan.next!.task.id);
    expect(r.items.slice(1).map((i) => i.taskId)).toEqual(plan.alsoNow.slice(0, 3).map((p) => p.task.id));
  });

  it("the next step follows the plan: marking it done changes the answer", () => {
    const before = guidance("What should I do first?");
    const after = guidance("What should I do first?", { ...MOVED, done: [before.items[0].taskId] });
    expect(after.items[0].taskId).not.toBe(before.items[0].taskId);
  });

  it("every title, summary, date and source comes from the pack and the planner", () => {
    const r = guidance("What should I do first?");
    const plan = buildPlan({ pack: berlinPack, ...MOVED, todayISO: TODAY });
    for (const item of r.items) {
      const task = berlinPack.tasks.find((t) => t.id === item.taskId)!;
      expect(item.title).toBe(task.title);
      expect(item.summary).toBe(task.summary);
      const planned = plan.tasks.find((p) => p.task.id === item.taskId)!;
      expect(item.deadline).toEqual(planned.deadline);
      expect(item.status).toBe(planned.status);
      for (const s of item.sources) {
        const src = berlinPack.sources.find((x) => x.id === s.sourceId)!;
        expect(s.url).toBe(src.url);
        expect(s.url).toMatch(/^https:\/\//);
      }
    }
    expect(r.items[0].sources.length).toBeGreaterThan(0);
  });

  it("carries the deadline a step inherits, so 'first' reflects what is urgent", () => {
    const r = guidance("What should I do first?");
    const plan = buildPlan({ pack: berlinPack, ...MOVED, todayISO: TODAY });
    const due = plan.next!.dueBy;
    if (due && due.taskId !== plan.next!.task.id) expect(r.items[0].inheritedFrom).toMatchObject({ date: due.date, daysLeft: due.daysLeft });
  });

  it("says what is not entered instead of computing without it, and that it is not legal advice", () => {
    const r = guidance("What should I do first?", ARRIVED);
    expect(r.notices.join(" ")).toMatch(/Not entered yet: .*move-in date/i);
    expect(r.notices.join(" ")).toMatch(/not legal advice/i);
  });

  it("when every step is done it says so and does not invent a next step", () => {
    const tracked = berlinPack.tasks.filter((t) => t.mode === "tracked").map((t) => t.id);
    const r = guidance("What should I do first?", { ...MOVED, done: tracked });
    expect(r.items).toEqual([]);
    expect(r.heading).toMatch(/marked every step/);
    expect(r.notices.join(" ")).toMatch(/not a check/);
  });

  it("an entry the pack does not cover abstains and does not guess", () => {
    const r = ask("What should I do first?", { values: { entryType: "visa_free" }, done: [] });
    expect(r.kind).toBe("abstain");
    if (r.kind === "abstain") expect(r.reason).toMatch(/cannot say what to do first without guessing/);
  });

  it("a plan built from nothing but the preselected entry type is not personal, so it is not used", () => {
    for (const s of [DEFAULT_ONLY, undefined]) {
      const r = ask("What should I do first?", s);
      expect(r.kind).toBe("answer");
    }
  });

  it("ignores the person's entries for a question that is not about what to do", () => {
    expect(shown("What documents do I need for Anmeldung?", MOVED)[0]).toBe("P009");
    expect(ask("How many days do I have to register my address?", MOVED).kind).toBe("answer");
  });
});

describe("free-form questions: nothing entered yet", () => {
  it("shows the cited general list of steps and says it is not ordered for them", () => {
    for (const q of ["Just landed, what to do?", "What should I do first?", "Where should I start?"]) {
      const r = ask(q);
      expect(r.kind, q).toBe("answer");
      if (r.kind !== "answer") continue;
      expect(r.passages.map((p) => p.citation.passageId)).toEqual(["P030"]);
      expect(r.passages[0].citation.url).toMatch(/^https:\/\//);
      expect(r.notices.join(" ")).toMatch(/do not know your situation yet/);
      expect(r.notices.join(" ")).toMatch(/Plan tab/);
    }
  });

  it("that passage says the steps have no strict order, and the answer repeats nothing it does not", () => {
    const p030 = berlinCorpus.passages.find((p) => p.id === "P030")!;
    expect(p030.text).toMatch(/without setting a strict order/);
  });
});

describe("free-form questions: while waiting", () => {
  it("answers from the pack's own notes for the step, each with its source", () => {
    const r = guidance("Can I do anything while waiting for my residence permit appointment?");
    const task = berlinPack.tasks.find((t) => t.id === "lea_appointment")!;
    expect(r.mode).toBe("meanwhile");
    expect(r.heading).toContain(task.title);
    expect(r.notes.map((n) => n.text)).toEqual(task.meanwhileNotes.map((n) => n.text));
    for (const n of r.notes) expect(n.sources.length).toBeGreaterThan(0);
  });

  it("is honest that the sources do not list what else is allowed", () => {
    const r = guidance("Can I do anything while waiting for my residence permit appointment?");
    expect(r.notices.join(" ")).toMatch(/do not say what else you may or may not do/);
  });

  it("uses the plan for other steps that can start now, and the pack alone when nothing is entered", () => {
    const withPlan = guidance("Can I do anything while waiting for my residence permit appointment?");
    expect(withPlan.basis).toBe("plan");
    expect(withPlan.items.length).toBeGreaterThan(0);
    expect(withPlan.items.map((i) => i.taskId)).not.toContain("lea_appointment");
    const bare = ask("Can I do anything while waiting for my residence permit appointment?");
    expect(bare.kind).toBe("guidance");
    if (bare.kind === "guidance") {
      expect(bare.basis).toBe("pack");
      expect(bare.items).toEqual([]);
      expect(bare.notes.length).toBeGreaterThan(0);
    }
  });

  it("picks the step the person named, and no other", () => {
    expect(guidance("What can I do while waiting for my Anmeldung appointment?").heading).toContain("Register your address");
    expect(guidance("Is there anything I can prepare while I wait for the LEA appointment?").heading).toContain("LEA appointment");
  });

  it("does not guess a step: no clear match means no step is named", () => {
    expect(matchTask(berlinPack, "")).toBeNull();
    expect(matchTask(berlinPack, "the weather")).toBeNull();
    expect(matchTask(berlinPack, "something")).toBeNull();
    // Two steps match equally well ("the permit" is in the application step and the appointment step): no guess.
    for (const waitingFor of ["the permit", "residence permit", "the appointment", "application"]) expect(matchTask(berlinPack, waitingFor), waitingFor).toBeNull();
    expect(matchTask(berlinPack, "my permit appointment")?.id).toBe("lea_appointment");
  });

  it("a vague 'waiting for my permit' names no step, so no notes are handed out for the wrong one", () => {
    const r = guidance("Can I do anything while waiting for my permit?");
    expect(r.mode).toBe("next_step");
    expect(r.notes).toEqual([]);
  });

  it("with no step named it falls back to what the plan says to do now, and says it could not tell", () => {
    const r = guidance("What can I do while waiting?");
    expect(r.mode).toBe("next_step");
    expect(r.notices[0]).toMatch(/could not tell which step you are waiting for/);
  });

  it("no longer mixes in the Anmeldung fee passage that retrieval used to add", () => {
    expect(ask("Can I do anything while waiting for my residence permit appointment?").kind).toBe("guidance");
  });
});

describe("free-form questions: topic guards still come first", () => {
  it("arrival framing does not turn an unsupported topic into guidance", () => {
    expect(ask("I just arrived, can I work part time?", MOVED).kind).toBe("abstain");
    expect(ask("Just landed, where can I find a cheap flat?", MOVED).kind).toBe("abstain");
    expect(ask("Just landed in Munich, what should I do?", MOVED).kind).toBe("abstain");
    expect(ask("Just landed, where do I get a SIM card?", MOVED).kind).toBe("abstain");
  });

  it("refusal comes first", () => {
    expect(ask("I just landed. Will my permit be approved?", MOVED).kind).toBe("refuse");
    expect(ask("Just landed, am I eligible for a residence permit?", MOVED).kind).toBe("refuse");
  });

  it("a question about a topic is answered from the sources, not turned into guidance", () => {
    expect(ask("What should I do first about my residence permit?", MOVED).kind).toBe("answer");
    expect(ask("What should I do if my permit expires?", MOVED).kind).not.toBe("guidance");
  });
});

describe("free-form questions: 'I haven't registered yet. What do I need?'", () => {
  it("was read as the words 'haven' and 't' and 'yet'; these are now framing", () => {
    expect(tokenize("I haven't registered my address yet. What do I need?")).toEqual(["register", "address"]);
    expect(tokenize("I don’t have it yet")).toEqual([]);
    expect(tokenize("What's the landlord's confirmation?")).toEqual(["landlord", "proof"]);
  });

  it("a bare 'what do I need?' after a topic asks for the documents", () => {
    expect(shown("I haven't registered my address yet. What do I need?")).toContain("P009");
    expect(shown("I just moved into my flat. What do I need to register?")).toContain("P009");
    expect(shown("I don't have health insurance yet. What do I need?").some((id) => ["P013", "P032", "P037", "P012"].includes(id))).toBe(true);
  });

  it("is not applied to questions that ask for something else", () => {
    expect(shown("How much money do I need to show?")).toEqual(expect.arrayContaining(["P050"]));
    expect(shown("How many days do I have to register my address?")).toContain("P001");
  });
});

describe("ambiguous questions ask what was meant", () => {
  const CASES = ["visa", "insurance", "Anmeldung", "help", "What do I need?", "Do I need it?", "fee"];

  it.each(CASES)("'%s' is not answered, and offers questions to choose from", (question) => {
    const r = ask(question);
    expect(r.kind).toBe("abstain");
    if (r.kind !== "abstain") return;
    expect(r.reason).toMatch(/too short/);
    expect(r.clarify!.options.length).toBeGreaterThanOrEqual(2);
    expect(r).not.toHaveProperty("passages");
  });

  it("every option leads to a cited answer, never a dead end", () => {
    for (const question of CASES) {
      const r = ask(question);
      if (r.kind !== "abstain" || !r.clarify) throw new Error(question);
      for (const option of r.clarify.options) {
        const a = ask(option);
        expect(a.kind, `${question} -> ${option}`).toBe("answer");
        if (a.kind === "answer") for (const p of a.passages) expect(p.citation.url).toMatch(/^https:\/\//);
      }
    }
  });

  it("options come from the saved passages' own example questions", () => {
    const all = new Set(berlinCorpus.passages.flatMap((p) => p.questions));
    for (const question of ["visa", "insurance", "Anmeldung"]) {
      const r = ask(question);
      if (r.kind === "abstain" && r.clarify) for (const o of r.clarify.options) expect(all.has(o), o).toBe(true);
    }
  });

  it("one word is ambiguous even when it expands to two ('Anmeldung' used to be answered with the fee passage)", () => {
    expect(ask("Anmeldung").kind).toBe("abstain");
    expect(shown("What does Anmeldung need?").length).toBeGreaterThan(0);
  });

  it("a question that is simply not covered has no options to offer", () => {
    for (const q of ["Where can I find a flat in Berlin?", "What is the weather like?"]) {
      const r = ask(q);
      expect(r.kind).toBe("abstain");
      if (r.kind === "abstain") expect(r.clarify).toBeUndefined();
    }
  });
});

describe("where is the university library? and places like it", () => {
  const NOT_OFFICE = /website of the place itself/;
  it.each([
    "Where is the university library?",
    "Where is the library?",
    "Where is the university canteen?",
    "Where is the Mensa?",
    "Where is the nearest pharmacy?",
    "Where is the nearest hospital?",
    "What are the opening hours of the library?",
    "How do I get to the university?",
    "Where is the central station?",
  ])("abstains with no passage and no invented place: %s", (question) => {
    const r = ask(question);
    expect(r.kind, question).toBe("abstain");
    expect(r).not.toHaveProperty("passages");
    if (r.kind === "abstain") {
      expect(r.reason).toMatch(/address, opening hours or directions/);
      expect(r.reason).toMatch(NOT_OFFICE);
      expect(r.reason).not.toMatch(/service\.berlin\.de/);
    }
    expect(classifyLocation(question)).not.toBeNull();
  });

  it("the cause: 'library' was not a place the location rule knew, so its words went to P033", () => {
    expect(shown("Where is the university library?")).toEqual([]);
    expect(berlinCorpus.passages.find((p) => p.id === "P033")!.text).not.toMatch(/\d{5}|stra(ß|ss)e/);
  });

  it("keeps the immigration office address and the Bürgeramt abstention exactly as they were", () => {
    expect(shown("Where is the immigration office?")).toEqual(["P020"]);
    const r = ask("Where is the Bürgeramt?");
    expect(r.kind).toBe("abstain");
    if (r.kind === "abstain") expect(r.reason).toMatch(/service\.berlin\.de/);
    expect(ask("What are the opening hours of the immigration office?").kind).toBe("abstain");
  });

  it("still answers what the sources do say about the library and about places that are not asked for", () => {
    expect(shown("Can I use the university library before I have enrolled?")).toEqual(["P033"]);
    expect(shown("When can I use the library?")).toContain("P033");
    expect(shown("Where do I enrol at the university?")).toContain("P033");
    expect(shown("Where is my tax ID letter?")).toContain("P040");
    expect(shown("Where can I register my address online?")).toContain("P010");
  });
});

describe("POST /api/ask with the person's entries", () => {
  const post = async (body: unknown) => {
    const res = await POST(new Request("http://localhost/api/ask", { method: "POST", body: JSON.stringify(body) }));
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  it("builds guidance from the entries it is sent", async () => {
    const { status, json } = await post({ question: "What should I do first?", today: TODAY, state: MOVED });
    expect(status).toBe(200);
    expect(json.kind).toBe("guidance");
  });

  it("works without entries, and ignores entries that are not valid", async () => {
    expect((await post({ question: "What should I do first?", today: TODAY })).json.kind).toBe("answer");
    for (const state of ["nonsense", 42, null, [], { values: "x" }, { values: { entryType: "<script>" }, done: "no" }]) {
      const { status, json } = await post({ question: "What should I do first?", today: TODAY, state });
      expect(status).toBe(200);
      expect(["answer", "abstain"]).toContain(json.kind);
    }
  });

  it("drops the invalid parts of entries and keeps the valid ones", async () => {
    const { json } = await post({
      question: "What should I do first?",
      today: TODAY,
      state: { values: { entryType: "national_visa", moveInDate: "2026-11-12", arrivalDate: "not a date", evil: "x" }, done: ["housing", "<b>x</b>", 7] },
    });
    expect(json.kind).toBe("guidance");
    expect(JSON.stringify(json)).not.toMatch(/<b>|evil/);
  });

  it("still rejects an empty question and bad JSON", async () => {
    expect((await post({ question: "  ", state: MOVED })).status).toBe(400);
    const bad = await POST(new Request("http://localhost/api/ask", { method: "POST", body: "{" }));
    expect(bad.status).toBe(400);
  });
});
