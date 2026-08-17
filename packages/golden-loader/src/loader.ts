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
  DailyMark,
  ResolvedPlan,
  SettlementFact,
  TradingDay,
} from '@merit/rules-engine';

import { calendarRowsFromRecord, CalendarRecordError, type CalendarRows } from './calendar.js';
import { snakeToCamel } from './compare.js';
import { PlanRecordError, resolvePlanRecord } from './plan.js';
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

/**
 * `DailyMark` field -> the key it is read from in a `days:` row.
 *
 * THIS MAP NOW POINTS AT `DailyMark` AND NOT AT `DayMark`, which is the whole
 * of what changed on the input side. `DayMark` is the scaffold's record and
 * `evaluate`'s argument; `DailyMark` is "exactly the live row from
 * `daily_marks`" (M01 section 2.1) and is what `advanceDay` folds. The two
 * differ in three places and each one is a statement: `DailyMark` carries
 * `adjustmentCents` and `sourceHash`, and it carries NO `tradedDay`, because
 * R-08 derives that from `fillCount` and "an engine that read them would be an
 * engine whose breach and win-day arithmetic depended on the ingester agreeing
 * with it".
 */
const DAY_MARK_SOURCE = {
  tradingDay: 'trading_day',
  openingBalanceCents: 'opening_balance_cents',
  closingBalanceCents: 'closing_balance_cents',
  highBalanceCents: 'high_balance_cents',
  lowBalanceCents: 'low_balance_cents',
  realizedPnlCents: 'realized_pnl_cents',
  adjustmentCents: 'adjustment_cents',
  fillCount: 'fill_count',
  sourceHash: 'source_hash',
} as const;
type _DayKeysAreTotal = Assert<Equals<keyof typeof DAY_MARK_SOURCE, keyof DailyMark>>;

/** The `account:` keys that reach the fold. */
const ACCOUNT_SOURCE = {
  sizeCents: 'size_cents',
  phase: 'phase',
  openedOn: 'opened_on',
} as const;

/**
 * Fields the loader supplies rather than reads, with the reason each is not a
 * fixture's to state.
 *
 * `accountId` is derived from the scenario id so a fixture run is reproducible
 * and nameable. `planVersionId` comes from the resolved plan record, because an
 * evaluation run against a version the account is not pinned to is the
 * retroactive-change hole `0027`'s trigger exists to close.
 *
 * `sourceHash` JOINS THEM, AND IT IS THE ONE ADDITION HERE. In the pipeline it
 * is the ingested artifact's digest and it is replay's input for telling a
 * superseded mark from a backdated one (M01 Appendix B.3). `advanceDay` never
 * reads it, no fixture states one, and a loader that invented something
 * digest-shaped would be manufacturing evidence; it carries the scenario and
 * the day instead, which is true and is obviously not a hash.
 */
const ACCOUNT_SYNTHESIZED = ['accountId', 'planVersionId', 'sourceHash'] as const;

// -----------------------------------------------------------------------------
// THE LIST IS EMPTY, AND EMPTYING IT IS WHAT THIS SESSION DID
// -----------------------------------------------------------------------------
// It held four entries: `account.phase`, `account.opened_on`,
// `days[].adjustment_cents` and `settlements`. All four were true of the
// SCAFFOLD's engine types, which is what its old header said: `EngineInput` is
// `{ planConfigVersion, accountState, dayMarks }` and has a home for none of
// them. STATE item 3 said M01 empties the list and this is that.
//
//   account.phase              `RuleState.phase`, through the prior state
//   account.opened_on          `initialState(plan, openedOn, engineVersion)`
//   days[].adjustment_cents    `DailyMark.adjustmentCents` (SD-01, R-10)
//   settlements                `DayInput.settlements` (empty only, see L-11)
//
// THE LIST STAYS, EMPTY, AND IS NOT DELETED. It is the mechanism rather than the
// contents: the loader refuses any fixture field it can neither map nor find
// here, so a format that grows a field the engine cannot take has one visible
// place to declare it and a reviewer reads the diff. An empty list is the
// strongest state it can be in, and L-14 keeps it from silently refilling with
// entries nothing uses.
const AWAITING_M01_INPUT: readonly string[] = [];

