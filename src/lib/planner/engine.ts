import type { Expr, InputDef, Pack, Task } from "../pack/schema";
import { addDays, diffDays, isValidISO } from "./dates";

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

export type Blocker = {
  requirementId: string;
  label: string;
  /** The unmet leaves that explain the block. */
  missing: { kind: "task" | "input"; id: string; label: string }[];
};

export type ComputedDeadline = {
  date: string;
  daysLeft: number;
  /** Only statutory and authority-stated dates can make a task overdue. */
  hard: boolean;
};

export type PlannedTask = {
  task: Task;
  status: Status;
  blockers: Blocker[];
  deadline: ComputedDeadline | null;
  /** Tasks that name this one as a requirement. */
  unlocks: string[];
};

export type Plan = {
  supported: boolean;
  unsupportedMessage: string | null;
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
      return typeof value === "string" && isValidISO(value) && value <= todayISO;
  }
}

function collectRefs(e: Expr, out: { task: string[]; input: string[] }) {
  if ("task" in e) out.task.push(e.task);
  else if ("input" in e) out.input.push(e.input);
  else for (const c of "allOf" in e ? e.allOf : e.anyOf) collectRefs(c, out);
}

export function computeDeadline(task: Task, values: InputValues, todayISO: string): ComputedDeadline | null {
  const d = task.deadline;
  if (d.kind === "informational" || d.kind === "none_found") return null;
  if (!d.triggerInput) return null;
  const trigger = values[d.triggerInput];
  if (typeof trigger !== "string" || !isValidISO(trigger)) return null;
  const date = d.offsetDays === null ? trigger : addDays(trigger, d.offsetDays);
  return {
    date,
    daysLeft: diffDays(date, todayISO),
    hard: d.kind === "statutory" || d.kind === "authority_stated",
  };
}

export function buildPlan({ pack, values, done, todayISO }: PlanInput): Plan {
  const inputDefs = new Map(pack.inputs.map((i) => [i.id, i]));
  const byId = new Map(pack.tasks.map((t) => [t.id, t]));
  const doneSet = new Set(done);

  for (const s of pack.supportedWhen) {
    const v = values[s.input];
    if (typeof v === "string" && v !== "" && !s.oneOf.includes(v)) {
      return { supported: false, unsupportedMessage: s.unsupportedMessage, tasks: [], next: null, alsoNow: [] };
    }
  }

  const isInputOk = (id: string) => {
    const def = inputDefs.get(id);
    return def ? inputSatisfied(def, values[id], todayISO) : false;
  };

  const taskDone = (t: Task): boolean => {
    if (t.mode === "info_only") return false;
    if (doneSet.has(t.id)) return true;
    return t.completedWhenInput ? isInputOk(t.completedWhenInput) : false;
  };

  // Evaluate an expression, collecting what is still missing.
  const evalExpr = (e: Expr, missing: Blocker["missing"]): boolean => {
    if ("task" in e) {
      const t = byId.get(e.task);
      const ok = t ? taskDone(t) : false;
      if (!ok) missing.push({ kind: "task", id: e.task, label: t?.title ?? e.task });
      return ok;
    }
    if ("input" in e) {
      const ok = isInputOk(e.input);
      if (!ok) missing.push({ kind: "input", id: e.input, label: inputDefs.get(e.input)?.label ?? e.input });
      return ok;
    }
    if ("allOf" in e) {
      let all = true;
      for (const c of e.allOf) if (!evalExpr(c, missing)) all = false;
      return all;
    }
    // anyOf: satisfied if one branch is; otherwise report every branch.
    const attempts = e.anyOf.map((c) => {
      const m: Blocker["missing"] = [];
      return { ok: evalExpr(c, m), m };
    });
    if (attempts.some((a) => a.ok)) return true;
    for (const a of attempts) missing.push(...a.m);
    return false;
  };

  const unlocks = new Map<string, string[]>();
  for (const t of pack.tasks) {
    const refs = { task: [] as string[], input: [] as string[] };
    for (const r of t.requirements) collectRefs(r.expr, refs);
    for (const dep of new Set(refs.task)) unlocks.set(dep, [...(unlocks.get(dep) ?? []), t.id]);
  }

  const tasks: PlannedTask[] = pack.tasks.map((task) => {
    const deadline = computeDeadline(task, values, todayISO);
    const blockers: Blocker[] = [];
    if (task.mode === "tracked" && !taskDone(task)) {
      for (const r of task.requirements) {
        const missing: Blocker["missing"] = [];
        if (!evalExpr(r.expr, missing)) blockers.push({ requirementId: r.id, label: r.label, missing });
      }
    }

    let status: Status;
    if (task.mode === "info_only") status = "info_only";
    else if (taskDone(task)) status = "done";
    else if (deadline?.hard && deadline.daysLeft < 0) status = "overdue";
    else if (blockers.length) status = "blocked";
    else if (deadline?.hard && deadline.daysLeft <= DUE_SOON_DAYS) status = "due_soon";
    else status = "ready";

    return { task, status, blockers, deadline, unlocks: unlocks.get(task.id) ?? [] };
  });

  // Next action: overdue first, then due soon, then ready; ties by earliest date, then pack order.
  const rank: Record<Status, number> = { overdue: 0, due_soon: 1, ready: 2, blocked: 9, done: 9, info_only: 9 };
  const order = new Map(pack.tasks.map((t, i) => [t.id, i]));
  const actionable = tasks
    .filter((p) => p.status === "overdue" || p.status === "due_soon" || p.status === "ready")
    .sort(
      (a, b) =>
        rank[a.status] - rank[b.status] ||
        (a.deadline?.date ?? "9999").localeCompare(b.deadline?.date ?? "9999") ||
        order.get(a.task.id)! - order.get(b.task.id)!,
    );

  return {
    supported: true,
    unsupportedMessage: null,
    tasks,
    next: actionable[0] ?? null,
    alsoNow: actionable.slice(1),
  };
}
