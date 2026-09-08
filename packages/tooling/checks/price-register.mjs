// =============================================================================
// packages/tooling/checks/price-register.mjs
// =============================================================================
// THE CORPUS PRICES THE WORK IT DOES NOT TAKE, AND UNTIL THIS FILE NOTHING THAT
// RUNS KNEW THE WORD `Price` EXISTED.
//
//   node packages/tooling/checks/price-register.mjs
//
// `ADR-461` section 7 item 2 is the whole of the motivation and it is quoted
// rather than paraphrased:
//
//   "THE PRICING IDIOM IS UNENFORCED AND ITS POPULATION IS INVISIBLE TO EVERY
//    CHECK. Forty-one prices are load-bearing enough that four rows of this wave
//    were dispatched against one of them, and nothing in `gates.mjs`,
//    `repo-invariants.mjs` or any lint rule knows the word `Price` exists. There
//    is no register of them, no gate that a price names a file that exists, and
//    no way to ask which prices a diff invalidated. Every one of the ten wrong
//    prices in section 4 would have been catchable by a person reading the file,
//    and none of them was catchable by anything that runs."
//
// The failure is narrow and worth stating in one sentence: an entry sets a price
// on work it leaves, a later row reads that price instead of the tree, and the
// price is wrong.
//
// -----------------------------------------------------------------------------
// WHAT THIS CHECK DECIDES AND WHAT IT REFUSES TO DECIDE
// -----------------------------------------------------------------------------
// THE STATE OF A PRICE IS NOT DERIVABLE AND THIS FILE DOES NOT PRETEND IT IS.
// Whether a price is still owed, whether the tree contradicts it, and whether
// any state of the tree could settle it are three readings, and a script that
// claimed them would be inventing them. `ADR-461` reached its verdicts by
// reading forty-one clauses against the tree one at a time, over a whole row.
//
// So the division is explicit:
//
//   DERIVED HERE          the population, from the corpus, on every run
//                         each price's anchor, section and item
//                         every repo path a price clause cites, and whether it
//                         resolves and is in range
//
//   READ FROM THE REGISTER and never computed
//                         the obligation (is the work still owed)
//                         the accuracy (does the price describe the tree)
//                         the basis (who says so)
//
// The register is the reader's half. This check's whole job is to keep that half
// HONEST: every price present, no price invented, every anchor where the register
// says it is, every path real, every non-default state carrying a citation. It
// cannot tell a correct verdict from a plausible one and it does not try.
//
// -----------------------------------------------------------------------------
// WHY THE POPULATION IS RE-DERIVED AND NEVER PINNED AS A NUMBER
// -----------------------------------------------------------------------------
// `ADR-461` published its derivation as
//
//   grep -ohE '\*\*?Price[^*]{0,40}?:' docs/decisions/ADR-*.md
//
// and that command DOES NOT REPRODUCE ITS OWN CENSUS. It requires an asterisk
// immediately before `Price`, and three of the forty-one prices it scored are
// written unbolded: `ADR-445:139`, `ADR-448:159` and `ADR-458:198`. The census
// table is right and the command under it is short by three. A register built by
// transcribing either that command's output or that entry's table would inherit
// the error, which is the reason this file counts the corpus itself on every run
// and pins no total anywhere.
//
// The idiom, as this file reads it: the word `Price`, optionally carrying a short
// `of the ...` qualifier, immediately followed by a colon, in a decision entry,
// OUTSIDE a code span, a fenced block and a blockquote. The exclusions are not
// decoration. Every entry that discusses the idiom quotes it, and an entry that
// quotes the label is talking about prices rather than setting one. `ADR-461`
// itself carries three such quotations on one line and `ADR-464` quotes the item
// it takes at length; without the exclusions the population would grow every time
// somebody wrote about it.
//
// -----------------------------------------------------------------------------
// WHAT THIS CHECK CANNOT DO, STATED HERE RATHER THAN DISCOVERED LATER
// -----------------------------------------------------------------------------
// LEG C SEES A PATH ONLY WHERE THE PRICE LINKS IT. A clause that names
// `corpus.yml` in a bare code span and links nothing is invisible to it. That is
// the same hole `ADR-461` section 7 item 1 found in the citation discipline at
// large, where a prose pointer of the form "its own `:270`" is enumerable by no
// derivation in this corpus, and it is recorded here rather than quietly carried.
// The leg's coverage is reported on every PASS as a fraction of the population
// so that the bound is a number a reader sees and not a caveat they have to find.
//
// IT READS ONE IDIOM AND NOT EVERY FORCING CLAIM. `ADR-461` section 8 measured a
// second population, 182 candidate claims over 99 entries, and refused to call it
// a population because its filter is a keyword union whose precision was never
// measured. This file is scoped to the labelled idiom for the same reason and
// section 8's row is still owed.
//
// THE REGISTER'S STATE CAN BE STALE AND NOTHING HERE WILL SAY SO. A price marked
// OPEN whose work landed yesterday stays OPEN until a reader moves it. What this
// converts is an unwritten convention into a written one with a tripwire on it,
// and that is the whole of the claim.
// =============================================================================

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {{ file: string; entry: string; line: number; where: string;
 *             clause: string; links: Link[] }} Price
 * @typedef {{ label: string; target: string; line: number | undefined }} Link
 * @typedef {{ anchor: string; where: string; obligation: string; accuracy: string;
 *             basis: string; row: number }} Row
 */

