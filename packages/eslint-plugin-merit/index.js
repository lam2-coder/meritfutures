import enginePurity from './rules/engine-purity.js';
import noRawDbClient from './rules/no-raw-db-client.js';

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
// `no-raw-db-client` IS VG-4, and it landed with CI-01 in session S-C exactly
// where this comment said it would. The condition recorded here was that it
// "needs the `scopedDb(identity)` accessor to exist before it can name what it
// permits", and that turned out to be the softer half of the rule: what it BANS
// is fixed today, and what it POINTS AT is a package that exists. Waiting for
// the accessor would have shipped a CI-01 stage with a hole in it where
// STRATEGY section 4.2 puts a merge blocker.

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: { name: 'eslint-plugin-merit', version: '0.0.0' },
  rules: {
    'engine-purity': enginePurity,
    'no-raw-db-client': noRawDbClient,
  },
};

export default plugin;
export { enginePurity, noRawDbClient };
