// =============================================================================
// apps/api/test/event-placement.test.ts
// =============================================================================
// THE DEPLOYABLE THAT HOLDS THE PRODUCER HOLDS NO HANDLE THAT CAN CARRY THE
// WRITE, ASSERTED OVER EVERY DOOR RATHER THAN OVER THE TWO SOMEBODY REMEMBERED.
//
// `src/events.ts`'s header states the finding and `events.test.ts` proves two
// instances of it: a `ScopedTx` is refused and a `FirmTx` is refused. **THOSE
// ARE TWO OF FIVE AND THEY ARE WRITTEN OUT BY HAND**, so the sentence "THIS
// DEPLOYABLE HOLDS NO TRANSACTION THAT CAN CARRY AN EVENT" rested on a
// hand-maintained pair while `src/db.ts` grew three more doors underneath it.
// The header said "two doors" until ADR-348 and `db.test.ts`'s first case has
// been named for FIVE since ADR-231; the conclusion never moved, which is
// exactly why nobody looked. This file derives the door list from `src/db.ts`,
// derives each door's BRAND from `packages/db/src/scoped-db.ts`, and refuses
// every one of them at `TRANSACTION_EVENT_WRITER`. A sixth door lands RED here
// with the ADR named in the message rather than landing quietly beside a
// sentence that is one door out of date.
//
// -----------------------------------------------------------------------------
// WHAT IS ASSERTED HERE AND WHAT IS ASSERTED SOMEWHERE ELSE
// -----------------------------------------------------------------------------
// `db.test.ts` PINS THE DOOR COUNT AND PINS THAT `src/db.ts` DOES NOT IMPORT
// `systemDb`, and neither is re-asserted here: this file takes the door list as
// an INPUT and asks a different question of it, which is what the writer does
// when handed each door's handle. `events.test.ts` owns the writer's behaviour
// name by name. `apps/worker/test/event-sink.test.ts` owns the OTHER half of the
// placement finding, which is that the deployable holding every emit call site
// cannot reach this producer in either spelling. This file is the half that can
// only be asserted from inside `apps/api`, because the door list lives here.
//
// -----------------------------------------------------------------------------
// SECTION 4 IS AN ABSENCE AND IT IS DELIBERATELY NOT A DUPLICATE OF `RI-35`
// -----------------------------------------------------------------------------
// `RI-35` binds `routes/payouts.ts`'s "Nothing in `apps/api/src` writes an
// event" to the `api-event-emit` artifact and reports at the SENTENCE. This
// case reports at the CALL, with the reason a caller needs: an emit added to a
// route in this deployable cannot write, so it is not a partial wiring that a
// later row completes, it is a transition recorded nowhere by a line that reads
// as though it were recorded. `EVENTS` section 1 makes the event and the fact
// one commit or neither; a route that emitted into `UNWIRED_EVENT_SINK` would
// roll its own state change back, and a route that emitted into a composed sink
// over a `ScopedTx` would be refused at the door mid-transaction. Both are
// worse than the refusal `payouts.ts` writes down, and this case is why the
// refusal stays a refusal.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  EVENT_CATALOGUE,
  EventError,
  TRANSACTION_EVENT_WRITER,
  UNWIRED_EVENT_SINK,
  buildEvent,
} from '../src/events.ts';
import type { EmitSpec } from '../src/events.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const ROOT = join(APP, '..', '..');

/** A file this suite reasons about, read as text and never imported for a type. */
function read(rel: string): string {
  const body = readFileSync(join(ROOT, rel), 'utf8');
  if (body.length === 0)
    throw new Error(`${rel} is empty, so every derivation below would measure nothing`);
  return body;
}

const DB_TS = read('apps/api/src/db.ts');
const EVENTS_TS = read('apps/api/src/events.ts');
const SCOPED_DB = read('packages/db/src/scoped-db.ts');

/** The clock this suite injects. Never the database's, which is `recorded_at`'s. */
const CLOCK = new Date('2026-09-05T12:00:00.000Z');

