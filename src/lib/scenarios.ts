import type { InputValues } from "./planner/engine";

export type Scenario = {
  id: string;
  label: string;
  blurb: string;
  values: InputValues;
  done: string[];
};

/** Demo situations, all pinned to one date so the screen never depends on the real clock. */
export const DEMO_DATE = "2026-11-14";

export const SCENARIOS: Scenario[] = [
  {
    id: "arrived",
    label: "Just arrived, no flat yet",
    blurb: "Housing first. Everything that depends on it stays blocked, with the reason.",
    values: { entryType: "national_visa", arrivalDate: "2026-11-12", visaEndDate: "2027-02-10", hasAdmissionLetter: true },
    done: [],
  },
  {
    id: "moved-in",
    label: "Moved in 3 days ago",
    blurb: "The two-week Anmeldung clock is running. The landlord's confirmation comes first.",
    values: { entryType: "national_visa", arrivalDate: "2026-11-05", moveInDate: "2026-11-11", visaEndDate: "2027-02-10", hasAdmissionLetter: true },
    done: [],
  },
  {
    id: "overdue",
    label: "Moved in 20 days ago",
    blurb: "The statutory registration period has passed. The overdue step rises to the top.",
    values: { entryType: "national_visa", arrivalDate: "2026-10-20", moveInDate: "2026-10-25", visaEndDate: "2027-02-10", hasAdmissionLetter: true },
    done: ["landlord_confirmation"],
  },
  {
    id: "visa-free",
    label: "Entered without a visa",
    blurb: "Out of scope on purpose. Ankunft says so instead of guessing.",
    values: { entryType: "visa_free" },
    done: [],
  },
];
