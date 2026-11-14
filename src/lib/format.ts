const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 2026-11-25 -> "25 Nov 2026" */
export function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function daysPhrase(daysLeft: number): string {
  if (daysLeft === 0) return "today is the last day";
  if (daysLeft === 1) return "1 day left";
  if (daysLeft > 1) return `${daysLeft} days left`;
  if (daysLeft === -1) return "1 day overdue";
  return `${-daysLeft} days overdue`;
}

/** Replace ISO dates inside free text with readable ones. */
export function prettyDates(text: string): string {
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => prettyDate(m));
}
