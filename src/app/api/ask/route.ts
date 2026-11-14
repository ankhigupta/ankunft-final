import { NextResponse } from "next/server";
import { berlinQA } from "@/lib/qa/load";
import { isValidISO, todayLocalISO } from "@/lib/planner/dates";
import { berlinPack } from "@/lib/pack/load";
import { restoreState } from "@/lib/saved-state";

const MAX_QUESTION_CHARS = 500;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON like {\"question\": \"...\"}." }, { status: 400 });
  }
  const { question, today, state } = (body ?? {}) as { question?: unknown; today?: unknown; state?: unknown };
  if (typeof question !== "string" || question.trim() === "") {
    return NextResponse.json({ error: "Ask a question." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json({ error: `Keep it under ${MAX_QUESTION_CHARS} characters.` }, { status: 400 });
  }
  const todayISO = typeof today === "string" && isValidISO(today) ? today : todayLocalISO();
  // The person's own entries, optional. They are read exactly as saved state is: each field checked, anything
  // invalid dropped, so nothing from the request reaches the planner unchecked.
  const restored = state === undefined ? null : restoreState(JSON.stringify(state), berlinPack);
  const situation = restored && (restored.outcome === "restored" || restored.outcome === "repaired") ? restored.state : undefined;
  return NextResponse.json(berlinQA(question, todayISO, situation));
}
