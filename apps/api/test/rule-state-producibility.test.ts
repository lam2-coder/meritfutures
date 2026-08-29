// =============================================================================
// apps/api/test/rule-state-producibility.test.ts
// =============================================================================
// WHY THE PAYOUT PORT CANNOT BE WIRED IN THIS DEPLOYMENT, AS PREDICATES RATHER
// THAN AS SENTENCES IN A REFUSAL MESSAGE.
//
// `usePayoutBackend`'s entry in `wiring.test.ts` is down to one clause and the
// clause is "a `RuleState` THIS DEPLOYMENT CANNOT PRODUCE". Session 429 asked
// what stands under it and found FOUR links, of which the first had never been
// named on this port or on `GET /accounts/:id/eligibility`: NOTHING RUNS THE
// JOB. The other three are the ones the two reasons already carry.
//
// **ADR-241 CLOSED THE FIRST AND MOVED THE SECOND, AND ADR-245 ADDED A FIFTH
// THAT IS NOT UNDER THE `RuleState` AT ALL.** `PayoutSubject` carries `state`,
// `plan` AND `gates`; links 1 to 4 are the first field and ADR-233 discharged
// the second, so the third had gone eleven entries without a clause. It is
// section 5 below, and it did not move when the worker landed because nothing
// the worker landed touches it.
//
// THE FILE EXISTS BECAUSE OF THE DEFECT SESSION 426 NAMED: a comment cannot
// fail. Every clause below was true when somebody wrote it, and the one that
// went false went false quietly, in another fence, and propagated to four
// readers. A predicate that runs on every `CI-01` pass expires; a sentence does
// not.
//
// IT LIVES IN `apps/api/test/` AND SWEEPS `apps/worker/src/`, WHICH IS
// `account-reads.test.ts`'s OWN PRECEDENT AND NOT A FENCE WIDENED TO FINISH.
// That file's five eligibility-blocker cases read the migration corpus, the
// worker's writer and the engine's types from the API's suite, for the reason
// stated there: a clause whose comparator lives in another package is a clause
// this file cannot keep true. `INV-M5-02` (`M05:81`) makes it one blocker
// across two endpoints, so the comparator belongs beside both reasons.
// =============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

/** Every `.ts` file under a deployable's or a package's `src/`. */
function deployableSources(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.ts')) found.push(path);
    }
  };
  for (const group of ['apps', 'packages'])
    for (const unit of readdirSync(join(REPO_ROOT, group))) {
      const src = join(REPO_ROOT, group, unit, 'src');
      try {
        if (statSync(src).isDirectory()) walk(src);
      } catch {
        // A workspace member with no `src/` is not a finding.
      }
    }
  return found;
}

/**
 * The file with its comment lines removed.
 *
 * `account-reads.test.ts`'s idiom and its reason: the modules swept here QUOTE
 * the things they refuse, so a sweep over the prose would be red on the sentence
 * that explains why it is green. This file is its own worst case, and section 4
 * below is where that bites.
 */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
    .join('\n');
}

const rel = (path: string): string => path.slice(REPO_ROOT.length + 1);

/**
 * `usePayoutBackend`'s reason, sliced out of the map rather than regexed.
 *
 * A LAZY MATCH WITH `$` UNDER THE `m` FLAG ENDS AT THE FIRST NEWLINE, which is
 * session 426's landmine on this exact map and which returned one-line reasons
 * for a whole session. The entry is a run of concatenated string literals ending
 * at the next divider comment, so two `indexOf` calls read it exactly and no
 * regex reads it at all.
 */
function payoutReason(): string {
  const source = readFileSync(join(REPO_ROOT, 'apps/api/test/wiring.test.ts'), 'utf8');
  const start = source.indexOf('\n  usePayoutBackend:');
  expect(start, 'the BLOCKED map no longer carries a `usePayoutBackend` entry').toBeGreaterThan(0);
  const rest = source.slice(start + 1);
  const end = rest.indexOf('\n  // ---');
  expect(end, 'the entry is not followed by a divider, so its extent is unknown').toBeGreaterThan(
    0,
  );
  return rest.slice(0, end);
}

