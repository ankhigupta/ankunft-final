# Pre-window research (credited)

The four JSON files in `src/data/` are **research output produced before the build window opened (14 Nov 2026, 00:00 IST)**. The organisers confirmed by email that pre-window research and design (source list, requirements) may be reused, with credit.

- `berlin-student.pack.json`: the researched source list (16 sources, see below), the 12 arrival tasks, their requirements with the basis for each, deadlines, and two documented source conflicts. Verified 2026-10-23.
- `berlin-student.corpus.json`: 50 short paraphrased passages with locators, written from the same sources. One passage (P009) had an extra hint question added inside the window.
- `qa-gold.json` (54 questions) and `qa-gold-heldout.json` (20 questions): the gold question sets used by `npm run eval`. The questions are unchanged from before the window; the `note` fields were reworded inside the window. The second set was used for tuning in the earlier prototype, so it is a regression check, not an independent test.

## Sources: primary and secondary

The pack marks each of the 16 sources as primary (10) or secondary (6). The app keeps primary and secondary sources apart. "Primary" here means the law itself or the authority that applies it. It does not mean every source is an official publication in its original place.

- **Primary, statutes on the official federal law portal (3):** S1 and S2 (Bundesmeldegesetz §17 and §19), S12 (Aufenthaltsgesetz §16b).
- **Primary, authorities and public services (7):** S3, S4, S5 and S10 (Service Berlin pages), S6 (Berlin immigration office, appointments), S11 (Rundfunkbeitrag service of ARD, ZDF and Deutschlandradio, which is not a ministry), S13 (a copy of the Foreign Office (Auswärtiges Amt) visa leaflet D3f on proof of financing, hosted on the German embassy in Tbilisi's website; the pack marks it primary, but it is one embassy's copy of a visa-stage leaflet, so check the current version for your own embassy).
- **Secondary (6):** S7 (Make it in Germany, a federal information portal that summarises requirements and is not the deciding authority), S8 and S9 and S15 (TU Berlin and FU Berlin pages), S14 (HfM Berlin page), and S16.
- **S16 is a third-party copy** of the Rundfunkbeitragsstaatsvertrag (consolidated text) hosted by media-perspektiven.de, not the official publication. The pack marks it as a statute mirror with secondary reliability.

Credit for the source texts belongs to their publishers, named in the pack for each source. The passages in the corpus are our paraphrases, not quotations.

All application code in this repository (schema, validator, planner, Q&A, UI, tests) was written inside the window and is committed step by step. Parts of the Q&A logic and the schema overlap closely with the earlier prototype; see "Disclosure on reuse" in `README.md`.
