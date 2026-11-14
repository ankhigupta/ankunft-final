import type { Expr, InputDef, Pack, Task } from "../pack/schema";
import { prettyDate } from "../format";
import { addDays, diffDays, isPlausibleDate, todayLocalISO } from "./dates";

/**
 * The planner is plain, explicit rules over the pack. No model is involved:
 * the same inputs always give the same plan, and every status can be traced
 * back to a requirement and a source.
 */

export const DUE_SOON_DAYS = 7;

export type InputValues = Partial<Record<string, string | boolean>>;

export type PlanInput = {
  pack: Pack;
  values: InputValues;
  /** Task ids the person has marked done. */
  done: string[];
  todayISO: string;
};

export type Status = "done" | "overdue" | "due_soon" | "blocked" | "ready" | "info_only";

/** One thing a requirement is waiting for. `notYet` is set when the person did enter a date but it is still in the future. */
export type Missing = { kind: "task" | "input"; id: string; label: string; notYet?: string };

/**
 * The unmet part of a requirement, with its structure kept. `all`: every part is needed. `any`: one of the
 * alternatives is enough. Flattening this loses the difference, and "A or B" would read as "A and B".
 */
export type Need =
  | { type: "item"; item: Missing }
  | { type: "all"; of: Need[] }
  | { type: "any"; of: Need[] };

export type Blocker = {
  requirementId: string;
  label: string;
  /** The unmet leaves, flattened. Prefer `need`, which says whether they are all required or alternatives. */
  missing: Missing[];
  need: Need;
};

export type ComputedDeadline = {
  date: string;
  daysLeft: number;
  /** Only statutory and authority-stated dates can make a task overdue. */
  hard: boolean;
};

/**
 * The hard (statutory or authority-stated) deadline that drives a task's urgency. It is the task's own, or the
 * earliest one inherited from a later task that cannot be done without this one. `taskId` names the task
 * the deadline belongs to; it equals the task's own id when the deadline is its own.
 */
export type DueBy = { date: string; daysLeft: number; taskId: string };

export type PlannedTask = {
  task: Task;
  /**
   * A task with an unmet requirement is always `blocked`, even past its own deadline. Its urgency is carried
   * by `deadline` and passed on to what it is waiting for through `dueBy`.
   */
  status: Status;
  blockers: Blocker[];
  deadline: ComputedDeadline | null;
  dueBy: DueBy | null;
  /** Tasks that name this one as a requirement. */
  unlocks: string[];
  /** The person marked this done, but something it depends on is not complete, so it is not counted as done. */
  doneMarkIgnored: boolean;
};

export type Plan = {
  supported: boolean;
  unsupportedMessage: string | null;
  /** The entry the pack does not cover (for example "unsure" or "visa_free"), so the screen can explain it. */
  unsupportedValue: string | null;
  /** Every tracked step is done. There is then no next step, and that is a finished plan, not a stuck one. */
  complete: boolean;
  tasks: PlannedTask[];
  /** The single task to do next, or null. */
  next: PlannedTask | null;
  /** Other tasks that can be started now. */
  alsoNow: PlannedTask[];
};

export function inputSatisfied(def: InputDef, value: string | boolean | undefined, todayISO: string): boolean {
  if (value === undefined || value === "" || value === null) return false;
  switch (def.satisfiedWhen) {
    case "present":
      return typeof value === "string" ? value.length > 0 : true;
    case "true":
      return value === true;
    case "reached":
      return typeof value === "string" && isPlausibleDate(value) && isPlausibleDate(todayISO) && value <= todayISO;
  }
}

function collectRefs(e: Expr, out: { task: string[]; input: string[] }) {
  if ("task" in e) out.task.push(e.task);
  else if ("input" in e) out.input.push(e.input);
  else for (const c of "allOf" in e ? e.allOf : e.anyOf) collectRefs(c, out);
}

/**
 * Tasks that must be done whatever else happens: required directly or through "all of". A task that appears
 * only in some branches of "any of" is a choice, not a requirement, so it is not listed.
 */
export function mandatoryTasks(e: Expr): string[] {
  if ("task" in e) return [e.task];
  if ("input" in e) return [];
  if ("allOf" in e) return [...new Set(e.allOf.flatMap(mandatoryTasks))];
  const branches = e.anyOf.map((c) => new Set(mandatoryTasks(c)));
  if (branches.length === 0) return [];
  return [...branches[0]].filter((id) => branches.every((b) => b.has(id)));
}

/**
 * An unmet need in words. Alternatives say that one is enough: "either A or B (one is enough)".
 * Several required parts are joined with "and".
 */
