/**
 * The live prompt-eval runner: real model, stubbed searches. It samples each
 * fixture with `GeminiClient` (the real transport, URL, and key), answers the
 * model's `search_food` calls from a fresh per-sample stub — every query
 * records its name and offers a deterministic id unique to that query — and
 * grades each answer with `grade.ts`.
 *
 * Gating: the suite only runs with `PROMPT_EVAL=1`, so the normal suite stays
 * green and offline. Under `PROMPT_EVAL=1` the env must name the Gemini
 * coordinates, loaded e.g. with `set -a; . ./.env.development; set +a`.
 *
 * Not a CI test: it calls the live API, costs money, and is non-deterministic.
 * The stubbed tool isolates the prompt — group B needs a live search.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  GeminiClient,
  type PhotoReadResult,
  type PhotoFoodSuggestion,
  type SearchFoodResult,
} from '../../src/photo/gemini.client';
import { gradeRead, passAtK, type ExpectedMeal } from './grade';

/** The two metrics a run may headline; `PROMPT_EVAL_METRIC` names one, unset names neither. */
const HEADLINED_METRICS = ['pass1', 'pass5'] as const;
type HeadlinedMetric = (typeof HEADLINED_METRICS)[number];

/** One fixture's photo score, as the summary line and the headline both read it. */
interface PhotoScore {
  id: string;
  sampleCount: number;
  pass1: number;
  pass5: number;
}

/** The metric the report headlines, from `PROMPT_EVAL_METRIC`; null prints no headline. */
let headlinedMetric: HeadlinedMetric | null = null;

const live = process.env.PROMPT_EVAL === '1';
(live ? describe : describe.skip)('prompt eval (live)', () => {
  const coordinates: NodeJS.ProcessEnv = {};
  let fixtureDirs: string[] = [];
  let samplesPerFixture = 20;

  beforeAll(() => {
    headlinedMetric = selectedMetric();
    requireEnvCoordinate('GEMINI_API_KEY');
    requireEnvCoordinate('GEMINI_MODEL');
    requireEnvCoordinate('GEMINI_API_BASE');
    Object.assign(coordinates, process.env);

    samplesPerFixture = Number(process.env.PROMPT_EVAL_SAMPLES ?? 20);
    if (!Number.isInteger(samplesPerFixture) || samplesPerFixture <= 0) {
      throw new Error(
        `PROMPT_EVAL_SAMPLES must be a positive integer, got "${process.env.PROMPT_EVAL_SAMPLES}"`,
      );
    }

    fixtureDirs = fixtureNames();
    if (fixtureDirs.length === 0)
      throw new Error('prompt eval needs at least one fixture under test/eval/fixtures');
  });

  it(
    'samples each fixture and reports pass@1 / pass@5',
    async () => {
      for (const fixtureId of fixtureDirs) {
        const outcomes = await sampleFixture(fixtureId, samplesPerFixture, coordinates);
        // A fixture with no sample is a harness bug, not a model failure: the run
        // must cover every fixture the configured sample count asks for.
        expect(outcomes).toHaveLength(samplesPerFixture);
      }
    },
    30 * 60_000,
  );
});

