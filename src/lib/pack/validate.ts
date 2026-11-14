import type { Expr, Pack } from "./schema";

/**
 * Structural checks a schema cannot express: references must resolve, there
 * must be no dependency cycles, and nothing may be called official without a
 * source. Errors block loading; warnings are for a human to read.
 */
export type PackIssue = { level: "error" | "warning"; where: string; message: string };

function refs(e: Expr, out: { tasks: string[]; inputs: string[] }) {
  if ("task" in e) out.tasks.push(e.task);
  else if ("input" in e) out.inputs.push(e.input);
  else for (const c of "allOf" in e ? e.allOf : e.anyOf) refs(c, out);
}

export function validatePack(pack: Pack): PackIssue[] {
  const issues: PackIssue[] = [];
  const err = (where: string, message: string) => issues.push({ level: "error", where, message });
  const warn = (where: string, message: string) => issues.push({ level: "warning", where, message });

  const taskIds = new Set<string>();
  for (const t of pack.tasks) {
    if (taskIds.has(t.id)) err(t.id, "duplicate task id");
    taskIds.add(t.id);
  }
  const inputIds = new Set(pack.inputs.map((i) => i.id));
  const sourceIds = new Set(pack.sources.map((s) => s.id));
  const conflictIds = new Set(pack.conflicts.map((c) => c.id));

  const checkSources = (where: string, ids: string[]) => {
    for (const id of ids) if (!sourceIds.has(id)) err(where, `unknown source ${id}`);
  };

  const deps = new Map<string, string[]>();
  for (const t of pack.tasks) {
    const edges: string[] = [];
    for (const r of t.requirements) {
      const found = { tasks: [] as string[], inputs: [] as string[] };
      refs(r.expr, found);
      for (const x of found.tasks) {
        if (!taskIds.has(x)) err(`${t.id}/${r.id}`, `unknown task ${x}`);
        edges.push(x);
      }
      for (const x of found.inputs) if (!inputIds.has(x)) err(`${t.id}/${r.id}`, `unknown input ${x}`);
      checkSources(`${t.id}/${r.id}`, r.sourceIds);
      if (r.basis !== "inferred" && r.sourceIds.length === 0)
        err(`${t.id}/${r.id}`, `basis ${r.basis} needs at least one source`);
      if (r.basis === "inferred") warn(`${t.id}/${r.id}`, "inferred requirement: shown as an assumption");
    }
    deps.set(t.id, edges);

    const d = t.deadline;
    checkSources(`${t.id}/deadline`, d.sourceIds);
    if (d.kind !== "none_found" && d.sourceIds.length === 0) err(`${t.id}/deadline`, "a deadline needs a source");
    if (d.triggerInput && !inputIds.has(d.triggerInput)) err(`${t.id}/deadline`, `unknown input ${d.triggerInput}`);
    if (d.offsetDays !== null && !d.triggerInput) err(`${t.id}/deadline`, "offsetDays without triggerInput");
    if (d.kind === "none_found" && (d.triggerInput || d.offsetDays !== null))
      err(`${t.id}/deadline`, "none_found must not carry a date rule");
    if (t.completedWhenInput && !inputIds.has(t.completedWhenInput))
      err(t.id, `unknown completedWhenInput ${t.completedWhenInput}`);
    for (const n of t.meanwhileNotes) checkSources(`${t.id}/meanwhile`, n.sourceIds);
    for (const c of t.conflictIds) if (!conflictIds.has(c)) err(t.id, `unknown conflict ${c}`);
  }
  for (const c of pack.conflicts) for (const s of c.statements) checkSources(c.id, s.sourceIds);
  for (const s of pack.supportedWhen) if (!inputIds.has(s.input)) err("supportedWhen", `unknown input ${s.input}`);

  // Cycle check (depth-first).
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, path: string[]) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      err(id, `dependency cycle: ${[...path, id].join(" -> ")}`);
      return;
    }
    state.set(id, 1);
    for (const next of deps.get(id) ?? []) if (taskIds.has(next)) visit(next, [...path, id]);
    state.set(id, 2);
  };
  for (const id of taskIds) visit(id, []);

  return issues;
}

export function isPackStale(pack: Pack, todayISO: string): boolean {
  const days = (Date.parse(todayISO) - Date.parse(pack.verifiedOn)) / 86_400_000;
  return days > pack.staleAfterDays;
}
