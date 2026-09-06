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

import { EventError, TRANSACTION_EVENT_WRITER, buildEvent } from '../src/events.ts';
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
