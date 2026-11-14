import { z } from "zod";
import type { Pack } from "../pack/schema";

export const PassageSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  locator: z.string().min(1),
  /** Example questions this passage answers. Indexed to help retrieval; never shown. */
  questions: z.array(z.string()).default([]),
  /** "verbatim" would be an exact quote; everything we ship is a paraphrase and says so. */
  textKind: z.enum(["verbatim", "paraphrase"]),
  text: z.string().min(1),
  conflictIds: z.array(z.string()).optional(),
});
export type Passage = z.infer<typeof PassageSchema>;

export const CorpusSchema = z.object({
  packId: z.string(),
  note: z.string().optional(),
  passages: z.array(PassageSchema).min(1),
});
export type Corpus = z.infer<typeof CorpusSchema>;

/** Every passage must point at a real source and a real conflict, or we refuse to start. */
export function validateCorpus(corpus: Corpus, pack: Pack): string[] {
  const errors: string[] = [];
  const sources = new Set(pack.sources.map((s) => s.id));
  const conflicts = new Set(pack.conflicts.map((c) => c.id));
  const seen = new Set<string>();
  if (corpus.packId !== pack.id) errors.push(`corpus is for pack ${corpus.packId}, not ${pack.id}`);
  for (const p of corpus.passages) {
    if (seen.has(p.id)) errors.push(`${p.id}: duplicate id`);
    seen.add(p.id);
    if (!sources.has(p.sourceId)) errors.push(`${p.id}: unknown source ${p.sourceId}`);
    for (const c of p.conflictIds ?? []) if (!conflicts.has(c)) errors.push(`${p.id}: unknown conflict ${c}`);
  }
  return errors;
}
