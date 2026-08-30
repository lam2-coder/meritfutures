import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { stripComments } from '../../../packages/tooling/checks/strip-comments.mjs';

// =============================================================================
// The payouts segment's own gate, and the blind spot it exists to close
// =============================================================================
// FOUR CONTROLS IN THIS REPOSITORY ARE SCOPED TO FILES ENDING `.ts` AND NONE OF
// THEM SEES A `.tsx` FILE. Read in session 260 against their own source:
//
//   eslint.config.js  `merit/no-raw-db-client`        apps/**/*.ts
//   eslint.config.js  `merit/no-calendar-in-expiry-path`  apps/**/payouts/**/*.ts
//   test/inv-m4-01.test.ts   walks src/ for `.ts`, bans money arithmetic
//   test/surface.test.ts     walks src/ for `.ts`, bans network calls
//
// `src/app/payouts/` is `.ts` today for exactly that reason, and this file is
// what makes the choice survive somebody changing it. IT WALKS `.ts` AND `.tsx`
// BOTH. A session that converts this segment to JSX gets the four properties
// asserted on the other side of the conversion whether or not it remembers to
// widen the four globs above, and the conversion is then a diff about syntax
// rather than a silent loss of four controls on the one screen in this
// application where money is rendered.
//
// IT IS SCOPED TO THIS SEGMENT AND CLAIMS NOTHING WIDER. The other five app
// segments in this wave are their own sessions' and the repository-wide fix is
// to widen the globs, which is `eslint.config.js`'s and belongs to whoever owns
// that file. Named here rather than performed.

const HERE = dirname(fileURLToPath(import.meta.url));
const SEGMENT = join(HERE, '..', 'src', 'app', 'payouts');

function segmentFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...segmentFiles(path));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(path);
  }
  return out;
}

const FILES = segmentFiles(SEGMENT);
const rel = (file: string): string => relative(join(HERE, '..'), file);

// COMMENTS OUT: THE PROSE IN THIS TREE QUOTES THE SHAPES BEING HUNTED. Both
// helpers are the shared home now (ADR-279) and neither is declared here.
//
// The copy that stood here was the two-replacement idiom, and it read a
// block-comment OPENER written inside a LINE comment as a real one:
// `src/app/payouts/page.ts`, one of the five files this suite parses, stripped
// to 345 characters under it and strips to 594 under the scanner. Four of the
// six cases below are ABSENCE assertions over that text.
//
// `expressionsOnly` was three more regexes over the result and is now one
// argument. Its own version could not see a nested `${}`; blanking keeps the
// quotes, the length and every newline, so a literal contributes no token and
// no offset moves.

/** Comments and string-literal CONTENT out, so only expressions remain. */
function expressionsOnly(source: string): string {
  return stripComments(source, { literals: 'blank' });
}

test('the segment exists and this check is looking at it', () => {
  expect(FILES.length, 'files in src/app/payouts').toBeGreaterThan(3);
  expect(
    FILES.map((f) => rel(f)).some((f) => f.endsWith('page.ts') || f.endsWith('page.tsx')),
  ).toBe(true);
});

test('no file in the segment performs a network call', () => {
  // surface.test.ts's rule, carried onto `.tsx` for this segment. Its own
  // reason stands: "the first `fetch` written here is a decision somebody makes
  // on purpose rather than one that appears in a diff." See src/app/payouts/
  // source.ts for why this session is not that somebody.
  const offences: string[] = [];
  for (const file of FILES) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const call of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
      if (code.includes(call)) offences.push(`${rel(file)}: ${call}`);
    }
  }
  expect(offences).toEqual([]);
});

test('no arithmetic on a money-suffixed value anywhere in the segment', () => {
  // inv-m4-01.test.ts's patterns, carried onto `.tsx` for this segment. The
  // formatter exemption does not apply here: src/format/money.ts is the only
  // permitted consumer and it is not in this directory, so the segment's
  // correct count is zero with no exceptions at all.
  const MONEY = '[A-Za-z0-9_.]*(?:_cents|_bp)\\b';
  const patterns = [
    new RegExp(`${MONEY}\\s*[+\\-*/]`, 'g'),
    new RegExp(`[+\\-*/]\\s*${MONEY}`, 'g'),
  ];

  const offences: string[] = [];
  for (const file of FILES) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const pattern of patterns) {
      for (const match of code.matchAll(pattern)) offences.push(`${rel(file)}: ${match[0].trim()}`);
    }
  }
  expect(offences, 'arithmetic on a money value in the payouts segment').toEqual([]);
});

