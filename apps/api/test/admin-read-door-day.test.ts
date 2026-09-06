// =============================================================================
// apps/api/test/admin-read-door-day.test.ts
// =============================================================================
// TWO TRUE SENTENCES IN TWO FILES, AND THE NUMBER A READER TAKES FROM EITHER ONE
// ALONE IS WRONG FOR THE QUESTION THAT MATTERS. ADR-356.
//
// `admin-read-constructibility.test.ts` case 1 asserts that SIX of the port's
// seven reads have producers. That is true, and it answers "how much of this
// directory is written". It does NOT answer "what does a deployment get on the
// day ADR-171 section 9 is met", and a reader who takes the six for the second
// question is wrong by one, because `exportEvidence`'s producer needs two
// further ports that nothing in this repository implements.
//
// THE OTHER HALF OF THE ARITHMETIC IS ALREADY MEASURED AND IT IS MEASURED
// SOMEWHERE ELSE. `admin-source-evidence.test.ts` asserts that nothing here
// implements `EvidencePackStore`. So both facts are held and NO CASE ANYWHERE
// MULTIPLIES THEM OUT. That is the shape this repository keeps finding: a
// conclusion nobody wrote down, standing between two controls that each pass.
//
// SO THIS FILE ASSERTS THE DOOR-DAY FIGURE ITSELF, and it asserts it as a
// NUMERAL, on `admin-read-constructibility.test.ts` case 1's own precedent: the
// figure is the finding, so a tree that moves off it fails here, where the
// reason is, rather than in a reader who did the multiplication by hand.
//
// AND IT MEASURES THE PARTIAL INSTALL RATHER THAN ARGUING ABOUT IT. Section 2
// runs the real router twice, unwired and half-wired, and reads the two statuses
// off `inject`. The ruling in ADR-356 section 4 rests on that pair being 503 and
// 500, and a pair asserted from reading `adminHandler` is a pair asserted from
// prose.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO. It does not require the door to open,
// it does not require a store to exist, and it does not require the port to be
// composed. It requires the tree and the arithmetic to agree.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { BASE_PATH, buildServer, discoverRouteModules } from '../src/index.ts';
import {
  ADMIN_SESSION_COOKIE,
  setAdminReadSource,
  setAdminSessionSource,
} from '../src/routes/admin-reads.ts';
import { IMPLEMENTED_ADMIN_READS, composeAdminReadSource } from '../src/admin-source/index.ts';

const HERE = import.meta.dirname;
const APP = join(HERE, '..');
const ROOT = join(APP, '..', '..');
const onDisk = await discoverRouteModules();
const COOKIE = { cookie: `${ADMIN_SESSION_COOKIE}=operator-token` };

function read(...parts: readonly string[]): string {
  return readFileSync(join(APP, ...parts), 'utf8');
}

/** Every shipped source file in the two workspaces that could hold a producer. */
function srcFiles(): readonly string[] {
  const out: string[] = [];
  for (const workspace of ['apps', 'packages']) {
    const base = join(ROOT, workspace);
    for (const pkg of readdirSync(base)) {
      const src = join(base, pkg, 'src');
      let entries: readonly string[];
      try {
        entries = readdirSync(src, { recursive: true }) as readonly string[];
      } catch {
        continue;
      }
      for (const entry of entries) if (entry.endsWith('.ts')) out.push(join(src, entry));
    }
  }
  // A SENTINEL RATHER THAN A SILENT ZERO. An absence check over an empty scope
  // reports PASS, which is `RI-28`'s own lesson recorded one directory over.
  expect(
    out.length,
    'the source sweep found no files, so every absence below is vacuous',
  ).toBeGreaterThan(100);
  return out;
}

afterEach(() => {
  setAdminReadSource(null);
  setAdminSessionSource(null);
});

// -----------------------------------------------------------------------------
// 1. The door-day figure, which is the arithmetic nobody had written down
// -----------------------------------------------------------------------------

