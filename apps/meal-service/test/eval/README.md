# Prompt eval — meal-photo reader

A live harness that scores the meal-photo prompt (`gemini.client.ts` `PROMPT`)
against committed image fixtures with hand-written expectations. It grades the
model's identity answer **before** `photo.service.ts`'s `OfferedIds` gate, which
is the level the prompt is responsible for: the gate turns a wrong id into "no
data", so grading after it would hide prompt failures.

- `grade.ts` — the pure grader (no network, no disk, no clock).
- `grade.test.ts` — offline unit tests for the grader and the `pass@k` estimator.
- `prompt-eval.test.ts` — the live runner, gated on `PROMPT_EVAL=1`.
- `fixtures/<id>/photo.jpg` and `fixtures/<id>/expected.json` — one fixture per scenario.

The runner is **not a CI test**: it calls the live API, costs money, and is
non-deterministic. Group B (naming and searchability) needs a live search — this
harness stubs the tool, so it isolates the prompt; a stub cannot exercise real
catalog/USDA ranking.

## Run

Load the env first, then pick the metric to headline:

```sh
set -a; . ./.env.development; set +a
npm run eval:pass1 -w apps/meal-service
npm run eval:pass5 -w apps/meal-service
```

| Command | Metric it headlines |
|---|---|
| `npm run eval:pass1 -w apps/meal-service` | `pass@1` — the one-shot number a user actually gets. |
| `npm run eval:pass5 -w apps/meal-service` | `pass@5` — the ceiling if a retry were ever added. |

Both commands sample the same way (`PROMPT_EVAL_SAMPLES=20`) and differ only in
which metric they headline; a run prints the full report line either way.

The run is live: it calls the API, costs money, and is non-deterministic. An n=20
baseline takes about seven minutes. Measured 2026-10-15 at n=20:
`photo pass@1=0.950 pass@5=1.000`.

`PROMPT_EVAL_SAMPLES` overrides the sample count. Unset `PROMPT_EVAL`, the suite
skips — the normal suite stays green and offline. An unrecognised
`PROMPT_EVAL_METRIC` fails the run loudly rather than headline the wrong metric.

## Fixture format — `expected.json`

| Key | Meaning |
|---|---|
| `id` | Fixture id; matches the directory name. |
| `scenario` | Human label for the matrix row it covers. |
| `photo` | Image filename inside the fixture directory. |
| `itemCount` | The exact number of items expected. Fewer grades `merged`, more `split`. |
| `foods[]` | One entry per expected food: `any` (name fragments, substring match on the normalised item name), `requireId` (the matched item must carry a bound `fdcId`). |
| `forbiddenInName[]` | Substrings no normalised item name may contain (dish words, combinations). |
| `note` | Free text: what was observed and why the fixture exists. |

## Adding a fixture

1. `mkdir apps/meal-service/test/eval/fixtures/<id>`, copy the photo in as
   `photo.jpg`, write `expected.json` per the table above.
2. Tick the scenario row below. `grade.ts` reads fixtures generically — no code
   change is needed for a new fixture.
3. `npm run eval:pass1 -w apps/meal-service`.

## Scenario matrix

Only **A3** is covered today; the rest need a photo.

### A. Decomposition
- [ ] A1 one whole food -> 1 item
- [ ] A2 two separable foods -> 2
- [x] **A3 a pot of 3 separable foods -> 3 (covered)**
- [ ] A4 four separable foods
- [ ] A5 six or more (the search cap)
- [ ] A6 a prepared composite eaten as one unit (sandwich, pizza slice, burrito, bowl of cereal) -> exactly 1
- [ ] A7 blended/indistinguishable mixture -> 1 or unreadable
- [ ] A8 the same food twice
- [ ] A9 a visible broth/oil

### B. Naming and searchability
> Needs a live search (this harness stubs the tool, so it isolates the prompt).
- [ ] B1 regional/plural variants (yardlong beans / long beans / snake beans)
- [ ] B2 local-language dish names
- [ ] B3 preparation words stripped
- [ ] B4 branded packaged food

### C. Id binding
- [ ] C1 every `searchQuery` was issued
- [ ] C2 the id came from its own query's result
- [ ] C3 one search per item
- [ ] C4 no guessed ids

### D. Failure honesty
- [ ] D1 a menu, a receipt, a hand, a desk -> unreadable
- [ ] D2 blurry or dark food -> unreadable or one confident guess, never an invented spread
- [ ] D3 an empty plate
- [ ] D4 a package with a nutrition label -> identity only, never the label's numbers

### E. Grams
- [ ] E1 per-food portion plausibility
- [ ] E2 a multi-food sum that does not multiply the whole portion by the item count
- [ ] E3 no zero or absurd weights

### F. Schema survival
- [ ] F1 raw schema-valid rate
- [ ] F2 `readable: false` always carries an empty items array
