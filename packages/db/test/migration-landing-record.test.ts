// =============================================================================
// packages/db/test/migration-landing-record.test.ts -- CI-02, the `unit` project.
// =============================================================================
// RI-37's SUITE, AND IT LIVES HERE RATHER THAN IN `packages/tooling/test`
// BECAUSE ITS INPUTS ARE THE MIGRATION SET AND THE DELTA MANIFEST, and both are
// `packages/db`'s. That is `data-model-nullability.test.ts`'s reason one check
// over, and the two files share its harness shape deliberately.
//
// ADR-334. `0080` (ADR-322) and `0081` (ADR-323) are MERGED money-schema
// migrations that carried no landing section in `packages/db/DELTA_MANIFEST.md`.
// The absence was reported FOUR times and repaired none -- ADR-323's landmine 1,
// ADR-327, ADR-330, and ADR-329 section 9 finding 5 -- because nothing in this
// repository could report it as a failure. `RI-37` is what could.
//
// THREE KINDS OF CASE ARE HERE AND THEY ARE DIFFERENT ARGUMENTS.
//
//   1. THE LIVE TREE. The check holds on this repository, and the manifest's
//      own record count is watched DISCRIMINATING rather than assumed: both
//      landing shapes must be present and the backlog register must be a
//      strict subset of what is on disk. A reader that matched nothing would
//      report every migration as unrecorded, which is loud; a reader that
//      matched everything would report a clean estate, which is not.
//
//   2. THE RECONSTRUCTIONS. Each of the two sections this row wrote is REMOVED
//      from the live manifest and the check is watched going RED naming that
//      migration, which is the tree as it stood before the repair. Each has its
//      COUNTERFACTUAL beside it: the same manifest with the MIGRATION taken
//      away as well, watched GREEN. A check red on both is catching nothing.
//      The removal is ASSERTED to have changed something, so a case cannot go
//      on testing a repair somebody reverted.
//
//   3. THE SEEDS, one per leg. Leg 2 (a record for a migration that is not on
//      disk); leg 3's one direction (a register entry whose gap has been
//      closed, which is what makes the register shrink-only) AND the direction
//      it deliberately does not take, asserted inert with the half that
//      compensates for it executed beside it; the scoping of the section-1
//      table leg in both directions; and all three sentinels.
//
// EVERY FIXTURE COPIES THE REAL MIGRATION DIRECTORY, because the whole subject
// is a real history: a synthetic two-file estate would let a reconstruction
// pass against a set that does not carry `0080`.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, test } from 'vitest';

import { CHECKS, REPO_ROOT } from '../../tooling/checks/repo-invariants.mjs';

const MIGRATIONS = 'packages/db/migrations';
const MANIFEST = 'packages/db/DELTA_MANIFEST.md';

const ri37 = (): { run: (root: string) => string[] } => {
  const found = CHECKS.find((c: { id: string }) => c.id === 'RI-37');
  if (found === undefined) throw new Error('RI-37 is not a member of CHECKS');
  return found;
};

const findings = (root: string): string[] => ri37().run(root);

const seeded: string[] = [];
afterAll(() => {
  for (const dir of seeded.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const liveManifest = (): string => readFileSync(join(REPO_ROOT, MANIFEST), 'utf8');

/**
 * A tree carrying the REAL migration set and whichever manifest body is named.
 *
 * `without` removes named migration files, which is how a counterfactual tree
 * is built: the tree on which the missing record was not owed.
 */
function estate(manifest: string | null, without: readonly string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'merit-landing-record-'));
  seeded.push(root);
  cpSync(join(REPO_ROOT, MIGRATIONS), join(root, MIGRATIONS), { recursive: true });
  for (const file of without) rmSync(join(root, MIGRATIONS, file));
  if (manifest !== null) {
    mkdirSync(join(root, 'packages/db'), { recursive: true });
    writeFileSync(join(root, MANIFEST), manifest);
  }
  return root;
}

/**
 * A row of section 16's section-number table, by the number in its key cell.
 * The key may be bold, which most rows written since 2026-08-16 are.
 */
const claimRow = (number: string): RegExp =>
  // MULTILINE, so the same pattern serves a per-line `test` and a whole-document
  // `replace`. Without it `^` anchors to the start of the file and a `replace`
  // over the manifest silently changes nothing, which the "changed nothing"
  // assertions beside every use of it exist to catch.
  new RegExp(String.raw`^\|\s*\*{0,2}${number}\*{0,2}\s*\|`, 'm');

/**
 * The live manifest with one number's CLAIM removed from section 16's
 * section-number table, and nothing else touched.
 *
 * THE REMOVAL IS ASSERTED, on `withoutSection`'s rule one function down, and
 * the row count is asserted too: a number this table claims TWICE is one the
 * check reads as one member, so removing "the" row for it would be removing
 * one of two and testing nothing. `21` is that number today and no case here
 * takes it by accident.
 */
function withoutClaim(body: string, number: string): string {
  const lines = body.split('\n');
  const hits = lines
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => claimRow(number).test(text));
  expect(
    hits.length,
    `\`${number}\` is claimed by ${hits.length} row(s) and this helper takes exactly 1`,
  ).toBe(1);
  const out = lines.filter((_, index) => index !== hits[0]?.index).join('\n');
  expect(out, `removing the claim on ${number} changed nothing`).not.toBe(body);
  return out;
}