describe('what a deployment gets on the day the operator door opens', () => {
  test('it is FIVE, and the five are named and derived rather than typed', () => {
    // `composeImplementedAdminReads` takes ONE required parameter, an
    // `AdminSourceBackend`. So the day a deployment can build that one value,
    // every name in this array is served and nothing else on the port is.
    expect([...IMPLEMENTED_ADMIN_READS]).toStrictEqual([
      'listEvents',
      'listFlags',
      'readAccount',
      'readIdentityGraph',
      'searchAccounts',
    ]);
    expect(IMPLEMENTED_ADMIN_READS).toHaveLength(5);

    // AND THE PARAMETER IS STILL ONE. A second required parameter here would
    // mean the door alone no longer buys the five, which is the premise this
    // whole file rests on and is the cheapest thing to lose in a refactor.
    const composition = read('src', 'admin-source', 'index.ts');
    const signature = composition.slice(
      composition.indexOf('export function composeImplementedAdminReads('),
    );
    expect(signature.slice(0, signature.indexOf('): PartialAdminReadSource'))).toContain(
      'options: AdminSourceOptions = {}',
    );
  });

  test('the SIXTH producer is two ports short, and neither port has an implementation', () => {
    // `adminReadSourceParts` supplies `exportEvidence`, which is why the
    // constructibility file counts six producers. It takes
    // `EvidenceExporterDeps`, and that interface names THREE ports.
    const evidence = read('src', 'admin-source', 'evidence.ts');
    const deps = evidence.slice(
      evidence.indexOf('export interface EvidenceExporterDeps {'),
      evidence.indexOf('\n}\n', evidence.indexOf('export interface EvidenceExporterDeps {')),
    );
    expect([...deps.matchAll(/readonly ([a-zA-Z]+):/g)].map((m) => m[1] ?? '')).toStrictEqual([
      'reads',
      'store',
      'writer',
    ]);

    // ONE OF THE THREE HAS A CONSTRUCTOR HERE, and it is the one that is a read
    // over the same handle the other five use.
    expect(evidence).toContain(
      'export function evidenceReadPort(tx: EvidenceTx): EvidenceReadPort',
    );

    // THE OTHER TWO HAVE NONE, ANYWHERE, and this is the assertion that reddens
    // on GOOD NEWS: the day a store or a writer lands, this case fails and names
    // the file that supplies it, which is the day the door-day figure becomes
    // six.
    //
    // IT IS A CONSTRUCTOR AND NOT THE WORD. `evidence.ts` names both types to
    // say why it does not reach them, and a control that reddened on the word
    // is a control somebody satisfies by deleting the explanation. That trap is
    // recorded twice in `admin-read-constructibility.test.ts` and it is the
    // default mistake here.
    const declaring = join(APP, 'src', 'admin-source', 'evidence.ts');
    for (const type of ['EvidencePackStore', 'EvidencePackWriter']) {
      const suppliers = srcFiles().filter(
        (file) =>
          file !== declaring &&
          new RegExp(`:\\s*${type}\\b|\\bsatisfies\\s+${type}\\b`).test(readFileSync(file, 'utf8')),
      );
      expect(
        suppliers,
        `${type} now has a supplier, so the door-day figure is no longer five`,
      ).toStrictEqual([]);
    }
  });

  test('the SEVENTH has no producer at all, and its blocker is not the door either', () => {
    // `readLiability` is the one name the constructibility file's case 1 puts in
    // `missing`. Its own blocker is an unsupplied fold term rather than the
    // purchase, which is why it does not join the five on door day.
    expect([...IMPLEMENTED_ADMIN_READS]).not.toContain('readLiability');
    expect(read('src', 'admin-source', 'eligible-next-7d.ts')).toContain(
      'export class EligibleFoldUnwired',
    );
  });
});

// -----------------------------------------------------------------------------
// 2. The partial install, measured through the real router rather than argued
// -----------------------------------------------------------------------------

describe('installing a partial source changes what an operator is told', () => {
  function operatorSession(): void {
    setAdminSessionSource({
      lookup: () =>
        Promise.resolve({ kind: 'operator', principal: { actorId: 'actor-1', role: 'owner' } }),
    });
  }

  test('UNWIRED answers 503 on every read, and the log line names the door', async () => {
    operatorSession();
    setAdminReadSource(null);
    const { app } = buildServer({ surface: 'operator', modules: onDisk });
    await app.ready();

    for (const path of ['/admin/liability', '/admin/accounts?query=a-1'])
      expect(
        (await app.inject({ method: 'GET', url: `${BASE_PATH}${path}`, headers: COOKIE }))
          .statusCode,
        `${path} unwired`,
      ).toBe(503);

    // THE MESSAGE IS WHAT MAKES THE 503 BETTER THAN A 500, so it is read at its
    // source rather than assumed: it names the port, the door, and the section
    // that makes the door takeable.
    const module = read('src', 'routes', 'admin-reads.ts');
    expect(module).toContain("systemDb('operator-console')");
    expect(module).toContain('ADR-171 section 9 makes');
  });

  test('HALF-WIRED answers 200 where it can and 500 where it cannot, and sends no 503', async () => {
    // THE PARTIAL INSTALL, BUILT THE ONLY WAY A DEPLOYMENT COULD BUILD ONE:
    // `composeAdminReadSource` over parts that do not cover the port. One method
    // is supplied by hand here rather than through
    // `composeImplementedAdminReads`, because what is under test is the
    // NON-NULL-ness of the source and not any producer's rows.
    operatorSession();
    setAdminReadSource(
      composeAdminReadSource({
        searchAccounts: () => Promise.resolve({ data: [], next_cursor: null }),
      }),
    );
    const { app } = buildServer({ surface: 'operator', modules: onDisk });
    await app.ready();

    // THE SERVED HALF IMPROVES. This is the case for a partial install and it is
    // recorded rather than skipped past.
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `${BASE_PATH}/admin/accounts?query=a-1`,
          headers: COOKIE,
        })
      ).statusCode,
    ).toBe(200);

    // AND THE UNSERVED HALF GETS WORSE, WHICH IS THE RULING. `adminHandler`
    // reaches its `source === null` branch only when the source IS null, so a
    // partial install silences the 503 for the whole port. What the unfilled
    // method throws instead is `AdminSourceNotComposed`, SYNCHRONOUSLY, and
    // nothing under any `src/` catches it.
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `${BASE_PATH}/admin/liability`,
          headers: COOKIE,
        })
      ).statusCode,
      'a half-wired liability read no longer answers 503',
    ).toBe(500);
  });

  test('nothing under any src/ catches the refusal, which is why it surfaces as a 500', () => {
    // The other half of the case above, asserted over the tree so it cannot be
    // repaired by accident: the day a handler catches `AdminSourceNotComposed`
    // and maps it to a status, this case reddens and the ruling in ADR-356
    // section 4 needs re-reading.
    const declaring = join(APP, 'src', 'admin-source', 'index.ts');
    const catchers = srcFiles().filter(
      (file) =>
        file !== declaring &&
        /catch[\s\S]{0,200}AdminSourceNotComposed/.test(readFileSync(file, 'utf8')),
    );
    expect(catchers, 'the refusal is caught somewhere now').toStrictEqual([]);
  });
});
