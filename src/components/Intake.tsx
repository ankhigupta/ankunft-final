"use client";

import type { Pack } from "@/lib/pack/schema";
import type { InputValues } from "@/lib/planner/engine";
import { dateProblem, MAX_DATE, MIN_DATE } from "@/lib/planner/dates";
import type { InputIssue } from "@/lib/input-checks";

type Props = {
  pack: Pack;
  values: InputValues;
  onChange: (id: string, value: string | boolean) => void;
  /** Notes about dates that do not fit together or fit today. Shown beside the field, never blocking. */
  issues?: InputIssue[];
};

const ENTRY_LABELS: Record<string, string> = {
  national_visa: "National study visa",
  visa_free: "Visa-free entry",
  unsure: "I am not sure",
};

export function Intake({ pack, values, onChange, issues = [] }: Props) {
  return (
    <form className="intake" onSubmit={(e) => e.preventDefault()} aria-label="Your situation">
      <h2 className="section-title">Your situation</h2>
      <div className="intake-grid">
        {pack.inputs.map((def) => {
          const id = `in-${def.id}`;
          const v = values[def.id];
          return (
            <div className="field" key={def.id}>
              {def.type === "boolean" ? (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={v === true}
                    onChange={(e) => onChange(def.id, e.target.checked)}
                  />
                  <span>{def.label}</span>
                </label>
              ) : (
                <>
                  <label htmlFor={id}>{def.label}</label>
                  {def.type === "enum" ? (
                    <select id={id} value={(v as string) ?? ""} onChange={(e) => onChange(def.id, e.target.value)}>
                      <option value="">Choose</option>
                      {def.options?.map((o) => (
                        <option key={o} value={o}>
                          {ENTRY_LABELS[o] ?? o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={id}
                      type="date"
                      min={MIN_DATE}
                      max={MAX_DATE}
                      value={(v as string) ?? ""}
                      aria-invalid={dateProblem(v) ? true : undefined}
                      aria-describedby={dateProblem(v) ? `${id}-error` : undefined}
                      onChange={(e) => onChange(def.id, e.target.value)}
                    />
                  )}
                </>
              )}
              {def.type === "date" && dateProblem(v) && (
                <p id={`${id}-error`} className="field-error" role="alert">
                  {dateProblem(v)} It is not used until you change it.
                </p>
              )}
              {issues
                .filter((i) => i.field === def.id && !dateProblem(v))
                .map((i) => (
                  <p key={i.id} className={i.severity === "warning" ? "field-warn" : "field-info"}>
                    {i.message}
                  </p>
                ))}
              {def.help && <p className="help">{def.help}</p>}
            </div>
          );
        })}
      </div>
    </form>
  );
}
