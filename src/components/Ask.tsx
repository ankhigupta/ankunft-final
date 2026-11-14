"use client";

import { useEffect, useReducer, useRef } from "react";
import type { QAResponse } from "@/lib/qa/answer";
import type { GuidanceResponse } from "@/lib/qa/guidance";
import type { InputValues } from "@/lib/planner/engine";
import { askReducer, describeFailure, initialAskState, shouldSend } from "@/lib/ask-state";
import { daysPhrase, deadlinePhrase, prettyDate, prettyDates } from "@/lib/format";
import { EXAMPLE_QUESTIONS } from "@/lib/qa/examples";
import { StatusBadge } from "./Badges";

const KINDS = new Set(["answer", "abstain", "refuse", "guidance"]);

type Props = {
  todayISO: string;
  /** What the person has entered (or the example on screen), so "what should I do first?" can use the plan. */
  situation: { values: InputValues; done: string[] };
  /** The plan on screen is an example, not the person's own. */
  isExample: boolean;
};

export function Ask({ todayISO, situation, isExample }: Props) {
  const [state, dispatch] = useReducer(askReducer, initialAskState);
  const controller = useRef<AbortController | null>(null);
  const counter = useRef(0);

  // Leaving the tab abandons a request still in flight.
  useEffect(() => () => controller.current?.abort(), []);

  async function submit(question: string) {
    if (!shouldSend(state, question)) return;
    const text = question.trim();
    controller.current?.abort();
    const mine = new AbortController();
    controller.current = mine;
    const requestId = ++counter.current;
    dispatch({ type: "submit", text: question, requestId });
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text, today: todayISO, state: situation }),
        signal: mine.signal,
      });
      let body: unknown = null;
      try {
        body = await r.json();
      } catch {
        /* an error page that is not JSON: described below, never shown raw */
      }
      if (mine.signal.aborted) return;
      const kind = typeof body === "object" && body !== null ? (body as { kind?: unknown }).kind : undefined;
      if (!r.ok || typeof kind !== "string" || !KINDS.has(kind)) {
        dispatch({ type: "failure", requestId, message: describeFailure({ status: r.ok ? 500 : r.status, body }) });
        return;
      }
      dispatch({ type: "success", requestId, result: body as QAResponse });
    } catch {
      if (mine.signal.aborted) return; // replaced by a newer question, or the question was edited
      dispatch({ type: "failure", requestId, message: describeFailure({ network: true }) });
    }
  }

  const { text, phase, asked, result: res, error } = state;
  const loading = phase === "loading";

  return (
    <div className="ask">
      <h2 className="section-title">Ask about the rules</h2>
      <p className="lead">
        Answers are the saved passages from official pages, each with its source. For &ldquo;what should I do
        first?&rdquo; it uses your plan. If the sources do not say, this says so. It will not judge your own case.
      </p>
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <label htmlFor="q" className="sr-only">
          Your question
        </label>
        <input
          id="q"
          value={text}
          maxLength={500}
          placeholder="For example: how many days do I have to register?"
          onChange={(e) => {
            // A changed question abandons the request in flight, so its answer cannot arrive under the new one.
            if (loading && e.target.value.trim() !== asked) controller.current?.abort();
            dispatch({ type: "edit", text: e.target.value });
          }}
        />
        <button className="btn" disabled={loading || !text.trim()}>
          {loading ? "Searching" : "Ask"}
        </button>
      </form>
      <div className="chips" role="list" aria-label="Example questions">
        {EXAMPLE_QUESTIONS.map(({ q: ex }) => (
          <button key={ex} type="button" className="chip" role="listitem" onClick={() => submit(ex)}>
            {ex}
          </button>
        ))}
      </div>

      <div aria-live="polite" className="ask-result" data-phase={phase}>
        {loading && (
          <p className="callout" role="status">
            Searching the saved sources for &ldquo;{asked}&rdquo;&hellip;
          </p>
        )}

        {error && (
          <div className="callout callout-warn" role="alert">
            <p>{error}</p>
            {asked && (
              <button type="button" className="btn btn-quiet" onClick={() => submit(asked)}>
                Try again
              </button>
            )}
          </div>
        )}

        {res?.kind === "answer" && (
          <>
            <p className="asked">“{res.question}”</p>
            {res.passages.map((p) => (
              <article className="answer" key={p.citation.passageId}>
                <p>{p.text}</p>
                <p className="cite">
                  <a href={p.citation.url} target="_blank" rel="noreferrer">
                    {p.citation.title}
                  </a>
                  <span>
                    {" "}
                    · {p.citation.locator} · retrieved {prettyDate(p.citation.retrievedOn)}
                    {p.citation.pageDate ? ` · page dated ${prettyDate(p.citation.pageDate)}` : ""}
                    {p.citation.authorityType === "statute_mirror" ? " · mirror of statute text" : ""}
                  </span>
                </p>
              </article>
            ))}
            {res.conflicts.map((c) => (
              <p key={c.id} className="callout callout-conflict">
                <strong>Sources disagree.</strong> {c.display}
              </p>
            ))}
            {res.notices.map((n) => (
              <p key={n} className="callout">
                {n}
              </p>
            ))}
          </>
        )}

        {res?.kind === "guidance" && <GuidanceCard res={res} isExample={isExample} />}

        {res?.kind === "abstain" && (
          <>
            <p className="asked">“{res.question}”</p>
            <p className="callout callout-abstain">
              <strong>{res.clarify ? "I need a little more." : "No answer from the sources."}</strong> {res.reason}
            </p>
            {res.clarify && res.clarify.options.length > 0 && (
              <div className="clarify">
                <p>{res.clarify.prompt}</p>
                <div className="chips" role="list" aria-label="Questions you could ask">
                  {res.clarify.options.map((o) => (
                    <button key={o} type="button" className="chip" role="listitem" onClick={() => submit(o)}>
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {res?.kind === "refuse" && (
          <div className="callout callout-refuse">
            <p>
              <strong>This needs a decision about your case.</strong> {res.reason}
            </p>
            <ul>
              {res.pointers.map((p) => (
                <li key={p.sourceId}>
                  <a href={p.url} target="_blank" rel="noreferrer">
                    {p.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** An answer built from the person's plan or the pack's own notes, labelled as such: it is not a retrieved passage. */
function GuidanceCard({ res, isExample }: { res: GuidanceResponse; isExample: boolean }) {
  const [first, ...rest] = res.items;
  return (
    <section className="guidance" aria-label="Guidance from your plan">
      <p className="asked">“{res.question}”</p>
      <p className="guidance-kicker">
        {res.basis === "plan" ? (isExample ? "From the example on screen, not your own details" : "From your plan") : "From the research pack"}
      </p>
      <h3 className="guidance-heading">{res.heading}</h3>

      {res.mode === "next_step" && first && <GuidanceItemView item={first} primary />}

      {res.notes.length > 0 && (
        <div className="guidance-notes">
          <p className="guidance-sub">What you can prepare</p>
          <ul>
            {res.notes.map((n) => (
              <li key={n.text}>
                {prettyDates(n.text)} <Sources refs={n.sources} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {(res.mode === "meanwhile" ? res.items : rest).length > 0 && (
        <div className="guidance-also">
          <p className="guidance-sub">{res.mode === "meanwhile" ? "Other steps you can start now" : "You can also start now"}</p>
          <ul>
            {(res.mode === "meanwhile" ? res.items : rest).map((i) => (
              <li key={i.taskId}>
                <strong>{i.title}</strong> <Sources refs={i.sources} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {res.notices.map((n) => (
        <p key={n} className="callout">
          {n}
        </p>
      ))}
    </section>
  );
}

function GuidanceItemView({ item, primary }: { item: GuidanceResponse["items"][number]; primary?: boolean }) {
  const d = item.deadline;
  return (
    <article className={`answer guidance-item${primary ? " guidance-primary" : ""}`}>
      <p>
        <strong>{item.title}</strong> {item.status && <StatusBadge status={item.status} />}
      </p>
      <p>{prettyDates(item.summary)}</p>
      {d && (
        <p className="plate-deadline">
          {d.hard ? "Last day" : "Guidance date"}: <strong>{prettyDate(d.date)}</strong> ({deadlinePhrase(d)})
          {!d.hard && " · guidance, not a legal date"}
        </p>
      )}
      {item.inheritedFrom && (
        <p className="plate-deadline">
          Needed first for {item.inheritedFrom.title}. Its last day: <strong>{prettyDate(item.inheritedFrom.date)}</strong> (
          {daysPhrase(item.inheritedFrom.daysLeft)})
        </p>
      )}
      <Sources refs={item.sources} />
    </article>
  );
}

function Sources({ refs }: { refs: { sourceId: string; title: string; url: string }[] }) {
  if (refs.length === 0) return null;
  return (
    <span className="cite">
      {" "}
      Sources:{" "}
      {refs.map((s, i) => (
        <span key={s.sourceId}>
          {i > 0 && " · "}
          <a href={s.url} target="_blank" rel="noreferrer">
            {s.title}
          </a>
        </span>
      ))}
    </span>
  );
}
