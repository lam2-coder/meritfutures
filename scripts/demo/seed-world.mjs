#!/usr/bin/env node
// =============================================================================
// scripts/demo/seed-world.mjs
// =============================================================================
// THE EXECUTABLE for CI-09's replay self-audit leg.
//
//   node scripts/demo/seed-world.mjs
//   node scripts/demo/seed-world.mjs --help
//
// `run.mjs`'s shape, and `.mjs` for `run.mjs`'s reason: the resolve hook has to
// be registered BEFORE the first import that needs it, and an import is hoisted
// above every statement in its own module.
//
// THE WORKFLOW JOB THAT RUNS THIS IS OWED AND IS NOT IN THIS SESSION'S FENCE.
// ADR-119 section 6 names it: one job in `.github/workflows/nightly.yml` beside
// `simulation-harness`, whose whole body is this command. Until it lands,
// CI-09's replay leg has an input and no stage, and `CI-06/gate-inventory`
// says so on every run.
// =============================================================================

import { register } from 'node:module';

// The one warning that is true and is not news, dropped; every other warning is
// still printed, because a filter that swallowed all of them would hide the next
// real one. `run.mjs` and `scripts/ci/nightly-harness.mjs` make the same call.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name !== 'ExperimentalWarning') process.stderr.write(`${warning.stack ?? ''}\n`);
});

register(new URL('./ts-resolve.mjs', import.meta.url));

const { main } = await import(new URL('./seed-world.ts', import.meta.url).href);

process.exitCode = await main(
  process.argv.slice(2),
  (text) => process.stdout.write(text),
  (text) => process.stderr.write(text),
);
