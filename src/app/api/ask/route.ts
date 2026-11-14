import { NextResponse } from "next/server";
import { berlinQA } from "@/lib/qa/load";
import { isValidISO, todayLocalISO } from "@/lib/planner/dates";

const MAX_QUESTION_CHARS = 500;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON like {\"question\": \"...\"}." }, { status: 400 });
  }
  const { question, today } = (body ?? {}) as { question?: unknown; today?: unknown };
  if (typeof question !== "string" || question.trim() === "") {
    return NextResponse.json({ error: "Ask a question." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json({ error: `Keep it under ${MAX_QUESTION_CHARS} characters.` }, { status: 400 });
  }
  const todayISO = typeof today === "string" && isValidISO(today) ? today : todayLocalISO();
  return NextResponse.json(berlinQA(question, todayISO));
}
