// =============================================================================
// apps/worker/test/event-sink.test.ts
// =============================================================================
// THE SEVEN CALL SITES, THE SEVEN NAMES, AND THE TWO FENCES BETWEEN THEM AND A
// ROW. This deployable holds every `emit` call in the workspace and it holds no
// producer; `apps/api` holds the only producer and no door that can carry the
// write. Neither half is a defect on its own and the pair is what makes the
// sink unwirable from here, so this file makes both halves mechanical rather
// than leaving them to a session log nobody re-reads.
//
// -----------------------------------------------------------------------------
// WHAT IS ASSERTED HERE AND WHAT IS ASSERTED SOMEWHERE ELSE
// -----------------------------------------------------------------------------
// `db.test.ts` ALREADY PINS THE BARE SPECIFIERS this deployable may import, to
// exactly `@merit/db`, `@merit/rules-engine` and `node:crypto`, so an
// `@merit/api` line in the manifest is caught there and is NOT re-asserted here.
// What that case cannot see is a RELATIVE specifier: `../../api/src/events.ts`
// is not a bare name, resolves with no manifest line at all, and is the exact
// move a wiring session under pressure reaches for. Section 3 closes that.
//
// The three ports' unwired defaults are asserted in `breaker.test.ts`,
// `detector-runner.test.ts` and `expiry.test.ts`, each beside the job it serves.
// This file asserts the SHAPE OF THE GAP ACROSS ALL THREE, which no per-job
// suite can see: how many call sites there are, which names they carry, and how
// many of those names the producer one deployable over would actually accept.
//
// -----------------------------------------------------------------------------
// THE FINDING SECTION 4 EXISTS FOR
// -----------------------------------------------------------------------------
// WIRING THE SINK WOULD NOT MAKE SEVEN CALL SITES WRITE. `buildEvent` refuses a
// name that is not a row in `EVENT_CATALOGUE`, on ADR-159 clause 1, and three of
// this deployable's seven names are not rows in it. A session that crossed the
// fence and declared the slice done would have wired the rest and broken those
// three, and nothing in either tree would have said so.
//
// THE COUNT HAS READ FOUR AND THEN FIVE, AND SECTION 4 IS WHY IT MOVED RATHER
// THAN DRIFTED. Each time the producer's catalogue grew, this case went red,
// which is what it was written to do: the split is DERIVED from the other
// deployable's file rather than named here, so the figures below are re-derived
// rather than adjusted. Nothing in `apps/worker/src` changed on either
// occasion and nothing here was widened. The two EVENTS rows this deployable's
// refusals were pointing at are `flag.raised` (`EVENTS:354`) and
// `detector.run_completed` (`EVENTS:358`); the first became a row in the
// producer when session 382 transcribed it, and the second when ADR-205 moved
// the document its payload declared no `_id` and no tenancy column in. SECTION
// 4b IS WHAT DID NOT MOVE: this deployable's own emit is a field short of the
// amended row, so the name is accepted and the emit would still be refused.
//
//   apps/api/src/events.ts               EVENT_CATALOGUE's keys, read as text
//   apps/worker/src/**                   the call sites and the specifiers
//
// Both are read rather than restated, which is `expiry.test.ts`'s idiom two
// files over and `packages/db`'s for binding `SqlExecutor` to `packages/queue`
// with no import in either direction.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { BREAKER_STATE_CHANGED } from '../src/breaker/ports.ts';
import type { DetectorEventName } from '../src/detectors/ports.ts';
import type { ExpiryEventName } from '../src/sweeps/ports.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', 'src');
const API_EVENTS_TS = resolve(HERE, '..', '..', 'api', 'src', 'events.ts');

/** Every `.ts` file under this deployable's `src`, by absolute path. */
function sources(dir: string = SRC): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found.sort();
}

const relToSrc = (path: string): string => relative(SRC, path).split('\\').join('/');

/**
 * The text with its comments removed.
 *
 * THE COMMENTS ARE WHERE THIS TREE'S FALSE POSITIVES LIVE. Every header in this
 * deployable discusses `apps/api` in prose and several quote a path, so a scan
 * over raw text would report an import from a paragraph explaining why there is
 * none. `db.test.ts` walked into the mirror image of this and reads a wrapped
 * sentence ending in the word "from" as an import (session 320); stripping
 * first is what stops both.
 */
function withoutComments(text: string): string {
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/[^\n]*/g, '');
}

// -----------------------------------------------------------------------------
// 1. The seven call sites, counted rather than carried
// -----------------------------------------------------------------------------
// THE COUNT IS DERIVED AT RUN TIME AND THE MAP IS WRITTEN OUT, which is the
// split ADR-034's remedy allows: the total is generated so it cannot drift, and
// the per-file expectation is a claim about WHERE the producers are, which is
// the thing a reader wants stated. A fourth file gaining an emit fails the map
// rather than passing silently under a total nobody read.

