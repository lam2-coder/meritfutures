// =============================================================================
// apps/worker/test/live-ingest.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF `src/live/`.
//
// -----------------------------------------------------------------------------
// SECTION 1 IS THE POINT OF THE SLICE AND IT ASSERTS AN ABSENCE
// -----------------------------------------------------------------------------
// `INV-M2-14` is a claim about what the streaming path CANNOT REACH: it is
// write-only into the live cache and holds no grant on the four authoritative
// tables. SECURITY `C-26` requires that be "structurally impossible rather than
// defended", and a comment in a module header saying so is a statement of
// intention rather than a control.
//
// So section 1 asserts it MECHANICALLY, and in the direction that can fail:
//
//   the four table names are DERIVED from `0050`'s own closing `REVOKE`, never
//     retyped here, so a fifth table appended to that list arrives in this suite
//     without anybody editing it
//   each name is PRESENT in the raw text of both module files, which is the
//     foreclosure being carried in the header as the slice requires
//   each name is ABSENT from the same files with every comment stripped, which
//     is the claim
//   the module's import graph is walked and is CLOSED: `ingest.ts` imports
//     `./ports.ts`, `ports.ts` imports nothing, and neither names a bare
//     specifier at all, so there is no path to any table in the estate by any
//     name and not merely by these four
//
// **A SEEDED VIOLATION WAS WATCHED FAILING AND THE FILES WERE RESTORED FROM A
// BYTE-IDENTICAL COPY.** An absence test nobody has seen fail is a test that
// passes because it looks in the wrong place.
//
// -----------------------------------------------------------------------------
// SECTION 2 IS THE PREDICATE, AND THE HOLE IN `0050`'s SKETCH IS AN ASSERTION
// -----------------------------------------------------------------------------
// `0050` refuses a monotonicity trigger and names this slice as the owner of the
// guard, sketching it as `excluded.sequence > live_account_state.sequence`.
// **That sketch refuses the first tick of every new trading day**, because
// `sequence` is 1-based PER ACCOUNT PER DAY, so a row left over at 400 is never
// overwritten by today's 1 and the trader reads yesterday's equity all day. The
// hole is seeded HERE as a standing case rather than only in a transcript: the
// sketched predicate is written out beside `supersedes` and asserted to disagree
// with it exactly at the day boundary.
//
// -----------------------------------------------------------------------------
// WHAT THIS SUITE READS RATHER THAN RESTATES
// -----------------------------------------------------------------------------
// This deployable cannot import `@merit/rithmic`, and must not import `@merit/db`
// outside `src/db.ts` (ADR-165). Every shape the module declares because it
// cannot import it is BOUND to its source by reading that source as text.
//
//   packages/db/migrations/0050_live_cache_and_role.sql  the columns, the
//     constraints, the three refusals, the four revoked tables, the sketch
//   packages/rithmic/src/simulator/stream.ts   LiveAccountTick's fields
//   packages/rithmic/src/index.ts              streamLive and Subscription
//   docs/architecture/EVENTS.md                the feed family and its producer
//   docs/ops/runbooks/CRON_INVENTORY.md        the feed-health row
//
// NOTHING HERE REACHES A DATABASE. `ci.yml`'s `integration` job runs on bare
// `ubuntu-latest` with no services block. What IS asserted is the property at
// the resolution it lives at: which port was called, with what values, in what
// order, and what the cache would hold afterwards under the upsert's own rules.
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { stripComments } from '../../../packages/tooling/checks/strip-comments.mjs';

import { TICK_REFUSALS, liveIngestClean, refuseTick, startLiveIngest } from '../src/live/ingest.ts';
import type { LiveIngestReport, LiveIngestRun } from '../src/live/ingest.ts';
import {
  LIVE_CACHE_UPSERT_SQL,
  LIVE_CACHE_WRITTEN_COLUMNS,
  LiveIngestUnwired,
  UNWIRED_LIVE_INGEST_IO,
  supersedes,
} from '../src/live/ports.ts';
import type {
  FeedExpectation,
  IngestTick,
  LiveCacheOutcome,
  LiveCacheRow,
  LiveIngestIo,
  LiveSubscription,
} from '../src/live/ports.ts';

const source = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const INGEST_TS = '../src/live/ingest.ts';
const PORTS_TS = '../src/live/ports.ts';
const MIGRATION_0050 = '../../../packages/db/migrations/0050_live_cache_and_role.sql';
const STREAM_TS = '../../../packages/rithmic/src/simulator/stream.ts';
const SIM_TYPES_TS = '../../../packages/rithmic/src/simulator/types.ts';
const RITHMIC_INDEX_TS = '../../../packages/rithmic/src/index.ts';
const EVENTS_MD = '../../../docs/architecture/EVENTS.md';
const CRON_INVENTORY_MD = '../../../docs/ops/runbooks/CRON_INVENTORY.md';

/** The two files that are this module. */
const MODULE_FILES = [INGEST_TS, PORTS_TS] as const;

// -----------------------------------------------------------------------------
// Reading the migration, so nothing below is retyped from it
// -----------------------------------------------------------------------------

