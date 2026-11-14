import { describe, expect, it } from "vitest";
import { daysPhrase, deadlinePhrase, prettyDate } from "./format";

describe("deadline wording (B11)", () => {
  it("keeps legal and authority deadlines as they were: left, last day, overdue", () => {
    expect(deadlinePhrase({ hard: true, daysLeft: 5 })).toBe("5 days left");
    expect(deadlinePhrase({ hard: true, daysLeft: 1 })).toBe("1 day left");
    expect(deadlinePhrase({ hard: true, daysLeft: 0 })).toBe("today is the last day");
    expect(deadlinePhrase({ hard: true, daysLeft: -1 })).toBe("1 day overdue");
    expect(deadlinePhrase({ hard: true, daysLeft: -6 })).toBe("6 days overdue");
    expect(deadlinePhrase({ hard: true, daysLeft: -6 })).toBe(daysPhrase(-6));
  });

  it("never calls a guidance date overdue, whatever the number of days", () => {
    for (let d = -400; d <= 400; d++) expect(deadlinePhrase({ hard: false, daysLeft: d }), String(d)).not.toMatch(/overdue|late|missed/i);
  });

  it("says a passed guidance date has passed, without a count of days", () => {
    expect(deadlinePhrase({ hard: false, daysLeft: -1 })).toBe("this date has passed");
    expect(deadlinePhrase({ hard: false, daysLeft: -3 })).toBe("this date has passed");
    expect(deadlinePhrase({ hard: false, daysLeft: -317 })).toBe("this date has passed");
    expect(deadlinePhrase({ hard: false, daysLeft: -317 })).not.toMatch(/\d/);
  });

  it("describes an upcoming guidance date in plain words", () => {
    expect(deadlinePhrase({ hard: false, daysLeft: 0 })).toBe("today");
    expect(deadlinePhrase({ hard: false, daysLeft: 1 })).toBe("tomorrow");
    expect(deadlinePhrase({ hard: false, daysLeft: 8 })).toBe("in 8 days");
  });

  it("formats dates as before", () => {
    expect(prettyDate("2026-11-04")).toBe("4 Nov 2026");
  });
});
