import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  ACCURACIES,
  DECISIONS,
  OBLIGATIONS,
  REGISTER,
  anchorOf,
  derive,
  legAnchors,
  legPaths,
  legPopulation,
  legStates,
  maskedLines,
  readRegister,
  run,
} from '../checks/price-register.mjs';

// =============================================================================
// EVERY LEG IS WATCHED FAILING, AND THE MOTIVATING FAILURE IS WATCHED BY NAME
// =============================================================================
// `ADR-461` section 7 item 2 names one failure: an entry sets a price on work it
// leaves, nothing that runs knows the price exists, and the next row reads it
// instead of the tree. `leg A, the motivating failure` below is that exact
// sentence executed: a price in the corpus with no row in the register.
//
// THE SECOND FAILURE IS THIS ROW'S OWN AND IT IS WATCHED TOO. A register
// transcribed out of another entry's table instead of derived at its own base is
// the error the whole 448s wave is about, and `ADR-461`'s published derivation
// command misses three of its own forty-one, so a transcribed row is exactly the
// shape to expect. Leg A's reverse direction and leg B are what see it.
//
// THE CORPUS IS FABRICATED AND THE REAL ENTRIES ARE NEVER WRITTEN. `derive` and
// `legPaths` take a directory and `readRegister` takes a path for this reason and
// for no other: seeding a missing price by editing `ADR-445` would be editing a
// dated record, which `ADR-386`:169 forbids and this row's fence forbids twice.
// Every fabricated case below asserts its own shape before reading a finding,
// because a fixture that silently failed to parse leaves a case that passes by
// testing nothing.
// =============================================================================

/** A fabricated corpus, one entry per key. */
function corpus(entries: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'merit-price-corpus-'));
  for (const [name, body] of Object.entries(entries)) writeFileSync(join(dir, name), body);
  return dir;
}

/** A fabricated register holding exactly these rows. */
function register(rows: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'merit-price-register-'));
  const path = join(dir, 'PRICE_REGISTER.md');
  writeFileSync(
    path,
    [
      '| # | Anchor | Where | Obligation | Accuracy | Basis |',
      '| --- | --- | --- | --- | --- | --- |',
      ...rows,
    ].join('\n'),
  );
  return path;
}

/** One register row, in the register's own spelling. */
const row = (
  n: number,
  anchor: string,
  where: string,
  obligation: string,
  accuracy: string,
  basis: string,
) => `| ${String(n)} | \`${anchor}\` | ${where} | ${obligation} | ${accuracy} | ${basis} |`;

/** An entry with one section holding one numbered item that prices something. */
const entry = (section: string, item: string, clause: string) =>
  [
    '## ADR-999: a fabricated entry',
    '',
    `### ${section}. What is owed`,
    '',
    `${item}. **A THING IS OWED.** **Price: ${clause}**`,
    '',
  ].join('\n');

