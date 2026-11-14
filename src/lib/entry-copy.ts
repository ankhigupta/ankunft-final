import type { Plan } from "./planner/engine";

/**
 * What to say when the plan does not cover the chosen entry route. This is the app's own wording; the pack's
 * research text is used as it is for the case it was written for (visa-free entry).
 */
export type NotCoveredNotice = { title: string; body: string };

export function notCoveredNotice(plan: Pick<Plan, "unsupportedValue" | "unsupportedMessage">): NotCoveredNotice {
  if (plan.unsupportedValue === "unsure") {
    return {
      title: "Choose how you entered Germany.",
      body:
        "Ankunft currently plans only for students who entered on a German national study visa. It cannot tell which " +
        "entry route applies to you. If you are not sure, check your visa, or ask the German embassy, your university's " +
        "international office or the immigration office (LEA). If you did enter on a national study visa, choose " +
        "\u201cNational study visa\u201d above.",
    };
  }
  return { title: "Not covered yet.", body: plan.unsupportedMessage ?? "" };
}
