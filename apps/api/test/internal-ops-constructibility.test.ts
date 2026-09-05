// =============================================================================
// apps/api/test/internal-ops-constructibility.test.ts
// =============================================================================
// FOUR METHODS UNDER ONE SENTENCE, AND THE SENTENCE WAS RIGHT ABOUT TWO OF THEM
// AND WRONG ABOUT THE OTHER TWO. ADR-242.
//
// `wiring.test.ts`'s `setInternalOpsSource` entry said the obstruction is "an
// ops plane rather than a database read", that three methods are "probes of
// other processes", that one "COMMANDS one", and that "None of the four is a
// shape `ApiDb` offers". A port with four methods got ONE reason, and a reason
// that covers four methods covers whichever of them it happens to fit.
//
//   `readReconStatus`  IS a database read, of state a process WROTE, into a
//                      registered table, and the exact filter it needs is
//                      already written in this deployable
//                      (`admin-source/liability.ts`). What refuses it is the
//                      DOOR and not the plane.
//   `runBatch`         IS a command, and `ApiDb` DOES offer the shape it needs:
//                      `firm(fn)` yields a `FirmTx`, `FirmTx` carries
//                      `sqlExecutor('job-enqueue')`, and that is structurally
//                      `packages/queue`'s `JobTransaction`. What refuses it is
//                      a manifest line, which is an authority and not a shape.
//
// THE RULE THIS FILE IS BUILT ON IS THE PROJECT'S OWN: "Prefer a new CI gate
// over a bigger model whenever the error is checkable" (`CLAUDE.md`). Every
// number below is DERIVED FROM SOURCE on each run, and every absence is
// EXECUTED rather than asserted in prose, on `ADR-235`'s rule that an absent
// producer reads as a satisfied specification and `ADR-240`'s application of it.
//
// -----------------------------------------------------------------------------
// WHAT IT DELIBERATELY DOES NOT DO, AND WHERE ITS FENCE IS
// -----------------------------------------------------------------------------
// IT DOES NOT REQUIRE THE PORT TO BE WIRED. `InternalOpsSource` is ONE port with
// four methods and its own docblock refuses a half-wiring: four setters "would
// buy the ability to half-wire the operator console, which is not an ability
// anybody has asked for". One constructible method out of four leaves the port
// blocked, which is `usePayoutBackend`'s rule and is the outcome here.
//
// IT READS NOTHING UNDER `apps/worker/**` AND NOTHING UNDER
// `packages/db/migrations/**`, and that is a fence rather than an oversight. The
// worker's entrypoint and the job store's schema were being built in a
// concurrent session, and an assertion here over either would go red on THEIR
// diff in a file they cannot edit. The workspace-wide counts that do reach both
// are DERIVED AND RECORDED in `docs/reviews/2026-08-29-internal-ops-plane.md`
// rather than executed here. What this file asserts is what `apps/api` itself
// can reach, which is the question the port actually asks.
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { SCOPE_RULES } from '@merit/db';
import type { FirmTx } from '@merit/db';

import {
  DEEP_HEALTH_DEPENDENCIES,
  InternalOpsError,
  renderDeepHealth,
  renderJobs,
} from '../src/routes/internal.ts';
import type { DependencyCheck } from '../src/routes/internal.ts';

const HERE = import.meta.dirname;
const APP = join(HERE, '..');
const REPO = join(HERE, '..', '..', '..');

function read(...parts: readonly string[]): string {
  return readFileSync(join(REPO, ...parts), 'utf8');
}

// -----------------------------------------------------------------------------
// 1. The four methods, read off the port rather than listed here
// -----------------------------------------------------------------------------

/**
 * The port's method names, out of its own interface body.
 *
 * `admin-read-constructibility.test.ts`'s idiom, for its reason: a fifth method
 * added to `InternalOpsSource` arrives on this array without anybody
 * remembering to add it, and the partition below then has a member nothing
 * rules.
 */
