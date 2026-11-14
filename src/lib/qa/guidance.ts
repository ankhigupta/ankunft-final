import type { Pack, Task } from "../pack/schema";
import { buildPlan, type ComputedDeadline, type InputValues, type Plan, type PlannedTask, type Status } from "../planner/engine";
import { hasProgress } from "../saved-state";
import type { GuidanceIntent } from "./intent";
import { tokenize } from "./text";

/**
 * Guidance answers "what should I do?" from the person's own entries and the research pack's rules, not from a
 * search of the saved pages. Nothing is written here: every title, summary, deadline, note and source comes from
 * the pack, and every date from the planner. If the planner cannot say, this says so.
 */

export type SourceRef = { sourceId: string; title: string; url: string };

export type GuidanceItem = {
  taskId: string;
  title: string;
  summary: string;
  status: Status | null;
  deadline: ComputedDeadline | null;
  /** The deadline this step inherits from a later step that cannot be done without it. */
  inheritedFrom: { title: string; date: string; daysLeft: number } | null;
  sources: SourceRef[];
};

export type GuidanceNote = { taskTitle: string; text: string; sources: SourceRef[] };

export type GuidanceResponse = {
  kind: "guidance";
  question: string;
  mode: "next_step" | "meanwhile";
  /** plan: built from the person's entries. pack: from the pack alone, because nothing was entered. */
  basis: "plan" | "pack";
  heading: string;
  items: GuidanceItem[];
  notes: GuidanceNote[];
  notices: string[];
};

export type Situation = { values: InputValues; done: string[] };

const MAX_ALSO = 3;

function sourceRefs(pack: Pack, ids: string[]): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const s = pack.sources.find((x) => x.id === id);
    if (s) out.push({ sourceId: s.id, title: s.title, url: s.url });
  }
  return out;
}

const taskSourceIds = (t: Task): string[] => [...t.requirements.flatMap((r) => r.sourceIds), ...t.deadline.sourceIds];

function item(pack: Pack, p: PlannedTask): GuidanceItem {
  const due = p.dueBy && p.dueBy.taskId !== p.task.id ? p.dueBy : null;
  return {
    taskId: p.task.id,
    title: p.task.title,
    summary: p.task.summary,
    status: p.status,
    deadline: p.deadline,
    inheritedFrom: due
      ? { title: pack.tasks.find((t) => t.id === due.taskId)?.title ?? due.taskId, date: due.date, daysLeft: due.daysLeft }
      : null,
    sources: sourceRefs(pack, taskSourceIds(p.task)),
  };
}

/** Date inputs the person has not entered: deadlines that depend on them cannot be computed. */
function missingDates(pack: Pack, values: InputValues): string[] {
  return pack.inputs.filter((i) => i.type === "date" && !values[i.id]).map((i) => i.label.toLowerCase());
}

const PLAN_NOTICE =
  "This comes from the details you entered and the rules in Ankunft's research pack, not from a search of the saved pages. It reports what the sources say. It is not legal advice.";

export type GuidanceOutcome = { type: "guidance"; value: GuidanceResponse } | { type: "abstain"; reason: string } | { type: "none" };

/** The step to do next, the steps that can also start now, and what is still missing from the person's entries. */
export function nextStepGuidance(question: string, pack: Pack, plan: Plan, situation: Situation): GuidanceOutcome {
  if (!plan.supported) {
    return {
      type: "abstain",
      reason:
        `${plan.unsupportedMessage ?? "Your situation is not covered yet."} ` +
        "So I cannot say what to do first without guessing. Check the Plan tab for the details.",
    };
  }
  const notices = [PLAN_NOTICE];
  const missing = missingDates(pack, situation.values);
  if (missing.length > 0) {
    notices.push(`Not entered yet: ${missing.join(", ")}. Deadlines that depend on them are not shown until you add them on the Plan tab.`);
  }
  if (plan.complete) {
    return {
      type: "guidance",
      value: {
        kind: "guidance", question, mode: "next_step", basis: "plan",
        heading: "You have marked every step Ankunft tracks as done.",
        items: [], notes: [],
        notices: [...notices, "That only reflects what you marked here. It is not a check that your paperwork is complete or accepted."],
      },
    };
  }
  if (!plan.next) {
    return {
      type: "guidance",
      value: {
        kind: "guidance", question, mode: "next_step", basis: "plan",
        heading: "Nothing is ready to start right now.",
        items: [], notes: [],
        notices: [...notices, "Every remaining step is waiting on another one. The Plan tab shows what each is waiting for."],
      },
    };
  }
  return {
    type: "guidance",
    value: {
      kind: "guidance", question, mode: "next_step", basis: "plan",
      heading: "Your next step, from your plan",
      items: [item(pack, plan.next), ...plan.alsoNow.slice(0, MAX_ALSO).map((p) => item(pack, p))],
      notes: [],
      notices,
    },
  };
}

/**
 * Which step a person is waiting for, matched on words they used ("my residence permit appointment") against
 * each step's title and summary. A match must be clear: more of the words than any other step. Otherwise no
 * step is named, because naming the wrong one would hand out the wrong notes.
 */
export function matchTask(pack: Pack, waitingFor: string): Task | null {
  const asked = new Set(tokenize(waitingFor));
  if (asked.size === 0) return null;
  const scored = pack.tasks
    .map((t) => {
      const words = new Set(tokenize(`${t.title} ${t.summary}`));
      return { t, n: [...asked].filter((w) => words.has(w)).length };
    })
    .sort((a, b) => b.n - a.n);
  if (scored[0].n === 0 || (scored[1] && scored[1].n === scored[0].n)) return null;
  return scored[0].t;
}

const MEANWHILE_LIMIT =
  "The sources I have saved do not say what else you may or may not do while you wait. If you are unsure, ask the office you are waiting for.";

export function meanwhileGuidance(
  question: string,
  pack: Pack,
  intent: Extract<GuidanceIntent, { kind: "meanwhile" }>,
  plan: Plan | null,
): GuidanceOutcome {
  const task = matchTask(pack, intent.waitingFor);
  if (!task) return { type: "none" };
  const notes: GuidanceNote[] = task.meanwhileNotes.map((n) => ({
    taskTitle: task.title,
    text: n.text,
    sources: sourceRefs(pack, n.sourceIds),
  }));
  const items =
    plan && plan.supported
      ? [...(plan.next ? [plan.next] : []), ...plan.alsoNow].filter((p) => p.task.id !== task.id).slice(0, MAX_ALSO).map((p) => item(pack, p))
      : [];
  const notices = [MEANWHILE_LIMIT];
  if (plan) notices.unshift(PLAN_NOTICE);
  if (notes.length === 0 && items.length === 0) {
    return { type: "abstain", reason: `The pack has nothing to prepare for "${task.title}" and I have no other step you can start now. ${MEANWHILE_LIMIT}` };
  }
  return {
    type: "guidance",
    value: {
      kind: "guidance", question, mode: "meanwhile", basis: plan ? "plan" : "pack",
      heading: `While you wait: ${task.title}`,
      items, notes, notices,
    },
  };
}

/**
 * Builds the plan only when the person has entered something of their own. The preselected entry type alone is not
 * that: a plan from it would say "housing first" to someone who has told us nothing.
 */
export function planFor(pack: Pack, situation: Situation | undefined, todayISO: string): Plan | null {
  if (!situation || !hasProgress(situation)) return null;
  return buildPlan({ pack, values: situation.values, done: situation.done, todayISO });
}
