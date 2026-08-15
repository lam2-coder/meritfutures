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
  REGISTRY_PATH,
  REPO_ROOT,
  expectationPath,
  loadFixture,
  loadFixtureDirectory,
  registryIds,
  unusedAwaitingEntries,
} from './loader.js';
export type {
  FixtureExpectation,
  FixtureFailure,
  GoldenFixture,
  LoadOptions,
  LoadResult,
} from './loader.js';

export { describeDiff, diffEndState, diffEvents, snakeToCamel } from './compare.js';
export type { Diff } from './compare.js';

export { mismatchProofExists, renderStageCoverage, stageCoverage } from './coverage.js';
export type { StageCoverage } from './coverage.js';

export { engineIsIdentityStub, runFixture } from './run.js';
export type { FixtureOutcome } from './run.js';

export { YamlSubsetError, parseYamlSubset } from './yaml.js';
export type { YamlValue } from './yaml.js';
