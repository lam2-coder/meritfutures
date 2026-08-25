// =============================================================================
// apps/api/src/start.ts
// =============================================================================
// The process entry point, and it is three lines on purpose.
//
// `index.ts` is this package's `exports` target, so importing it must have no
// effect: a test that imports `main` to assert on it must not thereby start a
// server on port 3000. The usual answer is an entry-point guard comparing
// `import.meta.filename` with `process.argv[1]`, which is a run-time string
// comparison that is right until something invokes the file by a symlink or a
// different real path, and which is invisible when it silently stops matching.
//
// A SEPARATE FILE HAS NO SUCH FAILURE MODE. `pnpm start` names this file, this
// file calls `main`, and `index.ts` stays a module that exports.
//
// -----------------------------------------------------------------------------
// THIS SCRIPT CANNOT RUN TODAY AND THE REASON IS NOT IN THIS FILE
// -----------------------------------------------------------------------------
// `node --experimental-strip-types` resolves an import specifier to THE FILE IT
// NAMES. It does not map `./index.js` onto `index.ts`, and every module under
// `apps/api/src` writes the `.js` form because `tsc` under `moduleResolution:
// NodeNext` requires it. So `pnpm --filter @merit/api start` dies on this file's
// own import with ERR_MODULE_NOT_FOUND.
//
// IT IS NOT THIS DEPLOYABLE'S DEFECT AND IT DID NOT ARRIVE WITH THIS SESSION.
// `apps/admin` and `apps/worker` declare the same start script and fail
// identically on their own first relative import, measured in session 209. The
// repair is two things together: `./x.js` becomes `./x.ts` throughout the
// affected `src/`, and the tsconfig gains `allowImportingTsExtensions: true`,
// without which `tsc` reports TS5097 on every rewritten line. `apps/api/tsconfig.json`
// is outside session 209's fence, so the finding is reported rather than reached
// for, and the whole repair was executed in a scratch copy outside this
// repository to prove it sufficient: with the specifiers rewritten and nothing
// else changed, both surfaces start under `node --experimental-strip-types` and
// serve, which is the run recorded in session 209's log.
// =============================================================================

import { main } from './index.ts';

await main();
