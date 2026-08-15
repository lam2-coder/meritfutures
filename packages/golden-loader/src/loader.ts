// =============================================================================
// packages/golden-loader/src/loader.ts
// =============================================================================
// THE LOADER. STRATEGY section 3.2 gives it in one sentence: it "reads
// `packages/rules-engine/fixtures/GS-*.yaml`, resolves `plan` and `calendar`
// against the fixture plan and calendar directories, folds the day stream
// through the real engine, and diffs the result against the expected end-state
// JSON field by field". P1 section 2.2 gives it its one structural obligation:
// it "reads a directory and imports the engine's public entry point only".
//
// THERE IS NO PER-FIXTURE TEST CODE, and that is the design rather than an
// economy. A fixture that can carry its own assertion is a fixture that can
// quietly acquire a weaker one.
//
// EVERY RULE BELOW CARRIES AN `L-nn` AND THROWS WITH IT. The corpus already
// paid for the lesson that a check exiting non-zero is not the same as a check
// failing on the finding it was aimed at: two of the eleven corpus gates were
// failing off-target and would have been scored as working (STRATEGY section
// 4.4). ../test/loader.test.ts seeds one violation per rule and asserts the
// rule id that comes back, which is falsify.mjs's discipline at this scale.
// =============================================================================

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  AccountId,
  AccountState,
  Cents,
  DayMark,
  EngineInput,
  PlanConfigVersion,
  PlanVersionId,
  TradingDay,
} from '@merit/rules-engine';

import { snakeToCamel } from './compare.js';
import { parseYamlSubset, type YamlValue } from './yaml.js';

// -----------------------------------------------------------------------------
// Compile-time assertions, in the shape packages/rules-engine/src/types.ts uses
// -----------------------------------------------------------------------------
// `false` rather than `never`, because `never` satisfies every constraint and an
// assertion phrased against it passes in exactly the case it exists to catch.

type Assert<T extends true> = T;
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// -----------------------------------------------------------------------------
// Where each engine input field comes from, and the assertion that keeps the
// map total
// -----------------------------------------------------------------------------
// THE POINT OF THESE THREE MAPS IS THAT M01 CANNOT WIDEN THE ENGINE'S INPUT
// TYPES WITHOUT THIS FILE FAILING TO COMPILE. The moment `PlanConfigVersion`
// grows `winDayFloorCents`, `_PlanKeysAreTotal` stops type-checking, the key is
// added here, and every plan record in fixtures/plans is then REQUIRED to carry
// it. A loader that silently defaulted the new field would hand the engine a
// parameter no fixture author chose, which is the defaulting DATA_MODEL
// section 12 forbids arriving through the test harness.

/** `PlanConfigVersion` field -> the key it is read from in a plan record. */
const PLAN_CONFIG_SOURCE = {
  planVersionId: 'plan_version_id',
} as const;
type _PlanKeysAreTotal = Assert<Equals<keyof typeof PLAN_CONFIG_SOURCE, keyof PlanConfigVersion>>;

/** `DayMark` field -> the key it is read from in a `days:` row. */
const DAY_MARK_SOURCE = {
  tradingDay: 'trading_day',
  openingBalanceCents: 'opening_balance_cents',
  closingBalanceCents: 'closing_balance_cents',
  highBalanceCents: 'high_balance_cents',
  lowBalanceCents: 'low_balance_cents',
  realizedPnlCents: 'realized_pnl_cents',
  fillCount: 'fill_count',
  tradedDay: 'traded_day',
} as const;
type _DayKeysAreTotal = Assert<Equals<keyof typeof DAY_MARK_SOURCE, keyof DayMark>>;

/** `AccountState` field -> the key it is read from in the `account:` block. */
const ACCOUNT_SOURCE = {
  sizeCents: 'size_cents',
} as const;

/**
 * `AccountState` fields the loader supplies rather than reads.
 *
 * Both are identifiers rather than rule inputs: `accountId` is derived from the
 * scenario id so a fixture run is reproducible and nameable, and
 * `planVersionId` comes from the resolved plan record, because an evaluation
 * that could be run against a version the account is not pinned to is the
 * retroactive-change hole `0027`'s trigger exists to close.
 */
const ACCOUNT_SYNTHESIZED = ['accountId', 'planVersionId'] as const;

