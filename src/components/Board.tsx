import type { Pack } from "@/lib/pack/schema";
import { waitingOn, type PlannedTask, type Plan, type Status } from "@/lib/planner/engine";
import { prettyDate } from "@/lib/format";
import { StatusBadge } from "./Badges";
import { TaskDetail } from "./TaskDetail";

type Props = {
  plan: Plan;
  pack: Pack;
  titleOf: (id: string) => string;
  onDone: (id: string) => void;
  onUndo: (id: string) => void;
  doneByUser: string[];
};

const GROUPS: { title: string; statuses: Status[] }[] = [
  { title: "Do now", statuses: ["overdue", "due_soon", "ready"] },
  { title: "Waiting on something", statuses: ["blocked"] },
  { title: "Done", statuses: ["done"] },
  { title: "Good to know", statuses: ["info_only"] },
];

function rowDate(p: PlannedTask, titleOf: (id: string) => string): string | null {
  if (p.status === "done") return null;
  if (p.dueBy && p.dueBy.taskId !== p.task.id) return `needed for ${titleOf(p.dueBy.taskId)} by ${prettyDate(p.dueBy.date)}`;
  if (!p.deadline) return null;
  const passed = p.deadline.daysLeft < 0;
  return `${p.deadline.hard ? "by " : "guidance "}${prettyDate(p.deadline.date)}${passed ? " (passed)" : ""}`;
}

export function Board({ plan, pack, titleOf, onDone, onUndo, doneByUser }: Props) {
  return (
    <div className="board">
      {GROUPS.map((g) => {
        const rows = plan.tasks.filter((p) => g.statuses.includes(p.status));
        if (rows.length === 0) return null;
        return (
          <section key={g.title} aria-labelledby={`g-${g.title}`}>
            <h3 id={`g-${g.title}`} className="group-title">
              {g.title} <span className="count">{rows.length}</span>
            </h3>
            <ul className="rows">
              {rows.map((p) => (
                <li key={p.task.id} className={`row row-${p.status}`}>
                  <details>
                    <summary>
                      <span className="row-main">
                        <span className="row-title">{p.task.title}</span>
                        {p.status === "blocked" && waitingOn(p).length > 0 && (
                          <span className="row-wait">Waiting on: {waitingOn(p).join("; ")}</span>
                        )}
                      </span>
                      <span className="row-meta">
                        {rowDate(p, titleOf) && <span className="row-date">{rowDate(p, titleOf)}</span>}
                        <StatusBadge status={p.status} />
                      </span>
                    </summary>
                    <TaskDetail p={p} pack={pack} titleOf={titleOf} />
                    {p.task.mode === "tracked" && p.status !== "done" && p.status !== "blocked" && (
                      <button type="button" className="btn btn-small" onClick={() => onDone(p.task.id)}>
                        Mark as done
                      </button>
                    )}
                    {p.doneMarkIgnored && doneByUser.includes(p.task.id) && (
                      <button type="button" className="btn btn-small btn-quiet" onClick={() => onUndo(p.task.id)}>
                        Remove my &ldquo;done&rdquo; mark
                      </button>
                    )}
                    {p.status === "done" && doneByUser.includes(p.task.id) && (
                      <button type="button" className="btn btn-small btn-quiet" onClick={() => onUndo(p.task.id)}>
                        Undo
                      </button>
                    )}
                  </details>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
