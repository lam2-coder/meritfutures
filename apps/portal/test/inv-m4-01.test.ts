import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

// =============================================================================
// INV-M4-01, standing in for a lint rule that does not exist yet
// =============================================================================
// INV-M4-01's enforcement column reads: "Lint rule banning arithmetic operators
// on any field whose name ends `_cents` or `_bp`; a formatting helper is the
// only permitted consumer. Review-blocking."
//
// THAT RULE IS NOT WRITTEN. packages/eslint-plugin-merit holds exactly three
// rules and none of them is this one, and writing it means writing into
// packages/, which is outside this session's fence. So this file is a
// SUBSTITUTE and is labelled one:
//
//   WEAKER THAN THE RULE, in two specific ways. It reads this application's
//   source as text rather than as an AST, so it sees `a_cents + b_cents` and
//   would not see the same addition written across two statements through
//   locals with different names. And it is scoped to apps/portal, where the
//   lint rule is scoped to every app path, so a second surface rendering money
//   is not covered until the rule lands.
//
//   STRONGER THAN NOTHING, in the way that matters today: the portal is the
//   only application that renders money, this catches the direct form, and it
//   fails a build rather than a review. FM-M4-01's detection column asks for "a
//   contract test asserting every displayed field maps to exactly one API
//   field", which is api-types.test.ts's job; this is the other half.
//
// WHOEVER WRITES `merit/no-money-arithmetic` OWNS DELETING THIS FILE, and that
// sentence is here rather than in a plan because that is the author who will
// read it. A substitute left in place beside the real rule is a second
// expression of one concept, which is the defect OQ-P1-04 was about.

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

/** The one permitted consumer. INV-M4-01 names it in those words. */
const FORMATTER = join('format', 'money.ts');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/**
 * Comments out, string literals kept.
 *
 * COMMENTS MUST GO OR THIS CHECK IS UNUSABLE. This repository's source is
 * mostly prose, and that prose quotes the contract: `floor_distance_cents`'s
 * own docblock in ../src/api/types.ts contains the words "balance - floor",
 * which is a hyphen beside a money word and is exactly the shape being hunted.
 * A check that fires on its own explanation gets disabled within a week.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/**
 * An arithmetic operator adjacent to a money-suffixed identifier.
 *
 * `+ - * /` and the compound assignments. `%` is deliberately absent: it is the
 * remainder that makes the exact formatter exact, and it appears nowhere else.
 * Comparison operators are absent for a stated reason too: comparing two money
 * values computes no money value, and INV-M4-01 bans computing one. A gate is
 * still never evaluated client side, and that is INV-M4-03's ban rather than
 * this one's.
 */
const MONEY = '[A-Za-z0-9_.]*(?:_cents|_bp)\\b';
const PATTERNS = [
  new RegExp(`${MONEY}\\s*[+\\-*/]`, 'g'),
  new RegExp(`[+\\-*/]\\s*${MONEY}`, 'g'),
  new RegExp(`${MONEY}\\s*[+\\-*/]=`, 'g'),
];

test('no arithmetic on a money-suffixed value outside the formatter', () => {
  const offences: string[] = [];
  let scanned = 0;

  for (const file of sourceFiles(SRC)) {
    const rel = relative(join(HERE, '..'), file);
    if (rel.endsWith(FORMATTER)) continue;
    scanned += 1;
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const pattern of PATTERNS) {
      for (const match of code.matchAll(pattern)) {
        offences.push(`${rel}: ${match[0].trim()}`);
      }
    }
  }

  expect(scanned, 'source files scanned').toBeGreaterThan(0);
  expect(offences, 'arithmetic on a money value outside src/format/money.ts').toEqual([]);
});

test('the check fires on the violation it exists to catch', () => {
  // RI-06's argument, applied to a check that has no seeded violation on disk:
  // a control watched only in its passing state is a control nobody has seen
  // work. These four are the forms a real diff would take.
  const violations = [
    'const distance = account.balance_cents - account.floor_cents;',
    'const total = a_cents + b_cents;',
    'const headroom = max_bp - best_day_share_bp;',
    'let running_cents = 0; running_cents += mark.realized_pnl_cents;',
  ];

  for (const line of violations) {
    const hit = PATTERNS.some((p) => new RegExp(p.source).test(line));
    expect(hit, `the check catches: ${line}`).toBe(true);
  }

  // And it does not fire on the two shapes that are not arithmetic: reading a
  // money field, and handing one to the formatter.
  const permitted = [
    'const shown = formatCents(account.floor_distance_cents);',
    'const { withdrawable_cents } = account;',
  ];
  for (const line of permitted) {
    const hit = PATTERNS.some((p) => new RegExp(p.source).test(line));
    expect(hit, `the check does not fire on: ${line}`).toBe(false);
  }
});