type _AccountKeysAreTotal = Assert<
  Equals<keyof typeof ACCOUNT_SOURCE | (typeof ACCOUNT_SYNTHESIZED)[number], keyof AccountState>
>;

// -----------------------------------------------------------------------------
// The fields the corpus's fixture format states and the scaffold's engine types
// have no home for
// -----------------------------------------------------------------------------
// GOLDEN_SCENARIOS section 2's printed example carries `account.phase`,
// `account.opened_on`, `days[].adjustment_cents` and `settlements`. The engine
// types written at the scaffold do not declare any of them, and
// packages/rules-engine/src/types.ts says why in its own words: "THE FIELD SETS
// BELOW ARE THE SCAFFOLD'S, NOT M01's".
//
// THE CHOICE HERE IS BETWEEN DROPPING THEM SILENTLY AND NAMING THEM. A dropped
// input on a money path is the worst available outcome: the fixture states a
// condition, the engine never sees it, and the scenario passes while pinning
// something else. So the loader refuses any fixture field it can neither map
// nor find on this list, the list is one visible place, and adding to it is a
// diff a reviewer reads.
//
// IT CANNOT ROT INTO A PERMANENT EXCUSE EITHER. L-14 asserts every entry is
// actually used by some fixture, so an entry whose field stops appearing has to
// be deleted rather than inherited.
const AWAITING_M01_INPUT = [
  'account.phase',
  'account.opened_on',
  'days[].adjustment_cents',
  'settlements',
] as const;

/** The fixture keys this loader knows about at the top level. */
const FIXTURE_KEYS = new Set([
  'id',
  'name',
  'source',
  'plan',
  'calendar',
  'account',
  'days',
  'settlements',
]);

/**
 * The keys the expectation sibling may carry.
 *
 * `note` is the only one that is not read: it is where a fixture author records
 * why the expectation pins what it pins, beside the values rather than in a
 * commit message nobody reads next to the file.
 */
const EXPECTATION_KEYS = new Set(['end_state', 'events', 'pins', 'note']);

const ID_PATTERN = /^GS-\d{3}$/;
const TRADING_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/** A fixture that does not load, always naming the rule that refused it. */
export class FixtureError extends Error {
  readonly rule: string;
  readonly file: string;

  constructor(rule: string, file: string, message: string) {
    super(`${rule} ${basename(file)}: ${message}`);
    this.name = 'FixtureError';
    this.rule = rule;
    this.file = file;
  }
}

// -----------------------------------------------------------------------------
// Paths
// -----------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The workspace root, three levels up from `packages/golden-loader/src`.
 *
 * IT IS VERIFIED RATHER THAN ASSUMED. A check that cannot reach its inputs
 * throws; it does not report that it found nothing wrong.
 */
export const REPO_ROOT = ((): string => {
  const root = resolve(HERE, '../../..');
  if (!existsSync(join(root, 'pnpm-workspace.yaml'))) {
    throw new Error(`the workspace root is not where the loader expects it: ${root}`);
  }
  return root;
})();

/** GOLDEN_SCENARIOS section 2 fixes this path, and the corpus cites it. */
export const FIXTURE_DIR = join(REPO_ROOT, 'packages/rules-engine/fixtures');

export const REGISTRY_PATH = join(REPO_ROOT, 'docs/testing/GOLDEN_SCENARIOS.md');

// -----------------------------------------------------------------------------
// The registry
// -----------------------------------------------------------------------------

/**
 * Every scenario identifier the registry defines.
 *
 * DELIBERATELY THE SAME QUERY AS `gs_count` IN scripts/corpus/gates.mjs:
 * distinct `GS-\d{3}` identifiers in GOLDEN_SCENARIOS.md. Two expressions of
 * one concept is OQ-P1-04's defect and the honest position is that this is a
 * second one; unifying them means the corpus runner exporting a membership
 * helper, which is a change to scripts/corpus this session is scoped out of.
 * Recorded rather than smoothed over: if these two ever disagree, this one is
 * the one that is wrong.
 */
export function registryIds(registryPath: string = REGISTRY_PATH): Set<string> {
  if (!existsSync(registryPath)) {
    throw new Error(`the golden scenario registry is missing: ${registryPath}`);
  }
  const body = readFileSync(registryPath, 'utf8');
  return new Set([...body.matchAll(/\b(GS-\d{3})\b/g)].map((m) => m[1] as string));
}

