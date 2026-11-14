import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { berlinPack } from "@/lib/pack/load";
import { buildPlan, type InputValues } from "@/lib/planner/engine";
import { checkInputs } from "@/lib/input-checks";
import { Board } from "./Board";
import { Intake } from "./Intake";
import { NextPlate } from "./NextPlate";
import { TaskDetail } from "./TaskDetail";

const TODAY = "2026-11-14";
const TRACKED = berlinPack.tasks.filter((t) => t.mode === "tracked").map((t) => t.id);
const titleOf = (id: string) => berlinPack.tasks.find((t) => t.id === id)?.title ?? id;
const plan = (values: InputValues, done: string[] = []) => buildPlan({ pack: berlinPack, values, done, todayISO: TODAY });
const noop = () => {};
const plate = (p: ReturnType<typeof plan>) => renderToStaticMarkup(createElement(NextPlate, { plan: p, titleOf, onDone: noop, anyTracked: true }));
const board = (p: ReturnType<typeof plan>, done: string[]) =>
  renderToStaticMarkup(createElement(Board, { plan: p, pack: berlinPack, titleOf, onDone: noop, onUndo: noop, doneByUser: done }));
const detail = (p: ReturnType<typeof plan>, id: string) =>
  renderToStaticMarkup(createElement(TaskDetail, { p: p.tasks.find((t) => t.task.id === id)!, pack: berlinPack, titleOf }));

describe("next-step card: all steps done (B5)", () => {
  const html = plate(plan({ entryType: "national_visa", moveInDate: "2026-11-01", hasAdmissionLetter: true }, TRACKED));

  it("shows a completion state", () => {
    expect(html).toContain("All steps are done");
    expect(html).toContain("plate-complete");
  });

  it("does not show the misleading 'nothing is ready' or 'waiting' text, or an action button", () => {
    expect(html).not.toContain("Nothing is ready right now");
    expect(html).not.toMatch(/waiting on another one/i);
    expect(html).not.toContain("Mark as done");
  });

  it("does not claim the paperwork is complete or accepted", () => {
    expect(html).toMatch(/not a\s+check that your paperwork is complete or accepted/);
  });

  it("when steps are waiting, the old explanation still applies", () => {
    const waiting = plan({ entryType: "national_visa" }, ["housing", "health_insurance", "enrollment", "livelihood"]);
    expect(waiting.next).toBeNull();
    expect(waiting.complete).toBe(false);
    expect(plate(waiting)).toContain("Nothing is ready right now");
    expect(plate(waiting)).not.toContain("All steps are done");
  });
});

describe("alternatives on screen (B7)", () => {
  const p = plan({ entryType: "national_visa", moveInDate: "2026-11-11" }, ["health_insurance", "livelihood"]);

  it("the task detail says either alternative is enough", () => {
    const html = detail(p, "lea_application");
    expect(html).toContain("Still missing: either ");
    expect(html).toContain("(one is enough)");
  });

  it("the task detail does not list the alternatives as a flat list of requirements", () => {
    const html = detail(p, "lea_application");
    expect(html).not.toContain(`Still missing: ${titleOf("anmeldung")}; ${titleOf("landlord_confirmation")}`);
  });

  it("the board row says what it waits on in the same words", () => {
    expect(board(p, ["health_insurance", "livelihood"])).toContain("Waiting on: ");
    expect(board(p, ["health_insurance", "livelihood"])).toMatch(/Waiting on: [^<]*either [^<]*\(one is enough\)/);
  });

  it("required parts read as 'and'", () => {
    expect(detail(plan({ entryType: "national_visa" }), "anmeldung")).toMatch(/Still missing: [^<]* and [^<]*/);
  });
});