function portMethods(): readonly string[] {
  const source = read('apps', 'api', 'src', 'routes', 'internal.ts');
  const start = source.indexOf('export interface InternalOpsSource {');
  expect(start, '`InternalOpsSource` is not declared where this file looks for it').toBeGreaterThan(
    -1,
  );
  const body = source.slice(start, source.indexOf('\n}\n', start));
  return [...body.matchAll(/^ {2}([a-zA-Z]+)\(/gm)].map((match) => match[1] ?? '').sort();
}

/**
 * The ruling, one row per method. ADR-242 section 2.
 *
 * A METHOD MISSING FROM HERE IS A FAILURE AND SO IS ONE THAT IS ONLY HERE. The
 * two directions are asserted separately below, because a partition that only
 * checks one of them is a list that silently stops covering the port.
 */
const RULED: Readonly<Record<string, 'read' | 'command'>> = {
  readDependencies: 'command',
  readJobs: 'command',
  readReconStatus: 'read',
  runBatch: 'command',
};

test('every method of the port is ruled read or command, in both directions', () => {
  expect(portMethods()).toStrictEqual(Object.keys(RULED).sort());
});

test('exactly one of the four is a database read, which is why the port stays blocked', () => {
  // THE COUNT IS THE WHOLE VERDICT. A port whose methods split one-to-three
  // cannot be wired without three arms that reject, and `usePayoutBackend`'s
  // rule refuses exactly that. The day this count moves, the port's entry is
  // owed a fresh reading rather than a smaller sentence.
  const reads = Object.values(RULED).filter((verdict) => verdict === 'read');
  expect(reads).toHaveLength(1);
  expect(RULED['readReconStatus']).toBe('read');
});

// -----------------------------------------------------------------------------
// 2. `readDependencies`: three of the four dependencies are other processes, and
//    no partial adapter can render a response at all
// -----------------------------------------------------------------------------

/** A well-formed probe result for one dependency. Only the name varies below. */
function probe(name: DependencyCheck['name']): DependencyCheck {
  return { name, status: 'ok', checked_at: '2026-08-29T06:00:00Z', detail: null };
}

test('a deep-health answer covering only the dependency this process holds is refused', () => {
  // THE DECISIVE FACT ABOUT THIS METHOD, AND IT IS BEHAVIOURAL RATHER THAN
  // ARGUED. `db` is the one of the four that this deployable could probe from
  // inside itself: it holds a pool. The other three are an SFTP server, Rise
  // and a PSP, none of which is in this process. `renderDeepHealth` refuses a
  // short answer by ruling ("a missing probe is not a passing one"), so there
  // is no adapter that probes what it can reach and omits what it cannot.
  expect(() => renderDeepHealth([probe('db')])).toThrow(InternalOpsError);
  expect(() => renderDeepHealth([probe('db')])).toThrow(/sftp/);
});

test('every one of the four dependencies is required, one at a time', () => {
  // ASSERTED OVER THE ARRAY RATHER THAN OVER THE ONE CASE ABOVE, so a fifth
  // dependency added to `DEEP_HEALTH_DEPENDENCIES` is covered without an edit.
  for (const omitted of DEEP_HEALTH_DEPENDENCIES) {
    const short = DEEP_HEALTH_DEPENDENCIES.filter((name) => name !== omitted).map(probe);
    expect(() => renderDeepHealth(short), `omitting \`${omitted}\` was accepted`).toThrow(
      new RegExp(omitted),
    );
  }
});

/**
 * Every shipped `.ts` under `apps/api/src`, which is the deployable this port is
 * declared in.
 *
 * `test/` IS OUTSIDE DELIBERATELY, on `certificate-links.test.ts`'s rule: a
 * fixture naming a vendor is a suite describing a shape, and the claim here is
 * about what a DEPLOYMENT can reach.
 */
function apiSources(): readonly string[] {
  const walk = (dir: string): readonly string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return walk(path);
      return entry.endsWith('.ts') ? [path] : [];
    });
  return walk(join(APP, 'src'));
}

/** The files under `apps/api/src` that reach the network outbound. */
function outboundCallers(): readonly string[] {
  return apiSources()
    .filter((path) => readFileSync(path, 'utf8').includes('globalThis.fetch'))
    .map((path) =>
      path
        .slice(APP.length + 1)
        .split('\\')
        .join('/'),
    )
    .sort();
}

test('the sweep reaches source, so an empty answer is not an empty search', () => {
  // THE PREMISE OF THE COUNT BELOW, ASSERTED FIRST. A walk that silently reached
  // nothing would report "no vendor probe" for a tree full of them.
  expect(apiSources().length).toBeGreaterThan(30);
  expect(outboundCallers().length).toBeGreaterThan(0);
});