/**
 * A catalogue row that reaches the insert, so every refusal below is the DOOR's.
 *
 * `payout.hold_released` is chosen for `events.test.ts`'s stated reason: it
 * carries both tenancy columns and no `_cents` field, so `buildEvent` completes
 * and the only thing left to fail is `assertEventInsertTx`. A name that failed
 * earlier would make every case here green for the wrong reason.
 */
const SPEC: EmitSpec = {
  name: 'payout.hold_released',
  payload: {
    payout_request_id: '11111111-1111-4111-8111-111111111111',
    identity_id: '22222222-2222-4222-8222-222222222222',
    account_id: '33333333-3333-4333-8333-333333333333',
    released_by: 'expiry',
  },
};

// -----------------------------------------------------------------------------
// The doors, derived from the interface rather than written here
// -----------------------------------------------------------------------------

/** One door of `ApiDb`: the method name and the handle type it hands its callback. */
interface Door {
  readonly door: string;
  readonly handle: string;
}

/**
 * `ApiDb`'s body, bounded by its own declaration and its own closing brace.
 *
 * IT THROWS RATHER THAN RETURNING AN EMPTY STRING. A slice that returned
 * nothing would make every case below vacuously true, which is the direction a
 * derived suite fails in silently.
 */
function apiDbBody(): string {
  const opens = DB_TS.indexOf('export interface ApiDb {');
  if (opens === -1)
    throw new Error('`apps/api/src/db.ts` declares no `ApiDb`, so this suite has no door list');
  const closes = DB_TS.indexOf('\n}', opens);
  if (closes === -1) throw new Error('`ApiDb` has no closing brace, so its body cannot be bounded');
  return DB_TS.slice(opens, closes);
}

/**
 * Every door and the handle it yields.
 *
 * THE SHAPE IS THE INTERFACE'S OWN AND IS NOT NEGOTIABLE BY THIS FILE: each
 * door takes the whole unit of work rather than handing a handle back, so every
 * signature ends `(...: Handle) => Promise<T>): Promise<T>;` and the parameter
 * name varies (`tx`, `rx`, `px`) with whether the handle is transactional. A
 * door written in some other shape does not match, the count assertion below
 * fails, and that is the correct outcome: an unmatched door is a door this
 * suite did not refuse.
 */
function doors(): Door[] {
  const found: Door[] = [];
  for (const match of apiDbBody().matchAll(
    /^ {2}(\w+)<T>\(.*?\(\w+: (\w+)\) => Promise<T>\): Promise<T>;$/gm,
  )) {
    found.push({ door: match[1] ?? '', handle: match[2] ?? '' });
  }
  return found;
}

/**
 * The `__brand` literal `packages/db` stamps on one handle.
 *
 * READ FROM THE ACCESSOR AND NEVER WRITTEN HERE, which is `events.ts`'s own
 * discipline for `EVENT_INSERT_BRAND`: the brand is the whole of the control, so
 * a suite that typed it would agree with itself rather than with the package.
 */
function brandOf(handle: string): string {
  const declaration = new RegExp(`^export interface ${handle}(?: extends \\w+)? \\{$`, 'm');
  const opens = SCOPED_DB.search(declaration);
  if (opens === -1)
    throw new Error(
      `\`packages/db/src/scoped-db.ts\` declares no \`${handle}\` to read a brand from`,
    );
  const closes = SCOPED_DB.indexOf('\n}', opens);
  const brand = /^\s+readonly __brand: '(\w+)';$/m.exec(SCOPED_DB.slice(opens, closes));
  if (brand === null)
    throw new Error(
      `\`${handle}\` carries no \`__brand\`, so this suite cannot say what the writer would see`,
    );
  return brand[1] ?? '';
}