/** Every directory under `test/eval/fixtures` is a fixture. */
function fixtureNames(): string[] {
  const fixturesDir = path.join(__dirname, 'fixtures');
  return fs
    .readdirSync(fixturesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/**
 * One sample's stub search: records every query it is asked, and offers a
 * deterministic id unique to that query within the sample. No network, no
 * USDA — the same query always gets the same id, so the grader can check an
 * answer's `searchQuery` carried the `fdcId` it names.
 */
class StubSearch {
  readonly issuedQueries: string[] = [];
  readonly offeredIdsByQuery = new Map<string, number[]>();
  private nextId = 1000;

  async answer(query: string): Promise<SearchFoodResult> {
    this.issuedQueries.push(query);
    const existing = this.offeredIdsByQuery.get(query);
    if (existing !== undefined) return resultFor(query, existing[0]);
    const offered = this.nextId;
    this.nextId += 1;
    this.offeredIdsByQuery.set(query, [offered]);
    return resultFor(query, offered);
  }
}

function resultFor(query: string, fdcId: number): SearchFoodResult {
  return { catalog: [], usda: [{ name: query, fdcId }] };
}

interface SampleOutcome {
  sample: number;
  readable: boolean;
  pass: boolean;
  matchedFoods: number;
  granularity: string;
  failures: string[];
  itemCount: number;
}

async function sampleFixture(
  fixtureId: string,
  samples: number,
  coordinates: NodeJS.ProcessEnv,
): Promise<SampleOutcome[]> {
  const expected = readFixture(fixtureId);
  const image = fs.readFileSync(path.join(__dirname, 'fixtures', fixtureId, expected.photo));
  const outcomes: SampleOutcome[] = [];

  for (let sample = 1; sample <= samples; sample += 1) {
    outcomes.push(await takeSample(expected, image, sample, coordinates));
  }

  printFixtureReport(expected, outcomes);
  return outcomes;
}

function readFixture(fixtureId: string): ExpectedMeal {
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures', fixtureId, 'expected.json'), 'utf8');
  return JSON.parse(raw) as ExpectedMeal;
}

async function takeSample(
  expected: ExpectedMeal,
  image: Buffer,
  sample: number,
  coordinates: NodeJS.ProcessEnv,
): Promise<SampleOutcome> {
  const stub = new StubSearch();
  const client = new GeminiClient(coordinates);
  const answer: PhotoReadResult = await client.readPhoto(
    { mimeType: 'image/jpeg', bytes: image },
    undefined,
    (query: string) => stub.answer(query),
  );
  if (!answer.readable) {
    return {
      sample,
      readable: false,
      pass: false,
      matchedFoods: 0,
      granularity: '—',
      failures: ['unreadable'],
      itemCount: 0,
    };
  }
  const items: PhotoFoodSuggestion[] = answer.items;
  const verdict = gradeRead({
    expected,
    items,
    issuedQueries: stub.issuedQueries,
    offeredIdsByQuery: stub.offeredIdsByQuery,
  });
  return {
    sample,
    readable: true,
    pass: verdict.pass,
    matchedFoods: verdict.matchedFoods,
    granularity: verdict.granularity,
    failures: verdict.failures,
    itemCount: items.length,
  };
}

function printFixtureReport(expected: ExpectedMeal, outcomes: SampleOutcome[]): void {
  const passed = outcomes.filter((outcome) => outcome.pass).length;
  const readable = outcomes.filter((outcome) => outcome.readable).length;
  const photoPass1 = passAtK(outcomes.length, passed, 1);
  const photoPass5 = passAtK(outcomes.length, passed, 5);

  const itemPasses = outcomes.reduce((total, outcome) => total + outcome.matchedFoods, 0);
  const itemTotal = outcomes.length * expected.itemCount;
  const itemPass1 = passAtK(itemTotal, itemPasses, 1);
  const itemPass5 = passAtK(itemTotal, itemPasses, 5);

  const merged = outcomes.filter((outcome) => outcome.granularity === 'merged').length;
  const split = outcomes.filter((outcome) => outcome.granularity === 'split').length;
  const idBindingFailures = outcomes.filter((outcome) =>
    outcome.failures.some(
      (failure) => failure.includes('fdcId') || failure.includes('searchQuery'),
    ),
  ).length;

  console.log(
    `[prompt-eval] ${expected.id}: n=${outcomes.length} readable=${readable}/${outcomes.length} ` +
      `photo pass@1=${photoPass1.toFixed(3)} pass@5=${photoPass5.toFixed(3)} ` +
      `item pass@1=${itemPass1.toFixed(3)} pass@5=${itemPass5.toFixed(3)} ` +
      `merged=${merged} split=${split} id-binding-failures=${idBindingFailures}`,
  );
  printHeadlinedMetric({
    id: expected.id,
    sampleCount: outcomes.length,
    pass1: photoPass1,
    pass5: photoPass5,
  });
  for (const [failure, count] of failureCounts(outcomes)) {
    console.log(`[prompt-eval]   ${count}x ${failure}`);
  }
}

/** Print the one line for the metric `PROMPT_EVAL_METRIC` selected, or nothing when none was selected. */
function printHeadlinedMetric(score: PhotoScore): void {
  if (headlinedMetric === null) return;
  console.log(
    `[prompt-eval] ${score.id}: ${headlinedMetric}=${score[headlinedMetric].toFixed(3)} (n=${score.sampleCount})`,
  );
}

function failureCounts(outcomes: SampleOutcome[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const outcome of outcomes) {
    for (const failure of outcome.failures) {
      counts.set(failure, (counts.get(failure) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

/** Fail loudly when a Gemini coordinate is missing; the suite must never silently run unconfigured. */
function requireEnvCoordinate(name: string): void {
  if (process.env[name]) return;
  throw new Error(
    `${name} is not set — load .env.development first (set -a; . ./.env.development; set +a)`,
  );
}

/**
 * The metric `PROMPT_EVAL_METRIC` asks the report to headline: `pass1` or
 * `pass5`. Unset prints no headline, exactly as before. Any other value throws,
 * so a typo cannot silently headline the wrong metric.
 */
function selectedMetric(): HeadlinedMetric | null {
  const raw = process.env.PROMPT_EVAL_METRIC;
  if (raw === undefined) return null;
  if (HEADLINED_METRICS.includes(raw as HeadlinedMetric)) return raw as HeadlinedMetric;
  throw new Error(`PROMPT_EVAL_METRIC must be ${HEADLINED_METRICS.join(' or ')}, got "${raw}"`);
}
