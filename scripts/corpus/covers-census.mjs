// =============================================================================
// scripts/corpus/covers-census.mjs
// =============================================================================
// THE CENSUS BEHIND "30 OF 33", KEPT RATHER THAN REBUILT. ADR-398 section 9
// refused a prose gate over `covers` and priced the structuring slice that
// would make it buildable, and ADR-402 refused that slice. Both derivations
// were made by scaffolding built inside a session and thrown away with it, so
// the second row rebuilt the first row's instrument in order to check its
// figure, and a third would have rebuilt it again. This file is that
// scaffolding, kept, on the precedent citation-fan-in.mjs sets in this
// directory for exactly the same reason.
//
// IT IS AN INSTRUMENT AND NOT A GATE. It is registered in no GATES array, it
// mints no `CI-06` letter and no `RI-nn`, and it asserts nothing: there is no
// threshold at which a `covers` line is wrong. A gate documenting its own blind
// spot is the corpus working, and a runner that failed on the count of them
// would be answering a question nobody asked. ADR-398 measured the only
// buildable predicate over this field and found every finding false; ADR-402
// re-derived it and found more findings, all of them false as well.
//
// -----------------------------------------------------------------------------
// WHY IT REPORTS TWO GRAMMARS AND NOT ONE NUMBER
// -----------------------------------------------------------------------------
// "Carries a limitation clause" is a judgement about English, and a single
// figure hides that. NARROW counts an explicit negation of the check's own
// reach: `does NOT`, `is NOT`, `cannot`, `skips`, `never`, `deliberately not`.
// WIDE adds the quieter forms a person reads as a limitation and a regex does
// not, `only` chief among them. CI-06i is the case that makes the difference
// concrete: it says "Table names only; columns are checked against a live
// catalogue, which needs a database", which is a blind spot stated plainly and
// missed by every negation pattern. So NARROW is a FLOOR on the population and
// WIDE is the better estimate, and a row handed either figure alone is being
// handed the wrong end of an interval.
//
// -----------------------------------------------------------------------------
// THE FIGURES THIS FILE ONCE PRODUCED ARE NOT WRITTEN INTO IT
// -----------------------------------------------------------------------------
// ADR-383 section 8 ruled that a `covers` line should not carry a live cardinal
// and ADR-386 section 7 refined it: deletion and attribution are the same
// repair, because both turn a LIVE CLAIM into a RECORD. That ruling binds this
// header too. Every count here is DERIVED at the moment of the run and none is
// written down, so nothing in this file can go stale in the way fourteen
// cardinals in repo-invariants.mjs did. Where a figure is named in prose it is
// named with the entry that measured it and never in the present tense.
//
// usage: node scripts/corpus/covers-census.mjs
// =============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GATES } from './gates.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');

/** STRATEGY's gate inventory, named as gates.mjs names it so the two agree. */
const STRATEGY_DOC = 'docs/testing/STRATEGY.md';
const GATE_INVENTORY = '### 4.4 Corpus integrity';

/**
 * An explicit negation of the check's own reach. A FLOOR on the population.
 *
 * @type {RegExp[]}
 */
const NARROW = [
  /\bdoes\s+NOT\b/i,
  /\bdo\s+NOT\b/i,
  /\bis\s+NOT\b/i,
  /\bare\s+NOT\b/i,
  /\bNOT\s+check/i,
  /\bdeliberately\s+not\b/i,
  /\bcannot\b/i,
  /\bskips?\b/i,
  /\bexempt/i,
  /\brefus/i,
  /\bnever\b/i,
];

/** The quieter forms a person reads as a limitation. NARROW plus these. */
const WIDE = [
  ...NARROW,
  /\bonly\b/i,
  /\bignores?\b/i,
  /\bexclud/i,
  /\bwithout\b/i,
  /\bnothing\s+about\b/i,
  /\bstops?\s+at\b/i,
  /\bleaves?\b/i,
  /\bno\s+gate\b/i,
];