/** The one brand `TRANSACTION_EVENT_WRITER` admits, read out of the producer. */
function insertBrand(): string {
  const match = /^const EVENT_INSERT_BRAND = '(\w+)';$/m.exec(EVENTS_TS);
  if (match === null)
    throw new Error('`apps/api/src/events.ts` declares no `EVENT_INSERT_BRAND` to read');
  return match[1] ?? '';
}

/** A handle carrying one brand and an `insert` that would succeed if it were reached. */
function handleBranded(brand: string): object {
  return { __brand: brand, insert: () => Promise.resolve([{ id: 1n }]) };
}

// -----------------------------------------------------------------------------
// 1. The door list, and the one brand that is not on it
// -----------------------------------------------------------------------------

describe('the doors this deployable opens', () => {
  test('every door in `ApiDb` is matched, and there are five of them', () => {
    // THE COUNT IS `db.test.ts`'s AND IS RE-ASSERTED HERE FOR ONE REASON: this
    // file's own regex is what turns a door into a case, so a door the pattern
    // misses would silently shrink the set of brands section 2 refuses. The
    // assertion is about THIS FILE's reader and not about the door count.
    const found = doors();
    expect(found.map((d) => d.door)).toEqual([
      'scoped',
      'firm',
      'resolution',
      'establishment',
      'publicLookup',
    ]);
  });

  test('no door yields the handle the writer admits, which is the whole finding', () => {
    // ADR-165 section 6 rules that `@merit/api` takes `scoped` and `firm` and
    // that a `system` door is REFUSED. Three more doors landed after that entry
    // and none of them changed the answer, so this case states the property over
    // the tree rather than over the entry: whatever `src/db.ts` opens, none of it
    // is the handle `events` is written through.
    const admitted = insertBrand();
    const opened = doors().map((d) => brandOf(d.handle));
    expect(opened).not.toContain(admitted);
    // AND THE ADMITTED BRAND IS A REAL HANDLE RATHER THAN A STRING NOBODY MINTS.
    // Without this the case above passes on a typo in the producer.
    expect(SCOPED_DB).toContain(`readonly __brand: '${admitted}';`);
  });

  test('the five brands are distinct, so no two doors collapse into one case below', () => {
    const opened = doors().map((d) => brandOf(d.handle));
    expect(new Set(opened).size).toBe(opened.length);
  });
});

// -----------------------------------------------------------------------------
// 2. The writer, refusing every one of them
// -----------------------------------------------------------------------------

describe('the writer refuses every handle this deployable can obtain', () => {
  test('each door`s brand is refused AT THE DOOR, with its own brand in the message', async () => {
    const admitted = insertBrand();
    for (const { door, handle } of doors()) {
      const brand = brandOf(handle);
      // A GUARD ON THE FIXTURE ITSELF, so a future door that DID yield the
      // admitted brand fails here rather than being asserted to reject and
      // failing that assertion for a reason nobody reads.
      expect({ door, admitted: brand === admitted }).toEqual({ door, admitted: false });
      await expect(
        TRANSACTION_EVENT_WRITER.insert(handleBranded(brand), buildEvent(SPEC, CLOCK)),
      ).rejects.toThrow(EventError);
      await expect(
        TRANSACTION_EVENT_WRITER.insert(handleBranded(brand), buildEvent(SPEC, CLOCK)),
      ).rejects.toThrow(new RegExp(`branded "${brand}"`));
    }
  });

  test('the refusal names the DOOR as the repair, which is what a wiring session needs', async () => {
    // THE MESSAGE IS THE FINDING'S DELIVERY VEHICLE. A caller who reads
    // `refuseTenancyColumn`'s sentence instead repairs the payload, which is a
    // rule about scoped writes stated to somebody who was never permitted one.
    const brand = brandOf(doors()[0]?.handle ?? '');
    await expect(
      TRANSACTION_EVENT_WRITER.insert(handleBranded(brand), buildEvent(SPEC, CLOCK)),
    ).rejects.toThrow(/THE REPAIR IS THE DOOR AND NOT THIS CHECK/);
  });

  test('the handle the writer admits is one no door hands out, proved by writing with it', async () => {
    // THE POSITIVE HALF, WITHOUT WHICH EVERY CASE ABOVE IS SATISFIED BY A WRITER
    // THAT REJECTS EVERYTHING. The admitted brand writes; the five doors do not
    // yield it; therefore the gap is the DOOR LIST and not the writer.
    const writes: { key: string; values: Readonly<Record<string, unknown>> }[] = [];
    const tx = {
      __brand: insertBrand(),
      insert: (key: string, values: Readonly<Record<string, unknown>>) => {
        writes.push({ key, values });
        return Promise.resolve([{ id: 1n }]);
      },
    };
    await TRANSACTION_EVENT_WRITER.insert(tx, buildEvent(SPEC, CLOCK));
    expect(writes.map((w) => w.key)).toEqual(['events']);
  });
});

