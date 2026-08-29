// =============================================================================
// apps/worker/src/start.ts
// =============================================================================
// The process entry point, and it is short on purpose.
//
// **THIS FILE IS THE DEFECT `ADR-241` FIXES.** It did not exist. `package.json`'s
// `start` named `src/index.ts`, which is this package's `exports` target, so the
// deployable's whole run was: load a barrel, define `main`, exit 0. `ADR-239`
// measured it live and the allocation row re-derived it independently.
//
// **A SEPARATE FILE RATHER THAN AN ENTRY-POINT GUARD**, which is
// `apps/api/src/start.ts`'s ruling and is transcribed rather than re-argued:
// importing `index.ts` must have no effect, and the usual guard comparing
// `import.meta.filename` with `process.argv[1]` is a run-time string comparison
// that is right until something invokes the file by a symlink and invisible when
// it silently stops matching. `pnpm start` names this file, this file calls
// `main`, and `index.ts` stays a module that exports.
//
// -----------------------------------------------------------------------------
// THERE IS NO `try` HERE AND THAT IS THE WHOLE CONTROL
// -----------------------------------------------------------------------------
// `await main()` at the top level of an ES module: if the job rejects, Node
// reports the error and the process exits NON-ZERO. A supervisor's only signal
// is the exit code, and every `catch` that logged and fell through would convert
// a failed batch back into the green service this row exists to end.
//
// **THE `finally` RELEASES THE POOL AND DOES NOT DECIDE ANYTHING.** `pg` holds
// the event loop open, so a one-shot job that did not close its pool would
// SUCCEED and then hang, which a supervisor reads as a job still running and a
// dead-man switch reads as a job that never finished. `Promise.prototype.finally`
// runs on both paths and REJECTS WITH THE ORIGINAL REASON, so releasing the pool
// cannot turn a failed batch into a green one.
//
// It is one statement at column zero rather than a `try` block for a second
// reason: the measurement that found this defect was a grep for a top-level call
// to `main`, and the repair should be visible to the same grep that measured the
// hole.
// =============================================================================

import { closeWorkerDb } from './db.ts';
import { main } from './index.ts';

await main().finally(closeWorkerDb);
