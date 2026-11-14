import type { Plan } from "@/lib/planner/engine";
import { prettyDate, prettyDates, daysPhrase } from "@/lib/format";
import { StatusBadge } from "./Badges";

type Props = {
  plan: Plan;
  titleOf: (id: string) => string;
  onDone: (id: string) => void;
  anyTracked: boolean;
};

export function NextPlate({ plan, titleOf, onDone, anyTracked }: Props) {
  const n = plan.next;
  if (!n) {
    return (
      <section className="plate plate-empty" aria-live="polite">
        <p className="plate-kicker">Next step</p>
        <h2>{anyTracked ? "Nothing is ready right now" : "Add your situation to get a plan"}</h2>
        <p>
          {anyTracked
            ? "Every remaining step is waiting on another one. Open the list below to see what each is waiting for."
            : "Choose how you entered Germany and add your dates."}
        </p>
      </section>
    );
  }
  const d = n.deadline;
  return (
    <section className={`plate plate-${n.status}`} aria-live="polite">
      <p className="plate-kicker">
        Next step <StatusBadge status={n.status} />
      </p>
      <h2>{n.task.title}</h2>
      <p className="plate-summary">{prettyDates(n.task.summary)}</p>
      {d && (
        <p className="plate-deadline">
          {d.hard ? "Last day" : "Guidance date"}: <strong>{prettyDate(d.date)}</strong> ({daysPhrase(d.daysLeft)})
          {!d.hard && " · guidance, not a legal date"}
        </p>
      )}
      {n.unlocks.length > 0 && <p className="plate-unlocks">Unlocks: {n.unlocks.map(titleOf).join(", ")}</p>}
      <div className="plate-actions">
        <button type="button" className="btn" onClick={() => onDone(n.task.id)}>
          Mark as done
        </button>
      </div>
      {plan.alsoNow.length > 0 && (
        <p className="plate-also">You can also start now: {plan.alsoNow.map((p) => p.task.title).join(" · ")}</p>
      )}
    </section>
  );
}