/**
 * Fields a fixture states that the ENGINE DERIVES, which is a different thing
 * from a field it has no home for.
 *
 * `traded_day` is `fill_count > 0` by R-08. `DailyMark` carries no such field
 * and `types.ts` is explicit that this is deliberate: the batch writes what it
 * observed, the engine derives it, "and an engine that read them would be an
 * engine whose breach and win-day arithmetic depended on the ingester agreeing
 * with it".
 *
 * SO THE FIXTURE MAY STATE IT AND THE FOLD MAY NOT READ IT, and that is not the
 * silent drop `AWAITING_M01_INPUT` exists to prevent: the value is not lost,
 * it is RECOMPUTED, from `fill_count`, which the fixture also states. A fixture
 * whose `traded_day` disagrees with its own `fill_count` is stating a
 * contradiction, and `L-10` refuses it below rather than letting the fold quietly
 * pick the one it happens to read.
 */
const DERIVED_BY_THE_ENGINE = ['days[].traded_day'] as const;

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

/**
 * M01, which is where `source:` has to land for a citation to be resolvable.
 *
 * A PATH CONSTANT RATHER THAN A GLOB, because M01 is one document and the rule
 * is that a fixture cites the rules engine's specification. `REGISTRY_PATH`
 * above records what happens when a corpus document moves and a reader of it by
 * path is missed; this one is asserted rather than assumed for the same reason,
 * in `m01Identifiers`, which throws when the file is gone instead of returning
 * an empty set that would make every citation unresolvable at once.
 */
export const M01_PATH = join(REPO_ROOT, 'docs/plans/M01-rules-engine.md');

/**
 * ADR-043 split the registry into one file per SECTION, so this is a DIRECTORY.
 *
 * It was `docs/testing/GOLDEN_SCENARIOS.md` until 2026-08-15. The split moved the
 * file and this constant was missed, because the sweep covered markdown and
 * `scripts/` and this is neither: it is application code reading a corpus
 * document by path. CI-02 and CI-03 are what found it, which is the honest
 * version of "every gate reading these by path needs its reader updated" -- the
 * readers are not all gates.
 */
export const REGISTRY_PATH = join(REPO_ROOT, 'docs/testing/golden-scenarios');

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
  // A DIRECTORY OR A SINGLE FILE. Callers in the test suite pass a temporary file
  // to exercise the parse, and the live registry is now a directory, so both are
  // accepted rather than forcing every caller to know which.
  let body: string;
  if (statSync(registryPath).isDirectory()) {
    const files = readdirSync(registryPath)
      .filter((f) => /^\d{2}-.*\.md$/.test(f))
      .sort();
    // The same rule the corpus runner applies to its directory readers: a glob
    // that matches nothing returns an empty set rather than throwing, and an
    // empty registry would make every fixture's pin resolve against nothing and
    // report full coverage of zero scenarios.
    if (files.length === 0) {
      throw new Error(`the golden scenario registry has no section files: ${registryPath}`);
    }
    body = files.map((f) => readFileSync(join(registryPath, f), 'utf8')).join('\n');
  } else {
    body = readFileSync(registryPath, 'utf8');
  }
  return new Set([...body.matchAll(/\b(GS-\d{3})\b/g)].map((m) => m[1] as string));
}

// -----------------------------------------------------------------------------
// M01's identifier space, which is what makes `source:` resolvable
// -----------------------------------------------------------------------------
// P2 section 2's mechanical traceability tier: `source:` "becomes a resolvable
// citation: at least one `R-nn`, `CV-nn` or `INV-nn` that exists in M01".
//
// THE DEFINITION QUERY IS THE LEADING TABLE CELL, NOT A MENTION ANYWHERE IN THE
// FILE, and the difference is the whole value of the rule. M01 mentions `R-31`
// inside INV-06's prose, inside a state-diagram label and inside half a dozen
// other rows; a mention-anywhere query would resolve a citation of a rule the
// document only ever refers to, and the first fixture citing an identifier M01
// discusses but does not define would load clean. A rule, a config validation
// and an invariant are each DEFINED by a row of their own table, so the row is
// the definition and the leading cell is its name.
//
// VERIFIED TOTAL RATHER THAN ASSERTED COUNT: at the time of writing this query
// returns exactly the 93 identifiers a mention-anywhere query returns, which is
// R-01 to R-50, CV-01 to CV-19 and INV-01 to INV-24 with nothing on either side
// that the other lacks. The number is not written down here, for STRATEGY
// section 4.4's reason: a quantity a script can derive does not get stated by
// hand. What IS asserted is that the parse found something at all.