describe("done marks that no longer count (B9) on screen", () => {
  const p = plan({ entryType: "national_visa" }, ["landlord_confirmation", "anmeldung"]);

  it("explains it in the task detail", () => {
    expect(detail(p, "anmeldung")).toContain("You marked this as done earlier");
  });

  it("offers to remove the mark, and shows the step as waiting rather than done", () => {
    const html = board(p, ["landlord_confirmation", "anmeldung"]);
    expect(html).toContain("Remove my");
    expect(html).toMatch(/Waiting on something/);
    expect(plan({ entryType: "national_visa", moveInDate: "2026-11-11" }, ["landlord_confirmation"]).tasks.find((t) => t.task.id === "landlord_confirmation")!.doneMarkIgnored).toBe(false);
  });

  it("does not show the explanation for a step that is simply open", () => {
    expect(detail(plan({ entryType: "national_visa" }), "anmeldung")).not.toContain("You marked this as done earlier");
  });
});

describe("future move-in date on screen (B10)", () => {
  it("says the entered date is still in the future instead of listing it as missing", () => {
    const html = detail(plan({ entryType: "national_visa", moveInDate: "2026-11-20" }), "landlord_confirmation");
    expect(html).toContain("Move-in date: 20 Nov 2026 is still in the future");
    expect(html).not.toMatch(/Still missing:[^<]*Move-in date(?!:)/);
  });
});

describe("guidance dates read naturally (B11)", () => {
  const values = { entryType: "national_visa", moveInDate: "2026-11-01", visaEndDate: "2026-11-10", hasAdmissionLetter: true };
  const done = ["landlord_confirmation", "anmeldung", "health_insurance", "enrollment", "livelihood"];
  const p = plan(values, done);

  it("the task detail says a passed guidance date has passed, not that it is overdue", () => {
    const html = detail(p, "lea_application");
    expect(p.tasks.find((t) => t.task.id === "lea_application")!.deadline).toMatchObject({ hard: false, daysLeft: -4 });
    expect(html).toContain("Guidance date");
    expect(html).toContain("this date has passed");
    expect(html).not.toMatch(/overdue/i);
    expect(html).not.toMatch(/4 days/);
  });

  it("the next-step card does the same", () => {
    expect(p.next?.task.id).toBe("lea_application");
    const html = plate(p);
    expect(html).toContain("this date has passed");
    expect(html).toContain("guidance, not a legal date");
    expect(html).not.toMatch(/overdue/i);
  });

  it("a statutory deadline is still called overdue", () => {
    const html = plate(plan({ entryType: "national_visa", moveInDate: "2026-10-20" }, ["landlord_confirmation"]));
    expect(html).toContain("11 days overdue"); // last day was 3 Nov
  });
});

describe("situation form: date notes (C6)", () => {
  const render = (values: InputValues, today = TODAY) =>
    renderToStaticMarkup(createElement(Intake, { pack: berlinPack, values, onChange: noop, issues: checkInputs(values, today) }));

  it("shows a warning beside the move-in field when it is before the arrival date", () => {
    const html = render({ entryType: "national_visa", arrivalDate: "2026-11-10", moveInDate: "2026-10-01" });
    expect(html).toContain("This is before your arrival date (10 Nov 2026)");
    expect(html).toContain("field-warn");
  });

  it("shows a calm note for a visa end date that has passed, without a day count", () => {
    const html = render({ entryType: "national_visa", visaEndDate: "2026-01-01" });
    expect(html).toContain("already passed");
    expect(html).toContain("immigration office (LEA)");
    expect(html).not.toMatch(/\d+ days/);
  });

  it("shows an information note for a future move-in date", () => {
    expect(render({ entryType: "national_visa", moveInDate: "2026-12-01" })).toContain("field-info");
  });

  it("shows nothing for a consistent situation", () => {
    const html = render({ entryType: "national_visa", arrivalDate: "2026-11-05", moveInDate: "2026-11-11", visaEndDate: "2027-02-10" });
    expect(html).not.toContain("field-warn");
    expect(html).not.toContain("field-info");
  });

  it("does not stack a consistency note on top of a date's own error", () => {
    const html = render({ entryType: "national_visa", arrivalDate: "2026-11-10", moveInDate: "9999-12-31" });
    expect(html).toContain("field-error");
    expect(html).not.toContain("field-warn");
  });
});
