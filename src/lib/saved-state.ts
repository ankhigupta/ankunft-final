import type { Pack } from "./pack/schema";
import type { InputValues } from "./planner/engine";
import { isPlausibleDate } from "./planner/dates";

/**
 * What the app remembers between visits: the person's own entries and the steps they marked done.
 * Example situations ("presets") and their dates are never part of it.
 *
 * Saved data is read back from the browser, so it is treated as untrusted: damaged, hand-edited or written by
 * an older version. Every field is checked, valid parts are kept, and anything else is dropped.
 */
export const STORAGE_KEY = "ankunft.final.v1";
/** Far more than a real saved state needs (a few hundred bytes). Anything bigger is not ours. */
const MAX_SAVED_CHARS = 50_000;

export type RealState = { values: InputValues; done: string[] };

export function defaultState(): RealState {
  return { values: { entryType: "national_visa" }, done: [] };
}

export type Restored = {
  state: RealState;
  /**
   * none: nothing was saved. restored: everything was valid. repaired: some saved details were invalid and
   * dropped, the rest was kept. reset: nothing usable, so the initial state is used.
   */
  outcome: "none" | "restored" | "repaired" | "reset";
};

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

export function restoreState(raw: string | null | undefined, pack: Pack): Restored {
  if (raw === null || raw === undefined) return { state: defaultState(), outcome: "none" };
  if (typeof raw !== "string" || raw.length > MAX_SAVED_CHARS) return { state: defaultState(), outcome: "reset" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: defaultState(), outcome: "reset" };
  }
  if (!isPlainObject(parsed)) return { state: defaultState(), outcome: "reset" };

  let repaired = false;

  // Values: keep each entry that is a known input with a value of the right kind.
  let values: InputValues;
  if (isPlainObject(parsed.values)) {
    values = {};
    const saved = parsed.values;
    for (const def of pack.inputs) {
      if (!Object.hasOwn(saved, def.id)) continue;
      const v = saved[def.id];
      const ok =
        def.type === "boolean"
          ? typeof v === "boolean"
          : def.type === "enum"
            ? typeof v === "string" && (v === "" || (def.options ?? []).includes(v))
            : typeof v === "string" && (v === "" || isPlausibleDate(v));
      if (ok) values[def.id] = v as string | boolean;
      else repaired = true;
    }
    if (Object.keys(saved).some((k) => !pack.inputs.some((d) => d.id === k))) repaired = true;
  } else {
    values = defaultState().values;
    repaired = true;
  }

  // Done: keep ids of real, trackable steps, once each.
  let done: string[] = [];
  if (Array.isArray(parsed.done)) {
    const trackable = new Set(pack.tasks.filter((t) => t.mode === "tracked").map((t) => t.id));
    for (const id of parsed.done) {
      if (typeof id === "string" && trackable.has(id)) {
        if (!done.includes(id)) done.push(id);
        else repaired = true;
      } else repaired = true;
    }
  } else {
    done = [];
    repaired = true;
  }

  // Both parts unusable means there was nothing of value to keep.
  if (!isPlainObject(parsed.values) && !Array.isArray(parsed.done)) return { state: defaultState(), outcome: "reset" };

  return { state: { values, done }, outcome: repaired ? "repaired" : "restored" };
}

export function serializeState(state: RealState): string {
  return JSON.stringify({ values: state.values, done: state.done });
}

/** True when the person has entered something or marked something done, so replacing it would lose work. */
export function hasProgress(state: RealState): boolean {
  if (state.done.length > 0) return true;
  return Object.entries(state.values).some(([id, v]) => {
    if (v === undefined || v === "" || v === false) return false;
    return !(id === "entryType" && v === "national_visa"); // the preselected default is not the person's work
  });
}
