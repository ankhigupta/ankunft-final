import type { Basis, DeadlineKind } from "@/lib/pack/schema";
import type { Status } from "@/lib/planner/engine";

export const STATUS_LABEL: Record<Status, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  blocked: "Blocked",
  ready: "Ready",
  done: "Done",
  info_only: "Good to know",
};

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge status-${status}`}>{STATUS_LABEL[status]}</span>;
}

/** Why a requirement exists. Differentiated by outline style as well as colour. */
const BASIS_LABEL: Record<Basis, string> = {
  legal_requirement: "Law",
  authority_requirement: "Authority rule",
  stated_sequence: "Stated order",
  inferred: "Our assumption",
};

export function BasisBadge({ basis }: { basis: Basis }) {
  return <span className={`basis basis-${basis}`}>{BASIS_LABEL[basis]}</span>;
}

export const DEADLINE_LABEL: Record<DeadlineKind, string> = {
  statutory: "Legal deadline",
  authority_stated: "Authority deadline",
  university_stated: "University guidance",
  informational: "Information, not a deadline",
  none_found: "No official deadline found",
};
