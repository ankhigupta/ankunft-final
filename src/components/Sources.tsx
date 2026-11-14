import type { Pack } from "@/lib/pack/schema";
import { isPackStale } from "@/lib/pack/validate";
import { prettyDate } from "@/lib/format";

const KIND: Record<string, string> = {
  statute: "Statute",
  statute_mirror: "Statute text (mirror)",
  government_service: "Government service",
  federal_portal: "Federal portal",
  university: "University",
};

export function Sources({ pack, todayISO }: { pack: Pack; todayISO: string }) {
  const stale = isPackStale(pack, todayISO);
  return (
    <div className="sources">
      <h2 className="section-title">Sources</h2>
      <p className="lead">
        Everything here comes from these pages, last checked on {prettyDate(pack.verifiedOn)}. Primary sources are the
        law and the authorities. Secondary sources are universities and portals and are labelled.
      </p>
      {stale && (
        <p className="callout callout-warn">
          These sources were last checked more than {pack.staleAfterDays} days ago. Re-check the linked pages before acting.
        </p>
      )}
      <ul className="source-list">
        {pack.sources.map((s) => (
          <li key={s.id}>
            <div className="src-head">
              <span className="src-id">{s.id}</span>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.title}
              </a>
            </div>
            <p className="src-meta">
              {s.publisher} · {KIND[s.authorityType]} · <span className={`rel rel-${s.reliability}`}>{s.reliability}</span> ·
              retrieved {prettyDate(s.retrievedOn)}
              {s.pageDate ? ` · page dated ${prettyDate(s.pageDate)}` : ""}
            </p>
            {s.pageDateNote && <p className="src-note">{s.pageDateNote}</p>}
            {s.note && <p className="src-note">{s.note}</p>}
          </li>
        ))}
      </ul>
      <h3 className="group-title">Where sources disagree</h3>
      <ul className="source-list">
        {pack.conflicts.map((c) => (
          <li key={c.id}>
            <strong>{c.topic}</strong>
            <p>{c.display}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