/** The decision entries, which are the only files that set a price. */
export const DECISIONS = resolve(HERE, '../../../docs/decisions');

/** The reader's half. */
export const REGISTER = resolve(DECISIONS, 'PRICE_REGISTER.md');

/**
 * Is the work still owed.
 *
 * OPEN is the default and needs no basis. Anything else is a claim that
 * something happened, so leg D demands a citation for it.
 */
export const OBLIGATIONS = ['OPEN', 'DISCHARGED', 'WITHDRAWN'];

/**
 * Does the price describe the tree.
 *
 * UNASSESSED is the default and means nobody has checked, which is a state worth
 * having: it is how the register shows which prices are load-bearing and unread.
 * Anything else is a verdict, so leg D demands a citation for it.
 */
export const ACCURACIES = ['HOLDS', 'WRONG', 'UNCHECKABLE', 'UNASSESSED'];

/**
 * A repo path a price cites that does not resolve, declared with a reason.
 *
 * KEYED `anchor::path`. Every reason opens `SETTLED` or `OPEN`, on
 * `write-guard-set.mjs`'s precedent: `SETTLED` means the path is correctly
 * absent (a price may name a file whose whole point is that it does not exist
 * yet) and `OPEN` means the absence is a hole somebody has written down. Both
 * keep this check green, and the difference is the difference between a decision
 * and a debt.
 *
 * EMPTY AT THE BASE THIS WAS WRITTEN ON, and that is a measurement rather than an
 * omission: all 15 path citations in the population resolve and every one whose
 * label carries a line number is in range.
 *
 * @type {Record<string, string>}
 */
const DECLARED_UNRESOLVED = {};

/** The literal idiom. */
const IDIOM = /\bPrice(?: of the [a-z]+)?:/g;

/** A markdown link, with its label, inside a price clause. */
const LINK = /\[`?([^\]`]+)`?\]\(([^)\s]+)\)/g;

/** An entry file. */
const ENTRY = /^ADR-\d+\.md$/;

/**
 * Blank every code span, fenced block and blockquote, keeping every offset.
 *
 * A QUOTATION OF THE IDIOM IS NOT AN INSTANCE OF IT, and every entry that
 * discusses pricing quotes it. The three exclusions are the three places this
 * corpus puts a quotation: inline in backticks, in a fence, and in a blockquote.
 * The blockquote arm was added on a measurement rather than a hunch. NOT ONE of
 * the labelled prices in this corpus sits on a `>` line, while blockquotes are
 * used throughout it to reproduce another document's words, and the first entry
 * to quote a price at length rather than inline was this checker's own.
 *
 * THE COST IS STATED: a price WRITTEN inside a blockquote would be invisible
 * here, exactly as one written inside backticks is. The idiom is a bolded clause
 * in an entry's own prose and neither shape has ever been used for one.
 *
 * Offsets are preserved because leg B reads the clause back out of the RAW line:
 * masking must not move a column.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function maskedLines(text) {
  let fenced = false;
  return text.split('\n').map((line) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return ' '.repeat(line.length);
    }
    if (fenced || /^\s*>/.test(line)) return ' '.repeat(line.length);
    return line.replace(/`[^`]*`/g, (span) => ' '.repeat(span.length));
  });
}