/**
 * The live manifest with one `## <n>.` section, everything under it, AND its
 * row in section 16's section-number table removed.
 *
 * THE CLAIM COMES OUT WITH THE SECTION AND THAT IS A FAITHFUL RECONSTRUCTION
 * RATHER THAN A CONVENIENCE. Leg 4 runs in both directions, so a manifest with
 * the heading gone and the row standing is not the tree as it stood before the
 * section was written; it is a tree carrying an orphan claim, which is its own
 * finding. Every section these cases remove had its row written in the same
 * commit as the section, which is that table's own rule.
 *
 * THE REMOVAL IS ASSERTED RATHER THAN ATTEMPTED, on `data-model-nullability`'s
 * rule: a reconstruction that quietly changed nothing would test the REPAIRED
 * manifest under the name of the broken one and report GREEN for the wrong
 * reason, which is the vacuous-pass shape this corpus has now found in a CHECK,
 * in a `DO` block and in a fold.
 */
function withoutSection(body: string, number: string): string {
  const lines = body.split('\n');
  const opens = lines
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => text.startsWith(`## ${number}.`));
  expect(opens.length, `\`## ${number}.\` heads ${opens.length} section(s) and must head 1`).toBe(
    1,
  );
  const from = opens[0]?.index ?? -1;
  let to = lines.length;
  for (let i = from + 1; i < lines.length; i += 1) {
    if ((lines[i] ?? '').startsWith('## ')) {
      to = i;
      break;
    }
  }
  const out = [...lines.slice(0, from), ...lines.slice(to)].join('\n');
  expect(out, `removing section ${number} changed nothing`).not.toBe(body);
  return withoutClaim(out, number);
}

/**
 * The live manifest with extra `## <n>.` sections appended AND each of their
 * numbers claimed in section 16's section-number table.
 *
 * THE SECOND HALF EXISTS BECAUSE OF LEG 4. A seed that appends a numbered
 * heading and claims nothing is a seed testing two things at once, and its
 * finding count stops being the number it was written to assert.
 */
