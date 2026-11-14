import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ErrorPage from "./error";

describe("error boundary page", () => {
  const html = renderToStaticMarkup(createElement(ErrorPage, { error: new Error("boom"), retry: () => {} }));

  it("tells the person something went wrong and announces it", () => {
    expect(html).toContain("Something went wrong");
    expect(html).toContain('role="alert"');
  });

  it("offers to try again and to clear saved data, as real buttons", () => {
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Try again<\/button>/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Clear saved data and start again<\/button>/);
  });

  it("does not show the technical error to the person", () => {
    expect(html).not.toContain("boom");
  });
});