describe('link 1: CLOSED. The worker deployable runs its job and fails loudly when it cannot', () => {
  test("the worker's entrypoint CALLS `main`, and so does the API's", () => {
    // **THIS BLOCK ASSERTED THE DEFECT UNTIL ADR-241 AND NOW ASSERTS THE
    // REPAIR.** It read "the worker's entrypoint DECLARES `main` and never calls
    // it": `apps/worker/package.json` started the deployable on the barrel,
    // which is this package's `exports` target, so the process loaded 1,277
    // lines of exports, bound nothing, scheduled nothing and exited 0. Both
    // deployables now start the same way, at `node --experimental-strip-types`
    // on a `start.ts` whose last statement is a top-level call.
    //
    // THE COMPARATOR IS STILL THE POINT AND NOT DECORATION. An assertion about
    // one entrypoint passes just as well when the sweep reads the wrong file;
    // asserting BOTH with the identical predicate on the identical shape makes
    // the sweep prove it can see a call and see its absence.
    const manifest = (app: string): { readonly scripts: Record<string, string> } =>
      JSON.parse(readFileSync(join(REPO_ROOT, 'apps', app, 'package.json'), 'utf8')) as {
        readonly scripts: Record<string, string>;
      };

    for (const app of ['worker', 'api'])
      expect(manifest(app).scripts['start']).toBe('node --experimental-strip-types src/start.ts');

    const workerEntry = codeOf(join(REPO_ROOT, 'apps/worker/src/start.ts'));
    const apiEntry = codeOf(join(REPO_ROOT, 'apps/api/src/start.ts'));

    expect(apiEntry).toContain('\nawait main();');
    expect(workerEntry).toContain('\nawait main()');

    // AND THE BARREL STILL DOES NOT CALL IT, which is the half that must not be
    // lost in the repair: `index.ts` is the package's `exports` target and
    // importing it must have no effect.
    const workerBarrel = codeOf(join(REPO_ROOT, 'apps/worker/src/index.ts'));
    expect(workerBarrel).not.toContain('\nawait main()');
    expect(workerBarrel).not.toContain('\nmain();');
  });

  test('a deployable calls the batch now, and a failed batch leaves a NON-ZERO status', () => {
    // `runNightlyBatch` is `writeRuleStateVia`'s only caller and the writer is
    // the only site in the tree that inserts a `rule_states` row. THIS TEST READ
    // "nothing under any `src/` calls the batch, so no deployment ever folds a
    // day" and counted THREE namers: the module declaring it, the barrel
    // exporting it, and the API reason that names it inside a string literal.
    // The fourth is the one it said would be "a scheduler or an adapter".
    const namers = deployableSources()
      .filter((path) => codeOf(path).includes('runNightlyBatch'))
      .map(rel)
      .sort();
    expect(namers).toEqual([
      'apps/api/src/routes/account-reads.ts',
      'apps/worker/src/batch/nightly.ts',
      'apps/worker/src/index.ts',
      'apps/worker/src/job.ts',
    ]);

    // **AND NOTHING BETWEEN THE FOLD AND THE PROCESS SWALLOWS A FAILURE**, which
    // is the property that makes the repair worth anything: a job that ran and
    // failed silently is the exit-0 defect in a new costume. The status itself
    // is asserted where a process can be watched leaving one,
    // `apps/worker/test/entrypoint.test.ts`; what is asserted here is that no
    // `catch` was added to the path between them afterwards.
    for (const path of ['apps/worker/src/start.ts', 'apps/worker/src/job.ts'])
      expect(
        codeOf(join(REPO_ROOT, path)),
        `${path} catches the failure the exit code is`,
      ).not.toMatch(/\bcatch\b/);
  });
});

