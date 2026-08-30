/**
 * Source with every comment removed, every string literal kept and every
 * newline kept.
 *
 * THIS DECLARATION EXISTS BECAUSE THE IMPLEMENTATION IS `.mjs` AND MUST BE.
 * `repo-invariants.mjs` is run as `node packages/tooling/checks/repo-invariants.mjs`
 * with nothing compiled and no flag, so the shared home it imports cannot be
 * TypeScript; and the suites that import it are type-checked by packages whose
 * `tsconfig.json` sets no `allowJs` and is outside ADR-279's fence. One
 * signature restated is not a second copy of the algorithm, which is the thing
 * `RI-30` counts.
 */
export declare function stripComments(
  source: string,
  options?: { literals?: 'keep' | 'blank' },
): string;
