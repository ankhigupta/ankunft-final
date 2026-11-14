/**
 * The example questions shown as chips on the Ask page. The UI and the tests read this one list,
 * so every chip a person can click is checked against its expected outcome.
 */
export type ExampleQuestion =
  | { q: string; expect: "answer"; passages: string[] }
  | { q: string; expect: "refuse" };

export const EXAMPLE_QUESTIONS: ExampleQuestion[] = [
  { q: "How many days do I have to register my address?", expect: "answer", passages: ["P001", "P008"] },
  { q: "What does the landlord's confirmation have to contain?", expect: "answer", passages: ["P005"] },
  { q: "What documents does the study residence permit need?", expect: "answer", passages: ["P014", "P015"] },
  { q: "How much money do I need to show?", expect: "answer", passages: ["P045", "P050"] },
  { q: "Will the immigration office approve my application?", expect: "refuse" },
];