describe('link 2: a `BatchPorts` value IS constructed under `src/`, and it serves four of ten', () => {
  test('the adapter is the one constructor, and it refuses six methods by name', () => {
    // **THIS BLOCK WAS NAMED "no `BatchPorts` value is constructed under any
    // `src/`" AND ADR-241 MADE THAT FALSE.** The batch takes its I/O as an
    // argument and, until session 431, every satisfier was a test double or
    // `scripts/demo/world.ts`. `postgresBatchPorts` is the first one over a
    // database.
    //
    // THE NEEDLE MOVED WITH THE FACT AND IS NAMED HERE RATHER THAN IN A
    // COMMENT. The old sweep matched `': BatchPorts = '`, which finds a value
    // ASSIGNED TO AN ANNOTATED CONST and does not find one RETURNED FROM AN
    // ANNOTATED FUNCTION. Both spellings are swept below, so a second
    // constructor in either shape is a named failure rather than a silent one.
    const constructors = deployableSources()
      .filter(
        (path) =>
          codeOf(path).includes(': BatchPorts = ') || codeOf(path).includes('): BatchPorts {'),
      )
      .map(rel)
      .sort();
    expect(constructors).toEqual(['apps/worker/src/batch/adapter.ts']);

    // NON-VACUITY IS THE SECOND HALF AND IT IS WHY THE SWEEP RUNS TWICE. A
    // census is worth nothing until the same predicate is shown finding the four
    // values that live outside `src/`, none of which opens a connection.
    const elsewhere = [
      'apps/worker/test/replay.test.ts',
      'apps/worker/test/nightly-batch.test.ts',
      'scripts/demo/world.ts',
    ];
    for (const path of elsewhere)
      expect(
        readFileSync(join(REPO_ROOT, path), 'utf8'),
        `the sweep's needle no longer matches ${path}`,
      ).toContain(': BatchPorts = ');
  });

  test('and the six refusals each carry a blocker, so a red batch names what to build', () => {
    // A PORT THAT RETURNED A PLAUSIBLE VALUE WOULD BE WORSE THAN ONE THAT
    // REFUSES, because `runNightlyBatch` counts a `written` outcome per account
    // that did not throw. Each refusal below is a `BatchPortUnwired` naming the
    // method, and the message carries the slice that clears it.
    const adapter = codeOf(join(REPO_ROOT, 'apps/worker/src/batch/adapter.ts'));
    for (const port of ['loadAccountDay', 'accountDaysFrom', 'storedRuleStates'])
      expect(adapter, `${port} no longer refuses by name`).toContain(
        `new BatchPortUnwired('${port}'`,
      );
    for (const port of ['raiseReconciliation', 'raiseDivergence'])
      expect(adapter, `${port} no longer refuses by name`).toContain(
        `new BatchPortUnwired('${port}'`,
      );

    // AND THE WRITE PORT IS COMPOSED ON THE UNWIRED ENCODER, which is link 3's
    // subject seen from the adapter: the door is real and the codec is not, and
    // the two arrive on one `RuleStateWriterIo` so that a deployment installs
    // both or neither.
    expect(adapter).toContain('UNWIRED_RULE_STATE_WRITER_IO.encodeEngineGates');
  });
});

describe('link 3: the `engine_gates` encoding is RULED and is UNIMPLEMENTED, and those are different', () => {
  test('a primary source declares the stored shape, so the writer is a codec and not a ruling', () => {
    // THE NARROWING THIS SESSION LANDED, AND IT MOVES A BLOCKER FROM "NOBODY HAS
    // DECIDED" TO "NOBODY HAS TYPED IT". `state-writer.ts` said the stored
    // encoding was "a corpus amendment rather than a line of code", which was
    // true the day it was written. ADR-206 ruled it and the design record
    // reproduces it in full, so the amendment EXISTS and what is owed is a
    // module.
    const record = readFileSync(
      join(REPO_ROOT, 'docs/architecture/data-model/rule_states.md'),
      'utf8',
    );
    expect(record).toContain('ADR-206');
    expect(record).toContain('six gate groups, twenty-five leaves');
    expect(record).toContain('every cents leaf a base-10 string');
  });

  test('and no implementation of it ships, so a wired adapter would still refuse by name', () => {
    // The only `RuleStateWriterIo` value under `src/` is the unwired default,
    // and it THROWS rather than returning, because a writer that silently did
    // nothing produces a report saying 5,000 rows were written on a night the
    // book gained none.
    const declarations = deployableSources().flatMap((path) =>
      [...codeOf(path).matchAll(/export const (\w+): RuleStateWriterIo =/g)].map(
        (match) => match[1] ?? '',
      ),
    );
    expect(declarations).toEqual(['UNWIRED_RULE_STATE_WRITER_IO']);
    expect(codeOf(join(REPO_ROOT, 'apps/worker/src/batch/state-writer.ts'))).toContain(
      'throw new RuleStateWriterUnwired',
    );
  });
});

