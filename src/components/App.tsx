"use client";

import { useEffect, useMemo, useState } from "react";
import { berlinPack as pack } from "@/lib/pack/load";
import { buildPlan, canMarkDone, type InputValues } from "@/lib/planner/engine";
import { todayLocalISO } from "@/lib/planner/dates";
import { prettyDate } from "@/lib/format";
import { notCoveredNotice } from "@/lib/entry-copy";
import { checkInputs } from "@/lib/input-checks";
import { DEMO_DATE, SCENARIOS } from "@/lib/scenarios";
import { defaultState, hasProgress, restoreState, serializeState, STORAGE_KEY, type RealState } from "@/lib/saved-state";
import { Intake } from "./Intake";
import { NextPlate } from "./NextPlate";
import { Board } from "./Board";
import { Ask } from "./Ask";
import { Sources } from "./Sources";

type Tab = "plan" | "ask" | "sources";
/** An example situation shown on screen. It lives only in memory and is never saved. */
type Demo = { id: string; label: string; values: InputValues; done: string[] };

function readSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage blocked: start fresh
  }
}
function save(s: RealState) {
  try {
    localStorage.setItem(STORAGE_KEY, serializeState(s));
  } catch {
    /* private mode or blocked storage: the app still works, it just will not remember */
  }
}

export function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("plan");
  // The person's own situation. This is the only thing that is saved.
  const [real, setReal] = useState<RealState>(defaultState);
  // An example on screen, if any. While it is shown, edits go to it and nothing is saved.
  const [demo, setDemo] = useState<Demo | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [restoreNote, setRestoreNote] = useState<string | null>(null);
  const [realToday, setRealToday] = useState("2026-01-01");

  useEffect(() => {
    const r = restoreState(readSaved(), pack);
    // Restoring saved state after mount avoids a server/client mismatch.
    /* eslint-disable react-hooks/set-state-in-effect */
    setReal(r.state);
    if (r.outcome === "repaired") setRestoreNote("Some saved details were not valid and were left out. The rest was kept.");
    if (r.outcome === "reset") setRestoreNote("Saved data in this browser could not be read, so you are starting fresh.");
    setRealToday(todayLocalISO());
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (ready) save(real);
  }, [ready, real]);

  const values = demo ? demo.values : real.values;
  const done = demo ? demo.done : real.done;
  const demoDate = demo ? DEMO_DATE : null;
  const today = demoDate ?? realToday;
  const plan = useMemo(() => buildPlan({ pack, values, done, todayISO: today }), [values, done, today]);
  const titleOf = (id: string) => pack.tasks.find((t) => t.id === id)?.title ?? id;
  const anyTracked = Boolean(values.entryType);
  const issues = useMemo(() => checkInputs(values, today), [values, today]);
  const notice = notCoveredNotice(plan);
  const pendingScenario = SCENARIOS.find((s) => s.id === pending);

  /** Apply a change to whatever is on screen: the example if one is shown, otherwise the person's own plan. */
  function update(fn: (s: RealState) => RealState) {
    if (demo) setDemo((d) => (d ? { ...d, ...fn({ values: d.values, done: d.done }) } : d));
    else setReal(fn);
  }
  function markDone(id: string) {
    // A task that is waiting on something cannot be completed from here, whichever button was pressed.
    if (!canMarkDone(plan, id)) return;
    update((s) => ({ ...s, done: s.done.includes(id) ? s.done : [...s.done, id] }));
  }
  function setValue(id: string, v: string | boolean) {
    update((s) => ({ ...s, values: { ...s.values, [id]: v } }));
  }
  function startScenario(id: string) {
    const s = SCENARIOS.find((x) => x.id === id);
    if (!s) return;
    setDemo({ id: s.id, label: s.label, values: s.values, done: s.done });
    setPending(null);
    setTab("plan");
  }
  function requestScenario(id: string) {
    // Never take over the screen from someone's own entries without asking. Moving between examples needs no ask.
    if (!demo && hasProgress(real)) setPending(id);
    else startScenario(id);
  }

  return (
    <>
      <header className="masthead">
        <div className="masthead-inner">
          <div className="signplate" aria-label="Ankunft">
            <span className="sign-name">Ankunft</span>
            <span className="sign-sub">Arrival · Berlin</span>
          </div>
          <p className="tagline">What to do first, what it waits on, and where each rule comes from.</p>
        </div>
        <nav className="tabs" aria-label="Sections">
          {(["plan", "ask", "sources"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className="tab"
              aria-current={tab === t ? "page" : undefined}
              onClick={() => setTab(t)}
            >
              {t === "plan" ? "Plan" : t === "ask" ? "Ask" : "Sources"}
            </button>
          ))}
        </nav>
      </header>

      {demo && (
        <div className="demo-banner" role="status">
          <span>
            Example: {demo.label}. Dates are computed as if today were {prettyDate(DEMO_DATE)}. Nothing here is saved, and
            your own plan is kept.
          </span>
          <button type="button" className="btn btn-small btn-light" onClick={() => setDemo(null)}>
            Back to my own plan
          </button>
        </div>
      )}

      {restoreNote && (
        <div className="notice-banner" role="status">
          <span>{restoreNote}</span>
          <button type="button" className="btn btn-small btn-light" onClick={() => setRestoreNote(null)}>
            Dismiss
          </button>
        </div>
      )}

      <main className="page">
        {tab === "plan" && (
          <>
            <section className="scenarios" aria-label="Try a situation">
              <p className="scen-title">Try a situation</p>
              <div className="scen-list">
                {SCENARIOS.map((s) => (
                  <button key={s.id} type="button" className="scen" onClick={() => requestScenario(s.id)} title={s.blurb}>
                    {s.label}
                  </button>
                ))}
              </div>
            </section>

            {pendingScenario && (
              <section className="callout callout-warn" role="group" aria-label="Confirm example">
                <p>
                  <strong>Show the example &ldquo;{pendingScenario.label}&rdquo;?</strong> It replaces what is on screen
                  with a made-up situation. Your own entries and progress are kept, and come back when you choose
                  &ldquo;Back to my own plan&rdquo;. Nothing in the example is saved.
                </p>
                <div className="confirm-actions">
                  <button type="button" className="btn" onClick={() => startScenario(pendingScenario.id)}>
                    Show the example
                  </button>
                  <button type="button" className="btn btn-quiet" onClick={() => setPending(null)}>
                    Cancel
                  </button>
                </div>
              </section>
            )}

            <Intake pack={pack} values={values} onChange={setValue} issues={issues} />

            {!plan.supported ? (
              <section className="callout callout-abstain" role="status">
                <strong>{notice.title}</strong> {notice.body}
              </section>
            ) : (
              <>
                <NextPlate
                  plan={plan}
                  titleOf={titleOf}
                  anyTracked={anyTracked}
                  onDone={markDone}
                />
                <Board
                  plan={plan}
                  pack={pack}
                  titleOf={titleOf}
                  doneByUser={done}
                  onDone={markDone}
                  onUndo={(id) => update((s) => ({ ...s, done: s.done.filter((x) => x !== id) }))}
                />
              </>
            )}
            <p className="fineprint">
              Ankunft reports what official sources say. It does not give legal advice and does not predict decisions.
              Dates marked as guidance are not legal deadlines.
            </p>
          </>
        )}
        {tab === "ask" && <Ask todayISO={today} situation={{ values, done }} isExample={Boolean(demo)} />}
        {tab === "sources" && <Sources pack={pack} todayISO={today} />}
      </main>
    </>
  );
}