/** The four tables `0050`'s closing REVOKE takes back from `merit_live`. */
function revokedFromLive(): string[] {
  const sql = source(MIGRATION_0050);
  // ANCHORED ON THE NEWLINE AFTER `ON`, which is what separates the four-table
  // list from `REVOKE ALL ON live_account_state FROM merit_app, PUBLIC;` and
  // from `REVOKE DELETE ON live_account_state FROM merit_live;` above it. A
  // looser pattern matches the first REVOKE and captures everything between.
  const match = /REVOKE ALL ON\n([\s\S]*?)\nFROM merit_live;/.exec(sql);
  if (match === null) throw new Error('0050 no longer carries a REVOKE ALL ... FROM merit_live');
  return (match[1] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/** Every column `0050`'s CREATE TABLE declares, in order. */
function cacheColumns(): string[] {
  const sql = source(MIGRATION_0050);
  const match = /CREATE TABLE live_account_state \(([\s\S]*?)\n\);/.exec(sql);
  if (match === null) throw new Error('0050 no longer declares live_account_state');
  const columns: string[] = [];
  for (const line of (match[1] ?? '').split('\n')) {
    const declaration = /^ {2}([a-z_]+)\s+[a-z]/.exec(line);
    if (declaration !== null && declaration[1] !== undefined) columns.push(declaration[1]);
  }
  return columns;
}

// SOURCE WITH EVERY COMMENT REMOVED AND EVERY STRING LITERAL PRESERVED.
//
// IT TRACKS QUOTES RATHER THAN MATCHING A REGEX, because the file it is pointed
// at holds a multi-line SQL template literal and a naive stripper that met a
// `//` inside one would remove code and pass this suite by deleting the thing it
// is looking for.
//
// **IMPORTED AND NOT DECLARED, ON ADR-279.** The scanner this file wrote by hand
// was one of eight comment strippers in the tree and one of three that were
// correct; it is now the shared home's, with two differences that are repairs
// rather than changes. Newlines inside a BLOCK comment survive, so a caller that
// reports `file:line` reports the line. And a template SUBSTITUTION is treated
// as code, so a nested template no longer inverts the state, which is a defect
// this file's version had and which showed on three real files.

/** Every module specifier imported by one file. */
function importsOf(code: string): string[] {
  return [...stripComments(code).matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
}

/** The field names one `export interface` block declares. */
function interfaceFields(code: string, name: string): string[] {
  const match = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(code);
  if (match === null) throw new Error(`no export interface ${name}`);
  return [...(match[1] ?? '').matchAll(/^\s*readonly ([A-Za-z]+)[?]?:/gm)].map(
    (field) => field[1] ?? '',
  );
}

// =============================================================================
// 1. THE ABSENCE. `INV-M2-14` asserted mechanically rather than commented
// =============================================================================

describe('INV-M2-14: the streaming path cannot reach the authoritative tables', () => {
  it('derives the four table names from 0050 rather than restating them', () => {
    expect(revokedFromLive()).toEqual(['fills', 'raw_ingest_rows', 'daily_marks', 'rule_states']);
  });

  it('names every one of them in the module headers, which is the foreclosure', () => {
    for (const file of MODULE_FILES) {
      const raw = source(file);
      for (const table of revokedFromLive()) expect(raw).toContain(table);
    }
  });

  it('names none of them in code, which is the claim', () => {
    for (const file of MODULE_FILES) {
      const code = stripComments(source(file));
      for (const table of revokedFromLive()) {
        expect(code, `${file} names ${table} in code`).not.toContain(table);
      }
    }
  });

  it('names none of their Drizzle property spellings in code either', () => {
    // A table key reaches the accessor as a camelCase property, so the snake
    // case check alone would miss `tx.insert('dailyMarks', ...)` entirely.
    const keys = revokedFromLive().map((table) =>
      table.replace(/_([a-z])/g, (_all, letter: string) => letter.toUpperCase()),
    );
    expect(keys).toEqual(['fills', 'rawIngestRows', 'dailyMarks', 'ruleStates']);
    for (const file of MODULE_FILES) {
      const code = stripComments(source(file));
      for (const key of keys) expect(code, `${file} names ${key} in code`).not.toContain(key);
    }
  });

  it('has a CLOSED import graph of two nodes and no bare specifier at all', () => {
    expect(importsOf(source(PORTS_TS))).toEqual([]);
    expect(importsOf(source(INGEST_TS))).toEqual(['./ports.ts', './ports.ts']);
  });

  it('imports no database client, no engine, no accessor and no batch module', () => {
    const forbidden = [
      'pg',
      'drizzle-orm',
      '@merit/db',
      '@merit/rules-engine',
      '@merit/rithmic',
      '../batch/',
      '../db.ts',
    ];
    for (const file of MODULE_FILES) {
      const code = stripComments(source(file));
      for (const specifier of forbidden) {
        expect(code, `${file} reaches ${specifier}`).not.toContain(`'${specifier}`);
      }
    }
  });

  it('adds no SqlExecutorReason member, no SystemReason member and no key cast', () => {
    for (const file of MODULE_FILES) {
      const code = stripComments(source(file));
      expect(code).not.toContain('SqlExecutorReason');
      expect(code).not.toContain('SystemReason');
      expect(code).not.toContain('as TableKey');
      expect(code).not.toContain('sqlExecutor');
    }
  });

  it('writes exactly one table, and the upsert names no other', () => {
    const named = [...LIVE_CACHE_UPSERT_SQL.matchAll(/\b([a-z_]+)\.[a-z_]+/g)].map(
      (match) => match[1] ?? '',
    );
    expect([...new Set(named)].sort()).toEqual(['excluded', 'live_account_state']);
    expect(LIVE_CACHE_UPSERT_SQL).toContain('INSERT INTO live_account_state');
  });

  it('emits no event, because ADR-161 clause 7 gives feed.* to the sweep', () => {
    // EVENTS section 5.4 states the producer, and it is neither the feed nor
    // this ingest. Read there rather than restated here.
    const events = source(EVENTS_MD);
    expect(events).toContain('nothing below is produced by the streaming ingest');
    for (const file of MODULE_FILES) {
      const code = stripComments(source(file));
      for (const name of ['feed.stalled', 'feed.resumed', 'feed.gap_detected']) {
        expect(code, `${file} produces ${name}`).not.toContain(name);
      }
      expect(code).not.toContain("'events'");
    }
  });
});

// =============================================================================
// 2. THE PREDICATE, AND `0050`'s SKETCH IS THE SEEDED HOLE
// =============================================================================

/** The predicate exactly as `0050`'s header sketches it. NOT the one we ship. */
const sketched = (
  candidate: { tradingDay: string; sequence: number },
  held: { tradingDay: string; sequence: number },
): boolean => candidate.sequence > held.sequence;

describe('the monotonicity predicate 0050 recorded as owed to this slice', () => {
  it('is quoted in 0050 as sequence alone, which is the sketch this widens', () => {
    expect(source(MIGRATION_0050)).toContain('excluded.sequence > live_account_state.sequence');
  });

  it('carries 0050s own fragment AND the trading-day half in the SQL', () => {
    expect(LIVE_CACHE_UPSERT_SQL).toContain('excluded.sequence > live_account_state.sequence');
    expect(LIVE_CACHE_UPSERT_SQL).toContain(
      'excluded.trading_day > live_account_state.trading_day',
    );
    expect(LIVE_CACHE_UPSERT_SQL).toContain(
      'excluded.trading_day = live_account_state.trading_day',
    );
  });

  it('accepts the ordinary tick and refuses the out-of-order one', () => {
    const held = { tradingDay: '2026-08-27', sequence: 7 };
    expect(supersedes({ tradingDay: '2026-08-27', sequence: 8 }, held)).toBe(true);
    expect(supersedes({ tradingDay: '2026-08-27', sequence: 7 }, held)).toBe(false);
    expect(supersedes({ tradingDay: '2026-08-27', sequence: 6 }, held)).toBe(false);
  });

  it('accepts the day rollover and refuses yesterdays straggler', () => {
    const held = { tradingDay: '2026-08-27', sequence: 400 };
    expect(supersedes({ tradingDay: '2026-08-28', sequence: 1 }, held)).toBe(true);
    expect(supersedes({ tradingDay: '2026-08-26', sequence: 999 }, held)).toBe(false);
  });

  it('THE SEEDED HOLE: the sketched predicate freezes the surface at the day boundary', () => {
    const held = { tradingDay: '2026-08-27', sequence: 400 };
    const rollover = { tradingDay: '2026-08-28', sequence: 1 };
    // The sketch refuses today's first tick, so the row keeps yesterday's
    // equity through the whole of today: ADR-020 rule 3's named failure, "a
    // live surface that silently freezes at its last value".
    expect(sketched(rollover, held)).toBe(false);
    expect(supersedes(rollover, held)).toBe(true);
  });

  it('THE SEEDED HOLE, the other way: the sketch admits yesterdays straggler', () => {
    const held = { tradingDay: '2026-08-28', sequence: 3 };
    const straggler = { tradingDay: '2026-08-27', sequence: 400 };
    // The sketch would rewind the row by a whole session.
    expect(sketched(straggler, held)).toBe(true);
    expect(supersedes(straggler, held)).toBe(false);
  });

  it('agrees with the sketch everywhere inside one trading day', () => {
    const day = '2026-08-27';
    for (let held = 1; held <= 6; held += 1) {
      for (let candidate = 1; candidate <= 6; candidate += 1) {
        expect(
          supersedes({ tradingDay: day, sequence: candidate }, { tradingDay: day, sequence: held }),
        ).toBe(
          sketched({ tradingDay: day, sequence: candidate }, { tradingDay: day, sequence: held }),
        );
      }
    }
  });
});

describe('the upsert against 0050s own CREATE TABLE', () => {
  it('writes only columns 0050 declares', () => {
    const declared = cacheColumns();
    expect(declared).toContain('account_id');
    for (const column of LIVE_CACHE_WRITTEN_COLUMNS) expect(declared).toContain(column);
  });

  it('never writes the GENERATED column, which cannot disagree with its inputs', () => {
    expect(source(MIGRATION_0050)).toContain(
      'intraday_movement_cents bigint GENERATED ALWAYS AS (equity_cents - opening_equity_cents) STORED',
    );
    expect(LIVE_CACHE_UPSERT_SQL).not.toContain('intraday_movement_cents');
  });

  it('never writes indicative or created_at, whose defaults 0050 sets', () => {
    expect(LIVE_CACHE_UPSERT_SQL).not.toContain('indicative');
    expect(LIVE_CACHE_UPSERT_SQL).not.toContain('created_at');
    expect(cacheColumns()).toContain('indicative');
    expect(cacheColumns()).toContain('created_at');
  });

  it('sets as_of_instant on the UPDATE arm, because a column default does not fire there', () => {
    expect(source(MIGRATION_0050)).toContain(
      'as_of_instant          timestamptz NOT NULL DEFAULT now()',
    );
    expect(LIVE_CACHE_UPSERT_SQL).toContain('as_of_instant = excluded.as_of_instant');
  });

  it('preserves the day opening within a day and replaces it across one', () => {
    expect(LIVE_CACHE_UPSERT_SQL).toContain('opening_equity_cents = CASE');
    expect(LIVE_CACHE_UPSERT_SQL).toContain('ELSE live_account_state.opening_equity_cents');
  });

  it('names none of the three columns 0050 refused', () => {
    const migration = source(MIGRATION_0050);
    expect(migration).toContain('No `kind` column');
    expect(migration).toContain('No `at_utc` column');
    expect(migration).toContain('No `projected_floor_distance_cents` column');
    for (const refused of ['kind', 'at_utc', 'projected_floor_distance_cents']) {
      expect(cacheColumns()).not.toContain(refused);
      expect(LIVE_CACHE_UPSERT_SQL).not.toContain(refused);
    }
  });
});

// =============================================================================
// 3. THE PORT SHAPES, BOUND TO THE SOURCES THIS DEPLOYABLE CANNOT IMPORT
// =============================================================================

describe('the declared shapes against packages/rithmic', () => {
  it('narrows LiveAccountTick and declares no field it does not have', () => {
    const tick = interfaceFields(source(STREAM_TS), 'LiveAccountTick');
    const port = interfaceFields(source(PORTS_TS), 'IngestTick');
    expect(tick.length).toBeGreaterThan(port.length);
    for (const field of port) expect(tick, `LiveAccountTick has no ${field}`).toContain(field);
  });

  it('declares neither kind nor atUtc, because 0050 refused both columns', () => {
    const tick = interfaceFields(source(STREAM_TS), 'LiveAccountTick');
    const port = interfaceFields(source(PORTS_TS), 'IngestTick');
    for (const field of ['kind', 'atUtc']) {
      expect(tick, `the tick no longer carries ${field}`).toContain(field);
      expect(port, `the port declares ${field}, which 0050 refused`).not.toContain(field);
    }
  });

  it('matches streamLive and Subscription as PlatformAdapter declares them', () => {
    const index = source(RITHMIC_INDEX_TS);
    expect(index).toContain('streamLive(handler: LiveTickHandler): Promise<Subscription>;');
    expect(index).toContain('export type LiveTickHandler = (tick: LiveAccountTick) => void;');
    const ports = source(PORTS_TS);
    expect(ports).toContain(
      'streamLive(handler: (tick: IngestTick) => void): Promise<LiveSubscription>;',
    );
    expect(ports).toContain('close(): void;');
  });

  it('keeps money in bigint on both sides of the boundary', () => {
    expect(source(STREAM_TS)).toContain('readonly equityCents: Cents;');
    expect(source(SIM_TYPES_TS)).toContain('export type Cents = bigint;');
    expect(interfaceFields(source(PORTS_TS), 'LiveCacheRow')).toEqual([
      'accountId',
      'tradingDay',
      'sequence',
      'openingEquityCents',
      'equityCents',
      'feed',
      'asOfInstant',
    ]);
    const ports = stripComments(source(PORTS_TS));
    expect(ports).toContain('readonly openingEquityCents: bigint;');
    expect(ports).toContain('readonly equityCents: bigint;');
    expect(ports).not.toContain('equityCents: number');
  });
});

// =============================================================================
// 4. THE INGEST, against a feed faithful to stream.ts and a cache faithful to
//    the upsert
// =============================================================================

interface CacheState {
  readonly tradingDay: string;
  readonly sequence: number;
  readonly openingEquityCents: bigint;
  readonly equityCents: bigint;
  readonly feed: string;
  readonly asOfInstant: Date;
}

interface Fake {
  readonly io: LiveIngestIo;
  /** The cache, under the upsert's own rules. */
  readonly cache: Map<string, CacheState>;
  /** Every row handed to the cache, whether or not it was written. */
  readonly attempted: LiveCacheRow[];
  /** Every heartbeat recorded. */
  readonly heartbeats: FeedExpectation[];
  /** Every ref the burn list was asked about, in order, with repeats. */
  readonly lookups: string[];
  /** Has the pump delivered every tick it holds? */
  exhausted(): boolean;
  closed(): number;
}

interface FakeOptions {
  readonly ticks: readonly IngestTick[];
  /** Burn list. A ref absent from this map resolves to `null`. */
  readonly refs: Readonly<Record<string, string>>;
  readonly now: Date;
  /** Raise from `upsertIfNewer` for these account ids. */
  readonly writeFailsFor?: readonly string[];
  /**
   * Make `upsertIfNewer` resolve a whole TURN later rather than on a microtask.
   *
   * WITHOUT IT NOTHING EVER COALESCES AND THE BOUND IS UNTESTED. A fake whose
   * write resolves on a microtask finishes before the pump's next
   * `setImmediate`, so every tick is written before its successor arrives and
   * the queue never holds two. That is the easy case, and it is not the one a
   * real sink is in.
   */
  readonly writeDelayTurns?: number;
}

/**
 * The feed, rebuilt rather than imported, and faithful to `stream.ts`.
 *
 * ONE TICK PER TURN OF THE EVENT LOOP, PUMPED WITH `setImmediate`, AND THE
 * SUBSCRIPTION RESOLVES BEFORE THE FIRST DELIVERY. `stream.ts` records why it is
 * a turn rather than a microtask: a microtask pump runs before the caller's
 * `await` continuation, so the first tick would arrive while the consumer was
 * still waiting for the object that lets it close. A fake that delivered
 * synchronously would make every ordering assertion below vacuous.
 */
function fakeIo(options: FakeOptions): Fake {
  const cache = new Map<string, CacheState>();
  const attempted: LiveCacheRow[] = [];
  const heartbeats: FeedExpectation[] = [];
  const lookups: string[] = [];
  const fails = new Set(options.writeFailsFor ?? []);
  let delivered = 0;
  let closes = 0;

  const io: LiveIngestIo = {
    now: () => options.now,
    feed: {
      streamLive(handler): Promise<LiveSubscription> {
        let open = true;
        const pump = (): void => {
          if (!open) return;
          const tick = options.ticks[delivered];
          if (tick === undefined) return;
          delivered += 1;
          handler(tick);
          setImmediate(pump);
        };
        setImmediate(pump);
        return Promise.resolve({
          close(): void {
            open = false;
            closes += 1;
          },
        });
      },
    },
    refs: {
      accountIdForRef(ref): Promise<string | null> {
        lookups.push(ref);
        return Promise.resolve(options.refs[ref] ?? null);
      },
    },
    cache: {
      async upsertIfNewer(row: LiveCacheRow): Promise<LiveCacheOutcome> {
        attempted.push(row);
        for (let n = 0; n < (options.writeDelayTurns ?? 0); n += 1) await turn();
        if (fails.has(row.accountId)) {
          throw new Error(`write refused for ${row.accountId}`);
        }
        const held = cache.get(row.accountId);
        const candidate = { tradingDay: row.tradingDay, sequence: row.sequence };
        if (held !== undefined && !supersedes(candidate, held)) return 'refused-stale';
        // The `CASE`: the opening survives within a day and is replaced across
        // one. Transcribed from LIVE_CACHE_UPSERT_SQL, which the suite above
        // binds to 0050.
        const openingEquityCents =
          held === undefined || row.tradingDay > held.tradingDay
            ? row.openingEquityCents
            : held.openingEquityCents;
        cache.set(row.accountId, {
          tradingDay: row.tradingDay,
          sequence: row.sequence,
          openingEquityCents,
          equityCents: row.equityCents,
          feed: row.feed,
          asOfInstant: row.asOfInstant,
        });
        return 'written';
      },
    },
    expectations: {
      record(expectation): Promise<void> {
        heartbeats.push(expectation);
        return Promise.resolve();
      },
    },
  };

  return {
    io,
    cache,
    attempted,
    heartbeats,
    lookups,
    exhausted: () => delivered >= options.ticks.length,
    closed: () => closes,
  };
}

const turn = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

/** Let the pump deliver everything, then let the drain finish. */
async function settle(fake: Fake, run: LiveIngestRun): Promise<void> {
  for (let guard = 0; guard < 10_000 && !fake.exhausted(); guard += 1) await turn();
  await run.drained();
}

const tick = (
  platformAccountRef: string,
  tradingDay: string,
  sequence: number,
  equityCents: bigint,
): IngestTick => ({ platformAccountRef, tradingDay, sequence, equityCents, indicative: true });

const NOW = new Date('2026-08-27T14:30:00.000Z');
const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
const REFS = { 'RITH-A': ACCOUNT_A, 'RITH-B': ACCOUNT_B };

async function runOver(options: FakeOptions): Promise<{
  readonly fake: Fake;
  readonly report: LiveIngestReport;
}> {
  const fake = fakeIo(options);
  const run = await startLiveIngest(fake.io, { feed: 'simulator' });
  await settle(fake, run);
  const report = await run.close();
  return { fake, report };
}

describe('the ingest writes the cache and nothing else', () => {
  it('writes every tick of one account in delivery order', async () => {
    const { fake, report } = await runOver({
      ticks: [
        tick('RITH-A', '2026-08-27', 1, 500_000n),
        tick('RITH-A', '2026-08-27', 2, 500_250n),
        tick('RITH-A', '2026-08-27', 3, 499_800n),
      ],
      refs: REFS,
      now: NOW,
    });
    expect(report.received).toBe(3);
    expect(report.failed).toBe(0);
    expect(report.refusedStale).toBe(0);
    expect(fake.cache.get(ACCOUNT_A)).toEqual({
      tradingDay: '2026-08-27',
      sequence: 3,
      openingEquityCents: 500_000n,
      equityCents: 499_800n,
      feed: 'simulator',
      asOfInstant: NOW,
    });
  });

  it('holds the day opening at the FIRST tick it observed, never a later one', async () => {
    const { fake } = await runOver({
      ticks: [
        tick('RITH-A', '2026-08-27', 1, 500_000n),
        tick('RITH-A', '2026-08-27', 2, 600_000n),
        tick('RITH-A', '2026-08-27', 3, 400_000n),
      ],
      refs: REFS,
      now: NOW,
    });
    const state = fake.cache.get(ACCOUNT_A);
    expect(state?.openingEquityCents).toBe(500_000n);
    // The movement the database GENERATES from the two, in integer cents.
    expect((state?.equityCents ?? 0n) - (state?.openingEquityCents ?? 0n)).toBe(-100_000n);
  });

  it('resets the opening across the day boundary and never rewinds into it', async () => {
    const { fake, report } = await runOver({
      ticks: [
        tick('RITH-A', '2026-08-27', 1, 500_000n),
        tick('RITH-A', '2026-08-27', 2, 505_000n),
        // Today's first tick. sequence resets to 1, which the sketched
        // predicate would have refused.
        tick('RITH-A', '2026-08-28', 1, 505_000n),
        tick('RITH-A', '2026-08-28', 2, 507_500n),
        // Yesterday's straggler, arriving after today opened.
        tick('RITH-A', '2026-08-27', 3, 480_000n),
      ],
      refs: REFS,
      now: NOW,
    });
    expect(fake.cache.get(ACCOUNT_A)).toEqual({
      tradingDay: '2026-08-28',
      sequence: 2,
      openingEquityCents: 505_000n,
      equityCents: 507_500n,
      feed: 'simulator',
      asOfInstant: NOW,
    });
    expect(report.refusedStale).toBe(1);
  });

  it('leaves the row where it is when an out-of-order tick would rewind it', async () => {
    const { fake, report } = await runOver({
      ticks: [
        tick('RITH-A', '2026-08-27', 1, 500_000n),
        tick('RITH-A', '2026-08-27', 5, 520_000n),
        tick('RITH-A', '2026-08-27', 4, 111_111n),
        tick('RITH-A', '2026-08-27', 5, 222_222n),
      ],
      refs: REFS,
      now: NOW,
    });
    const state = fake.cache.get(ACCOUNT_A);
    expect(state?.sequence).toBe(5);
    expect(state?.equityCents).toBe(520_000n);
    expect(report.refusedStale).toBe(2);
  });

  it('keeps accounts apart, and one ref never lands on another account row', async () => {
    const { fake } = await runOver({
      ticks: [
        tick('RITH-A', '2026-08-27', 1, 500_000n),
        tick('RITH-B', '2026-08-27', 1, 900_000n),
        tick('RITH-B', '2026-08-27', 2, 901_000n),
      ],
      refs: REFS,
      now: NOW,
    });
    expect(fake.cache.get(ACCOUNT_A)?.equityCents).toBe(500_000n);
    expect(fake.cache.get(ACCOUNT_B)?.equityCents).toBe(901_000n);
    expect(fake.cache.size).toBe(2);
  });

  it('resolves each ref once, because INV-M2-10 makes the burn list permanent', async () => {
    const { fake } = await runOver({
      ticks: [
        tick('RITH-A', '2026-08-27', 1, 500_000n),
        tick('RITH-A', '2026-08-27', 2, 500_100n),
        tick('RITH-B', '2026-08-27', 1, 900_000n),
        tick('RITH-A', '2026-08-27', 3, 500_200n),
      ],
      refs: REFS,
      now: NOW,
    });
    expect(fake.lookups.sort()).toEqual(['RITH-A', 'RITH-B']);
  });

  it('stamps as_of_instant from OUR clock and never from the tick', async () => {
    const { fake } = await runOver({
      ticks: [tick('RITH-A', '2026-08-27', 1, 500_000n)],
      refs: REFS,
      now: NOW,
    });
    expect(fake.attempted[0]?.asOfInstant).toBe(NOW);
    expect(fake.cache.get(ACCOUNT_A)?.asOfInstant).toBe(NOW);
  });
});

describe('what the ingest refuses before the cache ever sees it', () => {
  it('refuses a tick that is not labeled indicative', () => {
    const unlabeled = { ...tick('RITH-A', '2026-08-27', 1, 1n), indicative: false };
    expect(refuseTick(unlabeled as unknown as IngestTick)).toBe('not-indicative');
  });

  it('refuses a non-positive sequence, which 0050s CHECK would have raised on', () => {
    expect(source(MIGRATION_0050)).toContain('CHECK (sequence > 0)');
    expect(refuseTick(tick('RITH-A', '2026-08-27', 0, 1n))).toBe('sequence-not-positive');
    expect(refuseTick(tick('RITH-A', '2026-08-27', -1, 1n))).toBe('sequence-not-positive');
  });

  it('REFUSES A NUMBER EQUITY RATHER THAN COERCING IT', () => {
    const floated = { ...tick('RITH-A', '2026-08-27', 1, 1n), equityCents: 500_000 };
    expect(refuseTick(floated as unknown as IngestTick)).toBe('equity-not-integer-cents');
  });

  it('accepts a well-formed tick', () => {
    expect(refuseTick(tick('RITH-A', '2026-08-27', 1, -500_000n))).toBeNull();
  });

  it('counts a malformed tick and writes nothing for it', async () => {
    const bad = { ...tick('RITH-C', '2026-08-27', 1, 1n), indicative: false };
    const { fake, report } = await runOver({
      ticks: [bad as unknown as IngestTick, tick('RITH-A', '2026-08-27', 1, 500_000n)],
      refs: REFS,
      now: NOW,
    });
    expect(report.refused['not-indicative']).toBe(1);
    expect(fake.attempted).toHaveLength(1);
    expect(fake.cache.size).toBe(1);
  });

  it('counts an unknown ref and never invents an account for it', async () => {
    const { fake, report } = await runOver({
      ticks: [tick('RITH-Z', '2026-08-27', 1, 500_000n)],
      refs: REFS,
      now: NOW,
    });
    expect(report.refused['unknown-ref']).toBe(1);
    expect(fake.attempted).toHaveLength(0);
    expect(fake.cache.size).toBe(0);
    expect(fake.heartbeats).toHaveLength(0);
  });
});

describe('gaps are counted at delivery and never produced as events', () => {
  it('reports a gap in feed.gap_detected field names', async () => {
    const { report } = await runOver({
      ticks: [tick('RITH-A', '2026-08-27', 1, 500_000n), tick('RITH-A', '2026-08-27', 4, 501_000n)],
      refs: REFS,
      now: NOW,
    });
    expect(report.gaps).toEqual([
      {
        platformAccountRef: 'RITH-A',
        accountId: ACCOUNT_A,
        tradingDay: '2026-08-27',
        lastSequence: 1,
        receivedSequence: 4,
      },
    ]);
  });

  it('reports at most one per account and trading day, as EVENTS section 5.4 rules', async () => {
    expect(source(EVENTS_MD)).toContain('At most one per feed, account and trading day');
    const { report } = await runOver({
      ticks: [
        tick('RITH-A', '2026-08-27', 1, 1n),
        tick('RITH-A', '2026-08-27', 4, 2n),
        tick('RITH-A', '2026-08-27', 9, 3n),
      ],
      refs: REFS,
      now: NOW,
    });
    expect(report.gaps).toHaveLength(1);
    expect(report.gaps[0]?.receivedSequence).toBe(4);
  });

  it('reads the day too, so a rollover is never a gap', async () => {
    const { report } = await runOver({
      ticks: [
        tick('RITH-A', '2026-08-27', 400, 1n),
        tick('RITH-A', '2026-08-28', 1, 2n),
        tick('RITH-A', '2026-08-28', 2, 3n),
      ],
      refs: REFS,
      now: NOW,
    });
    expect(report.gaps).toEqual([]);
  });

  it('is detected at ENQUEUE, so coalescing never hides one', async () => {
    // The write for tick 1 is still in flight when 5 arrives, so 3 is
    // coalesced away and never reaches the cache. The gap between 1 and 3 must
    // still be reported, which is the whole reason gap detection sits in the
    // handler rather than beside the write.
    const { fake, report } = await runOver({
      ticks: [
        tick('RITH-A', '2026-08-27', 1, 1n),
        tick('RITH-A', '2026-08-27', 3, 2n),
        tick('RITH-A', '2026-08-27', 5, 3n),
      ],
      refs: REFS,
      now: NOW,
      writeDelayTurns: 2,
    });
    expect(report.coalesced).toBeGreaterThan(0);
    expect(fake.attempted.map((row) => row.sequence)).not.toContain(3);
    expect(report.gaps).toHaveLength(1);
    expect(report.gaps[0]?.lastSequence).toBe(1);
    expect(report.gaps[0]?.receivedSequence).toBe(3);
  });
});

describe('the heartbeat the expectation sweep needs', () => {
  it('is recorded on an accepted write, in the shape ports.ts declares', async () => {
    const { fake } = await runOver({
      ticks: [tick('RITH-A', '2026-08-27', 1, 500_000n)],
      refs: REFS,
      now: NOW,
    });
    expect(fake.heartbeats).toEqual([
      {
        feed: 'simulator',
        tradingDay: '2026-08-27',
        accountId: ACCOUNT_A,
        lastTickAt: NOW,
        lastSequence: 1,
      },
    ]);
  });

  it('is NOT recorded for a tick the predicate refused', async () => {
    const { fake } = await runOver({
      ticks: [tick('RITH-A', '2026-08-27', 5, 500_000n), tick('RITH-A', '2026-08-27', 2, 400_000n)],
      refs: REFS,
      now: NOW,
    });
    expect(fake.heartbeats).toHaveLength(1);
    expect(fake.heartbeats[0]?.lastSequence).toBe(5);
  });

  it('carries no equity, no movement and no money of any kind', () => {
    const fields = interfaceFields(source(PORTS_TS), 'FeedExpectation');
    expect(fields).toEqual(['feed', 'tradingDay', 'accountId', 'lastTickAt', 'lastSequence']);
    for (const field of fields) expect(field.toLowerCase()).not.toContain('cents');
  });
});

describe('failure, backpressure and shutdown', () => {
  it('counts a failing write, keeps the first message, and keeps going', async () => {
    const { fake, report } = await runOver({
      ticks: [
        tick('RITH-A', '2026-08-27', 1, 500_000n),
        tick('RITH-B', '2026-08-27', 1, 900_000n),
        tick('RITH-B', '2026-08-27', 2, 901_000n),
      ],
      refs: REFS,
      now: NOW,
      writeFailsFor: [ACCOUNT_A],
    });
    expect(report.failed).toBe(1);
    expect(report.firstFailure).toContain(ACCOUNT_A);
    // The other trader's surface is untouched by the first one's failure.
    expect(fake.cache.get(ACCOUNT_B)?.sequence).toBe(2);
  });

  it('coalesces per account, so the queue is bounded by the account count', async () => {
    const ticks: IngestTick[] = [];
    for (let sequence = 1; sequence <= 40; sequence += 1) {
      ticks.push(tick('RITH-A', '2026-08-27', sequence, BigInt(500_000 + sequence)));
    }
    const { fake, report } = await runOver({
      ticks,
      refs: REFS,
      now: NOW,
      writeDelayTurns: 2,
    });
    expect(report.received).toBe(40);
    // The sink is slower than the feed, so the queue really does hold two.
    expect(report.coalesced).toBeGreaterThan(0);
    // Whatever the interleaving, the cache lands where writing every tick in
    // turn would have landed: coalescing is observationally equivalent.
    expect(fake.cache.get(ACCOUNT_A)?.sequence).toBe(40);
    expect(fake.cache.get(ACCOUNT_A)?.equityCents).toBe(500_040n);
    expect(fake.cache.get(ACCOUNT_A)?.openingEquityCents).toBe(500_001n);
    expect(report.written + report.coalesced + report.refusedStale).toBe(40);
    // And it wrote strictly fewer rows than it received, which is the bound.
    expect(fake.attempted.length).toBeLessThan(40);
  });

  it('closes the subscription exactly once and drains what was queued', async () => {
    const fake = fakeIo({
      ticks: [tick('RITH-A', '2026-08-27', 1, 500_000n), tick('RITH-A', '2026-08-27', 2, 500_100n)],
      refs: REFS,
      now: NOW,
    });
    const run = await startLiveIngest(fake.io, { feed: 'simulator' });
    await settle(fake, run);
    const report = await run.close();
    expect(fake.closed()).toBe(1);
    expect(report.received).toBe(2);
    expect(fake.cache.get(ACCOUNT_A)?.sequence).toBe(2);
  });

  it('reports a clean run when the feed delivered nothing', async () => {
    const { report } = await runOver({ ticks: [], refs: REFS, now: NOW });
    expect(liveIngestClean(report)).toBe(true);
    expect(report.feed).toBe('simulator');
  });

  it('is not clean once anything was received', async () => {
    const { report } = await runOver({
      ticks: [tick('RITH-A', '2026-08-27', 1, 1n)],
      refs: REFS,
      now: NOW,
    });
    expect(liveIngestClean(report)).toBe(false);
  });

  it('names every refusal in the report', async () => {
    const { report } = await runOver({ ticks: [], refs: REFS, now: NOW });
    expect(Object.keys(report.refused).sort()).toEqual([...TICK_REFUSALS].sort());
  });
});

describe('the unwired default refuses rather than returning a plausible value', () => {
  it('refuses every port', async () => {
    await expect(UNWIRED_LIVE_INGEST_IO.feed.streamLive(() => {})).rejects.toBeInstanceOf(
      LiveIngestUnwired,
    );
    await expect(UNWIRED_LIVE_INGEST_IO.refs.accountIdForRef('RITH-A')).rejects.toBeInstanceOf(
      LiveIngestUnwired,
    );
    await expect(
      UNWIRED_LIVE_INGEST_IO.cache.upsertIfNewer({
        accountId: ACCOUNT_A,
        tradingDay: '2026-08-27',
        sequence: 1,
        openingEquityCents: 1n,
        equityCents: 1n,
        feed: 'simulator',
        asOfInstant: NOW,
      }),
    ).rejects.toBeInstanceOf(LiveIngestUnwired);
    await expect(
      UNWIRED_LIVE_INGEST_IO.expectations.record({
        feed: 'simulator',
        tradingDay: '2026-08-27',
        accountId: ACCOUNT_A,
        lastTickAt: NOW,
        lastSequence: 1,
      }),
    ).rejects.toBeInstanceOf(LiveIngestUnwired);
    expect(() => UNWIRED_LIVE_INGEST_IO.now()).toThrow(LiveIngestUnwired);
  });

  it('says what is missing, which is a role and not an adapter', async () => {
    await expect(UNWIRED_LIVE_INGEST_IO.feed.streamLive(() => {})).rejects.toThrow(
      'no process in this tree connects as it',
    );
  });

  it('stops a whole run at the door rather than half-writing one', async () => {
    await expect(
      startLiveIngest(UNWIRED_LIVE_INGEST_IO, { feed: 'simulator' }),
    ).rejects.toBeInstanceOf(LiveIngestUnwired);
  });
});

// =============================================================================
// 5. THE FEED-HEALTH ROW, AND THE EXPECTATION IT IS MEASURED AGAINST
// =============================================================================

describe('CRON_INVENTORY carries the feed-health row this slice owns', () => {
  it('rows the expectation sweep with a dead-man switch', () => {
    const inventory = source(CRON_INVENTORY_MD);
    expect(inventory).toContain('Live feed expectation sweep');
    expect(inventory).toContain('apps/worker/src/live/ingest.ts');
  });

  it('records that the expectation row itself is owed', () => {
    expect(source(CRON_INVENTORY_MD)).toContain('NO EXPECTATION ROW EXISTS YET');
  });

  it('states the grant that makes the sweep unbuildable today', () => {
    // 0050's REVOKE is what stops the sweep reading the cache, and F1 is the
    // escape that must not be taken. Both are read at the source.
    const migration = source(MIGRATION_0050);
    expect(migration).toContain('REVOKE ALL ON live_account_state FROM merit_app, PUBLIC;');
    expect(migration).toContain('granting merit_app SELECT here, which makes FM-M12-08 false');
  });
});