describe("link 4: the payout port's reason carries the chain, and carries no retired clause", () => {
  test('the entry leads with the missing job rather than with the decoding', () => {
    // A REASON THAT NAMES THE SECOND-CHEAPEST BLOCKER RETIRES THE QUESTION for
    // every reader after it, which is `wiring.test.ts`'s own finding about this
    // very entry, twice. The first link is the one a session dispatched to
    // remove the blocker walks into last.
    const reason = payoutReason();
    // THE LEAD CLAUSE MOVED WHEN THE LINK UNDER IT CLOSED, and this assertion
    // moved with it rather than being deleted. The entry read "NOTHING SCHEDULES
    // THE JOB" and "exits 0"; ADR-241 made both false, and an entry still
    // leading with them would send the next session to repair a link that is
    // already repaired.
    expect(reason).not.toContain('NOTHING SCHEDULES THE JOB');
    expect(reason).toContain('THE JOB NOW RUNS');
    expect(reason).toContain('NON-ZERO exit status');
    expect(reason).toContain('BatchPorts');
    expect(reason).toContain('encodeEngineGates');

    // AND IT NAMES THE THIRD FIELD NOW, which is section 5's subject seen from
    // the entry. Asserted here rather than only there because the finding that
    // matters is not that `gates` has no producer; it is that the REASON did not
    // say so, and a clause deleted from the entry has to fail somewhere.
    expect(reason).toContain('ExternalGates');
    expect(reason).toContain('provisioning_pending');
  });

  test('and it no longer says the stored encoding is undeclared, because ADR-206 declared it', () => {
    // THE CLAUSE THIS SESSION RETIRED, ASSERTED AS ABSENT. It read that writing
    // a decoding "WOULD BE INVENTING A CORPUS FACT". That was true until
    // ADR-206; leaving it standing would cost the next session the same day
    // this one spent finding out that it had not.
    //
    // THE NEEDLE IS ASSEMBLED RATHER THAN WRITTEN OUT, which is session 424's
    // landmine met on a different map: this file is swept by nothing, but the
    // entry it reads is one file over and a future sweep that joined them would
    // match this line. Assembling it also keeps the retired sentence out of the
    // repository's own grep results, where it reads as live.
    const retired = 'INVENTING A ' + 'CORPUS FACT';
    expect(payoutReason()).not.toContain(retired);
  });
});

