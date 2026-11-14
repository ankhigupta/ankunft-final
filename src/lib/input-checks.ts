import { prettyDate } from "./format";
import { isPlausibleDate } from "./planner/dates";
import type { InputValues } from "./planner/engine";

/**
 * Checks that the dates a person entered fit together and fit today. They are notes beside the field, not
 * errors: the planner still works with what was entered, and nothing here is a legal conclusion.
 *
 * These know the roles of the Berlin pack's date inputs (arrival, move-in, visa end). The pack does not carry
 * those roles and is not changed, so the checks live in the app, next to the other Berlin-specific wording.
 * A date that is missing, impossible or out of range is the date field's own problem (see dateProblem) and is
 * skipped here.
 */
export type InputIssue = {
  id: string;
  /** The input the note belongs to. */
  field: "arrivalDate" | "moveInDate" | "visaEndDate";
  severity: "warning" | "info";
  message: string;
};

export function checkInputs(values: InputValues, todayISO: string): InputIssue[] {
  const date = (id: string): string | null => {
    const v = values?.[id];
    return isPlausibleDate(v) ? v : null;
  };
  const arrival = date("arrivalDate");
  const moveIn = date("moveInDate");
  const visaEnd = date("visaEndDate");
  const issues: InputIssue[] = [];

  if (arrival && moveIn && moveIn < arrival) {
    issues.push({
      id: "move-in-before-arrival",
      field: "moveInDate",
      severity: "warning",
      message: `This is before your arrival date (${prettyDate(arrival)}). Check both dates. The plan uses them as entered.`,
    });
  }
  if (arrival && visaEnd && visaEnd < arrival) {
    issues.push({
      id: "visa-end-before-arrival",
      field: "visaEndDate",
      severity: "warning",
      message: `This is before your arrival date (${prettyDate(arrival)}). Check both dates.`,
    });
  }
  if (visaEnd && isPlausibleDate(todayISO) && visaEnd < todayISO) {
    issues.push({
      id: "visa-end-passed",
      field: "visaEndDate",
      severity: "warning",
      message:
        "This date has already passed. The guidance Ankunft has is to apply while your visa is still valid, so it does " +
        "not fit this situation, and Ankunft cannot say what applies to you now. Ask the immigration office (LEA) or " +
        "your university's international office.",
    });
  }
  if (moveIn && isPlausibleDate(todayISO) && moveIn > todayISO) {
    issues.push({
      id: "move-in-future",
      field: "moveInDate",
      severity: "info",
      message: "This date is still in the future, so steps that need you to have moved in wait until it arrives.",
    });
  }
  if (arrival && isPlausibleDate(todayISO) && arrival > todayISO) {
    issues.push({
      id: "arrival-future",
      field: "arrivalDate",
      severity: "info",
      message: "This date is still in the future.",
    });
  }
  return issues;
}
