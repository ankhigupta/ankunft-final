"use client";

import { useEffect, useMemo, useState } from "react";
import { berlinPack as pack } from "@/lib/pack/load";
import { buildPlan, type InputValues } from "@/lib/planner/engine";
import { todayLocalISO } from "@/lib/planner/dates";
import { prettyDate } from "@/lib/format";
import { DEMO_DATE, SCENARIOS } from "@/lib/scenarios";
import { Intake } from "./Intake";
import { NextPlate } from "./NextPlate";
import { Board } from "./Board";
import { Ask } from "./Ask";
import { Sources } from "./Sources";

const KEY = "ankunft.final.v1";
type Tab = "plan" | "ask" | "sources";
type Saved = { values: InputValues; done: string[]; demoDate: string | null };

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}
function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode or blocked storage: the app still works, it just will not remember */
  }
}

export function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("plan");
  const [values, setValues] = useState<InputValues>({ entryType: "national_visa" });
  const [done, setDone] = useState<string[]>([]);
  const [demoDate, setDemoDate] = useState<string | null>(null);
  const [realToday, setRealToday] = useState("2026-01-01");

  useEffect(() => {
    const s = load();
    // Restoring saved state after mount avoids a server/client mismatch.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (s) {
      setValues(s.values ?? {});
      setDone(s.done ?? []);
      setDemoDate(s.demoDate ?? null);
    }
    setRealToday(todayLocalISO());
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (ready) save({ values, done, demoDate });
  }, [ready, values, done, demoDate]);

  const today = demoDate ?? realToday;
  const plan = useMemo(() => buildPlan({ pack, values, done, todayISO: today }), [values, done, today]);
  const titleOf = (id: string) => pack.tasks.find((t) => t.id === id)?.title ?? id;
  const anyTracked = Boolean(values.entryType);

  function setValue(id: string, v: string | boolean) {
    setValues((prev) => ({ ...prev, [id]: v }));
  }
  function applyScenario(id: string) {
    const s = SCENARIOS.find((x) => x.id === id);
    if (!s) return;
    setValues(s.values);
    setDone(s.done);
    setDemoDate(DEMO_DATE);
    setTab("plan");
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

      {demoDate && (
        <div className="demo-banner" role="status">
          <span>Demo date: {prettyDate(demoDate)}. Dates on this page are computed as if today were that day.</span>
          <button type="button" className="btn btn-small btn-light" onClick={() => setDemoDate(null)}>
            Use today&apos;s real date
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
                  <button key={s.id} type="button" className="scen" onClick={() => applyScenario(s.id)} title={s.blurb}>
                    {s.label}
                  </button>
                ))}
              </div>
            </section>

            <Intake pack={pack} values={values} onChange={setValue} />

            {!plan.supported ? (
              <section className="callout callout-abstain" role="status">
                <strong>Not covered yet.</strong> {plan.unsupportedMessage}
              </section>
            ) : (
              <>
                <NextPlate
                  plan={plan}
                  titleOf={titleOf}
                  anyTracked={anyTracked}
                  onDone={(id) => setDone((d) => (d.includes(id) ? d : [...d, id]))}
                />
                <Board
                  plan={plan}
                  pack={pack}
                  titleOf={titleOf}
                  doneByUser={done}
                  onDone={(id) => setDone((d) => (d.includes(id) ? d : [...d, id]))}
                  onUndo={(id) => setDone((d) => d.filter((x) => x !== id))}
                />
              </>
            )}
            <p className="fineprint">
              Ankunft reports what official sources say. It does not give legal advice and does not predict decisions.
              Dates marked as guidance are not legal deadlines.
            </p>
          </>
        )}
        {tab === "ask" && <Ask todayISO={today} />}
        {tab === "sources" && <Sources pack={pack} todayISO={today} />}
      </main>
    </>
  );
}