describe('the population is derived from the corpus and never from a table', () => {
  test('the labelled idiom is found, with its section and its item', () => {
    const prices = derive(corpus({ 'ADR-999.md': entry('8', '3', 'one line.') }));
    expect(prices).toHaveLength(1);
    expect(prices[0]?.where).toBe('8.3');
    expect(anchorOf(prices[0]!)).toBe('ADR-999:5');
  });

  test('the qualified spellings of the label are the same idiom', () => {
    const body = [
      '## ADR-999: a fabricated entry',
      '',
      '### 2. What is owed',
      '',
      '1. **ONE.** **Price of the step: a row.**',
      '2. **TWO.** **Price of the widening: a line.**',
      '',
    ].join('\n');
    expect(derive(corpus({ 'ADR-999.md': body })).map((p) => p.where)).toEqual(['2.1', '2.2']);
  });

  test('an UNBOLDED price is the same idiom, which is the defect in ADR-461s own command', () => {
    // ADR-461 published `\*\*?Price[^*]{0,40}?:`, which requires an asterisk
    // against `Price`. Three of the forty-one prices it SCORED are unbolded, so
    // the command is short of the census it sits under. This case is that gap.
    const body = [
      '## ADR-999: a fabricated entry',
      '',
      '### 8. What is owed',
      '',
      '3. **A THING.** Price: a recording handle.',
      '',
    ].join('\n');
    expect(derive(corpus({ 'ADR-999.md': body })).map((p) => p.where)).toEqual(['8.3']);
  });

  test('a QUOTATION of the idiom in a code span is not a price', () => {
    const body = [
      '## ADR-999: a fabricated entry',
      '',
      '### 2. How the population was derived',
      '',
      'The corpus writes the literal `Price:` to open a clause, and `Price of the step:` beside it.',
      '',
    ].join('\n');
    expect(derive(corpus({ 'ADR-999.md': body }))).toEqual([]);
  });

  test('a QUOTATION of the idiom in a fenced block is not a price', () => {
    const body = [
      '## ADR-999: a fabricated entry',
      '',
      '### 2. How the population was derived',
      '',
      '```',
      'grep -n "Price: " docs/decisions',
      '```',
      '',
    ].join('\n');
    expect(derive(corpus({ 'ADR-999.md': body }))).toEqual([]);
  });

  test('a QUOTATION of the idiom in a blockquote is not a price', () => {
    // NOT ONE of the labelled prices in this corpus sits on a `>` line, and the
    // first entry to quote a price at length rather than inline was ADR-464,
    // which quotes the very item it takes. A blockquote here is somebody else's
    // words and a price is the entry's own.
    const body = [
      '## ADR-999: a fabricated entry',
      '',
      '### 5. What was asked for',
      '',
      'The item priced two options:',
      '',
      '> **Price: a letter or a register span listing all of them with their state.**',
      '',
    ].join('\n');
    expect(derive(corpus({ 'ADR-999.md': body }))).toEqual([]);
  });

  test('masking preserves every offset, so a clause is read out of the RAW line', () => {
    const source = 'a `span` and **Price: a thing**';
    const masked = maskedLines(source)[0] ?? '';
    expect(masked).toHaveLength(source.length);
    expect(masked.indexOf('Price')).toBe(source.indexOf('Price'));
  });

  test('an item is a leading number ON THE PRICE LINE and never a preceding one', () => {
    // ADR-458's section 6 price sits in a paragraph AFTER a numbered list, and
    // ADR-461 cites it as "section 6" with no item. A tracker that carried the
    // last item forward would attribute it to item 3 and every anchor derived
    // from this file would disagree with every citation of it in the corpus.
    const body = [
      '## ADR-999: a fabricated entry',
      '',
      '### 6. A finding',
      '',
      '3. **THE THIRD THING.** It is described here.',
      '',
      '**IT IS NOT REPAIRED HERE.** **Price: a row that owns the file.**',
      '',
    ].join('\n');
    expect(derive(corpus({ 'ADR-999.md': body })).map((p) => p.where)).toEqual(['6']);
  });

  test('a file that is not an entry is not read', () => {
    const dir = corpus({
      'ADR-999.md': entry('8', '1', 'one line.'),
      'ALLOCATION.md': '**Price: quoted by a dispatcher into a table.**',
      'PRICE_REGISTER.md': '**Price: quoted by the register itself.**',
    });
    expect(derive(dir)).toHaveLength(1);
  });
});

describe('leg A, the population and the register are the same set', () => {
  test('THE MOTIVATING FAILURE: a price in the corpus with no row in the register', () => {
    const prices = derive(corpus({ 'ADR-999.md': entry('8', '1', 'one line.') }));
    expect(prices, 'the fixture priced nothing and the case would be vacuous').toHaveLength(1);
    const findings = legPopulation(prices, readRegister(register([]))).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(
      'leg A: ADR-999:5 sets a price and the register does not list it',
    );
  });

  test('a row naming a price the corpus does not set, which is a transcribed table', () => {
    const prices = derive(corpus({ 'ADR-999.md': entry('8', '1', 'one line.') }));
    const rows = readRegister(
      register([
        row(1, 'ADR-999:5', '8.1', 'OPEN', 'UNASSESSED', '-'),
        row(2, 'ADR-445:135', '8.1', 'OPEN', 'UNASSESSED', '-'),
      ]),
    );
    expect(rows, 'the register fixture did not parse').toHaveLength(2);
    const findings = legPopulation(prices, rows).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('lists ADR-445:135 and no price is derived there');
  });

  test('one price, one row', () => {
    const prices = derive(corpus({ 'ADR-999.md': entry('8', '1', 'one line.') }));
    const rows = readRegister(
      register([
        row(1, 'ADR-999:5', '8.1', 'OPEN', 'UNASSESSED', '-'),
        row(2, 'ADR-999:5', '8.1', 'OPEN', 'UNASSESSED', '-'),
      ]),
    );
    const findings = legPopulation(prices, rows).findings;
    expect(findings.some((f) => f.includes('lists ADR-999:5 2 times'))).toBe(true);
  });

  test('green when the two sets agree', () => {
    const prices = derive(corpus({ 'ADR-999.md': entry('8', '1', 'one line.') }));
    const leg = legPopulation(
      prices,
      readRegister(register([row(1, 'ADR-999:5', '8.1', 'OPEN', 'UNASSESSED', '-')])),
    );
    expect(leg.findings).toEqual([]);
    expect(leg.derived).toBe(1);
    expect(leg.registered).toBe(1);
  });
});

