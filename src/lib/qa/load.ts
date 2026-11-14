import raw from "@/data/berlin-student.corpus.json";
import { berlinPack } from "../pack/load";
import { CorpusSchema, validateCorpus, type Corpus } from "./corpus";
import { Bm25Retriever } from "./retriever";
import { answerQuestion, type QAResponse } from "./answer";
import type { Situation } from "./guidance";

export function loadCorpus(input: unknown = raw): Corpus {
  const corpus = CorpusSchema.parse(input);
  const errors = validateCorpus(corpus, berlinPack);
  if (errors.length) throw new Error("Invalid corpus:\n  " + errors.join("\n  "));
  return corpus;
}

export const berlinCorpus = loadCorpus();
const retriever = new Bm25Retriever(berlinCorpus.passages);

export function berlinQA(question: string, todayISO: string, situation?: Situation): QAResponse {
  return answerQuestion(question, { pack: berlinPack, corpus: berlinCorpus, retriever, todayISO, situation });
}
