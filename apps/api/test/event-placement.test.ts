// =============================================================================
// apps/api/test/event-placement.test.ts
// =============================================================================
// THE DEPLOYABLE THAT HOLDS THE PRODUCER HOLDS NO HANDLE THAT CAN CARRY THE
// WRITE, ASSERTED OVER EVERY DOOR RATHER THAN OVER THE TWO SOMEBODY REMEMBERED.
//
// `packages/ledger/src/events.ts`'s header states the finding and `events.test.ts` proves two
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
} from '@merit/ledger';
import type { EmitSpec } from '@merit/ledger';

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
const EVENTS_TS = read('packages/ledger/src/events.ts');
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
    throw new Error('`packages/ledger/src/events.ts` declares no `EVENT_INSERT_BRAND` to read');
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
// `packages/ledger/src/events.ts` and `apps/worker/src/sweeps/expiry-adapter.ts` BOTH conclude
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

  test('exactly one `packages/*` module carries the producer, and it is the ruled home', () => {
    // THIS LEG WAS WRITTEN TO FAIL ON GOOD NEWS AND THE GOOD NEWS ARRIVED
    // (ADR-410). It read *"no `packages/*` composes a sink today, which is what
    // makes the finding a finding"* and it was true until the relocation. It is
    // UPDATED RATHER THAN DELETED, and it is not weaker for being updated: an
    // absence over every package is one bit, and this pins the carrier set to a
    // SINGLETON and names which file it is, so a SECOND producer minted anywhere
    // under `packages/*/src` still lands red here with its path in the message.
    // That was the property the old wording was protecting and it survives.
    //
    // THE SHAPE IS THE PRODUCER'S OWN TWO NAMES. A package that imported or
    // declared either one and is not the ruled home would be a second producer,
    // and the sentence "the ONLY event producer in this repository" would be
    // false with nobody told. It walks `src` only: a suite under
    // `packages/*/test` that stubs a sink is not a producer and must not turn
    // this red.
    //
    // THE BARREL IS EXPECTED AND IS THE HALF THAT MAKES THE MOVE WORTH ANYTHING.
    // `packages/ledger`'s `package.json` publishes `.` and nothing else, so a
    // module both deployables can reach is a module the barrel names. A home
    // that no barrel published would be a relocation that moved the file and not
    // the reachability.
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
    expect(carriers.sort()).toEqual([
      'packages/ledger/src/events.ts',
      'packages/ledger/src/index.ts',
    ]);

    // AND THE HOME IS ONE OF THE THREE ADDRESSES BOTH ARROWS ALREADY NAME, which
    // is what makes it a relocation rather than a package a founder must admit.
    // Derived from the manifests above rather than typed beside them.
    const shared = meritDeps('api').filter((name) => meritDeps('worker').includes(name));
    expect(shared).toContain('@merit/ledger');
  });

  test('the refusal names the address rather than sending its reader at a deployment', async () => {
    // THE CLAUSE THIS REPLACES READ `a decision about a deployment rather than a
    // file on disk` AND WAS BACKWARDS ON BOTH HALVES, which `packages/ledger/src/events.ts`'s
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
// 6. The relocation, and the bindings that had to move with it (ADR-410)
// -----------------------------------------------------------------------------
// THIS SECTION WAS WRITTEN AS A REFUTATION AND IT IS NOW A RECORD OF THE MOVE.
// Its first version derived three populations that all named `apps/api/src/
// events.ts` and asserted each was NOT empty, because the producer could not
// leave that path while they did. Every one of them has moved and every case is
// UPDATED RATHER THAN DELETED, on section 4's rule one section up.
//
// WHY THE OLD PATH IS NOT MERELY A HOME. Three suites under `apps/worker/test`
// recover `EVENT_CATALOGUE` by searching a file's TEXT, because `RI-04` forbids
// that deployable the import and text is the only instrument left to it. Two
// `file:line` pointers in `apps/worker/src/schedule.ts` resolved into the file
// and `RI-15` reads both shapes. `RI-35`'s register named the path as the one
// module its install probe must skip. **NONE OF THOSE IS AN IMPORT, SO NONE OF
// THEM IS SATISFIED BY A MODULE LEFT BEHIND THAT RE-EXPORTS**, which is the
// finding the first version of this section was written to carry and which is
// why the move needed a fence spanning three areas rather than one.
//
// WHAT SURVIVES AT THE OLD PATH AND WHY IT IS NARROW. `apps/api/src/events.ts`
// is a compatibility name for exactly one consumer outside this fence,
// `apps/worker/test/replay-adapter.test.ts`, which reaches it by relative path
// for `EVENT_NAMES`. It publishes that and nothing else: a module in the
// deployable that CANNOT install a sink must not re-export the install pair,
// and case 5 below holds that shut so a later row cannot widen it into a second
// producer surface by accident.
//
// EVERY CASE HERE STILL FAILS ON GOOD NEWS, pointed at the new arrangement
// rather than at the old obstruction.
describe('the relocation, and the bindings that moved with it', () => {
  /** Every `.ts` under one repo-relative directory, repo-relative and sorted. */
  function tsUnder(dir: string): string[] {
    return readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' })
      .map((entry) => `${dir}/${String(entry).split('\\').join('/')}`)
      .filter((rel) => rel.endsWith('.ts'))
      .sort();
  }

  const OLD_PATH = 'apps/api/src/events.ts';
  const HOME = 'packages/ledger/src/events.ts';

  test('both walks reach files, so the three counts below are measured', () => {
    // A CHECK THAT CANNOT RUN IS NOT A CHECK THAT PASSED. An empty walk would
    // make every population below empty, which is the value two of these cases
    // now treat as correct, so the guard has to come first.
    expect(tsUnder('apps/worker/src').length).toBeGreaterThan(0);
    expect(tsUnder('apps/worker/test').length).toBeGreaterThan(0);
  });

  test('no `file:line` pointer names the compatibility module, which declares nothing to cite', () => {
    // THE REPAIR WAS TO DROP THE COORDINATE AND NOT TO PREDICT A NEW ONE, which
    // is ADR-404's rule: a pointer repaired to a value its own wave invalidates
    // is the defect re-armed with a fresher date. This case holds that shut.
    // A coordinate into this module would be a pointer at a re-export, and the
    // thing it named would be in another package.
    //
    // IT READS BOTH SHAPES because `RI-15` does: a full path with a line, and a
    // BARE pointer inheriting the nearest path, which `schedule.ts` used to
    // write one of each on one line. The derivation is per LINE for that reason.
    const pointers: string[] = [];
    for (const rel of [...tsUnder('apps/worker/src'), ...tsUnder('apps/api/src')]) {
      read(rel)
        .split('\n')
        .forEach((line, index) => {
          if (!line.includes(`${OLD_PATH}:`)) return;
          for (const match of line.matchAll(/(?:events\.ts|`):(\d+)`/g))
            pointers.push(`${rel}:${index + 1} -> :${match[1] ?? ''}`);
        });
    }
    expect(pointers).toEqual([]);
  });

  test('the three text parsers read the producer`s home, and the old path holds no catalogue', () => {
    // THE SHAPE IS THE SEARCH STRING AND NOT THE PATH, and that is the whole
    // reason this move needed those three files in its fence. What they look
    // for is the DECLARATION, so a re-exporting module at the old path keeps
    // every import working and satisfies none of them.
    const parsers = tsUnder('apps/worker/test').filter((rel) =>
      read(rel).includes('export const EVENT_CATALOGUE'),
    );
    expect(parsers).toEqual([
      'apps/worker/test/breaker-adapter.test.ts',
      'apps/worker/test/event-sink.test.ts',
      'apps/worker/test/schedule.test.ts',
    ]);

    // AND EACH ONE NAMES THE HOME. `event-sink.test.ts` builds its path out of
    // segments, so the assertion is on the package directory rather than on a
    // string any of the three might have spelled differently.
    for (const rel of parsers) {
      expect(read(rel), `${rel} does not name the producer's package`).toContain('ledger');
    }

    // THREE SUITES STILL SPELL THE OLD PATH AND ALL THREE ARE REGISTERED RATHER
    // THAN REPAIRED, because ADR-410's fence over `apps/worker/test` is three
    // PATH CONSTANTS and nothing else. Not one of them breaks: each is a claim
    // about where the producer lives, and each is now one word out of date.
    //
    //   `event-sink.test.ts`      says what two untranscribed names are missing
    //                             is "a transcription into `apps/api/src/
    //                             events.ts`". That transcription is owed into
    //                             the home now
    //   `detector-census.test.ts` asserts a REFUSAL MESSAGE built in
    //                             `apps/worker/src/detectors/adapter.ts` still
    //                             names that path. Repairing the suite without
    //                             the message it reads would turn it red, so the
    //                             two are owed to one row together
    //   `expiry-adapter.test.ts`  says that path "is the only producer in this
    //                             repository", which is the sentence this move
    //                             makes false and which several files under
    //                             `apps/worker/src` also carry
    //
    // THE SET FAILS ON GOOD NEWS IN BOTH DIRECTIONS: a NEW stale mention lands
    // red here, and so does the day somebody holding that fence repairs one.
    //
    // THAT DAY ARRIVED AND THE EXPECTATION ABOVE IS KEPT BESIDE ITS CORRECTION
    // per `RI-14`. ADR-414 held `apps/worker/**` and repaired ALL THREE: the
    // refusal message in `detectors/adapter.ts` moved with the suite that reads
    // it, as the note above says it must. So the set is EMPTY, which is the
    // strongest form this assertion takes: it still reddens the moment any file
    // under `apps/worker/test` names the old path again. The three names are
    // left in the comment above rather than deleted, because a reader who finds
    // this empty needs to know what it used to hold and who emptied it.
    const stale = tsUnder('apps/worker/test').filter((rel) => read(rel).includes(OLD_PATH));
    expect(stale).toEqual([]);

    // THE DECLARATION IS AT THE HOME AND NOT AT THE OLD PATH, both halves, so
    // the three above are green for the reason they state.
    expect(read(HOME)).toContain('export const EVENT_CATALOGUE');
    expect(read(OLD_PATH)).not.toContain('export const EVENT_CATALOGUE');
  });

  test('the absence register skips the producer`s home, and the old path still carries the claim', () => {
    // `RI-35`'s `event-sink-caller` probe skips ONE file by name while it looks
    // for an install, because the producer's own refusal message quotes the
    // install and `stripComments` does not remove a string literal. The address
    // moved and the constant moved with it; the probe's intent is untouched.
    const register = read('packages/tooling/checks/absence-claims.mjs');
    expect(register).toContain(`const producer = '${HOME}';`);
    expect(read(HOME)).toContain('makeEventSink({ writer: TRANSACTION_EVENT_WRITER, clock })');

    // AND THE CLAIM THAT REGISTER ANCHORS IS STILL AT THE SITE IT NAMES. That
    // `site` is `apps/api/src/events.ts` and moving it was outside ADR-410's
    // fence, so the sentence stays at the old path while the register does.
    // The day the register's site moves, this expectation is what tells the row
    // that the sentence may follow it.
    expect(register).toContain("site: 'apps/api/src/events.ts'");
    expect(read(OLD_PATH)).toContain('`makeEventSink` is called by NO file');
  });

  test('the compatibility module publishes what one outside consumer takes, and no more', () => {
    // A MODULE IN THE DEPLOYABLE THAT CANNOT INSTALL A SINK MUST NOT PUBLISH THE
    // INSTALL PAIR. `apps/api` opens five doors and not one of them yields the
    // brand the writer admits, which sections 1 and 2 above derive; re-exporting
    // `makeEventSink` or `TRANSACTION_EVENT_WRITER` from here would say
    // otherwise to every reader and to `RI-35`'s probe at once.
    const shim = read(OLD_PATH);
    const exported = /export \{([^}]*)\}/.exec(shim)?.[1] ?? '';
    expect(exported).toContain('EVENT_NAMES');
    expect(exported).not.toContain('makeEventSink');
    expect(exported).not.toContain('TRANSACTION_EVENT_WRITER');

    // AND THE ONE CONSUMER IS REAL, derived rather than remembered. It is the
    // reason this module exists at all, and the day it stops naming this path
    // the module has no consumer left and should go.
    const takers = tsUnder('apps/worker/test').filter((rel) =>
      read(rel).includes("'../../api/src/events.ts'"),
    );
    expect(takers).toEqual(['apps/worker/test/replay-adapter.test.ts']);
  });

  test('both deployables can now name the producer, which is the whole deliverable', () => {
    // THE MOVE IS ONLY WORTH SOMETHING IF THE BARREL PUBLISHES THE INSTALL PAIR,
    // because `packages/ledger`'s manifest publishes `.` and nothing else. This
    // is the assertion that separates a relocation from a file that changed
    // directory.
    const barrel = read('packages/ledger/src/index.ts');
    expect(barrel).toContain("} from './events.ts';");
    expect(barrel).toContain("export { TRANSACTION_EVENT_WRITER } from './events.ts';");
    expect(barrel).toContain('makeEventSink');

    // AND BOTH ARROWS ALREADY REACH IT, re-derived from the manifests rather
    // than carried from ADR-408 section 6. A wave that severed either edge would
    // strand the producer again and nothing else in this tree would notice.
    const manifest = (app: string): string[] => {
      const parsed: unknown = JSON.parse(read(`apps/${app}/package.json`));
      const { dependencies = {} } = parsed as { dependencies?: Record<string, string> };
      return Object.keys(dependencies);
    };
    expect(manifest('api')).toContain('@merit/ledger');
    expect(manifest('worker')).toContain('@merit/ledger');

    // AND `apps/worker` IS STILL NOT WIRED, which ADR-410 declined on purpose:
    // installing the sink is a slice with its own verification. This is the leg
    // that fails on good news for the NEXT row rather than for this one.
    const installs = tsUnder('apps/worker/src').filter((rel) =>
      /\bmakeEventSink\s*\(/.test(read(rel)),
    );
    expect(installs).toEqual([]);
  });
});