function withSections(body: string, sections: readonly (readonly [number, string])[]): string {
  let out = body;
  for (const [number] of sections) {
    const before = out;
    out = out.replace(
      /(\n### Section numbers\n[\s\S]*?\n\|---\|---\|---\|\n)/,
      `$1| ${number} | seeded by this case | allocated |\n`,
    );
    expect(out, `claiming section ${number} changed nothing`).not.toBe(before);
  }
  const appended = sections.map(([number, heading]) => `## ${number}. ${heading}`).join('\n\n');
  return `${out}\n${appended}\n`;
}

/**
 * The migrations this tree records nowhere, written out rather than derived.
 *
 * IT IS A SECOND COPY OF `RI-37`'s REGISTER AND THAT IS THE POINT. Deriving it
 * from the check would make the case below assert that the check agrees with
 * itself. Written here, the day somebody writes one of these sections the case
 * goes red beside the register row, which is the friction a shrink-only
 * register is supposed to create.
 *
 * IT WAS TWENTY AND ADR-335 TOOK SIX OUT. `0052` to `0057` now hold
 * DELTA_MANIFEST sections 40 to 45 and their register rows came out in the same
 * commit, which is leg 3 doing the job it was written for. NINE OF THE FOURTEEN
 * BELOW OPEN WITH AN `E2 READ: MONEY PATH` HEADER, counted off the files rather
 * than off a register row: all but `0039`, `0040`, `0041`, `0043` and `0073`.
 * ADR-334 recorded sixteen of the original twenty as money path and the true
 * figure is fifteen; `0073_operator_directory.sql:4` opens `NOT THE MONEY PATH
 * BY FILE`, and ADR-334's own register row for it carries no marker, so the two
 * halves of that diff disagreed and the machine-readable half was right.
 */
const MIGRATION_NUMBERS_WITH_NO_SECTION = [
  '0037',
  '0039',
  '0040',
  '0041',
  '0043',
  '0044',
  '0050',
  '0059',
  '0063',
  '0073',
  '0074',
] as const;

/** The body of the smallest manifest the check accepts, without section 16. */
const MINIMAL_BODY = [
  '## 1. The migration sequence',
  '',
  '| # | File | Money path | Contents |',
  '|---|---|---|---|',
  '| 0001 | `extensions_and_enums` | yes | a row of the migration sequence |',
  '',
  '## 13. `0028` lands, and this is the heading shape (2026-08-15)',
  '',
].join('\n');

/**
 * The smallest manifest the check accepts: one section-1 row, one landing
 * heading, and section 16's section-number table claiming every number the
 * body heads.
 *
 * IT BECAME A FUNCTION WHEN LEG 4 LANDED. The check now compares the file's
 * numbered headings against that table in BOTH directions, and it THROWS on a
 * manifest carrying landing sections and no such table, because a missing
 * table would otherwise report every heading in the file as unclaimed and name
 * the wrong defect. So a seed that adds a section names its number here and
 * every seed's finding count stays equal to what the seed is about.
 *
 * SECTION 16 GOES LAST so a seeded section appended after this body does not
 * land inside the table region, which ends at the next heading of either
 * depth.
 */
const minimalManifest = (body = '', claims: readonly number[] = []): string =>
  [
    MINIMAL_BODY,
    body,
    '## 16. Allocation: `OI-nn` identifiers and section numbers',
    '',
    '### Section numbers',
    '',
    '| Section | Claimed by | State |',
    '|---|---|---|',
    ...[1, 13, 16, ...claims].map((n) => `| ${n} | a seed | allocated |`),
    '',
  ].join('\n');

// -----------------------------------------------------------------------------
// 1. THE LIVE TREE, and the reader watched discriminating
// -----------------------------------------------------------------------------
describe('RI-37 holds on this repository', () => {
  test('the repository holds: every migration has a landing record', () => {
    expect(findings(REPO_ROOT)).toEqual([]);
  });

  // THE HALF A GREEN RUN CANNOT SHOW, AND IT IS THE SIZE OF THE BACKLOG.
  // Green on the live tree is consistent with two very different checks: one
  // carrying a register of fourteen real gaps, and one whose register absorbs
  // nothing because those migrations were recorded all along. This case
  // separates them WITHOUT reaching into the runner: give every backlog number
  // a landing section and leg 3 must report EVERY entry as stale, one finding
  // each. That count is the register's size, and it is only reachable if every
  // one of those numbers was genuinely unrecorded a moment ago.
  //
  // THE LITERAL MOVED FROM 20 TO 14 TO 11 AND THAT IS THE ASSERTION, NOT THE
  // MAINTENANCE. A register that only shrinks is a register whose size is a
  // claim, so the number is written twice here on purpose: once as the list's
  // own length and once as a literal a session cannot change by editing the
  // list. ADR-335 wrote six sections and deleted six rows in one commit, and
  // ADR-336 wrote three and deleted three in one commit.
  test('the backlog register holds eleven migrations the manifest does not record', () => {
    const found = findings(
      estate(
        withSections(
          liveManifest(),
          MIGRATION_NUMBERS_WITH_NO_SECTION.map(
            (number) =>
              [
                Number(`9${number}`),
                `\`${number}\` lands, seeded by this case (2026-09-05)`,
              ] as const,
          ),
        ),
      ),
    );
    expect(found).toHaveLength(MIGRATION_NUMBERS_WITH_NO_SECTION.length);
    expect(found).toHaveLength(11);
    for (const number of MIGRATION_NUMBERS_WITH_NO_SECTION) {
      expect(found.join('\n')).toContain(`backlog register holds \`${number}\``);
    }
  });
});

// -----------------------------------------------------------------------------
// 2. THE RECONSTRUCTIONS: the tree as it stood before ADR-334's repair
// -----------------------------------------------------------------------------
describe('RI-37 goes red on the two sections that did not exist when it was written', () => {
  test('OCCURRENCE 1: the manifest without section 38 reports `0080`', () => {
    const found = findings(estate(withoutSection(liveManifest(), '38')));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('0080_wallet_debit_provenance.sql is on disk');
    expect(found[0]).toContain('carries no landing record for `0080`');
  });

  // THE COUNTERFACTUAL, which is the half a red run cannot show. The tree the
  // missing record was NOT owed on is the tree with the migration taken away.
  test('OCCURRENCE 1 COUNTERFACTUAL: without section 38 AND without `0080`, green', () => {
    expect(
      findings(estate(withoutSection(liveManifest(), '38'), ['0080_wallet_debit_provenance.sql'])),
    ).toEqual([]);
  });

  test('OCCURRENCE 2: the manifest without section 39 reports `0081`', () => {
    const found = findings(estate(withoutSection(liveManifest(), '39')));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('0081_purchase_processor_columns.sql is on disk');
    expect(found[0]).toContain('carries no landing record for `0081`');
  });

  test('OCCURRENCE 2 COUNTERFACTUAL: without section 39 AND without `0081`, green', () => {
    expect(
      findings(
        estate(withoutSection(liveManifest(), '39'), ['0081_purchase_processor_columns.sql']),
      ),
    ).toEqual([]);
  });

  // BOTH AT ONCE IS THE TREE THIS ROW WAS DISPATCHED AGAINST, and the count is
  // the assertion: exactly two, which is what the runner printed on `56f1ceaf`
  // before the sections were written.
  test('THE TREE AS DISPATCHED: neither section, exactly two findings', () => {
    const found = findings(estate(withoutSection(withoutSection(liveManifest(), '38'), '39')));
    expect(found).toHaveLength(2);
    expect(found.join('\n')).toContain('`0080`');
    expect(found.join('\n')).toContain('`0081`');
  });
});

// -----------------------------------------------------------------------------
// 2b. THE SIX SECTIONS ADR-335 WROTE, and the six register rows they closed
// -----------------------------------------------------------------------------
// EACH SECTION IS RECONSTRUCTED AWAY AND THE CHECK IS WATCHED REPORTING THAT
// MIGRATION, which is the tree as it stood before ADR-335 -- with one difference
// that matters and is asserted rather than assumed. On that tree the register
// still held the row, so leg 1 was SILENT and the gap was invisible; here the
// row is gone, so removing the section makes leg 1 speak. THAT IS THE PAIR THAT
// PROVES THE SHRINK: a case removing a section can only be red if the register
// row came out, and the size case above can only reach fourteen if it did.
//
// EVERY ONE HAS ITS COUNTERFACTUAL: the same manifest with the MIGRATION taken
// away as well, on which no record is owed. A check red on both is catching
// nothing.
const ADR_335_SECTIONS = [
  ['40', '0052', '0052_chart_of_accounts.sql'],
  ['41', '0053', '0053_firm_treasury_kind.sql'],
  ['42', '0054', '0054_identity_ledger_accounts.sql'],
  ['43', '0055', '0055_last_two_ledger_kinds.sql'],
  ['44', '0056', '0056_eighth_ledger_code.sql'],
  ['45', '0057', '0057_terminal_withdrawal_obligation.sql'],
] as const;

describe('RI-37 goes red on each of the six sections ADR-335 wrote', () => {
  for (const [section, number, file] of ADR_335_SECTIONS) {
    test(`without section ${section} the check reports \`${number}\``, () => {
      const found = findings(estate(withoutSection(liveManifest(), section)));
      expect(found).toHaveLength(1);
      expect(found[0]).toContain(`${file} is on disk`);
      expect(found[0]).toContain(`carries no landing record for \`${number}\``);
    });

    test(`COUNTERFACTUAL: without section ${section} AND without \`${number}\`, green`, () => {
      expect(findings(estate(withoutSection(liveManifest(), section), [file]))).toEqual([]);
    });
  }

  // ALL SIX AT ONCE IS THE TREE ADR-335 WAS DISPATCHED AGAINST WITH ITS
  // REGISTER ROWS ALREADY REMOVED, and the count is the assertion.
  test('THE TREE AS DISPATCHED: none of the six sections, exactly six findings', () => {
    let body = liveManifest();
    for (const [section] of ADR_335_SECTIONS) body = withoutSection(body, section);
    const found = findings(estate(body));
    expect(found).toHaveLength(6);
    for (const [, number] of ADR_335_SECTIONS) {
      expect(found.join('\n')).toContain(`carries no landing record for \`${number}\``);
    }
  });

  // AND THE HEADING SHAPE IS RE-ASSERTED ON THE NEW SECTIONS RATHER THAN
  // INHERITED. Section 40's heading names `0052` before its verb and section
  // 45's names `0057`; none of the six names another migration before the verb,
  // so no section absorbs a sibling's obligation the way section 39's heading
  // once absorbed `0080`'s. Removing section 40 must report `0052` and nothing
  // else, which the per-section cases above already require one at a time; this
  // one requires it of the cluster, where a cross-reference would hide.
  test('no one of the six headings claims another of the six', () => {
    for (const [section, number] of ADR_335_SECTIONS) {
      const found = findings(estate(withoutSection(liveManifest(), section)));
      expect(
        found.map((f) => f.includes(`\`${number}\``)),
        section,
      ).toEqual([true]);
    }
  });
});

// -----------------------------------------------------------------------------
// 2c. THE THREE SECTIONS ADR-336 WROTE, and the three register rows they closed
// -----------------------------------------------------------------------------
// SECTION 2b's REASONING APPLIES WORD FOR WORD AND THE PAIR IS THE SAME PAIR.
// Each section is reconstructed away and the check is watched reporting that
// migration, which can only be red because the register row came out; each has
// its counterfactual, the same manifest with the MIGRATION taken away as well,
// on which no record is owed.
//
// AND THE HEADING-SHAPE CASE IS RE-RUN OVER THIS CLUSTER RATHER THAN INHERITED
// FROM ADR-335's. These three headings are the first in the file where a
// SIBLING of the cluster is named in the heading text at all: section 47's
// heading is about `0070` and section 48's about `0072`, and the reader must
// still report exactly one migration per removal. Three consecutive headings
// for three consecutive migrations is where a widened reader would show.
const ADR_336_SECTIONS = [
  ['46', '0068', '0068_dual_control_threshold_ceiling.sql'],
  ['47', '0070', '0070_withdrawal_approval_and_dual_control.sql'],
  ['48', '0072', '0072_terminal_withdrawal_transitions.sql'],
] as const;

describe('RI-37 goes red on each of the three sections ADR-336 wrote', () => {
  for (const [section, number, file] of ADR_336_SECTIONS) {
    test(`without section ${section} the check reports \`${number}\``, () => {
      const found = findings(estate(withoutSection(liveManifest(), section)));
      expect(found).toHaveLength(1);
      expect(found[0]).toContain(`${file} is on disk`);
      expect(found[0]).toContain(`carries no landing record for \`${number}\``);
    });

    test(`COUNTERFACTUAL: without section ${section} AND without \`${number}\`, green`, () => {
      expect(findings(estate(withoutSection(liveManifest(), section), [file]))).toEqual([]);
    });
  }

  // ALL THREE AT ONCE IS THE TREE ADR-336 WAS DISPATCHED AGAINST WITH ITS
  // REGISTER ROWS ALREADY REMOVED, and the count is the assertion.
  test('THE TREE AS DISPATCHED: none of the three sections, exactly three findings', () => {
    let body = liveManifest();
    for (const [section] of ADR_336_SECTIONS) body = withoutSection(body, section);
    const found = findings(estate(body));
    expect(found).toHaveLength(3);
    for (const [, number] of ADR_336_SECTIONS) {
      expect(found.join('\n')).toContain(`carries no landing record for \`${number}\``);
    }
  });

  test('no one of the three headings claims another of the three', () => {
    for (const [section, number] of ADR_336_SECTIONS) {
      const found = findings(estate(withoutSection(liveManifest(), section)));
      expect(
        found.map((f) => f.includes(`\`${number}\``)),
        section,
      ).toEqual([true]);
    }
  });
});

// -----------------------------------------------------------------------------
// 3. THE SEEDS, one per leg
// -----------------------------------------------------------------------------
describe('RI-37 reads the manifest the way the manifest is written', () => {
  // LEG 2, THE OTHER DIRECTION. A record for a migration that is not on disk is
  // what a renumbered or abandoned migration leaves behind, and a check written
  // only for the missing-record shape would never see it.
  test('a landing section for a migration that is not on disk is a finding', () => {
    const found = findings(
      estate(minimalManifest('## 99. `9999` lands, and no such file exists (2026-09-05)\n', [99])),
    );
    expect(found.join('\n')).toContain('records `9999` as landed');
    expect(found.join('\n')).toContain('carries no such file');
  });

  // LEG 3, THE DIRECTION THAT MAKES THE REGISTER SHRINK-ONLY. `0073` is on the
  // backlog today. Give it a section and the register entry becomes furniture,
  // which is a finding on the commit that writes the section rather than an
  // exemption left standing behind a repair.
  test('a backlog entry whose gap has been closed is itself a finding', () => {
    const found = findings(
      estate(
        withSections(liveManifest(), [[99, '`0073` lands, seeded by this case (2026-09-05)']]),
      ),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('backlog register holds `0073`');
    expect(found[0]).toContain('now\ncarries its landing record'.replace('\n', ' '));
    expect(found[0]).toContain('The register may only shrink');
  });

  // LEG 3 RUNS IN ONE DIRECTION, AND THIS IS THE ONE IT DOES NOT TAKE. An
  // entry naming a migration the tree does not carry is INERT rather than a
  // finding: reporting it would make the register a claim about ONE migration
  // set rather than a property of the check, and it would fire over every
  // entry on any tree carrying a smaller set. Constitution E2 makes a merged
  // migration permanent, so the state it would guard is already forbidden.
  test('a register entry naming a migration this tree does not carry is inert', () => {
    expect(findings(estate(liveManifest(), ['0073_operator_directory.sql']))).toEqual([]);
  });

  // AND THE COMPENSATING HALF, EXECUTED RATHER THAN CLAIMED. A row that types
  // the wrong number absorbs nothing, so leg 1 reports the file it meant to
  // absorb. `0073` is on the register; give the register nothing to absorb by
  // leaving `0073` on disk and taking the register's help away from the
  // MIGRATION NEXT TO IT, which is not on the register at all: `0076` has a
  // landing section, so removing that section is the same shape as a mis-key.
  test('a migration the register does not absorb is reported by leg 1', () => {
    const found = findings(estate(withoutSection(liveManifest(), '34')));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('0076_firm_parameter_write_control.sql is on disk');
    expect(found[0]).toContain('carries no landing record for `0076`');
  });

  // THE SCOPING OF THE SECTION-1 LEG, AND IT IS LOAD BEARING RATHER THAN TIDY.
  // Section 14 (`0030` and `0031`) carries a table of the identical four-cell
  // shape, and so do several delta tables. A reader that took any four-digit
  // first cell anywhere in the file would count a delta row as a landing
  // record, which is how this check would quietly stop asserting anything.
  test('a four-digit table row OUTSIDE section 1 is not a landing record', () => {
    const found = findings(
      estate(
        minimalManifest(
          '## 14. A section that is not the migration sequence (2026-08-16)\n\n' +
            '| # | File | Money path | Contents |\n|---|---|---|---|\n' +
            '| 0002 | `identity` | yes | a table of the same shape, one section over |\n',
          [14],
        ),
      ),
    );
    expect(found.join('\n')).toContain('0002_identity.sql is on disk');
    expect(found.join('\n')).toContain('carries no landing record for `0002`');
  });

  // AND THE ROW INSIDE SECTION 1 IS READ, so the case above is about SCOPE and
  // not about the row parser having stopped matching.
  test('the same row INSIDE section 1 is a landing record', () => {
    const manifest = minimalManifest().replace(
      '| 0001 | `extensions_and_enums` | yes | a row of the migration sequence |',
      '| 0001 | `extensions_and_enums` | yes | a row |\n| 0002 | `identity` | yes | a row |',
    );
    const found = findings(estate(manifest));
    expect(found.join('\n')).not.toContain('for `0001`');
    expect(found.join('\n')).not.toContain('for `0002`');
  });
});

// -----------------------------------------------------------------------------
// 3b. LEG 4: the headings against section 16's own section-number table
// -----------------------------------------------------------------------------
// ADR-337. Section 16 is a SECTION-NUMBER ALLOCATION TABLE, written after three
// sections were numbered `14` in one day, and until leg 4 nothing compared it to
// the headings it allocates. Eight of its rows record that same omission and not
// one could report it, and the drift grew to eight unclaimed numbers while they
// did: sections 24, 26, 28 to 30 and 32 to 34.
//
// THE EIGHT ROWS THAT CLOSED IT ARE RECONSTRUCTED AWAY ONE AT A TIME, which is
// section 2b's and 2c's pair on a different registry: remove the CLAIM and the
// check must report that number, and the counterfactual is the same manifest
// with the SECTION removed as well, on which no claim is owed.
//
// THE COUNTERFACTUAL HERE IS NOT "GREEN" AND SAYING SO WOULD BE FALSE. Removing
// section 24 also removes `0046`'s only landing record, so leg 1 speaks. What
// the counterfactual asserts is that LEG 4 falls silent, which is the property
// under test, and it separates the two legs at the same time.
const LEG_4_ROWS = [
  ['24', '0046'],
  ['26', '0048'],
  ['28', '0051'],
  ['29', '0064'],
  ['30', '0065'],
  ['32', '0067'],
  ['33', '0075'],
  ['34', '0076'],
] as const;

const UNCLAIMED = 'carries no row claiming';
const UNTAKEN = 'section-number table claims';

describe('RI-37 leg 4 goes red on each of the eight claims ADR-337 wrote', () => {
  for (const [section, migration] of LEG_4_ROWS) {
    test(`without the claim on section ${section} the check reports it`, () => {
      const found = findings(estate(withoutClaim(liveManifest(), section)));
      expect(found).toHaveLength(1);
      expect(found[0]).toContain(`heads section \`${section}\``);
      expect(found[0]).toContain(UNCLAIMED);
      expect(found[0]).toContain(`\`${section}\``);
    });

    test(`COUNTERFACTUAL: without the claim AND without section ${section}, leg 4 is silent`, () => {
      const found = findings(estate(withoutSection(liveManifest(), section)));
      expect(found.filter((f) => f.includes(UNCLAIMED))).toEqual([]);
      // AND THE OTHER LEG SPEAKS, which is what makes the counterfactual a
      // separation of the two rather than a manifest nobody checked.
      expect(found.join('\n')).toContain(`carries no landing record for \`${migration}\``);
    });
  }

  // ALL EIGHT AT ONCE IS THE TREE THIS ROW WAS DISPATCHED AGAINST, and the
  // count is the assertion: exactly eight, which is what the runner printed on
  // `dc9a7b4a` before the rows were written.
  test('THE TREE AS DISPATCHED: none of the eight claims, exactly eight findings', () => {
    let body = liveManifest();
    for (const [section] of LEG_4_ROWS) body = withoutClaim(body, section);
    const found = findings(estate(body));
    expect(found).toHaveLength(8);
    for (const [section] of LEG_4_ROWS) {
      expect(found.join('\n')).toContain(`heads section \`${section}\``);
    }
  });

  // `27` IS THE ROW THIS TABLE DOES NOT OWE, and it is asserted rather than
  // left to be inferred from a green run. It heads no section, so nothing
  // claims it and leg 4 is silent about it in both directions. The `45` and
  // `48` rows each wrote "26 to 30", which would have made this nine.
  test('`27` heads no section and is owed no row', () => {
    expect(liveManifest()).not.toContain('\n## 27.');
    expect(findings(REPO_ROOT).join('\n')).not.toContain('`27`');
  });
});

describe('RI-37 leg 4 runs in both directions', () => {
  // A CLAIM WITH NO HEADING is what a renumbered or abandoned section leaves
  // behind. The reservation objection does not reach it, because this table's
  // own rule puts the claim in the commit that writes the section.
  test('a claim on a number no heading takes is a finding', () => {
    // FILTERED TO LEG 4 ON PURPOSE. The minimal manifest records `0001` and
    // `0028` and nothing else, so leg 1 speaks for every other migration on
    // disk; the seed is about the orphan claim and the assertion says so.
    const found = findings(estate(minimalManifest('', [77]))).filter((f) => f.includes(UNTAKEN));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('claims `77`');
    expect(found[0]).toContain('renumbered or abandoned section leaves behind');
  });

  // AND A MIS-KEYED ROW IS THE CASE THAT PAYS FOR THE SECOND DIRECTION. One
  // direction alone reports half of it and names neither number; both report
  // two findings that point at each other.
  test('a row typed with the wrong number is TWO findings that name each other', () => {
    const body = liveManifest().replace(claimRow('34'), '| **99** |');
    expect(body, 're-keying the `34` row changed nothing').not.toBe(liveManifest());
    const found = findings(estate(body));
    expect(found).toHaveLength(2);
    expect(found.join('\n')).toContain('heads section `34`');
    expect(found.join('\n')).toContain('claims `99`');
  });
});

describe('RI-37 leg 4 reads the key column as a SET, which is how the ruled collision survives', () => {
  // THE TRAP THIS ROW WAS DISPATCHED WITH. Section 16 carries TWO rows claiming
  // `21` and rules in terms that neither is renumbered, because renumbering
  // breaks every citation of whichever one moves. The check must tolerate that
  // recorded collision, and it does so by reading the key column as a set
  // rather than by knowing about `21`.
  test('the live manifest claims `21` twice and heads `## 21.` twice, and holds', () => {
    const rows = liveManifest()
      .split('\n')
      .filter((line) => claimRow('21').test(line));
    expect(rows).toHaveLength(2);
    expect(
      liveManifest()
        .split('\n')
        .filter((line) => line.startsWith('## 21.')),
    ).toHaveLength(2);
    expect(findings(REPO_ROOT)).toEqual([]);
  });

  // MULTIPLICITY IS NOT READ, EXECUTED. Taking one of the two `21` rows away
  // leaves the number claimed and the check green, which is the rule and not a
  // special case: a future duplicate is tolerated the same way.
  test('taking ONE of the two `21` rows away leaves the check green', () => {
    const body = liveManifest().replace(claimRow('21'), '| **21 REMOVED BY THIS CASE**x |');
    expect(body, 'blanking one `21` row changed nothing').not.toBe(liveManifest());
    expect(
      body.split('\n').filter((line) => claimRow('21').test(line)),
      'exactly one `21` row must remain',
    ).toHaveLength(1);
    expect(findings(estate(body))).toEqual([]);
  });

  // AND THE TOLERANCE IS NOT A HOLE. Take BOTH rows away and the number is
  // unclaimed, reported ONCE for the two headings that take it, because the
  // heading side is a set too.
  test('taking BOTH `21` rows away is exactly one finding', () => {
    const body = liveManifest()
      .split('\n')
      .filter((line) => !claimRow('21').test(line))
      .join('\n');
    const found = findings(estate(body));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('heads section `21`');
  });

  // THE SAME SENTENCE FROM THE HEADING SIDE. `## 14.` heads THREE sections on
  // ONE claimed number, which the `14` row records as "CLAIMED THREE TIMES".
  // Removing that one row is one finding and not three.
  test('`## 14.` heads three sections on one row, and losing it is one finding', () => {
    expect(
      liveManifest()
        .split('\n')
        .filter((line) => line.startsWith('## 14.')),
    ).toHaveLength(3);
    const found = findings(estate(withoutClaim(liveManifest(), '14')));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('heads section `14`');
  });
});

describe('RI-37 leg 4 excludes a lettered heading by the table`s own rule', () => {
  // `4a` IS A SECTION AND NOT A NUMBER, which section 16 states in terms: "A
  // lettered section deliberately claims no number ... adding rows for them
  // would make the table's own key ambiguous between a number and a name."
  // `4a`, `4b` and `4c` head six sections between them and none is owed a row.
  test('the live manifest heads six lettered sections and owes no row for any', () => {
    const lettered = liveManifest()
      .split('\n')
      .filter((line) => /^## \d+[a-z]+\./.test(line));
    expect(lettered).toHaveLength(6);
    expect(findings(REPO_ROOT)).toEqual([]);
  });

  test('a NEW lettered section with no row is not a finding', () => {
    const found = findings(
      estate(`${liveManifest()}\n## 4d. A lettered section, seeded by this case (2026-09-05)\n`),
    );
    expect(found).toEqual([]);
  });

  // AND THE DISCRIMINATOR, because an exclusion and a dead reader look the
  // same on a green run. The same seed with a NUMBER instead of a letter is a
  // finding, so the exemption is about the letter.
  test('the same section with a NUMBER instead of a letter IS a finding', () => {
    const found = findings(
      estate(`${liveManifest()}\n## 49. A numbered section, seeded by this case (2026-09-05)\n`),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('heads section `49`');
  });
});

describe('RI-37 leg 4 expands the range row', () => {
  // `1 to 13` IS ONE ROW CLAIMING THIRTEEN NUMBERS, which is why a reader
  // counting ROWS against headings answers the wrong question. Narrow it to a
  // single `1` and the twelve numbers it stops covering are reported.
  test('narrowing `1 to 13` to `1` reports sections 2 to 13', () => {
    const body = liveManifest().replace(claimRow('1 to 13'), '| 1 |');
    expect(body, 'narrowing the range row changed nothing').not.toBe(liveManifest());
    const found = findings(estate(body));
    expect(found).toHaveLength(12);
    for (let n = 2; n <= 13; n += 1) {
      expect(found.join('\n')).toContain(`heads section \`${n}\``);
    }
    expect(found.join('\n')).not.toContain('heads section `1`,');
  });
});

// -----------------------------------------------------------------------------
// 4. THE SENTINELS, which are RULE 1 rather than rule 2
// -----------------------------------------------------------------------------
// Each of these is the reader having stopped reading rather than a corpus with
// nothing to say. Reporting on any of them would be claiming to have checked
// something that was not checked, so each is a THROW and never a skip.
describe('RI-37 refuses to report on a tree it did not read', () => {
  test('SILENT on a tree carrying neither input', () => {
    const root = mkdtempSync(join(tmpdir(), 'merit-landing-record-empty-'));
    seeded.push(root);
    expect(findings(root)).toEqual([]);
  });

  test('SILENT on a tree carrying migrations and no manifest', () => {
    expect(findings(estate(null))).toEqual([]);
  });

  test('a manifest with no section-1 row THROWS rather than reporting 29 findings', () => {
    expect(() => findings(estate('## 13. `0028` lands (2026-08-15)\n'))).toThrow(
      /no migration-sequence row out of section 1/,
    );
  });

  test('a manifest with no landing heading THROWS rather than reporting the rest', () => {
    expect(() =>
      findings(
        estate(
          '## 1. The migration sequence\n\n| # | File |\n|---|---|\n' +
            '| 0001 | `extensions_and_enums` |\n',
        ),
      ),
    ).toThrow(/no `## <n>.` landing section/);
  });

  // LEG 4's TWO SENTINELS, and they are the same argument as the three above.
  // A manifest with landing sections and no allocation table, or a table this
  // reader can no longer parse a row out of, would report every numbered
  // heading in the file as unclaimed. That is loud AND wrong, which is the
  // direction this project can least afford.
  test('a manifest with no section-number table THROWS rather than reporting every heading', () => {
    expect(() => findings(estate(MINIMAL_BODY))).toThrow(/no `### Section numbers` table/);
  });

  test('a section-number table this reader parses no row out of THROWS', () => {
    const emptied = minimalManifest()
      .split('\n')
      .filter((line) => !/^\| \d+ \| a seed \|/.test(line))
      .join('\n');
    expect(emptied, 'emptying the seeded table changed nothing').not.toBe(minimalManifest());
    expect(() => findings(estate(emptied))).toThrow(/parsed no row out of/);
  });

  test('a migrations directory with no `nnnn_*.sql` THROWS', () => {
    const root = mkdtempSync(join(tmpdir(), 'merit-landing-record-nosql-'));
    seeded.push(root);
    mkdirSync(join(root, MIGRATIONS), { recursive: true });
    writeFileSync(join(root, MIGRATIONS, 'README.md'), 'not a migration\n');
    mkdirSync(join(root, 'packages/db'), { recursive: true });
    writeFileSync(join(root, MANIFEST), minimalManifest());
    expect(() => findings(root)).toThrow(/found no `nnnn_\*\.sql`/);
  });
});
