"use client";

import { useState } from "react";
import type { QAResponse } from "@/lib/qa/answer";
import { prettyDate } from "@/lib/format";

const EXAMPLES = [
  "How many days do I have to register my address?",
  "What does the landlord's confirmation have to contain?",
  "What documents does the study residence permit need?",
  "How much money do I need to show?",
  "Will the immigration office approve my application?",
];

export function Ask({ todayISO }: { todayISO: string }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<QAResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(question: string) {
    const text = question.trim();
    if (!text) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text, today: todayISO }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Something went wrong.");
      setRes(data as QAResponse);
    } catch (e) {
      setRes(null);
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ask">
      <h2 className="section-title">Ask about the rules</h2>
      <p className="lead">
        Answers are the saved passages from official pages, each with its source. If the sources do not say, this
        says so. It will not judge your own case.
      </p>
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
      >
        <label htmlFor="q" className="sr-only">
          Your question
        </label>
        <input
          id="q"
          value={q}
          maxLength={500}
          placeholder="For example: how many days do I have to register?"
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn" disabled={busy || !q.trim()}>
          {busy ? "Searching" : "Ask"}
        </button>
      </form>
      <div className="chips" role="list" aria-label="Example questions">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className="chip"
            role="listitem"
            onClick={() => {
              setQ(ex);
              submit(ex);
            }}
          >
            {ex}
          </button>
        ))}
      </div>

      <div aria-live="polite" className="ask-result">
        {err && <p className="callout callout-warn">{err}</p>}

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

        {res?.kind === "abstain" && (
          <p className="callout callout-abstain">
            <strong>No answer from the sources.</strong> {res.reason}
          </p>
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