describe('link 5: `PayoutSubject` has a THIRD field and no reason on this port had ever named it', () => {
  // `PayoutSubject` is `accountId`, `state`, `plan` and `gates`
  // (`apps/api/src/routes/payouts.ts`). Every clause this entry has ever carried
  // was about `state` or about `plan`: ADR-233 discharged the `ResolvedPlan`
  // half with `catalogRows`, and links 1 to 4 above are the `RuleState` half.
  // **`gates` HAS BEEN THE THIRD FIELD THE WHOLE TIME AND NOTHING NAMED IT**,
  // which is `wiring.test.ts`'s own finding about this very entry, for the third
  // time: a reason that names the second-cheapest blocker retires the question
  // for every reader after it.
  //
  // AND IT IS NOT DOWNSTREAM OF THE WORKER. Links 1 and 2 moved when ADR-241
  // landed; this one did not move, because nothing ADR-241 built touches it. A
  // session that lands the codec and the adapter and reads this entry would
  // arrive at `subject()` with a `RuleState` in hand and still have no third
  // argument for it.

  test('no `ExternalGates` value is resolved from a row anywhere under a `src/`', () => {
    // THE NEEDLE IS THE OBJECT KEY AND NOT THE TYPE NAME, because a file that
    // NAMES `ExternalGates` is usually declaring a parameter, which is the
    // opposite of producing one: seven files name it in code and five of those
    // are the engine declaring, re-exporting or consuming the type. A literal
    // must carry every member, so `hasPayoutInFlight:` finds the construction
    // and the annotation does not.
    const producers = deployableSources()
      .filter((path) => codeOf(path).includes('hasPayoutInFlight:'))
      .map(rel)
      .sort();

    // NEITHER OF THESE TWO READS A DATABASE AND THAT IS WHY THE COUNT IS NOT THE
    // ANSWER. `types.ts` DECLARES the field, which is the interface itself.
    // `trial.ts` RAISES one member on a value its own caller handed it
    // (`...context`), inside a Monte Carlo loop in a package whose manifest
    // declares the engine and the simulator and no database at all. So the
    // estate has no function that turns `accounts`, `identities` and
    // `payout_requests` into this record, on either deployable's door.
    expect(producers).toEqual([
      'packages/harness/src/trial.ts',
      'packages/rules-engine/src/types.ts',
    ]);

    // NON-VACUITY, on link 2's own precedent: the identical predicate is shown
    // finding the values that DO exist, all of them fixtures and none of them
    // reachable from a deployment.
    for (const path of [
      'apps/api/test/payouts.test.ts',
      'apps/worker/test/fixtures.ts',
      'packages/harness/test/canonical.ts',
      'packages/rules-engine/test/rules-f-context.test.ts',
      'scripts/demo/fold.ts',
    ])
      expect(
        readFileSync(join(REPO_ROOT, path), 'utf8'),
        `the sweep's needle no longer matches ${path}`,
      ).toContain('hasPayoutInFlight:');
  });

  test('and `accountStatus` cannot be a total map of `accounts.status`, by one member', () => {
    // **THE DATABASE DECLARES SEVEN AND THE ENGINE TAKES SIX.** Both sides are
    // derived here rather than typed out, so the day either one moves this case
    // names the difference instead of going quietly stale.
    //
    // THE ENGINE IS FAITHFUL AND THE GAP IS THE CORPUS'S. `M01` section 2.1
    // carries the same six, so `types.ts` transcribed its source correctly and
    // the missing member was never dropped here.
    const ddl = readFileSync(
      join(REPO_ROOT, 'packages/db/migrations/0001_extensions_and_enums.sql'),
      'utf8',
    );
    const declared = ddl.slice(ddl.indexOf('CREATE TYPE account_status AS ENUM ('));
    const stored = [...declared.slice(0, declared.indexOf(');')).matchAll(/'(\w+)'/g)].map(
      (match) => match[1] ?? '',
    );

    const types = codeOf(join(REPO_ROOT, 'packages/rules-engine/src/types.ts'));
    const union = types.slice(types.indexOf('export type AccountStatus ='));
    const accepted = [...union.slice(0, union.indexOf(';')).matchAll(/'(\w+)'/g)].map(
      (match) => match[1] ?? '',
    );

    expect(stored).toHaveLength(7);
    expect(accepted).toHaveLength(6);
    expect(stored.filter((member) => !accepted.includes(member))).toEqual(['provisioning_pending']);
    expect(accepted.filter((member) => !stored.includes(member))).toEqual([]);

    // SO THE RESOLVER OWES A REFUSAL RATHER THAN A GUESS, and the precedent is
    // one file over: `IdentityStatus` in `routes/payouts.ts` is read against
    // `= 'active'` "precisely so that a fourth arriving later fails CLOSED on
    // this door rather than open". A resolver that widened the engine's union to
    // admit the seventh would be a route deciding what a provisioning account is
    // worth to the rules.
  });
});