test('every `emit` in this workspace is in this deployable, and there are seven', () => {
  const byFile = new Map<string, number>();
  for (const path of sources()) {
    const hits = withoutComments(readFileSync(path, 'utf8')).match(/io\.events\.emit\(/g);
    if (hits !== null) byFile.set(relToSrc(path), hits.length);
  }

  expect(Object.fromEntries([...byFile].sort())).toEqual({
    'breaker/evaluate.ts': 1,
    'detectors/runner.ts': 3,
    'sweeps/expiry.ts': 3,
  });
  expect([...byFile.values()].reduce((a, b) => a + b, 0)).toBe(7);
});

// -----------------------------------------------------------------------------
// 2. The seven names, exhaustive at the type level
// -----------------------------------------------------------------------------
// THE RECORD IS KEYED BY THE UNION OF THE THREE PORTS' NAME TYPES, so a name
// added to any of them is a COMPILE ERROR here rather than a case that keeps
// passing over a list that got shorter than the system. That is the property a
// hand-written array cannot have, and it is why the list is a `Record` and not
// an array with a length assertion beside it.

type EmittedName = ExpiryEventName | DetectorEventName | typeof BREAKER_STATE_CHANGED;

/**
 * Each name, against the module that SPELLS IT as a literal.
 *
 * THAT IS NOT ALWAYS THE MODULE THE CALL SITE IS IN, and the one row where the
 * two differ is worth reading rather than smoothing away: the breaker declares
 * its name as `BREAKER_STATE_CHANGED` in its PORT file and `evaluate.ts` reaches
 * it by identifier, so section 1's emit-count map names `breaker/evaluate.ts`
 * and this one names `breaker/ports.ts`. Both are true and neither is the other.
 */
const EMITTED: Readonly<Record<EmittedName, string>> = {
  'payout.hold_released': 'sweeps/expiry.ts',
  'wallet.withdrawal_halt_released': 'sweeps/expiry.ts',
  'payout.freeze_expiring': 'sweeps/expiry.ts',
  'detector.run_completed': 'detectors/runner.ts',
  'detector.run_degraded': 'detectors/runner.ts',
  'flag.raised': 'detectors/runner.ts',
  'breaker.state_changed': 'breaker/ports.ts',
};

test('seven distinct names, and each is spelled as a literal in its own module', () => {
  const names = Object.keys(EMITTED);
  expect(new Set(names).size).toBe(7);

  for (const [name, module] of Object.entries(EMITTED)) {
    const text = withoutComments(readFileSync(join(SRC, module), 'utf8'));
    expect(text).toContain(`'${name}'`);
  }

  // THE BREAKER'S NAME IS BOUND BY VALUE AND NOT BY THE KEY ABOVE IT, so a
  // constant renamed in its port file cannot leave this record still claiming a
  // string the union no longer carries.
  expect(BREAKER_STATE_CHANGED).toBe('breaker.state_changed');
});

// -----------------------------------------------------------------------------
// 3. Nothing under `src` reaches out of this deployable
// -----------------------------------------------------------------------------

test('no relative specifier under src resolves outside apps/worker', () => {
  const escapes: string[] = [];
  for (const path of sources()) {
    const text = withoutComments(readFileSync(path, 'utf8'));
    for (const match of text.matchAll(/from\s+'(\.[^']*)'/g)) {
      const spec = match[1] ?? '';
      const target = resolve(dirname(path), spec);
      if (!target.startsWith(resolve(SRC, '..'))) escapes.push(`${relToSrc(path)} -> ${spec}`);
    }
  }
  expect(escapes).toEqual([]);
});

// -----------------------------------------------------------------------------
// 4. The producer's catalogue, read as text, holds five of the seven
// -----------------------------------------------------------------------------
// `RI-04` FORBIDS THE IMPORT, so the catalogue is parsed out of the file. THE
// PARSE IS ASSERTED BEFORE IT IS USED, because a parse that quietly returns
// nothing turns this case into a case that passes over an empty set: the
// catalogue's own docblock says it carries ten names and the count is checked
// against that sentence, so a reshape of that file fails loudly here rather
// than blinding the assertion below it.

