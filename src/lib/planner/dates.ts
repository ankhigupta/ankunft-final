/** Calendar-date arithmetic on YYYY-MM-DD strings, done in UTC so time zones never shift a day. */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidISO(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = ISO.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** The range of dates the app accepts. Anything outside it is ignored by the planner, never computed with. */
export const MIN_DATE = "2000-01-01";
export const MAX_DATE = "2100-12-31";

/** A real calendar date inside the accepted range. Safe to do arithmetic with. */
export function isPlausibleDate(s: unknown): s is string {
  return isValidISO(s) && s >= MIN_DATE && s <= MAX_DATE;
}

/** Why a typed date cannot be used, in words for the person typing it, or null if it can. Empty is fine. */
export function dateProblem(s: unknown): string | null {
  if (s === undefined || s === null || s === "") return null;
  if (typeof s !== "string" || !isValidISO(s)) return "That is not a real date. Use day, month and year.";
  if (s < MIN_DATE || s > MAX_DATE) return "Enter a date between 1 Jan 2000 and 31 Dec 2100.";
  return null;
}

function toDay(s: string): number {
  if (!isValidISO(s)) throw new Error(`Invalid date: ${s}`);
  return Date.parse(s) / 86_400_000;
}

export function addDays(s: string, n: number): string {
  return new Date((toDay(s) + n) * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from b to a (a - b). Positive when a is later. */
export function diffDays(a: string, b: string): number {
  return toDay(a) - toDay(b);
}

export function todayLocalISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
