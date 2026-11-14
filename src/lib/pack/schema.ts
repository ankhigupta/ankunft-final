import { z } from "zod";

/** ISO calendar date, e.g. 2026-10-24. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const SourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  publisher: z.string().min(1),
  authorityType: z.enum(["statute", "statute_mirror", "government_service", "federal_portal", "university"]),
  url: z.url(),
  retrievedOn: isoDate,
  pageDate: isoDate.nullable(),
  pageDateNote: z.string().optional(),
  note: z.string().optional(),
  reliability: z.enum(["primary", "secondary"]),
});
export type Source = z.infer<typeof SourceSchema>;

export const InputDefSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["enum", "date", "boolean"]),
  options: z.array(z.string()).optional(),
  /** When does a given value count as "known"? */
  satisfiedWhen: z.enum(["present", "reached", "true"]),
  help: z.string().optional(),
});
export type InputDef = z.infer<typeof InputDefSchema>;

/** A requirement expression: a task, an input, or a combination. */
export type Expr =
  | { task: string }
  | { input: string }
  | { allOf: Expr[] }
  | { anyOf: Expr[] };

export const ExprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.union([
    z.object({ task: z.string() }).strict(),
    z.object({ input: z.string() }).strict(),
    z.object({ allOf: z.array(ExprSchema).min(1) }).strict(),
    z.object({ anyOf: z.array(ExprSchema).min(1) }).strict(),
  ]),
);

/**
 * Why a requirement exists. "inferred" is allowed by the schema but the pack
 * must say so explicitly; the UI shows it differently from legal basis.
 */
export const BasisSchema = z.enum([
  "legal_requirement",
  "authority_requirement",
  "stated_sequence",
  "inferred",
]);
export type Basis = z.infer<typeof BasisSchema>;

export const RequirementSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  expr: ExprSchema,
  basis: BasisSchema,
  sourceIds: z.array(z.string()),
  note: z.string().optional(),
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const DeadlineKindSchema = z.enum([
  "statutory",
  "authority_stated",
  "university_stated",
  "informational",
  "none_found",
]);
export type DeadlineKind = z.infer<typeof DeadlineKindSchema>;

export const DeadlineSchema = z.object({
  kind: DeadlineKindSchema,
  triggerInput: z.string().nullable(),
  offsetDays: z.number().int().nullable(),
  direction: z.enum(["within", "before_or_on"]).nullable(),
  text: z.string().min(1),
  sourceIds: z.array(z.string()),
});
export type Deadline = z.infer<typeof DeadlineSchema>;

const NoteSchema = z.object({ text: z.string(), sourceIds: z.array(z.string()) });

export const TaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  mode: z.enum(["tracked", "info_only"]),
  completedWhenInput: z.string().optional(),
  appliesWhen: z.string(),
  requirements: z.array(RequirementSchema),
  deadline: DeadlineSchema,
  meanwhileNotes: z.array(NoteSchema),
  conflictIds: z.array(z.string()),
  openQuestions: z.array(z.string()),
});
export type Task = z.infer<typeof TaskSchema>;

export const ConflictSchema = z.object({
  id: z.string().min(1),
  topic: z.string(),
  statements: z.array(z.object({ text: z.string(), sourceIds: z.array(z.string()) })).min(2),
  display: z.string(),
});
export type Conflict = z.infer<typeof ConflictSchema>;

export const PackSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  jurisdiction: z.string(),
  audience: z.string(),
  verifiedOn: isoDate,
  staleAfterDays: z.number().int().positive(),
  inputs: z.array(InputDefSchema),
  supportedWhen: z.array(
    z.object({ input: z.string(), oneOf: z.array(z.string()), unsupportedMessage: z.string() }),
  ),
  sources: z.array(SourceSchema),
  conflicts: z.array(ConflictSchema),
  tasks: z.array(TaskSchema),
});
export type Pack = z.infer<typeof PackSchema>;
