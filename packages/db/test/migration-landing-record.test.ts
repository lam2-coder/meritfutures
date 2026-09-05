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
 * The live manifest with one `## <n>.` section and everything under it removed.
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
  return out;
}

/**
 * The migrations this tree records nowhere, written out rather than derived.
 *
 * IT IS A SECOND COPY OF `RI-37`'s REGISTER AND THAT IS THE POINT. Deriving it
 * from the check would make the case below assert that the check agrees with
 * itself. Written here, the day somebody writes one of these sections the case
 * goes red beside the register row, which is the friction a shrink-only
 * register is supposed to create. SIXTEEN OF THE TWENTY ARE MONEY PATH.
 */
const MIGRATION_NUMBERS_WITH_NO_SECTION = [
  '0037',
  '0039',
  '0040',
  '0041',
  '0043',
  '0044',
  '0050',
  '0052',
  '0053',
  '0054',
  '0055',
  '0056',
  '0057',
  '0059',
  '0063',
  '0068',
  '0070',
  '0072',
  '0073',
  '0074',
] as const;

/** The smallest manifest the check accepts: one section-1 row, one heading. */
const MINIMAL_MANIFEST = [
  '## 1. The migration sequence',
  '',
  '| # | File | Money path | Contents |',
  '|---|---|---|---|',
  '| 0001 | `extensions_and_enums` | yes | a row of the migration sequence |',
  '',
  '## 13. `0028` lands, and this is the heading shape (2026-08-15)',
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
  // carrying a register of twenty real gaps, and one whose register absorbs
  // nothing because those migrations were recorded all along. This case
  // separates them WITHOUT reaching into the runner: give every backlog number
  // a landing section and leg 3 must report EVERY entry as stale, one finding
  // each. That count is the register's size, and it is only reachable if every
  // one of those numbers was genuinely unrecorded a moment ago.
  test('the backlog register holds twenty migrations the manifest does not record', () => {
    const closed = MIGRATION_NUMBERS_WITH_NO_SECTION.map(
      (number) => `## 9${number}. \`${number}\` lands, seeded by this case (2026-09-05)`,
    ).join('\n\n');
    const found = findings(estate(`${liveManifest()}\n${closed}\n`));
    expect(found).toHaveLength(MIGRATION_NUMBERS_WITH_NO_SECTION.length);
    expect(found).toHaveLength(20);
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
// 3. THE SEEDS, one per leg
// -----------------------------------------------------------------------------
describe('RI-37 reads the manifest the way the manifest is written', () => {
  // LEG 2, THE OTHER DIRECTION. A record for a migration that is not on disk is
  // what a renumbered or abandoned migration leaves behind, and a check written
  // only for the missing-record shape would never see it.
  test('a landing section for a migration that is not on disk is a finding', () => {
    const found = findings(
      estate(`${MINIMAL_MANIFEST}\n## 99. \`9999\` lands, and no such file exists (2026-09-05)\n`),
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
      estate(`${liveManifest()}\n## 40. \`0073\` lands, seeded by this case (2026-09-05)\n`),
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
        `${MINIMAL_MANIFEST}\n## 14. A section that is not the migration sequence (2026-08-16)\n\n` +
          '| # | File | Money path | Contents |\n|---|---|---|---|\n' +
          '| 0002 | `identity` | yes | a table of the same shape, one section over |\n',
      ),
    );
    expect(found.join('\n')).toContain('0002_identity.sql is on disk');
    expect(found.join('\n')).toContain('carries no landing record for `0002`');
  });

  // AND THE ROW INSIDE SECTION 1 IS READ, so the case above is about SCOPE and
  // not about the row parser having stopped matching.
  test('the same row INSIDE section 1 is a landing record', () => {
    const manifest = MINIMAL_MANIFEST.replace(
      '| 0001 | `extensions_and_enums` | yes | a row of the migration sequence |',
      '| 0001 | `extensions_and_enums` | yes | a row |\n| 0002 | `identity` | yes | a row |',
    );
    const found = findings(estate(manifest));
    expect(found.join('\n')).not.toContain('for `0001`');
    expect(found.join('\n')).not.toContain('for `0002`');
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

  test('a migrations directory with no `nnnn_*.sql` THROWS', () => {
    const root = mkdtempSync(join(tmpdir(), 'merit-landing-record-nosql-'));
    seeded.push(root);
    mkdirSync(join(root, MIGRATIONS), { recursive: true });
    writeFileSync(join(root, MIGRATIONS, 'README.md'), 'not a migration\n');
    mkdirSync(join(root, 'packages/db'), { recursive: true });
    writeFileSync(join(root, MANIFEST), MINIMAL_MANIFEST);
    expect(() => findings(root)).toThrow(/found no `nnnn_\*\.sql`/);
  });
});
