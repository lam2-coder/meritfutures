// =============================================================================
// apps/api/test/admin-source-handle.test.ts
// =============================================================================
// THE SENTENCE FOUR ENTRIES CALLED UNREPAIRED, TURNED INTO A CONTROL. ADR-424.
//
// `ADR-413` item 4, `ADR-416` section 12 item 3, `ADR-420` item 5 and `ADR-421`
// item 3 each record the same gap in the same words: **`SystemTx` satisfying
// `AdminSourceTx` is held by prose and by no control.**
//
// **THAT SENTENCE IS WRONG IN BOTH DIRECTIONS AND `ADR-424` SECTION 4 DERIVES
// HOW.** `AdminSourceTx` was ALREADY bound, in three suites at once, and so were
// its five arms and `EvidenceTx`: SIX of the handles this directory declares
// were controlled before this file existed. What was NOT bound is the four the
// intersection does not reach, and **the admin liability read's own handle is
// one of them**. `AdminSourceTx` is `AccountTx & EventsTx & FlagsTx & GraphTx &
// SearchTx`; `LiabilityTx` is not a member, so the sentence's own subject never
// covered the module four entries were pointing at.
//
// Each handle's status was derived by breaking it and reading which files `tsc`
// then named, rather than by grepping for an assignment; `ADR-424` section 4
// records the instrument. The counts above are stated in the entry and are
// DERIVED THERE, not transcribed from it: cases 2 and 3 below re-derive the
// membership on every run.
//
// -----------------------------------------------------------------------------
// WHY FOUR ENTRIES DEFERRED, AND WHY THE REASON DOES NOT REACH THIS FILE
// -----------------------------------------------------------------------------
// `ADR-413` recorded the obstruction as: *"the binding site would be a file that
// names `@merit/db`, and `apps/api/src/db.ts` is the one file that may name
// `@merit/db` and declares no `system` door for it to bind against."* Both
// halves are about `apps/api/src`, and NEITHER HALF REACHES `apps/api/test`.
//
//   1. THE ONE-FILE RULE IS SCOPED TO `src` AND ALWAYS WAS. `db.test.ts`'s case
//      3 asserts which file under `apps/api/src` takes a HANDLE off the
//      accessor, as a map from file to value. It says nothing about `test/`,
//      where many files already name `@merit/db`; `ADR-424` section 5 derives
//      that count and no numeral for it is carried here.
//   2. A TYPE NEEDS NO DOOR, AND `db.test.ts` SAYS SO IN ITS OWN HEADER: *"A
//      type-only import is deliberately not pinned, because a type buys no
//      capability -- `import type { SystemTx }` cannot open anything, and a case
//      that failed on one would be asserting a house style rather than an
//      authority."* That sentence names this file's instrument by name.
//   3. AND THE BINDING WAS ALREADY TAKEN ONCE, TWO FILES OVER.
//      `admin-source-pinned-plan.test.ts` imports `SystemTx` from `@merit/db`
//      and binds it to a handle by type, which `ADR-416` landed and which is
//      what makes the deferral measurably stale rather than merely narrow.
//
// So the obstruction was real for `src` and was never tested against `test`. It
// is not weakened here and `ADR-171` clause 1 is untouched: NO DOOR IS OPENED,
// no value of type `SystemTx` is constructed, and nothing below can reach a row.
//
// -----------------------------------------------------------------------------
// WHAT EACH CASE CATCHES
// -----------------------------------------------------------------------------
//   1. `SystemTx` SATISFIES EVERY HANDLE THIS DIRECTORY DECLARES, checked by
//      `tsc` at one named seam, in the form `catalog-read.test.ts` uses for the
//      same kind of claim: identity arms, compiled and never called. Four of the
//      arms are the ones nothing watched: `EligibleFoldTx`, `LiabilityTx`,
//      `TradingCalendarTx` and `PayoutVelocityTx`. The other seven restate a
//      binding that already exists elsewhere, and they are kept rather than
//      trimmed because case 2 is an equality over the whole directory and a
//      witness with holes in it is a witness a reader has to cross-check.
//   2. THE WITNESS COVERS THE DIRECTORY, derived on both sides. A tenth handle
//      landing with no arm is RED and names itself, which is the failure mode
//      the prose has: a sentence copied into a new module asserts nothing.
//   3. THE PROSE AND THE WITNESS AGREE. Every module that STATES the property
//      declares a handle the witness covers.
//   4. NO HANDLE IN THIS DIRECTORY CARRIES A WRITE VERB, which is the other half
//      of the sentence the modules make and the half that gives the first half
//      its point. `SystemTx` carries `insert`, `updateAt` and `deleteAt`; the
//      claim is worth making only because narrowing to these shapes drops them.
//
// -----------------------------------------------------------------------------
// EVERY COUNT IS DERIVED ON EACH RUN AND NO NUMERAL IS TRANSCRIBED
// -----------------------------------------------------------------------------
// `ADR-034`'s remedy and `admin-read-constructibility.test.ts`'s rule. The four
// entries above all state "NINE DOCBLOCKS" and `ADR-424` section 3 reports what
// re-counting found; no numeral from any of them is carried into this file,
// because a count copied out of an entry is the defect those entries record.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import type { SystemTx } from '@merit/db';