test('this deployable holds two outbound clients and neither is SFTP, Rise or a PSP', () => {
  // THE ABSENCE, EXECUTED. `readDependencies` needs three probes of three
  // vendors. `apps/api/src` reaches the network in exactly these files, and they
  // are a CAPTCHA verifier and an OTP delivery vendor. The day a probe client
  // for any of the three lands, this case names the new file and the entry
  // expires rather than waiting to be noticed.
  expect(outboundCallers()).toStrictEqual(['src/otp-delivery.ts', 'src/turnstile.ts']);
});

// -----------------------------------------------------------------------------
// 3. `readJobs`: the job store has no reader, and the switch half is not rows
// -----------------------------------------------------------------------------

/** `JOB_QUEUE_METHODS`, read out of `packages/queue` as text. */
function jobQueueMethods(): readonly string[] {
  // READ AS TEXT AND NOT IMPORTED, BECAUSE THE IMPORT IS THE THING BEING
  // MEASURED. `apps/api` declares no `@merit/queue` (case 5 below), and
  // `.npmrc`'s `node-linker=isolated` makes an undeclared import unresolvable,
  // so a test that imported it would be asserting against a resolution this
  // deployable does not have. `packages/db/test/write-accessor.test.ts` reads
  // the other package the same way and for the same reason.
  const source = read('packages', 'queue', 'src', 'job-queue.ts');
  const start = source.indexOf('export const JOB_QUEUE_METHODS = [');
  expect(start, '`JOB_QUEUE_METHODS` is not declared where this file looks').toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf(']', start));
  return [...body.matchAll(/'([a-zA-Z]+)'/g)].map((match) => match[1] ?? '').sort();
}

test('the only interface onto the job store cannot answer a queue depth', () => {
  // `JobsResponse.queues` CARRIES A DEPTH AND A FAILURE COUNT, and `JobQueue` is
  // the one interface in this workspace that reaches the job store. Its five
  // methods declare a queue, enqueue, consume, start and stop. NONE OF THEM
  // READS A DEPTH, so `readJobs`' first field has no producer at any authority,
  // and the day a sixth method lands this case says so.
  expect(jobQueueMethods()).toStrictEqual(['consume', 'declareQueue', 'enqueue', 'start', 'stop']);
});

test('a jobs answer with no dead-man switch is refused, so a queues-only adapter cannot render', () => {
  // THE SAME SHAPE AS THE DEEP-HEALTH REFUSAL ABOVE AND FOR THE SAME REASON.
  // CRON_INVENTORY: "a job in this table without a dead-man switch is a job that
  // does not exist". An empty list says nothing is firing where the true
  // statement is that nothing is being watched, so an adapter that could answer
  // the queue half alone still cannot render this response.
  expect(() => renderJobs({ queues: [], deadManSwitches: [] })).toThrow(InternalOpsError);
  expect(() => renderJobs({ queues: [], deadManSwitches: [] })).toThrow(/nothing is being watched/);
});

test("the switch's expected-by time is a document cell and this repository holds the document", () => {
  // `DeadManSwitch.expected_by` IS "CRON_INVENTORY's 'Expected by' cell,
  // verbatim", by its own docblock. That register is MARKDOWN: its rows are
  // times like `06:00 CT` in a table, not rows of any relation, and no migration
  // in this schema holds one. The count is derived so that a register that grows
  // or shrinks is visible here rather than in a sentence.
  const inventory = read('docs', 'ops', 'runbooks', 'CRON_INVENTORY.md');
  const scheduled = [...inventory.matchAll(/^\| \*\*[^|]+\| [^|]+\| [^|]+\| [^|]+\| /gm)];
  expect(scheduled.length).toBeGreaterThan(15);
  expect(inventory).toContain('06:00 CT');
});

// -----------------------------------------------------------------------------
// 4. `readReconStatus`: a database read, refused by a door and not by a plane
// -----------------------------------------------------------------------------

