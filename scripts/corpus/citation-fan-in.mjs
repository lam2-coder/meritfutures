// =============================================================================
// scripts/corpus/citation-fan-in.mjs
// =============================================================================
// WHAT A ROW ABOUT TO EDIT A HEAVILY CITED FILE NEEDS, AND NO RUNNER REPORTED
// IT. ADR-386 section 11 item 1 asked for this by name. Every fan-in figure in
// that entry's section 3, and every one in ADR-385 section 1, came from an
// INSTRUMENTED COPY of the checks package held outside the tree and deleted
// afterwards, so the numbers were unreproducible the moment the session ended
// and the next row started by rebuilding the same scaffolding. This file is
// that scaffolding, kept.
//
// IT IS AN INSTRUMENT AND NOT A GATE. It is registered in no `gates.mjs` table,
// it mints no `RI-nn`, and it asserts nothing: there is no threshold at which a
// fan-in is wrong. A file with 53 citations into it is not a defect, it is a
// PRICE, and the decision it informs -- may this line move, and what does
// moving it cost -- belongs to the row paying it. A runner that failed on a
// number would be answering a question nobody asked.
//
// -----------------------------------------------------------------------------
// IT READS WITH THE CHECKER'S OWN READER AND NOT WITH A GREP
// -----------------------------------------------------------------------------
// `RI-15` and `RI-16` share one citation grammar: `citationsIn` tokenizes the
// backticks, `citationTargets` resolves a pointer against the citing file or by
// suffix against the walk. A grep reproduces neither the inheritance window nor
// the markdown-href resolution, so a grep-derived fan-in disagrees with the
// checks in exactly the cases a row cares about. This runner therefore uses the
// checks' functions themselves.
//
// THEY ARE NOT EXPORTED, AND THIS FILE DOES NOT EXPORT THEM. `repo-invariants.
// mjs` keeps the grammar private and adding an export to it is a diff on
// somebody else's file, taken in a wave where that file is usually held by a
// concurrent row. So the WHOLE `checks/` DIRECTORY is copied to the system temp
// directory and one export statement is appended to the copy, and the copy is
// deleted before this process exits. The tracked tree is never written to,
// which is the same discipline ADR-385's session recorded for the scratch copy
// it made by hand.
//
// THE DIRECTORY IS COPIED WHOLE AND NOT THE ONE FILE, and the reason is a cycle
// rather than convenience. `repo-invariants.mjs` imports `ri11` from
// `ui-server-endpoints.mjs`, which imports back; rewriting one file's
// specifiers to point at the originals loads the module graph TWICE and the
// second instance reads a binding the first has not initialised. Copying the
// directory keeps every relative specifier meaning a sibling, so there is one
// instance of each and no rewrite at all. The directory imports nothing but its
// own siblings and `node:` builtins, which is what makes this legal.
//
// AND IT IS COPIED TO THE PATH IT ALREADY OCCUPIES, under a temporary root,
// because two constants in that module are DERIVED FROM ITS OWN LOCATION rather
// than written down: `REPO_ROOT` is three directories up and `OWN_PACKAGE` is
// found by walking up to the nearest `package.json`. Both are deliberate --
// a rename is supposed to move them -- and both fail on a file dropped in a
// flat temp directory, which is the module telling the truth about where it is.
// So the manifest travels with the checks and the shape is preserved.
//
// THE COPY IS A COPY OF THE FILE ON DISK AT THE MOMENT OF THE RUN, so a fan-in
// derived here is derived through whatever grammar the tree currently holds. If
// a row widens the grammar, this instrument widens with it and no figure here
// needs re-typing. That is the property ADR-386 section 5 found ADR-385 lacking
// in the other direction: a number carried is a number that rots.
//
// -----------------------------------------------------------------------------
// WHAT THE TWO COLUMNS MEAN, BECAUSE THEY ARE NOT THE SAME PRICE
// -----------------------------------------------------------------------------
// ADR-386's ruling on moving a cited line is that every pointer in a LIVE file
// is repaired and every pointer in a DATED RECORD is NAMED, because a dated
// record is amended rather than committed to. Those are different costs and a
// single total hides which one a row is about to pay. So every edge is labelled
// with the shape of the file it is written in, and the summary prints them
// apart: `live` is repairable by the row that moves the line, `dated` is not.
// A file whose fan-in is 40 dated edges and 2 live ones is CHEAP to edit and
// reads expensive when the two are added together.
// =============================================================================

import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const PACKAGE = 'packages/tooling';
const CHECKS = join(REPO_ROOT, PACKAGE, 'checks');

/** The internals this runner borrows, appended to the copy as one export. */
const BORROWED = [
  'citationsIn',
  'citationReader',
  'citationTargets',
  'citedReasonFiles',
  'documentScope',
  'read',
];

/**
 * The checker's citation grammar, loaded from a copy that exports it.
 *
 * Nothing in the copy is edited except the appended export, so the grammar
 * loaded is byte for byte the grammar on disk.
 *
 * @returns {Promise<Record<string, Function>>}
 */