// -----------------------------------------------------------------------------
// 3. `apps/api/src` does not try, and that is the correct behaviour
// -----------------------------------------------------------------------------

describe('the producer`s own deployable emits nothing', () => {
  /** Every `.ts` file under this deployable's `src/`, repo-relative and sorted. */
  function sources(): string[] {
    const found: string[] = [];
    const walk = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
        else if (entry.name.endsWith('.ts')) found.push(`${prefix}${entry.name}`);
      }
    };
    walk(join(APP, 'src'), 'apps/api/src/');
    return found;
  }

  test('the walk reaches this deployable`s sources, so the absence below is measured', () => {
    // A CHECK THAT CANNOT RUN IS NOT A CHECK THAT PASSED. An empty walk would
    // make the next case green over a tree it never read.
    const found = sources();
    expect(found.length).toBeGreaterThan(20);
    expect(found).toContain('apps/api/src/events.ts');
  });

  test('no file under `apps/api/src` calls an event sink, and none can', () => {
    // THE SHAPE IS A CALL. `events.ts` declares `emit` twice as a METHOD -- once
    // on `EventSink` and once on the object `makeEventSink` returns -- and
    // neither is written `.emit(`, so the producer needs no exemption and is
    // deliberately not given one.
    const callers = sources().filter((rel) => /\.emit\s*\(/.test(read(rel)));
    expect(callers).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// 4. The address the refusal names, which was prose until ADR-408
// -----------------------------------------------------------------------------
// `src/events.ts` and `apps/worker/src/sweeps/expiry-adapter.ts` BOTH conclude
// that the repair is "a package both arrows already reach", and until this
// section neither half of that sentence was bound to anything. It is two
// separable claims and they fail in opposite directions, so they are two cases:
// that no `packages/*` holds a producer today, which is the ABSENCE the finding
// rests on, and that a shared address EXISTS, which is what makes the remedy a
// relocation rather than a new package a founder must admit through `VG-12`.
//
// THE FIRST CASE FAILS ON GOOD NEWS AND THAT IS ITS PURPOSE. The day a
// `packages/*` module composes a sink, this deployable's header stops being true
// and the row that made it true is the row that should be told, which is
// `RI-35`'s `event-sink-caller` discipline applied to the OTHER side of the
// fence. The second fails on bad news: a wave that drops the last shared
// workspace dependency turns a costed relocation back into an unpriced one, and
// nothing else in this tree would notice.
describe('the remedy address, measured rather than asserted', () => {
  /** One deployable's `@merit/*` dependencies, both kinds, read from its manifest. */
  function meritDeps(app: string): string[] {
    const manifest: unknown = JSON.parse(read(`apps/${app}/package.json`));
    const { dependencies = {}, devDependencies = {} } = manifest as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Object.keys({ ...dependencies, ...devDependencies })
      .filter((name) => name.startsWith('@merit/'))
      .sort();
  }

  test('the manifests are read, so the intersection below is measured', () => {
    // A CHECK THAT CANNOT RUN IS NOT A CHECK THAT PASSED. Two empty lists
    // intersect to an empty list, which would make the next case fail for a
    // reason that has nothing to do with the finding.
    expect(meritDeps('api')).toContain('@merit/db');
    expect(meritDeps('worker')).toContain('@merit/db');
  });

  test('a package BOTH deployables already name exists, so the remedy costs no manifest edge', () => {
    // THE PRODUCER HAS NO HANDLE AND THE HANDLE HAS NO PRODUCER, and the two
    // sit in deployables neither of which may import the other (`RI-04`). The
    // only address that can hold both is one under `packages/`, and this case
    // says that address is already in both dependency sets rather than being a
    // package somebody must first admit.
    const shared = meritDeps('api').filter((name) => meritDeps('worker').includes(name));
    expect(shared.length).toBeGreaterThan(0);
    // AND `packages/ledger` IS NAMED because ADR-104 ruled this exact shape for
    // it: two deployables had to post and `RI-04` forbade an app depending on an
    // app. Naming it here is a precedent and never a proposal about where the
    // producer should go, which is `packages/**`'s fence and not this one.
    expect(shared).toContain('@merit/ledger');
  });

  test('no `packages/*` composes a sink today, which is what makes the finding a finding', () => {
    // THE SHAPE IS THE PRODUCER'S OWN TWO NAMES. A package that imported or
    // declared either one would be a second producer, and the header sentence
    // "the ONLY event producer in this repository" would be false with nobody
    // told. It walks `src` only: a suite under `packages/*/test` that stubs a
    // sink is not a producer and must not turn this red.
    const carriers: string[] = [];
    for (const pkg of readdirSync(join(ROOT, 'packages'), { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      let src: string[];
      try {
        src = readdirSync(join(ROOT, 'packages', pkg.name, 'src'), {
          recursive: true,
          encoding: 'utf8',
        });
      } catch {
        continue;
      }
      for (const entry of src) {
        const rel = `packages/${pkg.name}/src/${String(entry)}`;
        if (!rel.endsWith('.ts')) continue;
        if (/\bmakeEventSink\b|\bTRANSACTION_EVENT_WRITER\b/.test(read(rel))) carriers.push(rel);
      }
    }
    expect(carriers).toEqual([]);
  });

  test('the refusal names the address rather than sending its reader at a deployment', async () => {
    // THE CLAUSE THIS REPLACES READ `a decision about a deployment rather than a
    // file on disk` AND WAS BACKWARDS ON BOTH HALVES, which `src/events.ts`'s
    // header records. A wiring session reads this message first, so the message
    // is where the correction has to land for it to be worth anything.
    await expect(
      UNWIRED_EVENT_SINK.emit({}, { name: 'payout.requested', payload: {} }),
    ).rejects.toThrow(/SO IT IS A FILE ON DISK RATHER THAN A DEPLOYMENT DECISION/);
  });
});

// -----------------------------------------------------------------------------
// 5. What the producer would DO with what its callers actually emit
// -----------------------------------------------------------------------------
// THIS IS THE ONE MEASUREMENT ONLY THIS SIDE OF THE FENCE CAN TAKE, AND IT IS
// WHY IT IS HERE RATHER THAN BESIDE THE CALL SITES. `apps/worker/test/
// event-sink.test.ts` establishes the shape of this gap across three ports and
// is the closest thing in this tree to a specification of this file's subject,
// but `RI-04` forbids it the import, so it can compare NAMES against the
// catalogue parsed as text and can assert two payload properties by reading
// source. It cannot run `buildEvent`. This suite already imports it.
//
// SO THE NAME SPLIT IS NOT RE-ASSERTED HERE. That is section 4 of that file and
// re-stating it would be two copies of one claim drifting apart. What is
// asserted is the thing neither file has ever composed: **of the names this
// estate emits, how many would BUILD if the sink were installed tomorrow.**
//
// THE ANSWER IS THREE OF NINE AND THE SIX REFUSALS ARE FOUR DIFFERENT KINDS,
// which is the finding rather than the number. Two names have no row in EVENTS
// at all and need an amendment to a frozen document before any producer may
// carry them. Two are rows of EVENTS that were never transcribed here. One is
// accepted at the name and refused at tenancy. One is accepted at the name and
// refused at the subject. **A ROW THAT WIRED THE SINK AND STOPPED WOULD HAVE
// DELIVERED A THIRD OF THIS ESTATE'S EMITS**, and nothing in either tree would
// have said so, because each half of the obstruction is asserted in a different
// deployable and neither one multiplies them out.
describe('the vocabulary, run against the payloads the callers actually spell', () => {
  /** A uuid-shaped value, so a field the catalogue reads as a uuid parses. */
  const UUID = '11111111-1111-4111-8111-111111111111';

  /**
   * The payload literal's own top-level keys, bounded by brace matching.
   *
   * A REGEX TO THE FIRST `};` WAS TRIED AND OVER-CAPTURED, folding a nested
   * evidence object's keys into the top level. That direction is silent: a
   * superset of the real keys makes a MISSING field look present, which is the
   * one thing this section exists to detect. It throws on an unbalanced literal
   * rather than returning what it managed to read.
   */
  function payloadKeys(module: string, name: string): string[] {
    const text = read(`apps/worker/src/${module}`);
    const at = text.indexOf(`name: '${name}'`);
    if (at === -1) throw new Error(`${module} does not spell \`${name}\` at a call site`);
    const opens = text.indexOf('payload: {', at);
    if (opens === -1) throw new Error(`\`${name}\` in ${module} carries no payload literal`);
    let depth = 0;
    let end = -1;
    for (let i = text.indexOf('{', opens); i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) throw new Error(`\`${name}\`'s payload literal in ${module} is unbalanced`);
    const body = text.slice(text.indexOf('{', opens) + 1, end);
    const keys: string[] = [];
    let nest = 0;
    for (const line of body.split('\n')) {
      const key = /^\s{2,}([a-z_][a-z0-9_]*):/.exec(line);
      if (key !== null && nest === 0 && key[1] !== undefined) keys.push(key[1]);
      nest += (line.match(/[{[]/g) ?? []).length - (line.match(/[}\]]/g) ?? []).length;
    }
    return keys;
  }

  /** The five names the catalogue admits that are spelled at a call site. */
  const ADMITTED: readonly (readonly [string, string])[] = [
    ['payout.hold_released', 'sweeps/expiry.ts'],
    ['wallet.withdrawal_halt_released', 'sweeps/expiry.ts'],
    ['payout.freeze_expiring', 'sweeps/expiry.ts'],
    ['detector.run_completed', 'detectors/runner.ts'],
    ['flag.raised', 'detectors/runner.ts'],
  ];

  test('every payload literal is found and bounded, so the outcomes below are measured', () => {
    // A CHECK THAT CANNOT RUN IS NOT A CHECK THAT PASSED. An extractor that
    // returned nothing would report every name as refused for a missing field,
    // which reads exactly like the finding this section reports.
    for (const [name, module] of ADMITTED) {
      expect({ name, keys: payloadKeys(module, name).length > 0 }).toEqual({ name, keys: true });
    }
    // AND THE BRACE MATCHER IS PINNED AGAINST THE ONE PAYLOAD THAT DEFEATED THE
    // REGEX, so a future rewrite that reintroduces the over-capture is red here.
    expect(payloadKeys('detectors/runner.ts', 'flag.raised')).toContain('evidence_summary');
    expect(payloadKeys('detectors/runner.ts', 'flag.raised')).not.toContain('window_days');
  });

  test('three of the estate`s nine emitted names would build, and the other six would not', () => {
    const built: string[] = [];
    const refused: Record<string, string> = {};
    for (const [name, module] of ADMITTED) {
      // THE VALUES ARE SYNTHESISED AND THE FIELD LIST IS NOT, which is the whole
      // design of this case: a uuid where the catalogue reads a uuid, so the
      // only thing that can fail is a field the call site does not spell. This
      // measures the SHAPE the caller sends and never its run-time values.
      const payload: Record<string, unknown> = {};
      for (const key of payloadKeys(module, name)) payload[key] = key.endsWith('_id') ? UUID : 'x';
      const row = (EVENT_CATALOGUE as Record<string, { actorFrom?: { field: string } }>)[name];
      const decides = row?.actorFrom?.field;
      if (decides !== undefined && decides in payload) payload[decides] = 'expiry';
      try {
        buildEvent({ name, payload } as EmitSpec, CLOCK);
        built.push(name);
      } catch (err) {
        const message = (err as Error).message;
        refused[name] = /reaches neither/.test(message) ? 'tenancy' : 'subject';
      }
    }

    // THE THREE THAT WOULD WRITE. A wiring row may quote this list and no more.
    expect(built.sort()).toEqual([
      'flag.raised',
      'payout.hold_released',
      'wallet.withdrawal_halt_released',
    ]);

    // AND THE TWO THE CATALOGUE ADMITS AND THE PRODUCER STILL REFUSES, each
    // naming which gate stopped it. `payout.freeze_expiring` is ADR-191 section
    // 9's registered open item and its repair is EVENTS'; `detector.run_completed`
    // is ADR-205 section 7's and its repair is one field at a call site in a
    // deployable this fence does not hold. NEITHER IS REPAIRED HERE and neither
    // is a reason to widen anything: admitting them would write rows that fall
    // out of every scoped read of an append-only table.
    expect(refused).toEqual({
      'payout.freeze_expiring': 'tenancy',
      'detector.run_completed': 'subject',
    });
  });
});

// -----------------------------------------------------------------------------
// 6. The relocation's price, which is a FENCE and not a manifest edge (ADR-410)
// -----------------------------------------------------------------------------
// SECTION 4 PRICED THE MOVE AT NO MANIFEST EDGE AND THAT REMAINS TRUE. Row 410
// re-derived it from both manifests and reproduced it exactly: three packages
// sit in both dependency sets and no `VG-12` admission is owed. THE PRICE IS
// SOMEWHERE ELSE AND NOTHING IN EITHER TREE COUNTED IT.
//
// `apps/api/src/events.ts` IS NOT ONLY WHERE THE PRODUCER LIVES, IT IS THE
// ADDRESS OTHER FENCES NAME. Row 410 performed the move into `packages/ledger`
// and ran the suite rather than predicting the outcome: 7 files and 12 cases
// went red, and 5 files and 7 cases of that are outside every fence this wave
// hands out. Three suites under `apps/worker/test` recover the catalogue by
// searching this file's TEXT for `export const EVENT_CATALOGUE`, so a
// re-exporting module at the same path satisfies none of them; three `file:line`
// pointers in `apps/worker/src/schedule.ts` resolve into it and `RI-15` reads
// every one; and `RI-35`'s register names this path as the declaring module to
// exclude, so the moved module's own refusal message reads as an INSTALL.
//
// THE THREE POPULATIONS ARE DERIVED HERE AND NOT TYPED, and each case FAILS ON
// GOOD NEWS, which is section 4's discipline pointed at the obstruction instead
// of at the remedy. The day the last of them stops naming this path, the
// relocation is unblocked and the row that unblocked it is the row that gets
// told, rather than a later row rediscovering the price by running the move.
//
// WHAT THIS SECTION DOES NOT CLAIM. It does not say the move is wrong, and it
// does not choose the destination: ADR-410 rules `packages/ledger` on the
// writer's shape and states why `@merit/db` and `@merit/rules-engine` lose.
// Every binding below keys on the SOURCE path, so the count is the same for all
// three destinations and this section is silent about which.
describe('the relocation`s price, which is a fence rather than a manifest edge', () => {
  /** Every `.ts` under one repo-relative directory, repo-relative and sorted. */
  function tsUnder(dir: string): string[] {
    return readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' })
      .map((entry) => `${dir}/${String(entry).split('\\').join('/')}`)
      .filter((rel) => rel.endsWith('.ts'))
      .sort();
  }

  test('both walks reach files, so the three counts below are measured', () => {
    // A CHECK THAT CANNOT RUN IS NOT A CHECK THAT PASSED. An empty walk would
    // make every population below empty, which is the value the cases treat as
    // good news, so the guard has to come first.
    expect(tsUnder('apps/worker/src').length).toBeGreaterThan(0);
    expect(tsUnder('apps/worker/test').length).toBeGreaterThan(0);
  });

  test('every `file:line` pointer into this file resolves today, and a move strands them all', () => {
    // BOTH POINTER SHAPES ARE READ, because `RI-15` reads both: a full path with
    // a line, and a BARE pointer inheriting the nearest path. `schedule.ts`
    // writes one of each on one line, so the derivation is per LINE rather than
    // per match, and it recovers the same three pointers that invariant reports.
    const total = EVENTS_TS.split('\n').length;
    const pointers: string[] = [];
    for (const rel of tsUnder('apps/worker/src')) {
      read(rel)
        .split('\n')
        .forEach((line, index) => {
          if (!line.includes('apps/api/src/events.ts:')) return;
          for (const match of line.matchAll(/(?:events\.ts|`):(\d+)`/g))
            pointers.push(`${rel}:${index + 1} -> :${match[1] ?? ''}`);
        });
    }

    // THEY RESOLVE ON THIS TREE, which is what makes them live pointers rather
    // than the stale ones `RI-15` exists to catch.
    for (const pointer of pointers) {
      const cited = Number(pointer.slice(pointer.lastIndexOf(':') + 1));
      expect(cited).toBeGreaterThan(0);
      expect(cited).toBeLessThanOrEqual(total);
    }

    // AND THE POPULATION IS NOT EMPTY, which is the half that fails on good
    // news. `apps/worker/**` is in no fence this wave, so the repair is a later
    // row's and is named in ADR-410 rather than taken here.
    expect(pointers.length).toBeGreaterThan(0);
  });

  test('three suites outside this deployable recover the catalogue from this file`s TEXT', () => {
    // THE SHAPE IS THE SEARCH STRING AND NOT THE PATH, and the difference is the
    // whole finding. A module left at this path that RE-EXPORTS the producer
    // keeps every import working and satisfies none of these three, because what
    // they look for is the declaration itself. `RI-04` is why they read text at
    // all: that deployable may not import this one.
    const parsers = tsUnder('apps/worker/test').filter((rel) =>
      read(rel).includes('export const EVENT_CATALOGUE'),
    );
    expect(parsers).toEqual([
      'apps/worker/test/breaker-adapter.test.ts',
      'apps/worker/test/event-sink.test.ts',
      'apps/worker/test/schedule.test.ts',
    ]);

    // AND THE DECLARATION THEY SEARCH FOR IS STILL HERE, so all three are green
    // for the reason they say and not by accident.
    expect(EVENTS_TS).toContain('export const EVENT_CATALOGUE');
  });

  test('the absence register names this path as the module to exclude, so the move trips it', () => {
    // `RI-35`'s `event-sink-caller` probe skips ONE file by name while it looks
    // for an install, and the name is written into the runner. This module's own
    // refusal message quotes `makeEventSink({ writer: TRANSACTION_EVENT_WRITER,
    // clock })`, which is exactly the shape the probe treats as an install, so
    // the exclusion is what keeps that artifact `absent`. Move the module and
    // the exclusion no longer covers it. Row 410 observed that RED rather than
    // predicting it.
    const register = read('packages/tooling/checks/absence-claims.mjs');
    expect(register).toContain("const producer = 'apps/api/src/events.ts';");
    expect(EVENTS_TS).toContain('makeEventSink({ writer: TRANSACTION_EVENT_WRITER, clock })');
  });
});
