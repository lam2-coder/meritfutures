// =============================================================================
// packages/golden-loader
// =============================================================================
// CI-03's whole implementation, and the format it reads is documented in
// ../README.md and in packages/rules-engine/fixtures/README.md.
//
//   pnpm exec vitest run --project golden
//
// STRATEGY section 3.2: "The loader is one function ... THERE IS NO PER-FIXTURE
// TEST CODE, which is what stops a fixture from quietly acquiring a bespoke
// assertion that weakens it."

export {
  AWAITING_ENGINE_INPUT,
  FIXTURE_DIR,
  FixtureError,
  M01_PATH,
  REGISTRY_PATH,
  REPO_ROOT,
  citedIdentifiers,
  expectationPath,
  loadFixture,
  loadFixtureDirectory,
  m01Identifiers,
  m01RuleGroups,
  registryIds,
  unusedAwaitingEntries,
} from './loader.ts';
export type {
  FixtureExpectation,
  FixtureFailure,
  FixtureInput,
  GoldenFixture,
  LoadOptions,
  LoadResult,
} from './loader.ts';

// THE TWO STAND-INS FOR P2-1, EXPORTED SO THEY CAN BE TESTED AND SO THE ONE
// THAT MUST BE DELETED IS VISIBLE FROM THE PACKAGE'S FRONT DOOR. `plan.ts`
// stands in for `resolvePlan` and goes when it lands; `calendar.ts` assembles
// rows for ADR-049's constructor and stays.
export { PlanRecordError, resolvePlanRecord } from './plan.ts';
export {
  CalendarRecordError,
  SYNTHESIZED_SEQUENCE_BASE,
  calendarRowsFromRecord,
} from './calendar.ts';
export type { CalendarRecord, CalendarRows } from './calendar.ts';

export { describeDiff, diffEndState, diffEvents, snakeToCamel } from './compare.ts';
export type { Diff } from './compare.ts';

export {
  DECLARED_RULES,
  mismatchProofExists,
  renderStageCoverage,
  stageAssertionHolds,
  stageCoverage,
} from './coverage.ts';
export type { FixturePolarity, GroupPolarity, StageCoverage } from './coverage.ts';

export { checkDeclarationAgainstFold, citedRuleIds, derivePolarity } from './polarity.ts';
export type { DeclarationCheck, Derivation, Polarity } from './polarity.ts';

export { GOLDEN_ENGINE_VERSION, engineIsIdentityStub, runFixture } from './run.ts';
export type { FixtureOutcome } from './run.ts';

export { YamlSubsetError, parseYamlSubset } from './yaml.ts';
export type { YamlValue } from './yaml.ts';