function catalogueNames(): string[] {
  const text = readFileSync(API_EVENTS_TS, 'utf8');
  const start = text.indexOf('export const EVENT_CATALOGUE = {');
  expect(start).toBeGreaterThan(-1);
  const end = text.indexOf('\n} as const satisfies', start);
  expect(end).toBeGreaterThan(start);
  const block = text.slice(start, end);
  const names: string[] = [];
  for (const match of block.matchAll(/^ {2}'([a-z_]+(?:\.[a-z_]+)+)': \{$/gm)) {
    const name = match[1];
    if (name !== undefined) names.push(name);
  }
  return names;
}

test('the producer one deployable over would accept five of these seven names', () => {
  const catalogue = catalogueNames();
  // The parse, checked before anything rests on it.
  expect(catalogue).toHaveLength(10);
  expect(catalogue).toContain('payout.requested');

  const emitted = Object.keys(EMITTED);
  const accepted = emitted.filter((name) => catalogue.includes(name)).sort();
  const refused = emitted.filter((name) => !catalogue.includes(name)).sort();

  // `detector.run_completed` JOINED THIS LIST WHEN ADR-205 MOVED `EVENTS:358`
  // AND THE PRODUCER TRANSCRIBED IT, which is the blocker this file's previous
  // shape was written to notice lifting. `flag.raised` joined it one session
  // earlier off `EVENTS:354`.
  //
  // ACCEPTING A NAME IS NOT WRITING A ROW AND IT IS NOT EVEN AN EMIT THAT WOULD
  // SUCCEED. Nothing in this deployable can reach the producer at all (`RI-04`
  // plus `node-linker=isolated`), and for `detector.run_completed` there is a
  // SECOND thing in the way that this file can see: section 4b.
  expect(accepted).toEqual([
    'detector.run_completed',
    'flag.raised',
    'payout.freeze_expiring',
    'payout.hold_released',
    'wallet.withdrawal_halt_released',
  ]);

  // THE TWO THAT WOULD STILL THROW AT THE NAME, AND THEY ARE ONE KIND OF GAP.
  // Neither has a row in EVENTS at all: `detector.run_degraded`'s payload is
  // M07 section 5's and `breaker.state_changed`'s is M06's, both registered by
  // sessions 300 and 320. Each needs an amendment to a frozen document and an
  // ADR before any producer may carry it, and neither repair is inside this
  // deployable.
  expect(refused).toEqual(['breaker.state_changed', 'detector.run_degraded']);
});

// -----------------------------------------------------------------------------
// 4b. AND THE ONE THAT JUST BECAME ACCEPTABLE STILL COULD NOT BE EMITTED FROM
//     HERE, BECAUSE THIS DEPLOYABLE'S PAYLOAD IS ONE FIELD SHORT
// -----------------------------------------------------------------------------
// ADR-205 clause 1 added `detector_run_id` to `EVENTS:358` and the producer's
// `subjectField` reads it, so `buildEvent` would now accept the NAME and refuse
// at the SUBJECT. THE REFUSAL MOVED AND DID NOT LIFT, and a reader of the
// `accepted` list above must not read it as a write.
//
// THE VALUE IS ALREADY IN SCOPE AT THE CALL SITE, which is what makes this a
// one-line repair rather than a design question: `runner.ts` binds the run's id
// from `insertRun` and calls `emitRunEvents` inside that same closure. It is
// still a `src/` change in a deployable no fence holds today, so ADR-205
// section 7 registers it rather than taking it, and this case is the pin.

test('the runner emits detector.run_completed WITHOUT the subject the catalogue now names', () => {
  const text = withoutComments(readFileSync(join(SRC, 'detectors', 'runner.ts'), 'utf8'));
  const start = text.indexOf("name: 'detector.run_completed'");
  expect(start).toBeGreaterThan(-1);
  const payload = text.slice(start, text.indexOf('};', start));

  expect(payload).toContain('detector:');
  expect(payload).toContain('duration_ms:');
  // THE CLEARING CONDITION. The day `runner.ts` carries the field, this goes red
  // and the session holding that fence records that the emit would build.
  expect(payload).not.toContain('detector_run_id');
});

// -----------------------------------------------------------------------------
// 5. And one of the five ACCEPTED names is refused by tenancy, which is expected
// -----------------------------------------------------------------------------
// `payout.freeze_expiring`'s payload is `{ payout_request_id, flag_id,
// expires_at, lead_hours }` and names NEITHER tenancy column, so `assertTenanted`
// refuses it after `buildEvent` has accepted the name. That is ADR-191 section
// 9's registered open item reaching this deployable, and it is asserted here as
// a property of the PAYLOAD rather than repaired: widening anything to admit it
// would write a row that falls out of every scoped read of an append-only table.
//
// ADR-205 DID NOT LIFT THIS AND THAT IS THE POINT OF ITS SECTION 5.
// `detector.run_completed` reaches neither column either and is admitted, on a
// `**FIRM**` mark EVENTS carries for it and does NOT carry for this name. The
// two are indistinguishable by consumer -- neither has a `TL` -- and are
// decided differently, because this one is a fact about ONE TRADER whose
// producer holds a `payout_request_id` that names an account.

test('the freeze warning names neither tenancy column, which is why it is refused', () => {
  const text = withoutComments(readFileSync(join(SRC, 'sweeps', 'expiry.ts'), 'utf8'));
  const start = text.indexOf("name: 'payout.freeze_expiring'");
  expect(start).toBeGreaterThan(-1);
  const payload = text.slice(start, text.indexOf('};', start));

  expect(payload).toContain('payout_request_id');
  expect(payload).not.toContain('identity_id');
  expect(payload).not.toContain('account_id');
});