test('the table this method reads is registered, and its class is what refuses the door', () => {
  // THE WHOLE OF THIS METHOD'S RULING, IN THE REGISTRY. `reconciliations` is a
  // real table this schema declares, it is registered, and it is `derived`
  // through `accounts` rather than `firm`. So `ApiDb.firm` refuses the key AT
  // COMPILE TIME (`FirmTableKey` excludes every `derived` table) and
  // `ApiDb.scoped` needs an identity the operator surface does not have. The
  // handle that serves it is `SystemTx` at `systemDb('operator-console')`, and
  // ADR-171 clause 1 refuses that door until an `AdminSessionSource` a
  // deployment can install exists. THAT IS A DOOR, NOT AN OPS PLANE.
  expect(SCOPE_RULES['reconciliations']?.class).toBe('derived');
});

test('a firm handle cannot name the table, and the refusal is the compiler', () => {
  const refuse = (tx: FirmTx): Promise<unknown[]> =>
    // @ts-expect-error ADR-242: `reconciliations` is scope class `derived`, so
    // it is not a `FirmTableKey` and `FirmTx.rowsWhere` will not take it. `tsc`
    // reports an UNUSED `@ts-expect-error` as an error of its own, so the day
    // this table is reclassified `firm` this line fails to compile in the other
    // direction and the ruling above is re-opened rather than silently wrong.
    tx.rowsWhere('reconciliations', { status: 'mismatch' });
  expect(typeof refuse).toBe('function');
});

test('the read this method needs is already written in this deployable', () => {
  // THE EVIDENCE THAT THE MISSING THING IS NOT A SHAPE. `admin-source/liability.ts`
  // folds open mismatches out of the same table with the same filter, over a
  // handle narrowed AT THE PORT rather than at the door, which is the narrowing
  // ADR-171 section 5 ruled belongs there. `readReconStatus` is that read plus a
  // clock, and the clock is the port's (`ReconSnapshot.asOf`).
  const liability = read('apps', 'api', 'src', 'admin-source', 'liability.ts');
  expect(liability).toContain("rowsWhere('reconciliations', { status: 'mismatch' })");
});

// -----------------------------------------------------------------------------
// 5. `runBatch`: `ApiDb` offers the shape, and what is missing is an authority
// -----------------------------------------------------------------------------

/** The single member `packages/queue` requires of a transaction handle. */
function jobTransactionMembers(): readonly string[] {
  const source = read('packages', 'queue', 'src', 'job-queue.ts');
  const start = source.indexOf('export interface JobTransaction {');
  expect(start, '`JobTransaction` is not declared where this file looks').toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf('\n}', start));
  return [...body.matchAll(/^ {2}([a-zA-Z]+)\(/gm)].map((match) => match[1] ?? '').sort();
}

test('the handle apps/api already holds satisfies the queue transaction structurally', () => {
  // THE CORRECTION TO THE ENTRY, AND IT IS A COMPILE-TIME FACT WITH A RUNTIME
  // WITNESS. `ApiDb.firm(fn)` hands its callback a `FirmTx`; `FirmTx` extends
  // `TxCommon`, which carries `sqlExecutor(reason)` at
  // `TransactionSqlExecutorReason`, which is `'job-enqueue'` and nothing else
  // (ADR-332 partitioned the vocabulary rather than widening this method's
  // reach); and the `SqlExecutor` it returns declares
  // exactly `executeSql`, which is the whole of `JobTransaction`. So "None of
  // the four is a shape `ApiDb` offers" is FALSE of this method: the shape is
  // there today and the capability is not.
  const takesTheTransaction = (tx: FirmTx): { executeSql: unknown } =>
    tx.sqlExecutor('job-enqueue');
  expect(typeof takesTheTransaction).toBe('function');
  expect(jobTransactionMembers()).toStrictEqual(['executeSql']);
});

test('apps/api declares no queue dependency, which is where this method is actually blocked', () => {
  // THE MANIFEST IS "THE ONLY PLACE THE CAPABILITY CAN BE ACQUIRED" (ADR-117
  // section 5, measured from this very package), and `.npmrc`'s
  // `node-linker=isolated` makes an undeclared import type-check and then fail
  // at run time. So this line is the blocker rather than a formality, and it is
  // an AUTHORITY: admitting `@merit/queue` to the deployable that serves the
  // whole public surface is a ruling in the shape ADR-120 gave the database
  // admission. The day it lands, this case names it.
  const manifest = JSON.parse(read('apps', 'api', 'package.json')) as {
    dependencies?: Record<string, string>;
  };
  expect(Object.keys(manifest.dependencies ?? {})).not.toContain('@merit/queue');
});