/**
 * The rows of STRATEGY section 4.4, which is where a gate's published
 * description lives and what ADR-398's predicate compares `covers` against.
 *
 * @returns {string[]}
 */
function inventoryRows() {
  const body = readFileSync(join(REPO_ROOT, STRATEGY_DOC), 'utf8');
  const start = body.indexOf(GATE_INVENTORY);
  if (start === -1) throw new Error(`${STRATEGY_DOC}: section not found: "${GATE_INVENTORY}"`);
  const rest = body.slice(start);
  const end = rest.indexOf('\n### ', 1);
  const section = end === -1 ? rest : rest.slice(0, end);
  const rows = section.split('\n').filter((l) => l.trim().startsWith('|'));
  // Rule 2: an empty section means the anchor moved, not that there is nothing
  // to compare against, and reporting a clean census would be the wrong answer.
  if (rows.length === 0) throw new Error(`${STRATEGY_DOC}: section 4.4 holds no table rows`);
  return rows;
}

/** The backticked tokens of one string, deduplicated, in source order. */
const tokensOf = (s) => [...new Set([...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]))];

/** The row of section 4.4 whose first cell names this gate, or undefined. */
const rowFor = (rows, id) => rows.find((r) => (r.split('|')[1] ?? '').includes(id));

function main() {
  const rows = inventoryRows();
  const ids = GATES.map((g) => g.id);

  // Rule 2 again: an empty GATES would make every figure below a clean zero.
  if (GATES.length === 0) throw new Error('GATES is empty; this census would report nothing');

  const narrow = GATES.filter((g) => NARROW.some((r) => r.test(g.covers)));
  const wide = GATES.filter((g) => WIDE.some((r) => r.test(g.covers)));
  const allTokens = new Set();
  let occurrences = 0;
  for (const g of GATES)
    for (const t of tokensOf(g.covers)) {
      allTokens.add(t);
      occurrences += 1;
    }

  console.log(`${GATES.length} gate(s), ${new Set(ids).size} distinct id(s)`);
  console.log(`  ${GATES.filter((g) => g.covers).length} carry a covers string`);
  console.log(
    `  ${narrow.length} carry a limitation clause under the NARROW grammar (a floor), ` +
      `${wide.length} under the WIDE one`,
  );
  console.log(
    `  ${allTokens.size} distinct backticked token(s) over ${occurrences} occurrence(s), ` +
      `in ${GATES.filter((g) => tokensOf(g.covers).length > 0).length} gate(s)`,
  );

  const stated = new Set(wide.map((g) => g.id));
  const silent = GATES.filter((g) => !stated.has(g.id)).map((g) => g.id);
  console.log(`\nStating no limitation at all (${silent.length}): ${silent.join(', ') || 'none'}`);

  // ADR-398 section 9's predicate, rebuilt: every backticked token in a gate's
  // `covers` appears somewhere in that gate's own section 4.4 row. It is
  // reported and never asserted, because ADR-398 and ADR-402 between them
  // measured every finding it has ever raised on this tree as FALSE.
  const findings = [];
  for (const g of GATES) {
    const toks = tokensOf(g.covers);
    if (toks.length === 0) continue;
    const row = rowFor(rows, g.id);
    if (row === undefined) {
      findings.push([g.id, '(no section 4.4 row)']);
      continue;
    }
    for (const t of toks) if (!row.includes(t)) findings.push([g.id, t]);
  }
  const reddened = new Set(findings.map((f) => f[0]));
  console.log(
    `\nADR-398 section 9's predicate, rebuilt: ${findings.length} finding(s) over ` +
      `${reddened.size} of ${GATES.length} gate(s). Every one measured so far is FALSE.`,
  );
  for (const [id, tok] of findings) console.log(`  ${id.padEnd(28)} ${JSON.stringify(tok)}`);

  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main());

export { NARROW, WIDE, tokensOf };
