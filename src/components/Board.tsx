import type { Pack } from "@/lib/pack/schema";
import type { Plan, Status } from "@/lib/planner/engine";
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
                      <span className="row-title">{p.task.title}</span>
                      <span className="row-meta">
                        {p.deadline && p.status !== "done" && (
                          <span className="row-date">
                            {p.deadline.hard ? "by " : "guidance "}
                            {prettyDate(p.deadline.date)}
                          </span>
                        )}
                        <StatusBadge status={p.status} />
                      </span>
                    </summary>
                    <TaskDetail p={p} pack={pack} titleOf={titleOf} />
                    {p.task.mode === "tracked" && p.status !== "done" && p.status !== "blocked" && (
                      <button type="button" className="btn btn-small" onClick={() => onDone(p.task.id)}>
                        Mark as done
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
