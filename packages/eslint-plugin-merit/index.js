import enginePurity from './rules/engine-purity.js';

// =============================================================================
// eslint-plugin-merit
// =============================================================================
// The rules that enforce a Merit ruling rather than a style preference. Each
// one exists because a document says something that a reviewer cannot be relied
// on to notice in a diff.
//
// PLAIN JAVASCRIPT WITH JSDoc TYPES, NOT TypeScript, and it is the same
// argument gates.mjs makes for having no dependencies: an ESLint plugin that
// must be compiled before ESLint can load it is a plugin that stops running on
// the day the compile breaks, in the stage whose job is to notice that. It is
// still type-checked by this package's `tsc --noEmit`.
//
// NOT HERE YET, named so its absence is scheduled rather than forgotten:
// VG-4, the rule banning raw Drizzle client imports outside `packages/db`
// (ADR-008, STRATEGY section 4.2). It needs the `scopedDb(identity)` accessor
// to exist before it can name what it permits, and it lands with CI-01.

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: { name: 'eslint-plugin-merit', version: '0.0.0' },
  rules: {
    'engine-purity': enginePurity,
  },
};

export default plugin;
export { enginePurity };
