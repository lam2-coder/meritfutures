import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

// CI-02, the `unit` project.
//
// =============================================================================
// THE SIMULATOR MAY NOT READ A CLOCK OR AN AMBIENT RANDOM SOURCE
// =============================================================================
// `determinism.test.ts` asserts the OUTCOME (the same seed renders the same
// bytes). This asserts the MECHANISM, and the two are not the same check: a
// `Date.now()` in a column that happens to be rendered at second resolution
// passes a same-process comparison and fails across a minute boundary, which
// is the flake that gets a determinism test deleted rather than a bug fixed.
//
// This is `merit/engine-purity`'s idea one package over, deliberately as a test
// rather than as an ESLint rule. The engine rule exists because the engine's
// purity is a MONEY-PATH invariant enforced at CI-01 and asserted by RI-01 in
// the manifest as well; this package is non-money and its constraint is
// narrower (no clock, no ambient randomness, and one permitted digest), so a
// test in the package that owns the constraint is proportionate. If a second
// package ever needs the same rule, that is the moment it becomes a lint rule
// with a glob in `eslint.config.js`, which is where `no-calendar-in-expiry-path`
// already shows the shape.
//
// WHAT IT SEES AND WHAT IT DOES NOT. The scan is LINE-BASED and skips comment
// lines, because this package's own headers discuss `new Date` at length and a
// scanner that could not tell prose from code would either fire on the
// explanation or be disabled. It therefore cannot see a banned construct built
// at runtime from string fragments, and nothing in this package does that.
// Saying so is cheaper than a later reader assuming the guarantee is total.
// =============================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

/** Each pattern with the reason it is banned, because a bare regex list ages badly. */
const FORBIDDEN: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\bDate\.now\b/, why: 'the wall clock. Every instant is derived from a session' },
  { pattern: /\bnew\s+Date\b/, why: 'the wall clock, and a parser that returns NaN on bad input' },
  { pattern: /\bDate\.parse\b/, why: 'lenient parsing. `parseInstantUtc` is strict on purpose' },
  { pattern: /\bMath\.random\b/, why: 'ambient randomness. Every draw is keyed on the seed' },
  { pattern: /\bperformance\.now\b/, why: 'a clock' },
  { pattern: /\brandomUUID\b/, why: 'ambient randomness. Every identifier is derived' },
  { pattern: /\brandomBytes\b/, why: 'ambient randomness' },
  { pattern: /\bprocess\.env\b/, why: 'ambient configuration. Everything arrives as an argument' },
  { pattern: /\bprocess\.hrtime\b/, why: 'a clock' },
  { pattern: /\bhrtime\b/, why: 'a clock' },
  { pattern: /\btoLocale[A-Za-z]*\b/, why: 'locale-dependent formatting. PT-06 randomizes LC_ALL' },
  { pattern: /\bIntl\./, why: 'locale-dependent formatting' },
];

function everyTypeScriptFile(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...everyTypeScriptFile(path));
    else if (entry.endsWith('.ts')) found.push(path);
  }
  return found.sort();
}

/** Strip whole-line comments and trailing `//` comments. Line-based, as the header says. */
function codeLines(body: string): { line: string; number: number }[] {
  const out: { line: string; number: number }[] = [];
  let inBlock = false;
  for (const [index, raw] of body.split('\n').entries()) {
    const trimmed = raw.trim();
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlock = true;
      continue;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    const withoutTrailing = raw.split('//')[0] ?? '';
    if (withoutTrailing.trim() === '') continue;
    out.push({ line: withoutTrailing, number: index + 1 });
  }
  return out;
}

test('no source file reads a clock, a locale or an ambient random source', () => {
  const findings: string[] = [];
  for (const path of everyTypeScriptFile(SRC)) {
    for (const { line, number } of codeLines(readFileSync(path, 'utf8'))) {
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(line)) {
          findings.push(`${relative(SRC, path)}:${number} matches ${pattern.source} (${why})`);
        }
      }
    }
  }
  expect(findings, findings.join('\n')).toEqual([]);
});

test('the scanner fires on a seeded violation', () => {
  // A check that has only ever been seen pass is indistinguishable from a check
  // that cannot fail, which is `falsify.mjs`'s discipline and the reason this
  // second test exists at all. The violation is fed to the same code path the
  // real scan uses rather than to a copy of it.
  const seeded = ['export function stamp(): number {', '  return Date.now();', '}'].join('\n');
  const lines = codeLines(seeded);
  const hits = lines.filter(({ line }) => FORBIDDEN.some(({ pattern }) => pattern.test(line)));
  expect(hits).toHaveLength(1);
  expect(hits[0]?.number).toBe(2);
});

test('the scanner does not fire on the prose that explains the ban', () => {
  // The other direction, and the reason the scan is comment-aware: this
  // package's own headers argue about `new Date` and `Math.random` at length,
  // and a scanner that could not tell prose from code would be disabled within
  // a week.
  const prose = [
    '// `new Date(...)` returns an Invalid Date rather than throwing.',
    '/**',
    ' * Never uses Math.random.',
    ' */',
    'export const value = 1;',
  ].join('\n');
  const lines = codeLines(prose);
  expect(lines.map(({ line }) => line.trim())).toEqual(['export const value = 1;']);
});

test('the one digest the package uses is deterministic and stays permitted', () => {
  // `createHash('sha256')` is a pure function of its input and is what
  // `ingest_files.sha256` is compared on (INV-M2-02). It is NOT on the list
  // above, and this test is here so a later session tightening the list does
  // not ban it by reflex and break the digest the redelivery rules rest on.
  const emit = readFileSync(join(SRC, 'simulator', 'emit.ts'), 'utf8');
  expect(emit).toContain("createHash('sha256')");
  for (const { pattern } of FORBIDDEN) {
    expect(pattern.test("createHash('sha256')")).toBe(false);
  }
});