async function borrowGrammar() {
  const dir = mkdtempSync(join(tmpdir(), 'merit-fan-in-'));
  const pkg = join(dir, PACKAGE);
  const copy = join(pkg, 'checks/repo-invariants.mjs');
  cpSync(CHECKS, join(pkg, 'checks'), { recursive: true });
  cpSync(join(REPO_ROOT, PACKAGE, 'package.json'), join(pkg, 'package.json'));
  appendFileSync(copy, `\nexport { ${BORROWED.join(', ')} };\n`);
  try {
    return await import(pathToFileURL(copy).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Every citation edge in the tree, resolved to the file it lands on.
 *
 * BOTH SCOPES, IN ONE PASS, because a row editing a source file is cited from
 * documents and a row editing a document is cited from source. `RI-15` reads
 * one and `RI-16` reads the other, and neither alone answers "what does this
 * line cost". The document side drops nothing: `RI-16` skips a citation under a
 * dated heading because it will not police one, and this runner COUNTS it and
 * labels it, because an unpoliced pointer is still a pointer that goes wrong.
 *
 * @param {Record<string, Function>} g
 * @returns {{from: string, at: number, to: string, line: number, cited: string, shape: 'live' | 'dated'}[]}
 */
function edges(g) {
  const { tree, candidates } = g.citationReader(REPO_ROOT);
  /** @type {{from: string, at: number, to: string, line: number, cited: string, shape: 'live' | 'dated'}[]} */
  const out = [];

  for (const rel of g.citedReasonFiles(tree))
    for (const c of g.citationsIn(g.read(REPO_ROOT, rel)))
      for (const to of g.citationTargets(REPO_ROOT, rel, c, candidates))
        out.push({ from: rel, at: c.at, to, line: c.start, cited: c.cited, shape: 'live' });

  for (const rel of tree.filter((f) => f.startsWith('docs/') && f.endsWith('.md'))) {
    const { body, inRecord } = g.documentScope(g.read(REPO_ROOT, rel));
    for (const c of g.citationsIn(body, false))
      for (const to of g.citationTargets(REPO_ROOT, rel, c, candidates))
        out.push({
          from: rel,
          at: c.at,
          to,
          line: c.start,
          cited: c.cited,
          shape: inRecord[c.at - 1] === true ? 'dated' : 'live',
        });
  }
  return out;
}

/**
 * The fan-in of one file, and the part of it that sits below a line.
 *
 * BELOW IS THE QUESTION A ROW ACTUALLY ASKS. Inserting at line N moves every
 * line after N and nothing before it, so the total is the wrong number and the
 * count below the insertion point is the right one. `at` is exact rather than
 * inclusive: a citation ON the line being replaced does not move.
 *
 * @param {ReturnType<typeof edges>} all
 * @param {string} rel
 * @param {number} below
 */
function report(all, rel, below) {
  const mine = all.filter((e) => e.to === rel);
  const under = mine.filter((e) => e.line > below);
  const count = (rows, shape) => rows.filter((r) => r.shape === shape).length;
  const lines = new Set(under.map((e) => e.line));
  const froms = new Set(under.map((e) => e.from));

  console.log(`${rel}`);
  console.log(
    `  ${mine.length} citation(s) in total, ${count(mine, 'live')} live and ` +
      `${count(mine, 'dated')} dated`,
  );
  console.log(
    `  ${under.length} below line ${below}: ${count(under, 'live')} live to repair and ` +
      `${count(under, 'dated')} dated to name, over ${lines.size} distinct line(s) and ` +
      `${froms.size} distinct file(s)`,
  );
  for (const e of [...under].sort((a, b) => a.line - b.line || a.from.localeCompare(b.from)))
    console.log(`    :${e.line}  <- ${e.from}:${e.at}  \`${e.cited}\`  (${e.shape})`);
}

/**
 * The files with the most citations into them, which is the shelf a row should
 * know about before it picks a file to edit.
 *
 * @param {ReturnType<typeof edges>} all
 * @param {number} top
 */
function leaderboard(all, top) {
  /** @type {Map<string, {live: number, dated: number}>} */
  const tally = new Map();
  for (const e of all) {
    const row = tally.get(e.to) ?? { live: 0, dated: 0 };
    row[e.shape] += 1;
    tally.set(e.to, row);
  }
  const rows = [...tally.entries()].sort(
    (a, b) => b[1].live + b[1].dated - (a[1].live + a[1].dated) || a[0].localeCompare(b[0]),
  );
  console.log(
    `${all.length} citation edge(s) resolve onto ${tally.size} file(s). The ${Math.min(top, rows.length)} most cited:`,
  );
  for (const [rel, row] of rows.slice(0, top))
    console.log(
      `  ${String(row.live + row.dated).padStart(4)}  ${rel}  (${row.live} live, ${row.dated} dated)`,
    );
}

const args = process.argv.slice(2);
const grammar = await borrowGrammar();
const all = edges(grammar);

if (args.length === 0) {
  leaderboard(all, 25);
} else {
  for (const arg of args) {
    const [rel, at] = arg.split(/:(?=\d+$)/);
    report(all, rel ?? arg, at === undefined ? 0 : Number(at));
  }
}
