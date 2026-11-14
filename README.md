# Ankunft: an arrival planner for international students in Berlin

Ankunft is a dependency-aware arrival plan plus cited Q&A for **non-EU students arriving in Berlin on a national study visa**. It answers three questions: what to do first, what each step is waiting on, and where each rule comes from.

It is not a chatbot. The planner runs on explicit rules over a researched data pack, and the Q&A only shows saved passages from official pages with their sources. When the sources do not say, it says so.

Live demo: https://ankunft.vercel.app/ *(update this link if the final deployment has a different URL)*

## What it does

- **Plan.** Enter how you entered Germany and your dates. You get one next step, the steps you can start now, and the steps that are waiting on something, each with the reason. Statuses: overdue, due soon, ready, blocked, done, good to know.
- **Dependencies.** Every requirement is tagged with why it exists: law, authority rule, stated order, or our assumption. Nothing is shown as official without a source.
- **Deadlines.** A date is computed only where a source gives a rule (for example move-in + 14 days for Anmeldung). Only legal or authority deadlines can make a step overdue. University guidance is labelled "guidance, not a legal date". If no source gives a deadline, none is shown.
- **Ask.** Free-form questions, sorted into kinds that are not treated alike:
  - *Answer from the saved passages* (50 of them): with source, locator and retrieval date.
  - *Guidance from your plan*: "just landed, what should I do?" or "anything I can do while waiting for my appointment?" are not lookups. They are answered from the details you entered, the pack's rules and its own notes, with sources, and say so. If you have entered nothing, you get the cited general list of steps and a note that it is not ordered for you.
  - *A question back*: a one-word or vague question gets example questions taken from the saved passages, each checked to be answerable.
  - *Abstain*: not in the sources, not Berlin, or a place or topic the sources do not cover (flat-hunting, work hours, a library's address).
  - *Refuse*: asks for a judgement on your own case, a legal outcome or a prediction.
- **Conflicts.** Where official sources disagree (earliest date to apply for the permit; foreign health insurance), both statements are shown. Ankunft does not pick a side.

## Run it

Requires Node 22.12 or newer.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests
npm run eval       # Q&A evaluation (six sets, see below)
npm run test:e2e   # browser checks against a running app (see scripts/e2e-interactions.mjs)
npm run lint
npm run build && npm start
```

No environment variables. No external services. No model calls.

## Layout

| Path | What it is |
| --- | --- |
| `src/lib/pack/` | Zod schema and validator for the data pack. Rejects unknown references, dependency cycles, authority claims without a source, and invented date rules. |
| `src/lib/planner/` | Date arithmetic and the planner engine. |
| `src/lib/qa/` | Text normalisation, BM25 retriever (behind a `Retriever` interface), answer / abstain / refuse logic, the intent check and guidance builder for "what should I do?" questions, evaluation harness. |
| `src/app/api/ask/` | `POST /api/ask` with `{question, today?, state?}`. `state` is the person's entries, checked field by field like saved data; it is used only for guidance questions. |
| `src/components/` | The interface. |
| `src/data/` | Pre-window research data (see below) and gold questions. |

## Trust rules

1. The planner uses rules, not a model.
2. Primary sources (laws and authorities) first; secondary sources (universities, portals and mirrors) are clearly labelled.
3. Legal requirements and inferred dependencies are kept apart and labelled differently.
4. No invented deadlines. Where none was found, the page says so.
5. Passages are paraphrases of the source pages and are labelled as such. Open the source before acting.
6. Berlin only. Questions about other cities abstain.

## Q&A evaluation

`npm run eval` runs six question sets. **None of them is independent evidence of how well Ankunft generalises.** The builder wrote every question, and the retrieval vocabulary, ranking rules and guards in this repository were tuned while the sets were visible. Read the tables as regression checks, with the groups kept apart. Results are from the code at this commit, on 15 Nov 2026.

### 1. Existing gold sets (written before the build window)

| Set | Answerable: right passage in the answer | Right passage first | Abstain correct | Refuse correct |
| --- | --- | --- | --- | --- |
| Main (38 answerable, 10 abstain, 6 refuse) | 38/38 | 35/38 | 10/10 | 6/6 |
| Second (12 answerable, 5 abstain, 3 refuse) | 11/12 | 10/12 | 5/5 | 3/3 |

Both were written by the builder. The second was used for tuning in an earlier prototype, and both were visible while this repository's vocabulary and ranking were tuned. They are regression checks, not tests. Their questions and expected answers are unchanged.

### 2. Tuned regression sets (`eval/`, written by the person who fixed the failures)

Each was written after the failure it covers was diagnosed, with new wording, but by the same person and for the same mechanisms. Passing them shows the fixes hold; it does not show the system generalises.

| Set | Cases | Answer correct | First passage ok | Abstain correct | Refuse correct | Wrong-topic passages shown |
| --- | --- | --- | --- | --- | --- | --- |
| `qa-unseen.json` | 79 | 42/42 | 41/42 | 27/27 | 10/10 | 0 |
| `qa-batch4.json` | 30 | 13/16 | 12/16 | 13/13 | 1/1 | 0 |
| `qa-conversational.json` | 35 | 35/35 correct outcome (guidance 12/12, answer 9/9, abstain 13/13, refuse 1/1) | | | | |

`qa-batch4.json` was also used to choose one parameter (the size of a section-title bonus), and three of its misses are known and listed by `npm run eval`. The conversational set checks the *kind* of response (guidance, answer, a question back, abstain, refuse), not only the passage.

### 3. Partially exposed holdout (`eval/qa-holdout.json`, 34 cases)

Written before the batch-3 fixes. After its first run, eight cases led to fixes or were investigated directly (h06, h08, h12, h15, h19, h20, h23, h32), so they are no longer blind and each says so in its note.

| Subset | Cases | Answer correct | First passage ok | Abstain correct | Refuse correct |
| --- | --- | --- | --- | --- | --- |
| All | 34 | 19/19 | 17/19 | 12/12 | 3/3 |
| Not exposed | 26 | 15/15 | 13/15 | 9/9 | 2/2 |
| Exposed | 8 | 4/4 | 4/4 | 3/3 | 1/1 |

Even the 26 "not exposed" cases are not blind: the builder saw all 34 results, and general changes made for the eight may have helped the others.

### 4. Genuinely blind results

There is one, and it is historical. The holdout was run once before any fix was made against it: right passage in the answer 15/19, abstain 9/12, refuse 2/3 (34 questions, one author, measured once). It cannot be repeated blind, because the failures it showed were then fixed. **There is no evaluation by anyone other than the builder, and no result here should be read as accuracy on real users' questions.**

What the sets do guarantee: abstention and refusal stay at 100% on the gold sets and on every set above, in the test suite. Known misses are printed by `npm run eval`. The evaluation data was not edited to improve these numbers; the only edits since the sets were written are the explanatory `note` fields on the holdout cases.

## Build history and credits

The build window for the final round opened on 14 Nov 2026 at 00:00 IST. The organisers confirmed by email that a new repository must be used and that pre-window research and design may be reused with credit.

- **Written inside the window (this repository's commits):** the application code: schema and validator, planner, retriever and answer logic, evaluation harness, API route, interface, tests. Some of it overlaps with the earlier prototype; see "Disclosure on reuse" below.
- **Pre-window research, reused with credit** (see `RESEARCH.md`): `berlin-student.pack.json` (sources, tasks, requirements, deadlines, conflicts), `berlin-student.corpus.json` (50 paraphrased passages), and the two gold question files (`qa-gold.json`, `qa-gold-heldout.json`). The data files were edited in this repository only in small ways: one extra hint question on passage P009, and reworded `note` fields in the gold files (the 74 questions themselves are unchanged).
- **Earlier prototype:** an earlier version of Ankunft was submitted in Prototype Round 1 from a different repository. This repository was started fresh and is not a fork or a copy of it, but it is not free of overlap either; see "Disclosure on reuse" below.
- **Libraries:** Next.js, React, Zod, Vitest, tsx, and the Atkinson Hyperlegible Next font (Fontsource).
- **AI assistance:** the code was written with Claude (Anthropic) and is committed with a co-author trailer.

### Disclosure on reuse

Checked by comparing this repository with the earlier prototype's files.

- The application was built in this fresh repository during the build window. Its commits are all dated 14 Nov 2026.
- Pre-window research, requirements, source data and design materials were reused with credit, following the organisers' written guidance. The reused data are the pack, the corpus and the gold question files, listed above. Pack and gold questions are unchanged; the corpus has the one edit noted above.
- Some Q&A design rules were recreated from the earlier prototype's behaviour: the refusal categories, the list of other German cities that triggers a "Berlin only" abstain, and the retrieval thresholds (`MIN_COVERAGE` 0.55, `MAX_PASSAGES` 3, `RELATIVE_CUTOFF` 0.7, `OLD_PAGE_YEARS` 3). In `src/lib/qa/answer.ts` this was **not a clean-room rewrite**: the refusal regular expressions, the city list, the thresholds, the decision-source ids (S4, S6), the type definitions and most user-facing refusal and abstain messages are word-for-word the same as in the prototype. About two thirds of that file matches the prototype by line similarity. The in-window changes to it are a minimum-two-content-words guard, a work-hours scope guard (replacing the prototype's generic-terms check), and reformatting.
- `src/lib/pack/schema.ts` also shares roughly 30 identical lines (Zod field definitions) with the prototype's schema. The retriever (BM25) and the tokeniser follow the same design as the prototype, with different parameters (k1 1.4 / b 0.6 here, 1.2 / 0.75 there) and different synonym and stopword code. The planner, validator, interface and tests are substantially different from the prototype's.
- Some files are byte-identical to the prototype. They are Create Next App boilerplate (config files, `public/` icons, `favicon.ico`, `.gitignore`, `AGENTS.md`) plus the five-line `src/app/page.tsx`.
- We cannot say from the files alone whether the overlapping code in `answer.ts` and `schema.ts` was typed again from the prototype or copied. We therefore do not claim that no source was copied.
- The organisers' guidance covered reuse of pre-window research and design with credit. We do not claim it explicitly approved reuse of implementation-specific logic, so the overlapping Q&A rules are disclosed here for the organisers to judge.

## Known limits

- **Not verified against the raw pages.** Specific figures (14 days, 992 and 11,904 EUR, fees, 4 months versus 8 weeks) come from our research notes. The passages are paraphrases, not verbatim quotes.
- **Open questions are shown in the app** under "Not verified" on each step: shared-flat and sublet cases, registering before move-in, appointment booking before the landlord's confirmation, and others.
- The 14-day Anmeldung date is move-in + 14 days with no weekend or holiday adjustment. It says to confirm counting with the registration office.
- Retrieval is lexical (BM25 with a small synonym list). It misses some phrasings and has no semantic understanding.
- Berlin and national-visa entrants only.
- No accounts and no server storage. Progress is saved in the browser only.
- Not legal advice.
