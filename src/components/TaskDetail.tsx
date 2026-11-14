import type { Pack } from "@/lib/pack/schema";
import type { PlannedTask } from "@/lib/planner/engine";
import { prettyDate, prettyDates, daysPhrase } from "@/lib/format";
import { BasisBadge, DEADLINE_LABEL } from "./Badges";

function SourceLinks({ ids, pack }: { ids: string[]; pack: Pack }) {
  if (ids.length === 0) return null;
  return (
    <span className="srcs">
      {ids.map((id) => {
        const s = pack.sources.find((x) => x.id === id);
        return s ? (
          <a key={id} href={s.url} target="_blank" rel="noreferrer" title={s.title}>
            {id}
          </a>
        ) : null;
      })}
    </span>
  );
}

export function TaskDetail({ p, pack, titleOf }: { p: PlannedTask; pack: Pack; titleOf: (id: string) => string }) {
  const t = p.task;
  const d = t.deadline;
  const conflicts = pack.conflicts.filter((c) => t.conflictIds.includes(c.id));
  return (
    <div className="detail">
      <p>{prettyDates(t.summary)}</p>

      <section>
        <h4>Deadline</h4>
        <p className="deadline-kind">{DEADLINE_LABEL[d.kind]}</p>
        <p>{prettyDates(d.text)}</p>
        {p.deadline && (
          <p className="deadline-calc">
            {p.deadline.hard ? "Last day" : "Guidance date"}: <strong>{prettyDate(p.deadline.date)}</strong> (
            {daysPhrase(p.deadline.daysLeft)})
            {!p.deadline.hard && <span className="guidance"> Guidance, not a legal date.</span>}
          </p>
        )}
        <SourceLinks ids={d.sourceIds} pack={pack} />
      </section>

      {t.requirements.length > 0 && (
        <section>
          <h4>What it depends on</h4>
          <ul className="reqs">
            {t.requirements.map((r) => {
              const blocker = p.blockers.find((b) => b.requirementId === r.id);
              return (
                <li key={r.id} className={blocker ? "unmet" : "met"}>
                  <div className="req-head">
                    <span className="req-mark" aria-hidden="true">{blocker ? "○" : "●"}</span>
                    <span>{r.label}</span>
                    <BasisBadge basis={r.basis} />
                  </div>
                  {blocker && (
                    <p className="missing">
                      Still missing: {blocker.missing.map((m) => (m.kind === "task" ? titleOf(m.id) : m.label)).join("; ")}
                    </p>
                  )}
                  {r.note && <p className="note">{r.note}</p>}
                  <SourceLinks ids={r.sourceIds} pack={pack} />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {t.meanwhileNotes.length > 0 && (
        <section>
          <h4>Meanwhile</h4>
          <ul>
            {t.meanwhileNotes.map((n, i) => (
              <li key={i}>
                {n.text} <SourceLinks ids={n.sourceIds} pack={pack} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {conflicts.map((c) => (
        <section key={c.id} className="conflict">
          <h4>Sources disagree</h4>
          <p>{c.display}</p>
          <ul>
            {c.statements.map((s, i) => (
              <li key={i}>
                {s.text} <SourceLinks ids={s.sourceIds} pack={pack} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {t.openQuestions.length > 0 && (
        <section className="open">
          <h4>Not verified</h4>
          <ul>
            {t.openQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
