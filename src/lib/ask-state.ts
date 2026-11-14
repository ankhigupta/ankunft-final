import type { QAResponse } from "./qa/answer";

/**
 * The Ask box as a small state machine, kept apart from the component so the rules can be tested without a
 * browser: a new question never shows the old answer, an older request can never overwrite a newer one, and
 * submitting the same question twice does not send it twice.
 */
export type AskState = {
  /** What is in the input box. */
  text: string;
  phase: "idle" | "loading" | "done" | "error";
  /** The question the current request or result belongs to. */
  asked: string | null;
  /** Identifies the current request. A response for any other id, or one that arrives when nothing is loading, is stale and is dropped. */
  requestId: number;
  result: QAResponse | null;
  error: string | null;
};

export const initialAskState: AskState = { text: "", phase: "idle", asked: null, requestId: 0, result: null, error: null };

export type AskAction =
  | { type: "edit"; text: string }
  /** `requestId` comes from a counter that only goes up, so every request has an id no earlier one had. */
  | { type: "submit"; text: string; requestId: number }
  | { type: "success"; requestId: number; result: QAResponse }
  | { type: "failure"; requestId: number; message: string };

/** True when submitting `text` now would start a new request. A repeat of the question already in flight does not. */
export function shouldSend(state: AskState, text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return !(state.phase === "loading" && state.asked === t);
}

export function askReducer(state: AskState, action: AskAction): AskState {
  switch (action.type) {
    case "edit": {
      const next = { ...state, text: action.text };
      // Changing the question hides what was shown for the old one, and abandons a request still in flight.
      if (state.phase !== "idle" && action.text.trim() !== state.asked) {
        return { ...next, phase: "idle", asked: null, result: null, error: null };
      }
      return next;
    }
    case "submit": {
      const t = action.text.trim();
      if (!shouldSend(state, t)) return state;
      return { ...state, text: action.text, phase: "loading", asked: t, requestId: action.requestId, result: null, error: null };
    }
    case "success":
      if (action.requestId !== state.requestId || state.phase !== "loading") return state;
      return { ...state, phase: "done", result: action.result, error: null };
    case "failure":
      if (action.requestId !== state.requestId || state.phase !== "loading") return state;
      return { ...state, phase: "error", result: null, error: action.message };
  }
}

export type Failure = { status?: number; body?: unknown; network?: boolean };

const SERVER_PROBLEM = "Ask is having a problem on our side. Please try again in a moment.";
const NETWORK_PROBLEM = "Could not reach Ask. Check your connection and try again.";

/** A friendly sentence for a failed request. Never a browser's own message ("Failed to fetch", "Unexpected token <"). */
export function describeFailure(f: Failure): string {
  if (f.network) return NETWORK_PROBLEM;
  if (f.status === 400) {
    const msg = typeof f.body === "object" && f.body !== null ? (f.body as { error?: unknown }).error : undefined;
    // The API's own 400 messages are written for people ("Ask a question.", "Keep it under 500 characters.").
    return typeof msg === "string" && msg.length > 0 && msg.length < 120 ? msg : "That question could not be sent. Check it and try again.";
  }
  return SERVER_PROBLEM;
}
