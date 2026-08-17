#!/usr/bin/env node
// =============================================================================
// scripts/demo/run.mjs
// =============================================================================
// THE EXECUTABLE. Three lines of real work: register the resolve hook, import
// the TypeScript entry, write what it returns.
//
//   node scripts/demo/run.mjs --seed merit-demo-001 --days 25
//
// It is `.mjs` and the rest of the directory is `.ts` because the hook has to be
// registered BEFORE the first import that needs it, and an import is hoisted
// above every statement in its own module. A `.ts` entry would need the hook to
// load itself, which is the ordering problem this file exists to avoid.
// =============================================================================

import { register } from 'node:module';

// Node's type stripping is behind an experimental flag and prints a warning to
// stderr on every run. The warning is true and is not news, and a demo whose
// output opens with a runtime notice reads as broken. Only that one is dropped;
// every other warning is still printed, because a filter that swallowed all of
// them would hide the next real one.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name !== 'ExperimentalWarning') process.stderr.write(`${warning.stack ?? ''}\n`);
});

register(new URL('./ts-resolve.mjs', import.meta.url));

const { main } = await import(new URL('./main.ts', import.meta.url).href);

const code = main(
  process.argv.slice(2),
  (text) => process.stdout.write(text),
  (text) => process.stderr.write(text),
);

process.exitCode = code;
