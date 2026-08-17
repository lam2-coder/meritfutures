// =============================================================================
// scripts/demo/ts-resolve.mjs
// =============================================================================
// A RESOLVE HOOK, TWENTY LINES, SO THE DEMO CAN RUN ON PLAIN `node`.
//
// The workspace publishes its libraries from source: both `packages/rithmic`
// and `packages/rules-engine` declare `"exports": { ".": "./src/index.ts" }`
// and nothing in this repository is built by `tsc` (tsconfig.base.json,
// `noEmit`). Vitest consumes that through Vite, which resolves TypeScript's
// `./types.js` convention to `types.ts`. Node does not.
//
// Node 22 strips types from a `.ts` file on its own, so the ONLY thing missing
// is that one resolution step: a relative specifier ending in `.js` whose file
// does not exist should be retried as `.ts`. That is what this does, and it
// does it only after the ordinary resolution has already failed, so a real
// `.js` file always wins and a genuinely missing module still throws.
//
// WHY NOT A LOADER PACKAGE. VG-12 makes any new dependency a deliberate
// admission and this demo is not the place to spend one. `tsx` and `ts-node`
// each solve this, and each is a package plus its tree, added so that a demo
// script can print a table.
// =============================================================================

/** @type {import('node:module').ResolveHook} */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    if (relative && specifier.endsWith('.js')) {
      return await next(`${specifier.slice(0, -'.js'.length)}.ts`, context);
    }
    throw error;
  }
}