// -----------------------------------------------------------------------------
// Small readers, each of which throws rather than coercing
// -----------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, YamlValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(file: string, rule: string, owner: string): Record<string, unknown> {
  if (!existsSync(file)) throw new FixtureError(rule, owner, `no such file: ${file}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (cause) {
    throw new FixtureError(rule, owner, `${basename(file)} is not valid JSON: ${String(cause)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new FixtureError(rule, owner, `${basename(file)} must hold a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function requireInteger(
  value: YamlValue | undefined,
  rule: string,
  file: string,
  what: string,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new FixtureError(
      rule,
      file,
      `${what} must be an integer, found ${JSON.stringify(value)}`,
    );
  }
  return value;
}

// -----------------------------------------------------------------------------
// The fixture
// -----------------------------------------------------------------------------

/** The expected end state, which lives in the JSON sibling and nowhere else. */
export interface FixtureExpectation {
  /** Fields the scenario pins, keyed as the fixture writes them. */
  readonly end_state: Readonly<Record<string, unknown>>;
  /** Event types, in order. */
  readonly events: readonly string[];
  /** Which operator or ordering this scenario exists to protect. */
  readonly pins: string;
}

export interface GoldenFixture {
  readonly id: string;
  readonly file: string;
  readonly name: string;
  readonly source: string;
  readonly planName: string;
  readonly calendarName: string;
  /** Exactly what the engine is called with, and nothing else. */
  readonly input: EngineInput;
  readonly expected: FixtureExpectation;
}

/** A fixture file that would not load, paired with the rule that refused it. */
export interface FixtureFailure {
  readonly file: string;
  readonly error: FixtureError;
}

export interface LoadResult {
  readonly fixtures: readonly GoldenFixture[];
  readonly failures: readonly FixtureFailure[];
}

/**
 * The JSON sibling's path for a fixture.
 *
 * STRATEGY section 2 and GOLDEN_SCENARIOS section 2 both rule the format as
 * "YAML plus an expected end-state JSON SIBLING", while section 2's printed
 * example shows the `expect:` block inline in the YAML. THE SIBLING IS THE
 * PHYSICAL LAYOUT AND `expect` IS THE LOGICAL BLOCK IT HOLDS: the sibling is
 * that block, serialized as JSON, which is the reading that keeps both
 * sentences true. L-05 refuses a YAML carrying an `expect` key, because the
 * one thing neither reading permits is a fixture with two of them.
 */
export function expectationPath(yamlFile: string): string {
  return yamlFile.replace(/\.yaml$/, '.expected.json');
}

function loadCalendar(dir: string, name: string, file: string): Set<string> {
  const path = join(dir, 'calendars', `${name}.json`);
  const record = readJson(path, 'L-08', file);

  const sessions = record['sessions'];
  const coverage = record['coverage'];
  if (!Array.isArray(sessions) || !isRecord(coverage as YamlValue)) {
    throw new FixtureError('L-08', file, `calendar ${name} needs "coverage" and "sessions"`);
  }
  const span = coverage as { from?: unknown; to?: unknown };
  if (typeof span.from !== 'string' || typeof span.to !== 'string') {
    throw new FixtureError('L-08', file, `calendar ${name} states no coverage interval`);
  }

  const days = new Set<string>();
  for (const session of sessions) {
    const day = (session as { trading_day?: unknown }).trading_day;
    if (typeof day !== 'string' || !TRADING_DAY_PATTERN.test(day)) {
      throw new FixtureError('L-08', file, `calendar ${name} holds a malformed session`);
    }
    if (day < span.from || day > span.to) {
      throw new FixtureError(
        'L-08',
        file,
        `calendar ${name} holds ${day} outside its own coverage`,
      );
    }
    days.add(day);
  }
  return days;
}

/**
 * Load and validate one fixture.
 *
 * @throws {FixtureError} on the first rule the fixture breaks, naming the rule.
 */
export function loadFixture(yamlFile: string, options: LoadOptions = {}): GoldenFixture {
  const dir = options.fixtureDir ?? FIXTURE_DIR;
  const registry = options.registry ?? registryIds(options.registryPath);

  // L-12  The file parses within the subset. A parse failure is a numbered
  //        rule rather than an unclassified crash, so the falsification suite
  //        can assert it lands on the finding it was aimed at like every other.
  let document: YamlValue;
  try {
    document = parseYamlSubset(readFileSync(yamlFile, 'utf8'));
  } catch (cause) {
    throw new FixtureError(
      'L-12',
      yamlFile,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  if (!isRecord(document)) {
    throw new FixtureError('L-01', yamlFile, 'a fixture must be a YAML mapping');
  }

  // L-05  The expectation lives in the sibling. A YAML carrying `expect` has
  //       two homes for one truth, and the loader would be choosing between
  //       them on behalf of a reader who cannot see that it did.
  if ('expect' in document) {
    throw new FixtureError(
      'L-05',
      yamlFile,
      'the expectation belongs in the .expected.json sibling, not in the YAML',
    );
  }

  // L-02  Unknown keys are refused rather than ignored. A misspelled `dayz:` is
  //       a fixture whose day stream is empty and whose expectation therefore
  //       pins the account-open state of a scenario about day forty.
  for (const key of Object.keys(document)) {
    if (!FIXTURE_KEYS.has(key)) {
      throw new FixtureError('L-02', yamlFile, `unknown fixture key "${key}"`);
    }
  }

  // L-01  The id is well formed and matches the filename it was found under.
  const id = document['id'];
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new FixtureError('L-01', yamlFile, `"id" must match GS-nnn, found ${JSON.stringify(id)}`);
  }
  if (!basename(yamlFile).startsWith(`${id}-`)) {
    throw new FixtureError('L-01', yamlFile, `the filename does not begin with "${id}-"`);
  }

  // L-03  A fixture whose id is not in the registry fails to load
  //       (STRATEGY section 3.2, loader rule 2).
  if (!registry.has(id)) {
    throw new FixtureError('L-03', yamlFile, `${id} is not a scenario in GOLDEN_SCENARIOS.md`);
  }

  const name = document['name'];
  const source = document['source'];
  if (typeof name !== 'string' || name.trim() === '') {
    throw new FixtureError('L-02', yamlFile, '"name" is required');
  }
  if (typeof source !== 'string' || source.trim() === '') {
    throw new FixtureError(
      'L-02',
      yamlFile,
      '"source" must cite the rule the scenario derives from',
    );
  }

  // L-04  The expectation, and its pin.
  const sibling = expectationPath(yamlFile);
  const raw = readJson(sibling, 'L-04', yamlFile);
  for (const key of Object.keys(raw)) {
    if (!EXPECTATION_KEYS.has(key)) {
      throw new FixtureError('L-04', yamlFile, `unknown key "${key}" in the expectation sibling`);
    }
  }
  const endState = raw['end_state'];
  const events = raw['events'];
  const pins = raw['pins'];

  if (typeof pins !== 'string' || pins.trim() === '') {
    // STRATEGY section 3.2, loader rule 1: "A fixture with no `expect.pins`
    // fails to load. A golden file without a stated pin is a regression test
    // wearing a golden file's name."
    throw new FixtureError('L-06', yamlFile, 'the expectation states no "pins"');
  }
  if (typeof endState !== 'object' || endState === null || Array.isArray(endState)) {
    throw new FixtureError('L-04', yamlFile, '"end_state" must be an object');
  }
  if (Object.keys(endState).length === 0) {
    // An empty expectation is the one shape that passes against any engine at
    // all, which makes it the shape a failing fixture decays into.
    throw new FixtureError('L-04', yamlFile, '"end_state" pins no field');
  }
  if (!Array.isArray(events) || events.some((e) => typeof e !== 'string')) {
    throw new FixtureError('L-04', yamlFile, '"events" must be a list of event types');
  }

  // L-07  The plan resolves, and carries every field the engine's config type
  //       declares.
  const planName = document['plan'];
  if (typeof planName !== 'string' || planName.trim() === '') {
    throw new FixtureError('L-07', yamlFile, '"plan" is required');
  }
  const plan = readJson(join(dir, 'plans', `${planName}.json`), 'L-07', yamlFile);
  const planConfig: Record<string, unknown> = {};
  for (const [field, key] of Object.entries(PLAN_CONFIG_SOURCE)) {
    const value = plan[key];
    if (value === undefined) {
      throw new FixtureError('L-07', yamlFile, `plan ${planName} carries no "${key}"`);
    }
    planConfig[field] = value;
  }

  // L-08  The calendar resolves, and every day in the stream is a session it
  //       declares, inside the coverage it declares.
  const calendarName = document['calendar'];
  if (typeof calendarName !== 'string' || calendarName.trim() === '') {
    throw new FixtureError('L-08', yamlFile, '"calendar" is required');
  }
  const sessions = loadCalendar(dir, calendarName, yamlFile);

  // L-09  The account block.
  const account = document['account'];
  if (!isRecord(account)) throw new FixtureError('L-09', yamlFile, '"account" must be a mapping');
  for (const key of Object.keys(account)) {
    // A fixture may not supply an identifier the loader owns. `accountId` is
    // derived from the scenario id and `planVersionId` comes from the resolved
    // plan record, and a fixture stating either could run an evaluation against
    // a version its account is not pinned to, which is the retroactive-change
    // hole `0027`'s trigger exists to close.
    if ((ACCOUNT_SYNTHESIZED as readonly string[]).includes(snakeToCamel(key))) {
      throw new FixtureError(
        'L-09',
        yamlFile,
        `account field "${key}" is supplied by the loader and may not be stated by a fixture`,
      );
    }
    const mapped = Object.values(ACCOUNT_SOURCE).includes(key as never);
    const awaiting = (AWAITING_M01_INPUT as readonly string[]).includes(`account.${key}`);
    if (!mapped && !awaiting) {
      throw new FixtureError('L-09', yamlFile, `account field "${key}" reaches no engine input`);
    }
  }
  const sizeCents = requireInteger(account['size_cents'], 'L-09', yamlFile, 'account.size_cents');

  // L-10  The day stream. Every field DayMark declares is supplied by the
  //       fixture; nothing is derived here.
  //
  //       DERIVING ONE WOULD BE THE LOADER DOING THE ENGINE'S WORK. `traded_day`
  //       is `fill_count > 0` by R-08, and a loader computing it is a loader
  //       that has implemented a rule the fixtures exist to check. So the
  //       fixture states it, the same way it states every other measurement.
  const days = document['days'];
  if (!Array.isArray(days)) throw new FixtureError('L-10', yamlFile, '"days" must be a list');

  const dayMarks: DayMark[] = [];
  let previousDay = '';
  for (const [index, row] of days.entries()) {
    const where = `days[${index}]`;
    if (!isRecord(row)) throw new FixtureError('L-10', yamlFile, `${where} must be a mapping`);

    for (const key of Object.keys(row)) {
      const mapped = Object.values(DAY_MARK_SOURCE).includes(key as never);
      const awaiting = (AWAITING_M01_INPUT as readonly string[]).includes(`days[].${key}`);
      if (!mapped && !awaiting) {
        throw new FixtureError('L-10', yamlFile, `${where} field "${key}" reaches no engine input`);
      }
    }

    const tradingDay = row['trading_day'];
    if (typeof tradingDay !== 'string' || !TRADING_DAY_PATTERN.test(tradingDay)) {
      throw new FixtureError('L-10', yamlFile, `${where}.trading_day must be YYYY-MM-DD`);
    }
    if (!sessions.has(tradingDay)) {
      throw new FixtureError(
        'L-08',
        yamlFile,
        `${where}.trading_day ${tradingDay} is not a session in calendar ${calendarName}`,
      );
    }
    if (tradingDay <= previousDay) {
      // Replay determinism (PT-06) is a property of the ENGINE over arrival
      // order. A fixture is the ordered stream itself, so an out-of-order or
      // repeated day here is a fixture defect rather than a case to exercise.
      throw new FixtureError('L-10', yamlFile, `${where}.trading_day is not after ${previousDay}`);
    }
    previousDay = tradingDay;

    const tradedDay = row['traded_day'];
    if (typeof tradedDay !== 'boolean') {
      throw new FixtureError('L-10', yamlFile, `${where}.traded_day must be true or false`);
    }

    const adjustment = row['adjustment_cents'];
    if (adjustment !== undefined && adjustment !== 0) {
      // Carried-and-ignored is not an option on a money field.
      throw new FixtureError(
        'L-11',
        yamlFile,
        `${where}.adjustment_cents is ${JSON.stringify(adjustment)} and the engine has nowhere to put it`,
      );
    }

    dayMarks.push({
      tradingDay: tradingDay as TradingDay,
      openingBalanceCents: requireInteger(
        row['opening_balance_cents'],
        'L-10',
        yamlFile,
        `${where}.opening_balance_cents`,
      ) as Cents,
      closingBalanceCents: requireInteger(
        row['closing_balance_cents'],
        'L-10',
        yamlFile,
        `${where}.closing_balance_cents`,
      ) as Cents,
      highBalanceCents: requireInteger(
        row['high_balance_cents'],
        'L-10',
        yamlFile,
        `${where}.high_balance_cents`,
      ) as Cents,
      lowBalanceCents: requireInteger(
        row['low_balance_cents'],
        'L-10',
        yamlFile,
        `${where}.low_balance_cents`,
      ) as Cents,
      realizedPnlCents: requireInteger(
        row['realized_pnl_cents'],
        'L-10',
        yamlFile,
        `${where}.realized_pnl_cents`,
      ) as Cents,
      fillCount: requireInteger(row['fill_count'], 'L-10', yamlFile, `${where}.fill_count`),
      tradedDay,
    });
  }

  // L-11  Settlements have no home on `EngineInput` yet, so a fixture may state
  //       the empty list and may not state anything else. M01 folds settlements
  //       into the day stream (M01 section 3.1) and this refusal expires there.
  const settlements = document['settlements'];
  if (settlements !== undefined && (!Array.isArray(settlements) || settlements.length > 0)) {
    throw new FixtureError(
      'L-11',
      yamlFile,
      'settlements are not yet an engine input; only an empty list may be stated',
    );
  }

  const accountState: AccountState = {
    accountId: id as AccountId,
    planVersionId: planConfig['planVersionId'] as PlanVersionId,
    sizeCents: sizeCents as Cents,
  };

  return {
    id,
    file: yamlFile,
    name,
    source,
    planName,
    calendarName,
    input: {
      planConfigVersion: planConfig as unknown as PlanConfigVersion,
      accountState,
      dayMarks,
    },
    expected: {
      end_state: endState as Record<string, unknown>,
      events: events as string[],
      pins,
    },
  };
}

export interface LoadOptions {
  /** Defaults to `packages/rules-engine/fixtures`. */
  readonly fixtureDir?: string;
  readonly registryPath?: string;
  /** Supplied directly by the falsification suite, which builds its own. */
  readonly registry?: Set<string>;
}

/**
 * Load every fixture in a directory.
 *
 * IT COLLECTS FAILURES RATHER THAN THROWING ON THE FIRST. A directory of two
 * hundred fixtures where the first one is malformed should report the first
 * one and the other one hundred and ninety-nine, not stop.
 */
export function loadFixtureDirectory(options: LoadOptions = {}): LoadResult {
  const dir = options.fixtureDir ?? FIXTURE_DIR;
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`the fixture directory is missing: ${dir}`);
  }

  const registry = options.registry ?? registryIds(options.registryPath);
  const fixtures: GoldenFixture[] = [];
  const failures: FixtureFailure[] = [];

  const files = readdirSync(dir)
    .filter((f) => extname(f) === '.yaml')
    .sort()
    .map((f) => join(dir, f));

  for (const file of files) {
    try {
      fixtures.push(loadFixture(file, { ...options, fixtureDir: dir, registry }));
    } catch (cause) {
      const error =
        cause instanceof FixtureError
          ? cause
          : new FixtureError('L-00', file, cause instanceof Error ? cause.message : String(cause));
      failures.push({ file, error });
    }
  }

  return { fixtures, failures };
}

/**
 * L-14. Every entry of `AWAITING_M01_INPUT` is actually used by some fixture.
 *
 * The list is an admission that four fixture fields reach no engine input. An
 * entry nobody uses is an admission nobody is making any more, and leaving it
 * there is how a temporary exception becomes a permanent one. This returns the
 * unused entries; the caller fails on a non-empty result.
 */
export function unusedAwaitingEntries(fixtures: readonly GoldenFixture[]): string[] {
  const raw = fixtures.map((f) => readFileSync(f.file, 'utf8'));
  return AWAITING_M01_INPUT.filter((entry) => {
    const field = entry.includes('.') ? (entry.split('.').pop() as string) : entry;
    return !raw.some((body) => new RegExp(`(^|\\s)${field}:`, 'm').test(body));
  });
}

/** The fixture fields that reach no engine input yet, for reporting. */
export const AWAITING_ENGINE_INPUT: readonly string[] = AWAITING_M01_INPUT;
