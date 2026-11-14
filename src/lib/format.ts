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

/**
 * How a computed date sits against today, in words that fit the kind of date.
 * A legal or authority deadline can be overdue. A guidance date cannot: it is advice, so once it has gone it
 * has "passed", with no count of days that would read like a missed legal deadline.
 */
export function deadlinePhrase(d: { daysLeft: number; hard: boolean }): string {
  if (d.hard) return daysPhrase(d.daysLeft);
  if (d.daysLeft < 0) return "this date has passed";
  if (d.daysLeft === 0) return "today";
  if (d.daysLeft === 1) return "tomorrow";
  return `in ${d.daysLeft} days`;
}

/** Replace ISO dates inside free text with readable ones. */
export function prettyDates(text: string): string {
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => prettyDate(m));
}