export function needText(need: Need, inside: "top" | "all" | "any" = "top"): string {
  switch (need.type) {
    case "item": {
      const m = need.item;
      return m.notYet ? `${m.label}: ${prettyDate(m.notYet)} is still in the future` : m.label;
    }
    case "all": {
      const text = need.of.map((n) => needText(n, "all")).join(" and ");
      return inside === "any" ? `(${text})` : text;
    }
    case "any": {
      const text = `either ${need.of.map((n) => needText(n, "any")).join(" or ")}`;
      return inside === "top" ? `${text} (one is enough)` : text;
    }
  }
}

/** What a blocked task is waiting for, one short text per unmet requirement, with no repeats. */
export function waitingOn(p: PlannedTask): string[] {
  return [...new Set(p.blockers.map((b) => needText(b.need)))];
}

function flattenNeed(n: Need): Missing[] {
  return n.type === "item" ? [n.item] : n.of.flatMap(flattenNeed);
}

/** A task can be marked done only if it is tracked, not done yet, and has no unmet requirement. */
export function canMarkDone(plan: Plan, taskId: string): boolean {
  const p = plan.tasks.find((t) => t.task.id === taskId);
  return Boolean(p && p.task.mode === "tracked" && p.status !== "done" && p.status !== "blocked");
}

export function computeDeadline(task: Task, values: InputValues, todayISO: string): ComputedDeadline | null {
  const d = task.deadline;
  if (d.kind === "informational" || d.kind === "none_found") return null;
  if (!d.triggerInput) return null;
  const trigger = values[d.triggerInput];
  if (typeof trigger !== "string" || !isPlausibleDate(trigger) || !isPlausibleDate(todayISO)) return null;
  const date = d.offsetDays === null ? trigger : addDays(trigger, d.offsetDays);
  return {
    date,
    daysLeft: diffDays(date, todayISO),
    hard: d.kind === "statutory" || d.kind === "authority_stated",
  };
}