describe('leg B, a row is anchored where it says it is', () => {
  test('the register puts a price in a section the entry does not', () => {
    const prices = derive(corpus({ 'ADR-999.md': entry('8', '1', 'one line.') }));
    const rows = readRegister(register([row(1, 'ADR-999:5', '11.2', 'OPEN', 'UNASSESSED', '-')]));
    const findings = legAnchors(prices, rows).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('places ADR-999:5 at section 11.2 and the entry puts it at 8.1');
  });

  test('green when the section and item are the entrys own', () => {
    const prices = derive(corpus({ 'ADR-999.md': entry('8', '1', 'one line.') }));
    const leg = legAnchors(
      prices,
      readRegister(register([row(1, 'ADR-999:5', '8.1', 'OPEN', 'UNASSESSED', '-')])),
    );
    expect(leg.findings).toEqual([]);
    expect(leg.checked).toBe(1);
  });
});

describe('leg C, a price names a path that is there', () => {
  const priced = (clause: string) => corpus({ 'ADR-999.md': entry('8', '1', clause) });

  test('a path that does not resolve, undeclared', () => {
    const prices = derive(
      priced('one leg in [`gone.mjs`](../../packages/tooling/checks/gone.mjs).'),
    );
    expect(
      prices[0]?.links,
      'the fixture cited no path and the case would be vacuous',
    ).toHaveLength(1);
    const findings = legPaths(prices, DECISIONS, {}).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(
      'cites `../../packages/tooling/checks/gone.mjs` and nothing is there',
    );
  });

  test('a path that does not resolve, declared SETTLED, keeps the check green', () => {
    const prices = derive(priced('one entry in [`later.yml`](../../.github/workflows/later.yml).'));
    const declared = {
      'ADR-999:5::../../.github/workflows/later.yml':
        'SETTLED: the file is the thing the price buys.',
    };
    expect(legPaths(prices, DECISIONS, declared).findings).toEqual([]);
  });

  test('a declaration with no class is itself the finding', () => {
    const prices = derive(priced('one entry in [`later.yml`](../../.github/workflows/later.yml).'));
    const declared = { 'ADR-999:5::../../.github/workflows/later.yml': 'it is fine.' };
    const findings = legPaths(prices, DECISIONS, declared).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('opens with neither SETTLED nor OPEN');
  });

  test('a cited line past the end of the file it names', () => {
    const prices = derive(
      priced('the clause at [`scoped-db.ts:99999`](../../packages/db/src/scoped-db.ts).'),
    );
    expect(prices[0]?.links[0]?.line).toBe(99999);
    const findings = legPaths(prices, DECISIONS, {}).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('is past the end of the file it names');
  });

  test('an http link is not a repo path', () => {
    const prices = derive(
      priced('one entry, once [PR #741](https://example.invalid/741) releases it.'),
    );
    expect(prices[0]?.links).toEqual([]);
    expect(legPaths(prices, DECISIONS, {}).findings).toEqual([]);
  });
});