const M01_DEFINITION = /^\|\s*\*{0,2}((?:R|CV|INV)-\d{2})\*{0,2}\s*\|/gm;

/**
 * Every `R-nn`, `CV-nn` and `INV-nn` M01 DEFINES.
 *
 * @throws when M01 is not where this expects it, or when the parse finds no
 * identifier at all. Both are the empty-set case ADR-048 calls the vacuity
 * class: an empty definition set makes every citation unresolvable and would
 * turn `L-13` from a traceability rule into a rule that refuses every fixture
 * in the directory, which reads as a corpus problem and is a reader problem.
 */
export function m01Identifiers(path: string = M01_PATH): Set<string> {
  if (!existsSync(path)) {
    throw new Error(`M01 is not where the loader expects it: ${path}`);
  }
  const ids = new Set(
    [...readFileSync(path, 'utf8').matchAll(M01_DEFINITION)].map((m) => m[1] as string),
  );
  if (ids.size === 0) {
    throw new Error(`M01 defines no R-nn, CV-nn or INV-nn rows: ${path}`);
  }
  return ids;
}

const M01_GROUP_HEADING = /^#+\s*(Group [A-Z]:[^\n]*)$/gm;

/**
 * Each `R-nn` M01 defines, mapped to the rule GROUP whose heading it falls under.
 *
 * ADR-048 REQUIRES COVERAGE TO REPORT POLARITY PER RULE GROUP and rejected
 * deriving polarity itself from the group, "because the group is not written on
 * the fixture and would become a second hand-maintained mapping, which is
 * ADR-034's class". THAT ARGUMENT APPLIES TO THIS FUNCTION TOO and is why it
 * reads M01 rather than restating the eight ranges: `packages/rules-engine`'s
 * `RuleId` carries the same eight boundaries in COMMENTS, which no machine can
 * read, and copying them here would be the second expression of one concept
 * that ADR-034 exists to end. M01 states the groups as headings above the rule
 * tables, so the document that defines a rule is also the one that says which
 * group it is in.
 *
 * A rule under no heading is omitted rather than bucketed into a default. The
 * caller reports it as ungrouped, which is visible; a default group is not.
 */
export function m01RuleGroups(path: string = M01_PATH): Map<string, string> {
  if (!existsSync(path)) {
    throw new Error(`M01 is not where the loader expects it: ${path}`);
  }
  const body = readFileSync(path, 'utf8');

  const headings = [...body.matchAll(M01_GROUP_HEADING)].map((m) => ({
    at: m.index,
    title: m[1] as string,
  }));
  if (headings.length === 0) {
    throw new Error(`M01 states no "Group X:" headings: ${path}`);
  }

  const groups = new Map<string, string>();
  for (const match of body.matchAll(/^\|\s*\*{0,2}(R-\d{2})\*{0,2}\s*\|/gm)) {
    const at = match.index;
    // The last heading at or before the row. A rule row above every heading
    // belongs to no group and is left out, which the report then names.
    let title: string | undefined;
    for (const heading of headings) {
      if (heading.at <= at) title = heading.title;
      else break;
    }
    if (title !== undefined) groups.set(match[1] as string, title);
  }
  return groups;
}

