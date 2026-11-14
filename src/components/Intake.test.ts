import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { berlinPack } from "@/lib/pack/load";
import { MAX_DATE, MIN_DATE } from "@/lib/planner/dates";
import type { InputValues } from "@/lib/planner/engine";
import { Intake } from "./Intake";

const render = (values: InputValues) => renderToStaticMarkup(createElement(Intake, { pack: berlinPack, values, onChange: () => {} }));
const dateInputs = (html: string) => html.match(/<input[^>]*type="date"[^>]*>/g) ?? [];

describe("situation form: date inputs", () => {
  it("every date input carries the accepted minimum and maximum", () => {
    const inputs = dateInputs(render({ entryType: "national_visa" }));
    expect(inputs.length).toBe(berlinPack.inputs.filter((i) => i.type === "date").length);
    for (const i of inputs) {
      expect(i).toContain(`min="${MIN_DATE}"`);
      expect(i).toContain(`max="${MAX_DATE}"`);
    }
  });

  it("shows no error for empty or valid dates", () => {
    const html = render({ entryType: "national_visa", moveInDate: "2026-11-11" });
    expect(html).not.toContain("field-error");
    expect(html).not.toContain("aria-invalid");
  });

  it("explains an extreme date next to the field, and links it to the input", () => {
    const html = render({ entryType: "national_visa", moveInDate: "9999-12-31" });
    expect(html).toContain("between 1 Jan 2000 and 31 Dec 2100");
    expect(html).toContain("It is not used until you change it");
    expect(html).toMatch(/id="in-moveInDate"[^>]*aria-invalid="true"[^>]*aria-describedby="in-moveInDate-error"/);
    expect(html).toContain('id="in-moveInDate-error"');
    expect(html).toContain('role="alert"');
  });

  it("flags only the field that is wrong", () => {
    const html = render({ entryType: "national_visa", moveInDate: "2026-11-11", visaEndDate: "1999-01-01" });
    expect(html.match(/field-error/g)?.length).toBe(1);
    expect(html).toContain('id="in-visaEndDate-error"');
    expect(html).not.toContain('id="in-moveInDate-error"');
  });
});