import type { AccountTx } from '../src/admin-source/account.ts';
import type { EligibleFoldTx } from '../src/admin-source/eligible-next-7d.ts';
import type { EventsTx } from '../src/admin-source/events.ts';
import type { EvidenceTx } from '../src/admin-source/evidence.ts';
import type { FlagsTx } from '../src/admin-source/flags.ts';
import type { GraphTx } from '../src/admin-source/graph.ts';
import type { AdminSourceTx } from '../src/admin-source/index.ts';
import type { LiabilityTx, TradingCalendarTx } from '../src/admin-source/liability.ts';
import type { PayoutVelocityTx } from '../src/admin-source/payout-velocity.ts';
import type { SearchTx } from '../src/admin-source/search.ts';

// -----------------------------------------------------------------------------
// 1. THE WITNESS, CHECKED BY `tsc`
// -----------------------------------------------------------------------------

/**
 * A `SystemTx` IS every handle this directory declares.
 *
 * **THIS IS THE PROPERTY, AND IT IS A TYPE.** `AdminSourceBackend.operator`
 * hands one handle to every module here and its docblock names the authority
 * behind it as `systemDb('operator-console')`. No value in this deployable
 * produces such a handle, which is `ADR-171` clause 1 working as ruled, so the
 * assignment a deployment would make is the one asserted here and nowhere else.
 *
 * IDENTITY ARMS, COMPILED AND NEVER CALLED, on `catalog-read.test.ts`'s reason
 * for `BOTH_HANDLES_READ_THE_CATALOGUE`: the assertion is the annotation, and a
 * body that did anything would be asserting something narrower than the shape.
 *
 * THE ARMS ARE READ BACK AS DATA BY CASE 2, so the region between the two
 * markers below is parsed rather than trusted. A member removed from this list
 * is RED there even though removing it can never be RED here.
 */
// witness-arms:begin
const A_SYSTEM_HANDLE_IS_EVERY_ADMIN_SOURCE_HANDLE: readonly [
  (tx: SystemTx) => AccountTx,
  (tx: SystemTx) => AdminSourceTx,
  (tx: SystemTx) => EligibleFoldTx,
  (tx: SystemTx) => EventsTx,
  (tx: SystemTx) => EvidenceTx,
  (tx: SystemTx) => FlagsTx,
  (tx: SystemTx) => GraphTx,
  (tx: SystemTx) => LiabilityTx,
  (tx: SystemTx) => PayoutVelocityTx,
  (tx: SystemTx) => SearchTx,
  (tx: SystemTx) => TradingCalendarTx,
] = [
  (tx) => tx,
  (tx) => tx,
  (tx) => tx,
  (tx) => tx,
  (tx) => tx,
  (tx) => tx,
  (tx) => tx,
  (tx) => tx,
  (tx) => tx,
  (tx) => tx,
  (tx) => tx,
];
// witness-arms:end