/** Every identifier a `source:` line cites, in the order it cites them. */
export function citedIdentifiers(source: string): string[] {
  // `\b` on both sides is what keeps `ADR-048` from reading as a citation of
  // `R-04` and `RE-U-019` from reading as one of `R-01`: neither has a word
  // boundary before its `R`. A three-digit `R-123` matches nothing either,
  // which is a fixture citing no rule rather than a fixture citing R-12.
  return [...new Set([...source.matchAll(/\b(?:R|CV|INV)-\d{2}\b/g)].map((m) => m[0]))];
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

/**
 * Exactly what the fold is called with, and nothing else.
 *
 * THIS IS `DayInput` MINUS THE TWO FIELDS THAT MOVE PER DAY. `advanceDay` takes
 * `{ engineVersion, plan, prior, mark, calendar, settlements }`; `prior` is the
 * fold's own carry and `mark` is one row of `marks`, so what a fixture supplies
 * is everything else, once, for the whole stream.
 */
export interface FixtureInput {
  readonly plan: ResolvedPlan;
  /**
   * The rows ADR-049's constructor takes, NOT the slice itself.
   *
   * `buildCalendarSlice` is a value import of the engine and this module may not
   * carry one: `check.mjs` loads this file in a tree copy with no
   * `node_modules`. `run.ts` builds the slice, which is one module further out
   * and already holds the engine.
   */
  readonly calendar: CalendarRows;
  /** `accounts.opened_on`. The day `initialState` opens the account on. */
  readonly openedOn: TradingDay;
  /**
   * The phase the account is in before the first mark.
   *
   * `closed` and `graduated` are not startable and L-09 refuses them: both are
   * terminal (R-24, R-49), so a fixture stating one is describing an account no
   * day can be folded against, which `advanceDay` answers with `account_closed`
   * rather than with the scenario's subject.
   */
  readonly startingPhase: 'eval' | 'funded';
  readonly marks: readonly DailyMark[];
  readonly settlements: readonly SettlementFact[];
}

export interface GoldenFixture {
  readonly id: string;
  readonly file: string;
  readonly name: string;
  readonly source: string;
  readonly planName: string;
  readonly calendarName: string;
  readonly accountId: AccountId;
  readonly input: FixtureInput;
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

/**
 * The calendar, as both the day set L-08 checks against and the slice the fold
 * is handed.
 *
 * THE TWO COME FROM ONE READ ON PURPOSE. A loader that validated against a set
 * built here and folded against a slice built somewhere else would have two
 * answers to "is this day a session", and the fixture would be checked against
 * the one that is not the engine's.
 */
function loadCalendar(
  dir: string,
  name: string,
  file: string,
): { days: Set<string>; rows: CalendarRows } {
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
  const rows: { trading_day: string; kind?: string }[] = [];
  let previous = '';
  for (const session of sessions) {
    const row = session as { trading_day?: unknown; kind?: unknown };
    const day = row.trading_day;
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
    // STRICTLY ASCENDING, CHECKED HERE BECAUSE THE CONSTRUCTOR CHECKS IT LATER.
    // `buildCalendarSlice` refuses a non-monotone slice and it is now called at
    // FOLD time, so without this a record's own defect would surface as a throw
    // inside `runFixture` rather than as the `L-08` that owns the record. The
    // synthesized `sequence` is the row's index, so days ascending is exactly
    // what makes the sequence ascending with them.
    if (day <= previous) {
      throw new FixtureError('L-08', file, `calendar ${name} holds ${day} after ${previous}`);
    }
    previous = day;
    days.add(day);
    rows.push(
      typeof row.kind === 'string' ? { trading_day: day, kind: row.kind } : { trading_day: day },
    );
  }

  try {
    return {
      days,
      rows: calendarRowsFromRecord({ coverage: { from: span.from, to: span.to }, sessions: rows }),
    };
  } catch (cause) {
    // A `kind` the mapping cannot read is a stated condition the engine would
    // never see, and it arrives as the calendar rule that owns the record rather
    // than as an unclassified crash.
    throw new FixtureError(
      'L-08',
      file,
      cause instanceof CalendarRecordError
        ? `calendar ${name}: ${cause.message}`
        : `calendar ${name} could not be read: ${String(cause)}`,
    );
  }
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

  // L-13  The citation RESOLVES, and there is at least one of them.
  //
  //       P2 section 2's mechanical traceability tier, and ADR-048's STATED
  //       PREREQUISITE rather than its companion: "a fixture citing nothing
  //       makes the polarity test VACUOUSLY TRUE". Polarity is derived from the
  //       rules a fixture cites, so "every rule this fixture cites is
  //       implemented" is trivially satisfied by a fixture that cites none, and
  //       such a fixture would flip to `direct` against an engine implementing
  //       nothing and then fail for a reason with nothing to do with its
  //       subject. ADR-048 lists that as case 4, "the dangerous one", and says
  //       it is "closed by a prerequisite rather than by care". This is the
  //       prerequisite, and it lands before the derivation reads a citation.
  //
  //       BOTH HALVES ARE THE SAME RULE ON PURPOSE. A citation of `R-99` and a
  //       citation of nothing are one defect wearing two costumes: in each case
  //       the fixture names no rule this repository can resolve, and in each
  //       case the traceability the tier exists to provide is absent. Splitting
  //       them into two rule numbers would let the second be relaxed without
  //       the first being discussed.
  const cited = citedIdentifiers(source);
  if (cited.length === 0) {
    throw new FixtureError(
      'L-13',
      yamlFile,
      `"source" cites no R-nn, CV-nn or INV-nn that M01 defines: ${JSON.stringify(source)}`,
    );
  }
  const m01 = options.m01Ids ?? m01Identifiers(options.m01Path);
  const unresolved = cited.filter((id) => !m01.has(id));
  if (unresolved.length > 0) {
    throw new FixtureError(
      'L-13',
      yamlFile,
      `"source" cites ${unresolved.join(', ')}, which M01 does not define`,
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
  const planRecord = readJson(join(dir, 'plans', `${planName}.json`), 'L-07', yamlFile);
  let plan: ResolvedPlan;
  try {
    plan = resolvePlanRecord(planRecord);
  } catch (cause) {
    // `resolvePlanRecord` already carries `L-07`; this is where it becomes the
    // `FixtureError` the rest of the loader throws, naming the fixture that
    // asked for the record rather than the record alone.
    throw new FixtureError(
      'L-07',
      yamlFile,
      cause instanceof PlanRecordError
        ? `plan ${planName}: ${cause.detail}`
        : `plan ${planName} could not be resolved: ${String(cause)}`,
    );
  }

  // L-08  The calendar resolves, and every day in the stream is a session it
  //       declares, inside the coverage it declares.
  const calendarName = document['calendar'];
  if (typeof calendarName !== 'string' || calendarName.trim() === '') {
    throw new FixtureError('L-08', yamlFile, '"calendar" is required');
  }
  const { days: sessions, rows: calendar } = loadCalendar(dir, calendarName, yamlFile);

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
    const awaiting = AWAITING_M01_INPUT.includes(`account.${key}`);
    if (!mapped && !awaiting) {
      throw new FixtureError('L-09', yamlFile, `account field "${key}" reaches no engine input`);
    }
  }
  const sizeCents = requireInteger(account['size_cents'], 'L-09', yamlFile, 'account.size_cents');

  // L-09  THE SIZE IS STATED TWICE AND BOTH STATEMENTS REACH THE FOLD. The
  //       fixture states `account.size_cents` and the plan record states
  //       `size.size_cents`, and `advanceDay` reads only the plan's: R-26
  //       measures profit against `plan.sizeCents`, R-35 subtracts it, INV-20
  //       compares against it. A fixture whose account size disagreed with its
  //       plan would be graded entirely against the plan's number while a reader
  //       checked the arithmetic against the fixture's.
  if (BigInt(sizeCents) !== plan.sizeCents) {
    throw new FixtureError(
      'L-09',
      yamlFile,
      `account.size_cents is ${String(sizeCents)} and plan ${planName} is sized ` +
        `${plan.sizeCents}; the fold reads the plan's and a reader would read this one`,
    );
  }

  // L-09  The phase the account starts in, which `AWAITING_M01_INPUT` used to
  //       hold because `EngineInput` had nowhere to put it. `RuleState.phase` is
  //       where it goes now.
  const phase = account['phase'];
  if (phase !== 'eval' && phase !== 'funded') {
    throw new FixtureError(
      'L-09',
      yamlFile,
      `account.phase must be "eval" or "funded", found ${JSON.stringify(phase)}. ` +
        '`closed` and `graduated` are terminal (R-24, R-49) and no day folds against either',
    );
  }
  if (phase === 'eval' && plan.eval === null) {
    // `initialState` puts an account in `funded` exactly when the plan has no
    // evaluation phase (Direct, Appendix A.3), so an eval fixture on such a plan
    // states a phase the engine cannot construct.
    throw new FixtureError(
      'L-09',
      yamlFile,
      `account.phase is "eval" and plan ${planName} has no evaluation phase`,
    );
  }

  const openedOn = account['opened_on'];
  if (typeof openedOn !== 'string' || !TRADING_DAY_PATTERN.test(openedOn)) {
    throw new FixtureError('L-09', yamlFile, 'account.opened_on must be YYYY-MM-DD');
  }

  // L-10  The day stream. Every field DayMark declares is supplied by the
  //       fixture; nothing is derived here.
  //
  //       DERIVING ONE WOULD BE THE LOADER DOING THE ENGINE'S WORK. `traded_day`
  //       is `fill_count > 0` by R-08, and a loader computing it is a loader
  //       that has implemented a rule the fixtures exist to check. So the
  //       fixture states it, the same way it states every other measurement.
  const days = document['days'];
  if (!Array.isArray(days)) throw new FixtureError('L-10', yamlFile, '"days" must be a list');

  const dayMarks: DailyMark[] = [];
  let previousDay = '';
  for (const [index, row] of days.entries()) {
    const where = `days[${index}]`;
    if (!isRecord(row)) throw new FixtureError('L-10', yamlFile, `${where} must be a mapping`);

    for (const key of Object.keys(row)) {
      const mapped = Object.values(DAY_MARK_SOURCE).includes(key as never);
      const awaiting = AWAITING_M01_INPUT.includes(`days[].${key}`);
      const derived = (DERIVED_BY_THE_ENGINE as readonly string[]).includes(`days[].${key}`);
      if (!mapped && !awaiting && !derived) {
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

    const fillCount = requireInteger(row['fill_count'], 'L-10', yamlFile, `${where}.fill_count`);

    // L-10  `traded_day` IS DERIVED AND IS STILL CHECKED. R-08 is
    //       `fill_count > 0` and `DailyMark` carries no `tradedDay`, so the
    //       fixture's statement reaches no engine input. It is not dropped: it
    //       is compared against the value the engine will derive from the same
    //       row, because a fixture asserting `traded_day: false` beside
    //       `fill_count: 3` is stating a contradiction, and the fold would
    //       silently resolve it in favour of the field the fixture author was
    //       not looking at.
    const tradedDay = row['traded_day'];
    if (typeof tradedDay !== 'boolean') {
      throw new FixtureError('L-10', yamlFile, `${where}.traded_day must be true or false`);
    }
    if (tradedDay !== fillCount > 0) {
      throw new FixtureError(
        'L-10',
        yamlFile,
        `${where}.traded_day is ${String(tradedDay)} and fill_count is ${String(fillCount)}; ` +
          'R-08 derives the first from the second and the engine will read only the second',
      );
    }

    // `adjustment_cents` NOW HAS A HOME AND L-11's REFUSAL OF IT IS RETIRED.
    // Its own comment said so: "M01 folds settlements into the day stream and
    // this refusal expires there". `DailyMark.adjustmentCents` is SD-01's
    // non-trading movement, applied at the open of its effective day (R-10), and
    // INV-18 is stated against it. An absent key is zero, which is what a day
    // with no movement has, and is the only default in this file that states a
    // fact rather than choosing a parameter.
    const adjustmentCents =
      row['adjustment_cents'] === undefined
        ? 0n
        : BigInt(
            requireInteger(row['adjustment_cents'], 'L-10', yamlFile, `${where}.adjustment_cents`),
          );

    // MONEY CROSSES INTO THE ENGINE AS `bigint`, AND JSON HAS NO LITERAL FOR
    // ONE. `Cents` is `bigint` (M01 section 2.1, INV-02: "all money is `bigint`
    // integer cents at every boundary"), and a fixture is a text file where
    // 5_000_000 is a JSON number. `requireInteger` is what makes the conversion
    // safe rather than a cast: it has already rejected a non-integer and
    // anything outside the safe range, so `BigInt` here widens a checked integer
    // and cannot lose a cent. THE BOUNDARY IS THIS LINE and there is no other:
    // nothing downstream of it holds money as a `number`.
    dayMarks.push({
      tradingDay: tradingDay as TradingDay,
      openingBalanceCents: BigInt(
        requireInteger(
          row['opening_balance_cents'],
          'L-10',
          yamlFile,
          `${where}.opening_balance_cents`,
        ),
      ),
      closingBalanceCents: BigInt(
        requireInteger(
          row['closing_balance_cents'],
          'L-10',
          yamlFile,
          `${where}.closing_balance_cents`,
        ),
      ),
      highBalanceCents: BigInt(
        requireInteger(row['high_balance_cents'], 'L-10', yamlFile, `${where}.high_balance_cents`),
      ),
      lowBalanceCents: BigInt(
        requireInteger(row['low_balance_cents'], 'L-10', yamlFile, `${where}.low_balance_cents`),
      ),
      realizedPnlCents: BigInt(
        requireInteger(row['realized_pnl_cents'], 'L-10', yamlFile, `${where}.realized_pnl_cents`),
      ),
      adjustmentCents,
      fillCount,
      // Synthesized, and deliberately not digest-shaped. See ACCOUNT_SYNTHESIZED.
      sourceHash: `fixture:${id}:${tradingDay}`,
    });
  }

  // L-11  SETTLEMENTS ARE AN ENGINE INPUT NOW AND THE REFUSAL SURVIVES FOR A
  //       DIFFERENT REASON. `DayInput.settlements` is a `SettlementFact[]` and
  //       DO-2 applies them in ordinal order, so the shape exists. What does not
  //       exist is a fixture that states one: `SettlementFact` needs
  //       `payoutRequestId`, `ordinal`, `approvedCents`, `basisTradingDay` and
  //       `effectiveTradingDay`, the format has no block for them, and every
  //       fixture in the directory states `settlements: []`.
  //
  //       INVENTING THE FIVE FIELDS HERE WOULD BE THE LOADER WRITING A FIXTURE.
  //       So the empty list passes through to the fold and a non-empty one is
  //       refused, naming what it would take to accept one rather than naming an
  //       engine limitation that is no longer true.
  const settlements = document['settlements'];
  if (settlements !== undefined && (!Array.isArray(settlements) || settlements.length > 0)) {
    throw new FixtureError(
      'L-11',
      yamlFile,
      'the fixture format states no settlement fields, so only an empty list may be stated. ' +
        'DayInput.settlements takes SettlementFact, which needs payout_request_id, ordinal, ' +
        'approved_cents, basis_trading_day and effective_trading_day',
    );
  }

  return {
    id,
    file: yamlFile,
    name,
    source,
    planName,
    calendarName,
    accountId: id as AccountId,
    input: {
      plan,
      calendar,
      openedOn: openedOn as TradingDay,
      startingPhase: phase,
      marks: dayMarks,
      settlements: [] as readonly SettlementFact[],
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
  /** Defaults to `docs/plans/M01-rules-engine.md`. */
  readonly m01Path?: string;
  /** L-13's resolution set, read once per directory rather than per fixture. */
  readonly m01Ids?: Set<string>;
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
  const m01Ids = options.m01Ids ?? m01Identifiers(options.m01Path);
  const fixtures: GoldenFixture[] = [];
  const failures: FixtureFailure[] = [];

  const files = readdirSync(dir)
    .filter((f) => extname(f) === '.yaml')
    .sort()
    .map((f) => join(dir, f));

  for (const file of files) {
    try {
      fixtures.push(loadFixture(file, { ...options, fixtureDir: dir, registry, m01Ids }));
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