/**
 * Every labelled price in the decision entries, with where it sits.
 *
 * THE SECTION AND ITEM ARE DERIVED AND NOT READ FROM THE REGISTER. The section is
 * the nearest preceding `### N.` heading; the item is a leading `N.` ON THE SAME
 * LINE and nowhere else. The same-line rule is what keeps a price that follows a
 * numbered list from being attributed to its last item: `ADR-458`'s section 6
 * price sits in a paragraph after item 3 and belongs to the section, which is
 * how `ADR-461` cites it.
 *
 * TAKES A DIRECTORY SO THE SUITE CAN WATCH THIS RED. The default is the real
 * corpus; the suite hands it a fabricated one, which is the only way to seed a
 * missing price without editing an entry this check ships beside.
 *
 * @param {string} [dir]
 * @returns {Price[]}
 */
export function derive(dir = DECISIONS) {
  /** @type {Price[]} */
  const prices = [];
  for (const name of readdirSync(dir)
    .filter((n) => ENTRY.test(n))
    .sort()) {
    const raw = readFileSync(resolve(dir, name), 'utf8');
    const rawLines = raw.split('\n');
    const masked = maskedLines(raw);
    let section = '';
    masked.forEach((line, index) => {
      const heading = /^###\s+(\d+)\./.exec(rawLines[index] ?? '');
      if (heading?.[1] !== undefined) section = heading[1];
      const item = /^(\d+)\.\s/.exec(rawLines[index] ?? '');
      for (const match of line.matchAll(IDIOM)) {
        const clause = (rawLines[index] ?? '').slice(match.index + match[0].length);
        prices.push({
          file: name,
          entry: name.replace(/\.md$/, ''),
          line: index + 1,
          where: item?.[1] === undefined ? section : `${section}.${item[1]}`,
          clause,
          links: [...clause.matchAll(LINK)]
            .filter((link) => !/^(?:https?:|#|mailto:)/.test(link[2] ?? ''))
            .map((link) => {
              const cited = /:(\d+)$/.exec(link[1] ?? '');
              return {
                label: link[1] ?? '',
                target: (link[2] ?? '').split('#')[0] ?? '',
                line: cited?.[1] === undefined ? undefined : Number(cited[1]),
              };
            }),
        });
      }
    });
  }
  return prices;
}

/** The anchor a register row and a derived price agree on. */
export const anchorOf = (/** @type {Price} */ price) => `${price.entry}:${String(price.line)}`;

/**
 * The register's rows, in the order it lists them.
 *
 * THE PARSE IS THE FIRST FIVE CELLS OF EVERY TABLE ROW WHOSE SECOND CELL IS AN
 * ANCHOR, which is how `ALLOCATION.md` is read by `CI-06f` and for the same
 * reason: a table split into a file per row is not a table. A row that is not
 * shaped like an anchor row is prose in a table and is skipped, so the register
 * may carry a legend without this check reading it as data.
 *
 * @param {string} [path]
 * @returns {Row[]}
 */
export function readRegister(path = REGISTER) {
  /** @type {Row[]} */
  const rows = [];
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (!line.startsWith('|')) return;
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim());
      if (cells.length < 6) return;
      const anchor = /^`?(ADR-\d+:\d+)`?$/.exec(cells[1] ?? '');
      if (anchor?.[1] === undefined) return;
      rows.push({
        anchor: anchor[1],
        where: (cells[2] ?? '').replace(/`/g, ''),
        obligation: cells[3] ?? '',
        accuracy: cells[4] ?? '',
        basis: cells[5] ?? '',
        row: index + 1,
      });
    });
  return rows;
}

/**
 * Leg A. The register is the population, both ways.
 *
 * A PRICE WITHOUT A ROW is the failure that lets a wrong price sit unread, which
 * is section 7 item 2's whole complaint. A ROW WITHOUT A PRICE is the failure
 * this row was warned about by name: a register transcribed out of another
 * entry's table instead of derived at its own base.
 *
 * @param {Price[]} prices
 * @param {Row[]} rows
 */
export function legPopulation(prices, rows) {
  /** @type {string[]} */
  const findings = [];
  const derived = new Set(prices.map(anchorOf));
  const registered = new Set(rows.map((row) => row.anchor));

  for (const price of prices) {
    if (registered.has(anchorOf(price))) continue;
    findings.push(
      `leg A: ${anchorOf(price)} sets a price and the register does not list it. Add a row ` +
        'with its obligation and its accuracy, or say in the register why the idiom matched ' +
        'something that is not a price.',
    );
  }
  for (const row of rows) {
    if (derived.has(row.anchor)) continue;
    findings.push(
      `leg A: the register's row at :${String(row.row)} lists ${row.anchor} and no price is ` +
        'derived there. Either the entry moved the clause, or the row was copied from ' +
        "somewhere else rather than derived. ADR-461's own published command misses three of " +
        'its own forty-one, so a row that came from a table is exactly the failure to expect.',
    );
  }

  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const row of rows) seen.set(row.anchor, (seen.get(row.anchor) ?? 0) + 1);
  for (const [anchor, count] of seen) {
    if (count > 1) {
      findings.push(
        `leg A: the register lists ${anchor} ${String(count)} times. One price, one row, or ` +
          'the totals this check reports are not counts of anything.',
      );
    }
  }

  return { findings, derived: prices.length, registered: rows.length };
}

/**
 * Leg B. Every row is anchored where it says it is.
 *
 * THE ANCHOR IS A LINE AND THE `where` IS A SECTION AND ITEM, and the two are
 * derived independently from the entry. A row that names the right line and the
 * wrong section did not come from this tree.
 *
 * @param {Price[]} prices
 * @param {Row[]} rows
 */
export function legAnchors(prices, rows) {
  /** @type {string[]} */
  const findings = [];
  const byAnchor = new Map(prices.map((price) => [anchorOf(price), price]));
  let checked = 0;
  for (const row of rows) {
    const price = byAnchor.get(row.anchor);
    if (price === undefined) continue; // leg A owns a row with no price.
    checked += 1;
    if (price.where !== row.where) {
      findings.push(
        `leg B: the register places ${row.anchor} at section ${row.where} and the entry puts ` +
          `it at ${price.where}. The section is the nearest preceding "### N." heading and the ` +
          'item is a leading "N." on the price\'s own line; both are derived on every run and ' +
          'neither is read from this table.',
      );
    }
  }
  return { findings, checked };
}

/**
 * Leg C. Every path a price cites resolves, and every cited line is in range.
 *
 * THIS IS THE LEG `ADR-461` SECTION 10 ITEM 4 CALLED "the cheapest useful leg"
 * AND SAID "would have caught nothing in this census". That is true and it is
 * still worth running: it is the only leg here that goes red on a tree that
 * moved under a price nobody re-read, which is the way a price rots between one
 * row and the next rather than the way it arrives wrong.
 *
 * @param {Price[]} prices
 * @param {string} [dir]
 * @param {Record<string, string>} [declared]
 */
export function legPaths(prices, dir = DECISIONS, declared = DECLARED_UNRESOLVED) {
  /** @type {string[]} */
  const findings = [];
  let citations = 0;
  let ranged = 0;
  let priced = 0;

  for (const price of prices) {
    if (price.links.length > 0) priced += 1;
    for (const link of price.links) {
      citations += 1;
      const anchor = anchorOf(price);
      const key = `${anchor}::${link.target}`;
      const target = resolve(dir, link.target);
      if (!existsSync(target)) {
        const reason = declared[key];
        if (reason === undefined) {
          findings.push(
            `leg C: ${anchor} cites \`${link.target}\` and nothing is there. A price that names ` +
              'a path which does not exist is either stale or was written against a file that ' +
              `was never created. Repair it if the entry is live; if it is a dated record, ` +
              `declare it with a SETTLED or OPEN reason under the key "${key}".`,
          );
          continue;
        }
        if (!/^(SETTLED|OPEN):/.test(reason)) {
          findings.push(
            `leg C: the reason declared for "${key}" opens with neither SETTLED nor OPEN. The ` +
              'class is what separates a decision from a debt and it is not optional.',
          );
        }
        continue;
      }
      if (link.line === undefined) continue;
      ranged += 1;
      const length = readFileSync(target, 'utf8').split('\n').length;
      if (link.line > length) {
        findings.push(
          `leg C: ${anchor} cites \`${link.target}:${String(link.line)}\` and that file is ` +
            `${String(length)} lines long. The pointer is past the end of the file it names.`,
        );
      }
    }
  }

  return { findings, citations, ranged, priced };
}

/**
 * Leg D. Every state is in the vocabulary, and every verdict carries a citation.
 *
 * THIS LEG DOES NOT CHECK A STATE. It checks that a state was WRITTEN DOWN from a
 * closed list, and that any state other than the two defaults names who decided
 * it. OPEN and UNASSESSED are the defaults precisely because they claim nothing:
 * a price nobody has looked at is owed and unscored, and saying so costs no
 * citation. Every other cell is somebody's reading and has to say whose.
 *
 * @param {Row[]} rows
 * @param {string} [dir]
 */
export function legStates(rows, dir = DECISIONS) {
  /** @type {string[]} */
  const findings = [];
  /** @type {Record<string, number>} */
  const obligations = {};
  /** @type {Record<string, number>} */
  const accuracies = {};

  for (const row of rows) {
    if (!OBLIGATIONS.includes(row.obligation)) {
      findings.push(
        `leg D: ${row.anchor} carries obligation "${row.obligation}", which is not one of ` +
          `${OBLIGATIONS.join(', ')}. The vocabulary is closed so that the tallies this check ` +
          'reports are counts of the same thing every run.',
      );
    } else {
      obligations[row.obligation] = (obligations[row.obligation] ?? 0) + 1;
    }

    if (!ACCURACIES.includes(row.accuracy)) {
      findings.push(
        `leg D: ${row.anchor} carries accuracy "${row.accuracy}", which is not one of ` +
          `${ACCURACIES.join(', ')}.`,
      );
    } else {
      accuracies[row.accuracy] = (accuracies[row.accuracy] ?? 0) + 1;
    }

    const claims = row.obligation !== 'OPEN' || row.accuracy !== 'UNASSESSED';
    const basis = row.basis.replace(/[-–—\s]/g, '');
    if (claims && basis === '') {
      findings.push(
        `leg D: ${row.anchor} is marked ${row.obligation}/${row.accuracy} and cites nobody. ` +
          'OPEN and UNASSESSED are the states that claim nothing; every other state is a ' +
          'reading, and a reading with no basis is the thing this register exists to replace.',
      );
      continue;
    }
    if (!claims) continue;

    // DEDUPED, because a basis cites an entry as a LINK and the corpus spells a
    // link with the id in both halves. Reporting one absent entry twice reads as
    // two holes and there is one.
    const cited = new Set([...row.basis.matchAll(/\bADR-(\d+)\b/g)].map((m) => m[1] ?? ''));
    for (const id of cited) {
      if (existsSync(resolve(dir, `ADR-${id}.md`))) continue;
      findings.push(
        `leg D: ${row.anchor} rests on ADR-${id}, and there is no such entry. A basis that ` +
          'names nothing is worse than no basis, because it reads as checked.',
      );
    }
    if (!/\bADR-\d+\b/.test(row.basis)) {
      findings.push(
        `leg D: ${row.anchor} is marked ${row.obligation}/${row.accuracy} and its basis names ` +
          'no entry. Cite the entry that decided it, so the next reader can go and disagree.',
      );
    }
  }

  return { findings, obligations, accuracies };
}

/** @param {string} line */
const emit = (line) => {
  process.stdout.write(`${line}\n`);
};

/** @param {Record<string, number>} tally */
const spell = (tally) =>
  Object.entries(tally)
    .sort()
    .map(([name, count]) => `${String(count)} ${name}`)
    .join(', ');

/**
 * Run every leg. Exit 0 only when all four hold.
 *
 * @param {string[]} [argv]
 */
export function run(argv = []) {
  if (argv.length > 0) {
    emit('It takes no argument. Every input it has is derived from the tree on the run.');
    return 2;
  }

  /** @type {Price[]} */
  let prices;
  /** @type {Row[]} */
  let rows;
  try {
    prices = derive();
    rows = readRegister();
  } catch (err) {
    emit(`ERROR  could not read the corpus or the register: ${String(err)}`);
    return 2;
  }

  const a = legPopulation(prices, rows);
  const b = legAnchors(prices, rows);
  const c = legPaths(prices);
  const d = legStates(rows);
  const findings = [...a.findings, ...b.findings, ...c.findings, ...d.findings];

  if (findings.length === 0) {
    const entries = new Set(prices.map((price) => price.entry)).size;
    emit(
      `PASS   ${String(a.derived)} labelled price(s) over ${String(entries)} entry(ies), and ` +
        `the register lists ${String(a.registered)} of them; ${String(b.checked)} anchor(s) sit ` +
        'at the section and item the register gives; ' +
        `${String(c.citations)} path citation(s) over ${String(c.priced)} price(s) resolve, of ` +
        `which ${String(c.ranged)} name a line and every one is in range; obligations ` +
        `${spell(d.obligations)}; accuracy ${spell(d.accuracies)}`,
    );
    return 0;
  }

  emit(`FAIL   the price register is not the corpus's prices (${String(findings.length)})`);
  for (const finding of findings) emit(`       ${finding}`);
  emit('');
  emit(
    'THE POPULATION IS DERIVED FROM docs/decisions ON EVERY RUN AND THE STATE IS READ FROM ' +
      'PRICE_REGISTER.md. If a finding names a price you meant to add, the register is what you ' +
      'update; if it names a state, no number in this file decides it and no number in this ' +
      'file will.',
  );
  return 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(run(process.argv.slice(2)));