export function buildPlan({ pack, values: valuesInput, done: doneInput, todayISO: todayInput }: PlanInput): Plan {
  // A date outside the accepted range, or one that does not exist, is treated as missing and never computed with.
  const todayISO = isPlausibleDate(todayInput) ? todayInput : todayLocalISO();
  // Malformed input (for example from damaged saved data) must degrade to "nothing entered", not throw.
  const values: InputValues = valuesInput && typeof valuesInput === "object" && !Array.isArray(valuesInput) ? valuesInput : {};
  const done = Array.isArray(doneInput) ? doneInput : [];
  const inputDefs = new Map(pack.inputs.map((i) => [i.id, i]));
  const byId = new Map(pack.tasks.map((t) => [t.id, t]));
  const doneSet = new Set(done);

  for (const s of pack.supportedWhen) {
    const v = values[s.input];
    if (typeof v === "string" && v !== "" && !s.oneOf.includes(v)) {
      return { supported: false, unsupportedMessage: s.unsupportedMessage, unsupportedValue: v, complete: false, tasks: [], next: null, alsoNow: [] };
    }
  }

  const isInputOk = (id: string) => {
    const def = inputDefs.get(id);
    return def ? inputSatisfied(def, values[id], todayISO) : false;
  };

  // A task counts as done only when it is marked done (or its own input says so) AND everything it depends on is
  // done. A stale mark, for example "Anmeldung" ticked and then the move-in date cleared, is ignored until the
  // prerequisites are back, and nothing here depends on the screen to enforce it.
  const marked = (t: Task): boolean =>
    t.mode === "tracked" && (doneSet.has(t.id) || (t.completedWhenInput ? isInputOk(t.completedWhenInput) : false));
  const requirementMet = (e: Expr): boolean => {
    if ("task" in e) {
      const t = byId.get(e.task);
      return t ? taskDone(t) : false;
    }
    if ("input" in e) return isInputOk(e.input);
    if ("allOf" in e) return e.allOf.every(requirementMet);
    return e.anyOf.some(requirementMet);
  };
  const doneMemo = new Map<string, boolean>();
  const visiting = new Set<string>();
  function taskDone(t: Task): boolean {
    if (t.mode === "info_only") return false;
    const cached = doneMemo.get(t.id);
    if (cached !== undefined) return cached;
    if (visiting.has(t.id)) return false; // a cycle is a pack error; never loop on it
    visiting.add(t.id);
    const ok = marked(t) && t.requirements.every((r) => requirementMet(r.expr));
    visiting.delete(t.id);
    doneMemo.set(t.id, ok);
    return ok;
  }

  /** The input is entered with a real date that has simply not arrived yet. */
  const notYetDate = (def: InputDef | undefined, id: string): string | undefined => {
    const v = values[id];
    return def?.satisfiedWhen === "reached" && typeof v === "string" && isPlausibleDate(v) && v > todayISO ? v : undefined;
  };

  // What is still unmet in an expression, keeping "all of" and "any of" apart. null means it is met.
  const needOf = (e: Expr): Need | null => {
    if ("task" in e) {
      if (requirementMet(e)) return null;
      return { type: "item", item: { kind: "task", id: e.task, label: byId.get(e.task)?.title ?? e.task } };
    }
    if ("input" in e) {
      if (requirementMet(e)) return null;
      const def = inputDefs.get(e.input);
      const notYet = notYetDate(def, e.input);
      return { type: "item", item: { kind: "input", id: e.input, label: def?.label ?? e.input, ...(notYet ? { notYet } : {}) } };
    }
    if ("allOf" in e) {
      const unmet = e.allOf.map(needOf).filter((n): n is Need => n !== null);
      if (unmet.length === 0) return null;
      return unmet.length === 1 ? unmet[0] : { type: "all", of: unmet };
    }
    const branches = e.anyOf.map(needOf);
    if (branches.some((b) => b === null)) return null; // one alternative is met, which is enough
    const unmet = branches as Need[];
    return unmet.length === 1 ? unmet[0] : { type: "any", of: unmet };
  };

  const unlocks = new Map<string, string[]>();
  for (const t of pack.tasks) {
    const refs = { task: [] as string[], input: [] as string[] };
    for (const r of t.requirements) collectRefs(r.expr, refs);
    for (const dep of new Set(refs.task)) unlocks.set(dep, [...(unlocks.get(dep) ?? []), t.id]);
  }

  // Urgency travels backwards along mandatory prerequisites: if Anmeldung must happen by a legal date and cannot
  // happen before the landlord's confirmation, the confirmation is as urgent as Anmeldung.
  const own = new Map<string, DueBy>();
  for (const task of pack.tasks) {
    const d = computeDeadline(task, values, todayISO);
    if (d?.hard && task.mode === "tracked" && !taskDone(task)) own.set(task.id, { date: d.date, daysLeft: d.daysLeft, taskId: task.id });
  }
  const inherited = new Map<string, DueBy>();
  const pass = (task: Task, due: DueBy, seen: Set<string>) => {
    for (const r of task.requirements) {
      for (const depId of mandatoryTasks(r.expr)) {
        const dep = byId.get(depId);
        if (!dep || dep.mode !== "tracked" || taskDone(dep) || seen.has(depId)) continue;
        const cur = inherited.get(depId);
        if (!cur || due.date < cur.date) inherited.set(depId, due);
        pass(dep, due, new Set([...seen, depId]));
      }
    }
  };
  for (const [id, due] of own) pass(byId.get(id)!, due, new Set([id]));
  const earliest = (a: DueBy | undefined, b: DueBy | undefined): DueBy | null => (a && b ? (b.date < a.date ? b : a) : (a ?? b ?? null));

  const tasks: PlannedTask[] = pack.tasks.map((task) => {
    const deadline = computeDeadline(task, values, todayISO);
    const blockers: Blocker[] = [];
    if (task.mode === "tracked" && !taskDone(task)) {
      for (const r of task.requirements) {
        const need = needOf(r.expr);
        if (need) blockers.push({ requirementId: r.id, label: r.label, missing: flattenNeed(need), need });
      }
    }
    const dueBy = earliest(own.get(task.id), inherited.get(task.id));

    // Blocked comes before any deadline state, so a task that cannot be done is never shown as doable.
    // Overdue and due soon are then read the same way, from the same hard deadline.
    let status: Status;
    if (task.mode === "info_only") status = "info_only";
    else if (taskDone(task)) status = "done";
    else if (blockers.length) status = "blocked";
    else if (dueBy && dueBy.daysLeft < 0) status = "overdue";
    else if (dueBy && dueBy.daysLeft <= DUE_SOON_DAYS) status = "due_soon";
    else status = "ready";

    const doneMarkIgnored = task.mode === "tracked" && doneSet.has(task.id) && !taskDone(task) && blockers.length > 0;
    return { task, status, blockers, deadline, dueBy, unlocks: unlocks.get(task.id) ?? [], doneMarkIgnored };
  });

  // Next action: overdue first, then due soon, then ready; ties by earliest date, then pack order.
  const rank: Record<Status, number> = { overdue: 0, due_soon: 1, ready: 2, blocked: 9, done: 9, info_only: 9 };
  const order = new Map(pack.tasks.map((t, i) => [t.id, i]));
  const when = (p: PlannedTask) => p.dueBy?.date ?? p.deadline?.date ?? "9999";
  const actionable = tasks
    .filter((p) => p.status === "overdue" || p.status === "due_soon" || p.status === "ready")
    .sort((a, b) => rank[a.status] - rank[b.status] || when(a).localeCompare(when(b)) || order.get(a.task.id)! - order.get(b.task.id)!);

  const tracked = tasks.filter((p) => p.task.mode === "tracked");
  return {
    supported: true,
    unsupportedMessage: null,
    unsupportedValue: null,
    complete: tracked.length > 0 && tracked.every((p) => p.status === "done"),
    tasks,
    next: actionable[0] ?? null,
    alsoNow: actionable.slice(1),
  };
}
