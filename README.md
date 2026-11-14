# Ankunft: an arrival planner for international students in Berlin

Ankunft is a dependency-aware arrival plan plus cited Q&A for **non-EU students arriving in Berlin on a national study visa**. It answers three questions: what to do first, what each step is waiting on, and where each rule comes from.

It is not a chatbot. The planner runs on explicit rules over a researched data pack, and the Q&A only shows saved passages from official pages with their sources. When the sources do not say, it says so.

Live demo: https://ankunft.vercel.app/ *(update this link if the final deployment has a different URL)*

## What it does

- **Plan.** Enter how you entered Germany and your dates. You get one next step, the steps you can start now, and the steps that are waiting on something, each with the reason. Statuses: overdue, due soon, ready, blocked, done, good to know.
- **Dependencies.** Every requirement is tagged with why it exists: law, authority rule, stated order, or our assumption. Nothing is shown as official without a source.
- **Deadlines.** A date is computed only where a source gives a rule (for example move-in + 14 days for Anmeldung). Only legal or authority deadlines can make a step overdue. University guidance is labelled "guidance, not a legal date". If no source gives a deadline, none is shown.
- **Ask.** Retrieval over 50 saved passages. Three outcomes: answer (with source, locator, retrieval date), abstain (not in the sources, or not Berlin), refuse (asks for a judgement on your own case, a legal outcome or a prediction).
- **Conflicts.** Where official sources disagree (earliest date to apply for the permit; foreign health insurance), both statements are shown. Ankunft does not pick a side.

## Run it

Requires Node 22.12 or newer.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests
npm run eval       # Q&A evaluation
npm run lint
npm run build && npm start
```

No environment variables. No external services. No model calls.

## Layout

| Path | What it is |
| --- | --- |
| `src/lib/pack/` | Zod schema and validator for the data pack. Rejects unknown references, dependency cycles, authority claims without a source, and invented date rules. |
| `src/lib/planner/` | Date arithmetic and the planner engine. |
| `src/lib/qa/` | Text normalisation, BM25 retriever (behind a `Retriever` interface), answer / abstain / refuse logic, evaluation harness. |
| `src/app/api/ask/` | `POST /api/ask` with `{question, today?}`. |
| `src/components/` | The interface. |
| `src/data/` | Pre-window research data (see below) and gold questions. |

## Trust rules

1. The planner uses rules, not a model.
2. Official sources only. Primary sources (law, authorities) are separated from secondary ones (universities, portals).
3. Legal requirements and inferred dependencies are kept apart and labelled differently.
4. No invented deadlines. Where none was found, the page says so.
5. Passages are paraphrases of the source pages and are labelled as such. Open the source before acting.
6. Berlin only. Questions about other cities abstain.

## Q&A evaluation

`npm run eval` runs two question sets. Both were written **before the build window**.

| | Right passage in answer | Right passage first | Abstain correct | Refuse correct |
| --- | --- | --- | --- | --- |
| Main set (38 answerable, 10 abstain, 6 refuse) | 37/38 | 33/38 | 10/10 | 6/6 |
| Second set (12 answerable, 5 abstain, 3 refuse) | 11/12 | 10/12 | 5/5 | 3/3 |

Honest reading: the second set was used for tuning in an earlier prototype, so it is a regression check, not an independent test. Neither set is blind, and both were written by the builder. Safety (abstain and refuse) must stay at 100% in the test suite. Known misses are listed by the eval itself.

## Build history and credits

The build window for the final round opened on 14 Nov 2026 at 00:00 IST. The organisers confirmed by email that a new repository must be used and that pre-window research and design may be reused with credit.

- **Written inside the window (this repository's commits):** all application code: schema and validator, planner, retriever and answer logic, evaluation harness, API route, interface, tests.
- **Pre-window research, reused with credit** (see `RESEARCH.md`): `berlin-student.pack.json` (sources, tasks, requirements, deadlines, conflicts), `berlin-student.corpus.json` (50 paraphrased passages), and the two gold question files.
- **Earlier prototype:** an earlier version of Ankunft was submitted in Prototype Round 1 from a different repository. No code from it is used here.
- **Libraries:** Next.js, React, Zod, Vitest, tsx, and the Atkinson Hyperlegible Next font (Fontsource).
- **AI assistance:** the code was written with Claude (Anthropic) and is committed with a co-author trailer.

## Known limits

- **Not verified against the raw pages.** Specific figures (14 days, 992 and 11,904 EUR, fees, 4 months versus 8 weeks) come from our research notes. The passages are paraphrases, not verbatim quotes.
- **Open questions are shown in the app** under "Not verified" on each step: shared-flat and sublet cases, registering before move-in, appointment booking before the landlord's confirmation, and others.
- The 14-day Anmeldung date is move-in + 14 days with no weekend or holiday adjustment. It says to confirm counting with the registration office.
- Retrieval is lexical (BM25 with a small synonym list). It misses some phrasings and has no semantic understanding.
- Berlin and national-visa entrants only.
- No accounts and no server storage. Progress is saved in the browser only.
- Not legal advice.