// -----------------------------------------------------------------------------
// The directory, read as data
// -----------------------------------------------------------------------------

const HERE = import.meta.dirname;
const DIRECTORY = join(HERE, '..', 'src', 'admin-source');

/** Every module under `src/admin-source/`, sorted, read off the directory. */
function modules(): readonly string[] {
  return readdirSync(DIRECTORY)
    .filter((name) => name.endsWith('.ts'))
    .sort();
}

function source(name: string): string {
  return readFileSync(join(DIRECTORY, name), 'utf8');
}

/**
 * The read handles the directory declares, as `{ module, name }`.
 *
 * FROM THE DECLARATIONS AND NOT FROM A LIST. A handle is an `export`ed
 * interface or type alias whose name ends in `Tx`, which is this directory's own
 * naming convention and the one every module's docblock uses when it names a
 * sibling's shape.
 */
function declaredHandles(): readonly { readonly module: string; readonly name: string }[] {
  const found: { module: string; name: string }[] = [];
  for (const name of modules()) {
    for (const match of source(name).matchAll(/^export (?:interface|type) ([A-Za-z]+Tx)\b/gm)) {
      found.push({ module: name, name: match[1] ?? '' });
    }
  }
  return found.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The handles the witness above binds, read out of this file's own text.
 *
 * THE REGION IS DELIMITED AND NOT PATTERN-MATCHED ACROSS THE WHOLE FILE, because
 * this file names every one of these types in its imports and in its prose, and
 * a scan that counted those would pass on a witness somebody had emptied.
 */
function witnessArms(): readonly string[] {
  const text = readFileSync(join(HERE, 'admin-source-handle.test.ts'), 'utf8');
  const start = text.indexOf('// witness-arms:begin');
  const end = text.indexOf('// witness-arms:end');
  expect(start, 'the witness region opens where this function looks for it').toBeGreaterThan(-1);
  expect(end, 'the witness region closes after it opens').toBeGreaterThan(start);
  const region = text.slice(start, end);
  return [...region.matchAll(/\(tx: SystemTx\) => ([A-Za-z]+),/g)]
    .map((match) => match[1] ?? '')
    .sort();
}

/**
 * The modules that STATE the property in prose, with the comment form each uses.
 *
 * `docblock` is a line inside a `/** ... *\/` block and `line` is a `//` banner.
 * BOTH FORMS ARE COUNTED AND THEY ARE COUNTED SEPARATELY, which is `ADR-424`
 * section 3's finding: the four entries all say "nine docblocks", and the money
 * path module is not one of them because its statement is a `//` banner.
 */
function proseSites(): readonly { readonly module: string; readonly form: string }[] {
  const sites: { module: string; form: string }[] = [];
  for (const name of modules()) {
    let inBlock = false;
    for (const line of source(name).split('\n')) {
      const text = line.trim();
      if (!inBlock && text.startsWith('/*')) inBlock = !text.includes('*/');
      else if (inBlock && text.includes('*/')) inBlock = false;
      if (!line.includes('SystemTx')) continue;
      const form = inBlock || text.startsWith('*') ? 'docblock' : 'line';
      sites.push({ module: name, form });
    }
  }
  return sites;
}

// -----------------------------------------------------------------------------
// The cases
// -----------------------------------------------------------------------------

describe('a `SystemTx` is every handle `src/admin-source/` declares (ADR-424)', () => {
  test('the type witness above is compiled, and this case says so out loud', () => {
    // `admin-source-pinned-plan.test.ts`'s idiom. The assertion that matters is
    // the annotation and it has already been made by the time this runs; this
    // case exists so a reader scanning the suite sees the claim named.
    expect(A_SYSTEM_HANDLE_IS_EVERY_ADMIN_SOURCE_HANDLE.every((arm) => typeof arm === 'function'));
  });

  // ---------------------------------------------------------------------------
  // 2. THE WITNESS COVERS THE DIRECTORY
  // ---------------------------------------------------------------------------
  test('there are handles to bind and arms to bind them, so neither side is vacuous', () => {
    // ASSERTED BEFORE THE EQUALITY. Two empty sets are equal, and a scan that
    // silently stopped matching would pass the case below on nothing at all.
    expect(declaredHandles().length, 'the directory declares read handles').toBeGreaterThan(0);
    expect(witnessArms().length, 'the witness binds arms').toBeGreaterThan(0);
  });

  test('every handle the directory declares is bound by the witness, and no arm is spare', () => {
    // BOTH DIRECTIONS AT ONCE. A handle with no arm is the property going
    // unchecked for one module; an arm naming a handle the directory no longer
    // declares is a witness that outlived what it witnessed.
    const declared = [...new Set(declaredHandles().map((handle) => handle.name))].sort();
    expect(witnessArms()).toStrictEqual(declared);
  });

  // ---------------------------------------------------------------------------
  // 3. THE PROSE AND THE WITNESS AGREE
  // ---------------------------------------------------------------------------
  test('every module that states the property declares a handle the witness covers', () => {
    // THE PROSE IS THE THING THIS FILE EXISTS TO STOP BEING LOAD-BEARING, so it
    // is asserted rather than deleted: the sentence stays in each module, and
    // this case makes a module that states it without a bound handle RED.
    const bound = new Set(witnessArms());
    const declaring = new Map<string, readonly string[]>();
    for (const handle of declaredHandles()) {
      declaring.set(handle.module, [...(declaring.get(handle.module) ?? []), handle.name]);
    }
    const claiming = [...new Set(proseSites().map((site) => site.module))].sort();
    expect(claiming.length, 'some module states the property').toBeGreaterThan(0);
    for (const name of claiming) {
      const handles = declaring.get(name) ?? [];
      expect(handles.length, `${name} states the property and declares a handle`).toBeGreaterThan(
        0,
      );
      for (const handle of handles) {
        expect(bound.has(handle), `${name}'s \`${handle}\` is bound by the witness`).toBe(true);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 4. AND NONE OF THEM CAN WRITE
  // ---------------------------------------------------------------------------
  test('no handle in this directory declares a write verb or reaches the executor', () => {
    // THE OTHER HALF OF THE SENTENCE. Every module's docblock says `insert`,
    // `updateAt`, `deleteAt` and `sqlExecutor` are ABSENT RATHER THAN UNUSED,
    // and `SystemTx` carries all four. Case 1 without this one would assert that
    // the operator door fits; this one asserts that what fits cannot write.
    //
    // THE VERBS ARE READ OFF `SystemTx` RATHER THAN LISTED. A write verb added
    // to that interface is a verb this case starts refusing on the same day,
    // which is the drift a hand-typed list here would not see.
    const accessor = readFileSync(
      join(HERE, '..', '..', '..', 'packages', 'db', 'src', 'scoped-db.ts'),
      'utf8',
    );
    const start = accessor.indexOf('export interface SystemTx extends TxCommon {');
    expect(start, '`SystemTx` is declared where this case looks for it').toBeGreaterThan(-1);
    const body = accessor.slice(start, accessor.indexOf('\n}\n', start));
    const verbs = [...body.matchAll(/^ {2}(insert|updateAt|deleteAt|sqlExecutor)\b/gm)].map(
      (match) => match[1] ?? '',
    );
    expect(verbs.length, '`SystemTx` carries the verbs this claim is about').toBeGreaterThan(0);

    for (const name of modules()) {
      const text = source(name);
      for (const match of text.matchAll(/^export interface ([A-Za-z]+Tx) \{\n([\s\S]*?)\n\}/gm)) {
        for (const verb of verbs) {
          expect(
            new RegExp(`^ {2}${verb}\\b`, 'm').test(match[2] ?? ''),
            `${name}'s \`${match[1]}\` declares \`${verb}\``,
          ).toBe(false);
        }
      }
    }
  });
});