describe('leg D, the state is written down and a verdict names who reached it', () => {
  const rowsOf = (...lines: string[]) => readRegister(register(lines));

  test('an obligation outside the vocabulary', () => {
    const findings = legStates(
      rowsOf(row(1, 'ADR-999:5', '8.1', 'MAYBE', 'UNASSESSED', '-')),
    ).findings;
    expect(findings.some((f) => f.includes('carries obligation "MAYBE"'))).toBe(true);
  });

  test('an accuracy outside the vocabulary', () => {
    const findings = legStates(
      rowsOf(row(1, 'ADR-999:5', '8.1', 'OPEN', 'PROBABLY', '-')),
    ).findings;
    expect(findings.some((f) => f.includes('carries accuracy "PROBABLY"'))).toBe(true);
  });

  test('a verdict with no basis, which is the state this register exists to replace', () => {
    const findings = legStates(rowsOf(row(1, 'ADR-999:5', '8.1', 'OPEN', 'WRONG', '-'))).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('is marked OPEN/WRONG and cites nobody');
  });

  test('a basis naming an entry that does not exist', () => {
    const findings = legStates(
      rowsOf(row(1, 'ADR-999:5', '8.1', 'DISCHARGED', 'HOLDS', 'ADR-9997')),
    ).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('rests on ADR-9997, and there is no such entry');
  });

  test('an absent entry is reported ONCE even though a link spells its id twice', () => {
    const basis = '[ADR-9997](ADR-9997.md)';
    const findings = legStates(
      rowsOf(row(1, 'ADR-999:5', '8.1', 'DISCHARGED', 'HOLDS', basis)),
    ).findings;
    expect(findings).toHaveLength(1);
  });

  test('a verdict whose basis names no entry at all', () => {
    const findings = legStates(
      rowsOf(row(1, 'ADR-999:5', '8.1', 'DISCHARGED', 'HOLDS', 'somebody said so')),
    ).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('its basis names no entry');
  });

  test('the two defaults claim nothing and cost no citation', () => {
    const leg = legStates(rowsOf(row(1, 'ADR-999:5', '8.1', 'OPEN', 'UNASSESSED', '-')));
    expect(leg.findings).toEqual([]);
    expect(leg.obligations).toEqual({ OPEN: 1 });
    expect(leg.accuracies).toEqual({ UNASSESSED: 1 });
  });

  test('the vocabularies are closed and are the ones the register documents', () => {
    expect(OBLIGATIONS).toEqual(['OPEN', 'DISCHARGED', 'WITHDRAWN']);
    expect(ACCURACIES).toEqual(['HOLDS', 'WRONG', 'UNCHECKABLE', 'UNASSESSED']);
    // PADDING-TOLERANT ON PURPOSE. Prettier pads a markdown table's cells to the
    // column width, so an assertion written as the literal `| \`OPEN\` |` passes
    // before the formatter runs and fails after it, which is a case that tests
    // the formatter rather than the register. This one asserts the legend ROW.
    const document = readFileSync(REGISTER, 'utf8');
    for (const value of [...OBLIGATIONS, ...ACCURACIES]) {
      expect(document, `the register does not document ${value}`).toMatch(
        new RegExp(`^\\|\\s*\`${value}\`\\s*\\|`, 'm'),
      );
    }
  });
});

describe('the register is not a parser trap', () => {
  test('a legend row is prose in a table and is not read as data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'merit-price-legend-'));
    const path = join(dir, 'PRICE_REGISTER.md');
    writeFileSync(
      path,
      [
        '| Value | Meaning |',
        '| --- | --- |',
        '| `OPEN` | The work has not been taken |',
        '',
        '| # | Anchor | Where | Obligation | Accuracy | Basis |',
        '| --- | --- | --- | --- | --- | --- |',
        row(1, 'ADR-999:5', '8.1', 'OPEN', 'UNASSESSED', '-'),
      ].join('\n'),
    );
    expect(readRegister(path).map((r) => r.anchor)).toEqual(['ADR-999:5']);
  });
});

describe('the real corpus and the real register', () => {
  test('every leg holds on the tree this check ships with', () => {
    expect(run()).toBe(0);
  });

  test('the corpus prices things, so the check is not passing on an empty set', () => {
    // NO NUMBER IS PINNED HERE ON PURPOSE. Rows land beside this one and each may
    // price something; a pinned total would make this case go red for the one
    // reason that is not a defect. What is asserted is that the population is
    // non-empty and that the register is exactly it, which is the property.
    const prices = derive();
    expect(prices.length).toBeGreaterThan(0);
    expect(new Set(prices.map((p) => p.entry)).size).toBeGreaterThan(1);
    expect(
      readRegister()
        .map((r) => r.anchor)
        .sort(),
    ).toEqual(prices.map(anchorOf).sort());
  });

  test('it takes no argument', () => {
    expect(run(['--fix'])).toBe(2);
  });

  test('a corpus directory that is not there is an error and not a pass', () => {
    const dir = mkdtempSync(join(tmpdir(), 'merit-price-empty-'));
    mkdirSync(join(dir, 'nothing'));
    expect(() => derive(join(dir, 'no-such-dir'))).toThrow();
  });
});