test('no float reaches the segment, and no operation that could produce one', () => {
  // "Money is integer cents. No floats anywhere, fixtures included." A decimal
  // literal on a payout screen is a wrong number in front of the person it
  // belongs to, and `toFixed` is how one gets there while looking careful.
  const offences: string[] = [];
  for (const file of FILES) {
    const code = expressionsOnly(readFileSync(file, 'utf8'));
    for (const match of code.matchAll(/(?<![\w.])\d+\.\d+/g)) {
      offences.push(`${rel(file)}: decimal literal ${match[0]}`);
    }
    for (const call of ['toFixed', 'parseFloat', 'Math.round', 'Math.floor', 'Number(']) {
      if (code.includes(call)) offences.push(`${rel(file)}: ${call}`);
    }
  }
  expect(offences).toEqual([]);
});

test('the segment serves no route and runs no server action', () => {
  // ADR-083 section 3 and ADR-095 ruling 3: no route handler or server action
  // in this application may serve `/api/v1` or any operator path. The strongest
  // form of that here is that this segment declares NO handler at all, so there
  // is nothing to inspect the path of.
  const offences: string[] = [];
  for (const file of FILES) {
    const name = rel(file);
    if (/(^|[\\/])route\.tsx?$/.test(name)) offences.push(`${name}: is a route handler`);

    const code = stripComments(readFileSync(file, 'utf8'));
    if (/['"]use server['"]/.test(code)) offences.push(`${name}: 'use server'`);
    for (const verb of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      if (new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${verb}\\b`).test(code)) {
        offences.push(`${name}: exports ${verb}`);
      }
    }
  }
  expect(offences).toEqual([]);
});

test('the segment reads no clock and imports no calendar', () => {
  // ADR-042: a release deadline is measured in wall-clock hours and Merit
  // QUOTES that unit rather than computing it, so `resolves_by` arrives as a
  // string and is rendered as one. `merit/no-calendar-in-expiry-path` is scoped
  // to this directory in eslint.config.js and covers the import half for `.ts`;
  // this covers the clock half, and both halves for `.tsx`.
  const offences: string[] = [];
  for (const file of FILES) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const clock of ['new Date', 'Date.now', 'Date.parse', 'toLocaleDate', 'toISOString']) {
      if (code.includes(clock)) offences.push(`${rel(file)}: ${clock}`);
    }
  }
  expect(offences).toEqual([]);
});

test('the segment imports only React and this application', () => {
  // VG-12: a new dependency is an admission a session cannot grant itself.
  // React and Next are admitted (ADR-095); nothing else is, and the way a
  // package arrives without an admission is an import nobody read.
  const offences: string[] = [];
  for (const file of FILES) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const match of code.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1] ?? '';
      const permitted =
        specifier.startsWith('.') ||
        specifier === 'react' ||
        specifier === 'react-dom' ||
        specifier.startsWith('next/');
      if (!permitted) offences.push(`${rel(file)}: imports ${specifier}`);
    }
  }
  expect(offences).toEqual([]);
});

test('the checks above fire on the violations they exist to catch', () => {
  // RI-06's argument. A control watched only in its passing state is a control
  // nobody has seen work, and every one of the five above is green on a tree
  // that contains no violation of it.
  const MONEY = '[A-Za-z0-9_.]*(?:_cents|_bp)\\b';
  const moneyPattern = new RegExp(`${MONEY}\\s*[+\\-*/]`);

  expect(moneyPattern.test('const net = row.approved_cents - row.trader_cents;')).toBe(true);
  expect(moneyPattern.test('formatCents(row.approved_cents);')).toBe(false);

  expect(/(?<![\w.])\d+\.\d+/.test(expressionsOnly('const rate = 0.8;'))).toBe(true);
  expect(/(?<![\w.])\d+\.\d+/.test(expressionsOnly("import x from './view.ts';"))).toBe(false);
  expect(/(?<![\w.])\d+\.\d+/.test(expressionsOnly('// ADR-062 section 1.2'))).toBe(false);

  expect(/['"]use server['"]/.test(stripComments("'use server';"))).toBe(true);
  expect(
    /export\s+(?:async\s+)?(?:function|const)\s+GET\b/.test('export async function GET() {}'),
  ).toBe(true);

  expect(stripComments('const at = new Date();').includes('new Date')).toBe(true);
  expect(stripComments('// new Date is banned here').includes('new Date')).toBe(false);
});
