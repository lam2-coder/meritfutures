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
// **AND ADR-285 INVERTED A LINK RATHER THAN ADDING ONE, WHICH IS THE FIRST TIME
// A CHECK IN THIS FILE HAS CHANGED DIRECTION.** Link 7's last-but-two case
// required that `routes/payouts.ts` contain no `RuleStateAbsent` AT ALL, because
// the absence of a refusal path was the finding. The path exists now, so the
// same case asserts its PRESENCE, asserts that `RuleStateUnreadable` is still
// NOT caught, and asserts that no arm of that route builds a `RuleState`. A
// check deleted when its finding closes is a property nothing holds afterwards.
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

import {
  CapScheduleCodecError,
  decodeCapScheduleCents,
  decodePlanRules,
  PlanRulesCodecError,
} from '@merit/rules-engine';

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
    //
    // **THERE ARE FIVE NAMERS NOW AND THE FIFTH IS THE SECOND STRING LITERAL**,
    // which is worth keeping in the list rather than filtering out: this sweep
    // counts files that NAME the batch and the two `apps/api` entries are both
    // reasons rather than callers. `admin-source/eligible-next-7d.ts` names it
    // in the `awaiting` field of its `no_folded_state` refusal, because what an
    // operator reading that refusal has to do is get this batch run.
    expect(namers).toEqual([
      'apps/api/src/admin-source/eligible-next-7d.ts',
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

  test('and the FOUR refusals left each carry a blocker, so a red batch names what to build', () => {
    // A PORT THAT RETURNED A PLAUSIBLE VALUE WOULD BE WORSE THAN ONE THAT
    // REFUSES, because `runNightlyBatch` counts a `written` outcome per account
    // that did not throw. Each refusal below is a `BatchPortUnwired` naming the
    // method, and the message carries the slice that clears it.
    //
    // **THE COUNT WAS FIVE AND `loadAccountDay` HAS LEFT IT.** This case named
    // that port among the refusals and went RED on ADR-260 without being seeded,
    // which is what a census is for. It is asserted in the other direction
    // rather than deleted: the port is named as one that must NOT refuse, so an
    // unwired arm restored to it is a named failure and not a silent return to
    // where this file started.
    const adapter = codeOf(join(REPO_ROOT, 'apps/worker/src/batch/adapter.ts'));
    expect(adapter, 'loadAccountDay refuses again').not.toContain(
      "new BatchPortUnwired('loadAccountDay'",
    );
    for (const port of ['accountDaysFrom', 'storedRuleStates'])
      expect(adapter, `${port} no longer refuses by name`).toContain(
        `new BatchPortUnwired('${port}'`,
      );
    for (const port of ['raiseReconciliation', 'raiseDivergence'])
      expect(adapter, `${port} no longer refuses by name`).toContain(
        `new BatchPortUnwired('${port}'`,
      );

    // AND THE TWO THAT STILL REFUSE ON THE READ SIDE ARE OFF `runNightlyBatch`'s
    // PATH, WHICH IS WHY "THE FOLD COMPLETES" AND "THE ADAPTER IS WHOLE" ARE
    // DIFFERENT SENTENCES. That function calls five methods and every one of
    // them answers; `accountDaysFrom` and `storedRuleStates` are the replay
    // audit's, and `runReplayAudit` is unscheduled.
    const nightly = codeOf(join(REPO_ROOT, 'apps/worker/src/batch/nightly.ts'));
    for (const port of ['accountDaysFrom', 'storedRuleStates'])
      expect(nightly, `${port} is on the nightly path after all`).not.toContain(port);
    for (const port of [
      'calendarWatermark',
      'calendarSlice',
      'accountsWithLiveMark',
      'loadAccountDay',
      'writeRuleState',
    ])
      expect(nightly, `${port} left the nightly path`).toContain(port);

    // **AND THE WRITE PORT IS COMPOSED ON A REAL ENCODER NOW.** This assertion
    // read that the adapter took `UNWIRED_RULE_STATE_WRITER_IO.encodeEngineGates`,
    // which was link 3's subject seen from the adapter: the door was real and the
    // codec was not. ADR-250 landed the codec, so the assertion is REPOINTED at
    // the fact that replaced it rather than deleted, and it is repointed at BOTH
    // halves, because an installed encoder written in this deployable would be
    // the `FM-16` ADR-239 slice A ruled against: `apps/api` decodes the same
    // column and cannot import `apps/worker`.
    expect(adapter).toContain("from '@merit/rules-engine'");
    expect(adapter).toContain('encodeEngineGates');
    expect(adapter).not.toContain('UNWIRED_RULE_STATE_WRITER_IO');
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

  test('and no implementation of it is WRITTEN in a deployable, which is ADR-239 A', () => {
    // **THIS TITLE READ "no implementation of it ships" AND ADR-250 MADE THAT
    // FALSE.** The predicate did not move and never needed to: it counts
    // `RuleStateWriterIo` VALUES declared under a deployable's `src/`, and the
    // encoder the adapter now installs is an IMPORT from `@merit/rules-engine`
    // rather than a value declared here. What this case still catches is the
    // defect it was written for: a second transcription of ADR-206 appearing in
    // a deployable, which is `FM-16` because two deployables read this column.
    //
    // The only `RuleStateWriterIo` value under `src/` is the unwired default,
    // and it THROWS rather than returning, because a writer that silently did
    // nothing produces a report saying 5,000 rows were written on a night the
    // book gained none. It stays, because a deployment that installs a door and
    // no encoding must still refuse.
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

  test('exactly ONE `ExternalGates` producer ships under a `src/`, and no deployable holds it', () => {
    // **THIS CASE READ "no `ExternalGates` value is resolved from a row anywhere
    // under a `src/`" AND ADR-260 MADE IT FALSE WITHOUT ANYTHING BEING SEEDED.**
    // It was written by ADR-248 to pin the absence, sliced out of the tree rather
    // than typed, expressly so that the resolver landing would be a FAILURE
    // rather than silence. The resolver landed and it failed. It is rewritten
    // onto the resolved side and it keeps asserting the thing that still matters,
    // which is not the count.
    //
    // THE NEEDLE IS THE OBJECT KEY AND NOT THE TYPE NAME, because a file that
    // NAMES `ExternalGates` is usually declaring a parameter, which is the
    // opposite of producing one. A literal must carry every member, so
    // `hasPayoutInFlight:` finds the construction and the annotation does not.
    const producers = deployableSources()
      .filter((path) => codeOf(path).includes('hasPayoutInFlight:'))
      .map(rel)
      .sort();

    // **THE PROPERTY IS THAT NO `apps/*` FILE IS ON THIS LIST, AND IT IS A
    // STRONGER PROPERTY THAN THE ABSENCE IT REPLACES.** `external-gates.ts` is
    // the one narrowing, `types.ts` DECLARES the field, and `trial.ts` RAISES one
    // member on a value its own caller handed it inside a Monte Carlo loop. A
    // deployable appearing here would be `FM-16` by name: `apps/worker` builds
    // `AccountDay.external` and `apps/api` builds `PayoutSubject.gates`, neither
    // can import the other, and a literal in either would be a second answer to
    // the seven-versus-six question with nothing comparing the two.
    expect(producers).toEqual([
      'packages/harness/src/trial.ts',
      'packages/rules-engine/src/external-gates.ts',
      'packages/rules-engine/src/types.ts',
    ]);
    expect(producers.filter((path) => path.startsWith('apps/'))).toEqual([]);

    // AND THE ONE PRODUCER IS REACHED BY BOTH DEPLOYABLES THROUGH THE BARREL,
    // which is what makes the sentence above a design rather than a coincidence.
    expect(codeOf(join(REPO_ROOT, 'packages/rules-engine/src/index.ts'))).toContain(
      'resolveExternalGates',
    );
    expect(codeOf(join(REPO_ROOT, 'apps/worker/src/batch/adapter.ts'))).toContain(
      'resolveExternalGates',
    );

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

  test('and `hasPayoutInFlight` has ONE ruled predicate since ADR-254, and it is the ACCOUNT', () => {
    // **THE THIRD FIELD'S SECOND LEG WAS A CONTRADICTED FUNCTION RATHER THAN A
    // MISSING ONE, AND ADR-254 RULED IT.** ADR-245 sized this leg as four column
    // reads and one refusal; ADR-248 found that the in-flight leg had no
    // predicate to read, because `M01` said FOR THIS ACCOUNT where it declared
    // the field and FOR THIS IDENTITY where it stated the rule, and refused to
    // rule between them. ADR-254 rules the ACCOUNT and amends M01's two R-38
    // rows.
    //
    // THE DAY THAT RULING MOVED, THIS CASE WAS RED, WHICH IS WHAT IT WAS FOR.
    // Both sides were sliced out of the document rather than typed here so that
    // an amendment would land as a failure rather than as silence, and it did.
    // The slices now read the RULED side, and the retired side is asserted to be
    // STILL PRESENT AND STILL MARKED: a corrected document that deletes what it
    // corrected leaves the next reader nothing to check.
    const m01 = readFileSync(join(REPO_ROOT, 'docs/plans/M01-rules-engine.md'), 'utf8');

    // Section 2.1's `ExternalGates` block, where the field is DECLARED.
    const block = m01.slice(m01.indexOf('interface ExternalGates {'));
    const declared = block.slice(0, block.indexOf('\n}')).split('\n');
    const field = declared.filter((line) => line.includes('hasPayoutInFlight:'));
    expect(field, 'section 2.1 no longer declares `hasPayoutInFlight` exactly once').toHaveLength(
      1,
    );
    expect(field[0]).toContain('for this account');

    // Group F's R-38 row, where the rule is STATED. It appears twice, because
    // M01 carries the rule table and its context-gate restatement, and both
    // copies say the same thing: naming the count keeps a future edit to one of
    // two visible, which is `0031`'s own reason for writing its two SD-09
    // predicates adjacent.
    const stated = m01
      .split('\n')
      .filter((line) => line.startsWith('| R-38 ') && line.includes('wallet-to-rail withdrawal'));
    expect(stated).toHaveLength(2);
    for (const row of stated) {
      // The LIVE half is everything before the retirement marker. The retired
      // sentence survives after it, quoted, which is why the filter above still
      // finds the phrase `wallet-to-rail withdrawal` on both rows.
      const live = row.split('**THIS ROW READ')[0] ?? '';
      expect(live).toContain('for this account');
      expect(live).not.toContain('for this identity');
      expect(row).toContain('withdrawal for this identity in');
      expect(row).toContain('ADR-254');
    }

    // AND THE ENGINE'S OWN CONTRACT NOW CARRIES THE RULING. `types.ts` claimed
    // to reproduce section 2.1 verbatim and then wrote the identity reading
    // twice; ADR-248 repaired the claim without ruling it, and ADR-254 rules it.
    // The comment names the winner, cites the ruling, and keeps the loser
    // visible, so a caller reading the interface to learn what to supply is told
    // a settled answer that is actually settled.
    const engine = readFileSync(join(REPO_ROOT, 'packages/rules-engine/src/types.ts'), 'utf8');
    const contract = engine.slice(
      engine.lastIndexOf('/**', engine.indexOf('export interface ExternalGates {')),
      engine.indexOf('/** R-40. Account `active` AND phase `funded`. */'),
    );
    expect(contract).toContain('for this account');
    expect(contract).toContain('for this identity');
    expect(contract).toContain('ADR-254');
    expect(contract).not.toContain('rules NEITHER');
  });

  test('and SD-09, the second line of defence for the same rule, is ACCOUNT grained', () => {
    // **THE INDEX IS THE ONE PLACE R-38 IS ENFORCED TODAY, IT AGREED WITH THE
    // DECLARATION RATHER THAN WITH THE RULE ROW, AND ADR-254 RULED WITH IT.**
    // M01's AS-01 residual says the same thing in prose ("None at account level.
    // At identity level, ten accounts can each hold one in-flight payout, which
    // is AS-09"), AS-09's own attack says it in five words ("AS-01's in-flight
    // rule does not help because each account has its own"), and AS-09 is RULED
    // at the gate as visibility rather than a rule, so the identity reading
    // would have refused nine of a copy trader's ten accounts under a ceiling
    // the corpus declined to impose.
    //
    // THE INDEX IS NOT THE ARGUMENT, WHICH IS WORTH KEEPING STRAIGHT HERE. A
    // shipped index is a commitment the database is already enforcing, and it
    // could still have been the wrong one. It is not: `SD-09` is M01's OWN
    // delta, declared at `(account_id)` in the same document that stated the
    // rule at the identity, so the index is the plan built faithfully and the
    // contradiction was always M01 against itself. ADR-254 section 1.
    const migrations = join(REPO_ROOT, 'packages/db/migrations');
    const files = readdirSync(migrations)
      .filter((name) => name.endsWith('.sql'))
      .sort();

    // The LAST migration to create the index is the live one, derived rather
    // than named: `0010` wrote it, `0031` dropped and rewrote it, and a `0074`
    // that rewrote it again would be found here instead of being missed.
    const creators = files.filter((name) =>
      readFileSync(join(migrations, name), 'utf8').includes(
        'CREATE UNIQUE INDEX payout_requests_no_in_flight_uq',
      ),
    );
    expect(creators).toEqual(['0010_payouts.sql', '0031_payout_hold_and_identity_restriction.sql']);

    const statement = (name: string): string => {
      const sql = readFileSync(join(migrations, name), 'utf8');
      const at = sql.indexOf('CREATE UNIQUE INDEX payout_requests_no_in_flight_uq');
      return sql.slice(at, sql.indexOf(';', at));
    };

    const live = statement(creators[creators.length - 1] ?? '');
    const outstanding = [...live.matchAll(/'(\w+)'/g)].map((match) => match[1] ?? '');

    // THE GRAIN, ASSERTED ON THE COLUMN AND NOT ON THE COMMENT ABOVE IT.
    expect(live).toContain('ON payout_requests (account_id)');
    expect(outstanding).toEqual(['approved', 'frozen', 'held_pending_review']);

    // AND THE STATUS SET MOVED TWICE AFTER M01 WAS FROZEN, WHICH THIS CASE USED
    // TO MEASURE AS A GAP AND NOW MEASURES AS CLOSED. ADR-028 retired
    // `transferring` from this table and ADR-040 added `held_pending_review`,
    // and ADR-040 named M01's declaration and its `SD-09` delta as two sites its
    // own sweep did not reach. ADR-254 folded them, so section 2.1's note is now
    // the index's own predicate rather than the pre-ADR-028 one.
    const m01 = readFileSync(join(REPO_ROOT, 'docs/plans/M01-rules-engine.md'), 'utf8');
    const block = m01.slice(m01.indexOf('interface ExternalGates {'));
    const line = block
      .slice(0, block.indexOf('\n}'))
      .split('\n')
      .find((row) => row.includes('hasPayoutInFlight:'));
    const note = (line ?? '').slice((line ?? '').indexOf('//') + 2);
    const declaredSet = note
      .slice(0, note.indexOf('for this account'))
      .split('|')
      .map((word) => word.trim());
    expect(declaredSet).toEqual(outstanding);

    // AND THE RETIRED SET IS STILL QUOTABLE, IN THE ROWS THAT WERE AMENDED.
    // Deleting it would leave a reader who finds `transferring` in ADR-204 or in
    // a session log with nothing in the plan to resolve it against.
    const retiredRows = m01
      .split('\n')
      .filter((row) => row.startsWith('| R-38 ') || row.startsWith('| SD-09 '));
    expect(retiredRows).toHaveLength(3);
    for (const row of retiredRows) {
      expect(row).toContain('transferring');
      expect(row).toContain('ADR-254');
    }

    // NON-VACUITY, on this file's own standard: the identical parser is shown
    // reading the SUPERSEDED predicate, which carries two members rather than
    // three, so a parser that silently matched nothing would fail here.
    const superseded = [...statement('0010_payouts.sql').matchAll(/'(\w+)'/g)].map(
      (match) => match[1] ?? '',
    );
    expect(superseded).toEqual(['approved', 'frozen']);
  });
});

describe('link 6: the READER exists, and the DAY it selects by now has a door', () => {
  // **THE FIRST LINK ON THIS LIST TO CLOSE ON THIS DEPLOYABLE'S OWN SIDE.**
  // Links 1 to 3 were all `apps/worker`'s: a job nothing called, an adapter that
  // refused, a codec nobody had written. Link 4 is the empty table. What was
  // never a link at all, because nobody had asked for it, is the thing that
  // turns a stored row into the `RuleState` `PayoutSubject.state` declares, and
  // `ADR-264` writes it.
  //
  // AND THE LINK UNDER IT WAS NEW WHEN `ADR-264` FOUND IT, AND `ADR-268` CLOSES
  // IT. `R-06` is that no endpoint may evaluate eligibility against anything
  // other than the LAST CLOSED DAY. The reader therefore takes the day as an
  // argument and has no `latest` arm; the caller is the only thing that could
  // know which day the calendar says is closed, and until `ADR-268` a scoped
  // payout transaction could not read the calendar at all. What closes it is a
  // NAMED DOOR and not a sixth catalogued key, so the assertions below that the
  // list did not move are unchanged and are now load bearing in the other
  // direction: they are what would catch the shorter diff being taken later.

  test('one `rule_states` row reader ships under a `src/` in THIS deployable, and it refuses absence', () => {
    // THE NEEDLE IS THE CODEC CALL AND NOT THE TYPE NAME, on link 5's own
    // reasoning: a file that NAMES `RuleState` is usually declaring a parameter.
    // A rebuilt state must carry `engineGates`, and `ADR-250` put the only
    // decoding of that column in the engine, so `decodeEngineGates(` finds every
    // rebuilder in the tree and finds nothing else.
    const rebuilders = deployableSources()
      .filter((path) => codeOf(path).includes('decodeEngineGates('))
      .map(rel)
      .sort();

    // **TWO, AND THE SECOND ONE IS `FM-16` BY NAME.** `apps/worker` rebuilds a
    // `prior` and `apps/api` rebuilds a `PayoutSubject.state`, neither can
    // import the other, and `ADR-264` section 6 registers the finding and names
    // its home as `packages/rules-engine` beside `gates-codec.ts`. What that
    // failure mode costs is "with nothing comparing them", and
    // `rule-state-reader.test.ts` supplies the comparator: `SD-08`'s digest,
    // computed by the writer and stored in `bytea`, re-derived from the state
    // the reader rebuilds.
    // The engine's own file is on the list because it DECLARES the function,
    // which is the shape link 5 already met on `hasPayoutInFlight:` and is the
    // reason both halves are asserted rather than only the count.
    expect(rebuilders).toEqual([
      'apps/api/src/rule-state-reader.ts',
      'apps/worker/src/batch/adapter.ts',
      'packages/rules-engine/src/gates-codec.ts',
    ]);
    expect(rebuilders.filter((path) => path.startsWith('apps/'))).toEqual([
      'apps/api/src/rule-state-reader.ts',
      'apps/worker/src/batch/adapter.ts',
    ]);

    // AND THE READER HAS NO ARM THAT ANSWERS AN ABSENT ROW, which is the
    // property four sessions have refused to give up and which a sweep can keep
    // true. A `latest` function appearing in that module would be `R-06`
    // violated by an ordering; a `??` on a column would be a gate that never
    // fires.
    const reader = codeOf(join(REPO_ROOT, 'apps/api/src/rule-state-reader.ts'));
    expect(reader, 'the reader gained a fallback that selects a row by ordering').not.toMatch(
      /\blatest\b/,
    );
    expect(reader, 'the reader gained a default for a column it could not read').not.toContain(
      '??',
    );
    expect(reader).toContain('throw new RuleStateAbsent');
  });

  test('and `tradingCalendar` is `firm` and STILL OUTSIDE the five keys ADR-233 catalogued', () => {
    // **THE BLOCKER `ADR-264` DERIVED, AND THE HALF OF IT THAT DID NOT MOVE.**
    // `subject()` runs on the payout transaction, which is a `ScopedTx`.
    // `ADR-233` gave that handle a `firm`-class read over `CATALOG_TABLE_KEYS`,
    // a CLOSED list, and the calendar is not on it. `ADR-268` reads the calendar
    // through a NAMED DOOR instead, so this list is asserted here for the
    // opposite reason it used to be: not because the day is unreachable, but
    // because the shorter diff was available and was refused.
    const scoped = readFileSync(join(REPO_ROOT, 'packages/db/src/scoped-db.ts'), 'utf8');
    const list = scoped.slice(scoped.indexOf('export const CATALOG_TABLE_KEYS = ['));
    const catalogued = [...list.slice(0, list.indexOf(']')).matchAll(/'(\w+)'/g)].map(
      (match) => match[1] ?? '',
    );

    expect(catalogued).toEqual([
      'coupons',
      'geoRestrictions',
      'midHealth',
      'planVersions',
      'planVersionSizes',
    ]);
    expect(catalogued).not.toContain('tradingCalendar');
    expect(catalogued).not.toContain('tradingCalendarLoads');

    // AND THE CLASS IS `firm`, WHICH IS WHAT PUTS IT OUT OF REACH OF EVERY
    // SCOPED METHOD RATHER THAN ONLY OFF THAT LIST. `ScopedTableKey` is
    // `Exclude<TableKey, FirmTableKey | PairTableKey>`, so `rows`, `rowsWhere`
    // and `rowAt` cannot be handed this key either.
    const registry = readFileSync(join(REPO_ROOT, 'packages/db/src/scope.ts'), 'utf8');
    const entry = registry.slice(registry.indexOf('\n  tradingCalendar: {'));
    expect(entry.slice(0, entry.indexOf('\n  },'))).toContain("class: 'firm'");

    // **AND THE READ EXISTS IN THIS DEPLOYABLE ON A DIFFERENT DOOR, WHICH IS
    // WHAT MADE THE SECOND TRANSACTION LOOK LIKE THE CHEAP ANSWER.**
    // `databaseEconomicCalendar` reads the same table through `ApiDb.firm`. That
    // read is a PANEL and this one is a verdict, and `ADR-268` refuses the
    // crossing here on `ADR-211` clause 4's own precondition: that crossing was
    // made safe by a migration after which nothing readable can move, and this
    // table is the one the corpus built a correction mechanism FOR.
    const api = codeOf(join(REPO_ROOT, 'apps/api/src/routes/economic-calendar.ts'));
    expect(api).toContain("tx.rowsWhere('tradingCalendar'");
    expect(api).toContain('db.firm(');
    expect(codeOf(join(REPO_ROOT, 'apps/api/src/db.ts'))).toContain(
      'firm<T>(fn: (tx: FirmTx) => Promise<T>): Promise<T>;',
    );
  });

  test('the day reaches the payout transaction through ONE named door and no other way', () => {
    // **THE DOOR, AND THE THREE THINGS IT IS NOT.** It is a method of `ScopedTx`
    // returning ONE day, so it is not a catalogue admission, not a second
    // transaction and not a `PayoutTx` member: `ADR-211` foreclosure 2 said a
    // `PayoutTx` will not gain a firm method, and it does not.
    const scoped = readFileSync(join(REPO_ROOT, 'packages/db/src/scoped-db.ts'), 'utf8');
    expect(scoped).toContain('lastClosedTradingDay(): Promise<string>;');
    expect(scoped).toContain('export async function lastClosedTradingDayStatement');

    const route = codeOf(join(REPO_ROOT, 'apps/api/src/routes/payouts.ts'));
    expect(route).not.toContain('lastClosedTradingDay(): Promise<');
    expect(route).not.toContain('session_close_at');
    expect(route).not.toContain('sessionCloseAt');
  });

  test('THE FOLD IS NOT RESTATED, and the two statements of it that exist are named', () => {
    // **`R-06`'s SELECTION IS ONE PREDICATE AND THIS TREE ALREADY STATES IT
    // TWICE**, which is the whole argument against handing a caller rows. The
    // census is over the tree rather than over a list, so a third statement
    // appearing anywhere turns this red rather than being noticed in review.
    const folds = deployableSources()
      .filter((path) => /session_?[cC]lose_?[aA]t/.test(codeOf(path)))
      .map(rel)
      .sort();

    // **THE WHOLE LIST IS ASSERTED AND EACH MEMBER IS SAID TO BE WHAT IT IS**,
    // on link 5's own idiom about the engine's file: a census that named only
    // the interesting members would be a filter somebody tuned. Two of these
    // SELECT A DAY, three DECLARE the column, and one is the door.
    //
    //   `apps/worker/src/batch/adapter.ts`      SELECTS. `anchorLastClosedDay`, which
    //                                           reads BOTH tables in ONE transaction and
    //                                           hands back a discriminated union (ADR-277).
    //                                           THE COVERAGE-BLIND FOLD THIS LINE USED TO
    //                                           NAME LEFT THE EXPORTED SURFACE ENTIRELY.
    //   `apps/api/src/admin-source/liability.ts` SELECTS. `lastClosedDay`, whose
    //                                           caller `anchorCalendar` does.
    //   `packages/db/src/scoped-db.ts`          THE DOOR. ADR-268.
    //   `packages/db/src/schema.ts`             declares the column.
    //   `packages/db/src/scope.ts`              the registry rule's prose.
    //   `packages/rules-engine/src/calendar.ts` the engine's own calendar type.
    //
    // `apps/api/src/routes/economic-calendar.ts` is NOT here and that is right:
    // it counts sessions still AHEAD off `session_open_at` for a freshness panel
    // and selects no day at all. A SEVENTH member is a third selection of `R-06`
    // and turns this red, which is the control the catalogue admission would
    // have had no way to provide.
    expect(folds).toEqual([
      'apps/api/src/admin-source/liability.ts',
      'apps/worker/src/batch/adapter.ts',
      'packages/db/src/schema.ts',
      'packages/db/src/scope.ts',
      'packages/db/src/scoped-db.ts',
      'packages/rules-engine/src/calendar.ts',
    ]);
  });
});

describe('link 7: `plan`s DECODING landed, and what the port waits on is smaller and named', () => {
  // **`ADR-281` FOUND THAT THE ENTRY'S SIXTEENTH-REVISION SUMMARY WAS FALSE IN
  // ITS FIRST CLAUSE**: it said `plan` waited on NOTHING because `ADR-233`
  // catalogued `planVersions` and `planVersionSizes`. `ADR-233` gave this
  // transaction the READ and not the DECODE, and `PayoutSubject.plan` is a
  // `ResolvedPlan` rather than a row.
  //
  // **`ADR-283` TOOK THE MOVE THAT ENTRY REGISTERED AND COULD NOT MAKE.**
  // `decodePlanRules` (`packages/rules-engine/src/plan/rules-codec.ts`) is
  // exported from the engine, `apps/api` has declared that package since session
  // 252, and the blob half of the `ResolvedPlan` is a call somebody can write on
  // the payout transaction. THE PORT STILL DOES NOT WIRE, and the cases below
  // are what keeps this file from repeating the failure it diagnoses: three
  // clauses NARROW and each is measured rather than described.

  test('`PayoutSubject.plan` is a `ResolvedPlan`, and NO `apps/api` file produces one yet', () => {
    // THE NEEDLE IS THE RESOLVER CALL AND NOT THE TYPE NAME, on link 6's own
    // reasoning: a file that NAMES `ResolvedPlan` is usually declaring a
    // parameter, and every consumer of the fold declares one. A file that
    // CALLS `resolvePlan(` is producing the value.
    const route = codeOf(join(REPO_ROOT, 'apps/api/src/routes/payouts.ts'));
    expect(route).toContain('readonly plan: ResolvedPlan;');

    const producers = deployableSources()
      .filter((path) => codeOf(path).includes('resolvePlan('))
      .map(rel)
      .sort();

    // **TWO, AND ONE OF THEM IS THE DECLARATION.** The engine declares the
    // resolver and `apps/worker` is the only deployable that calls it. A third
    // entry appearing under `apps/api/src` is this port's `plan` half landing,
    // and it turns this case red so the entry above cannot stay as it is.
    // **`ADR-283` DID NOT MOVE THIS NUMBER AND SAYS SO**: it landed the decoding
    // the resolver needs and wired nothing.
    expect(producers).toEqual([
      'apps/worker/src/batch/adapter.ts',
      'packages/rules-engine/src/plan/resolve.ts',
    ]);
    expect(producers.filter((path) => path.startsWith('apps/api/'))).toEqual([]);
  });

  test('the DECODING is no longer the blocker, and the engine is where it landed', () => {
    // **BOTH HALVES ARE NOW DISCHARGED AND EACH IS ASSERTED SO NOBODY
    // RE-DERIVES IT.** The declaration half was discharged in session 252 and
    // `ADR-281` section 7 found two sentences in this deployable still denying
    // it; both are repaired by `ADR-283`, which is what makes this case a pair
    // rather than a single assertion.
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'apps/api/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(manifest.dependencies?.['@merit/rules-engine']).toBe('workspace:*');

    const engineDoor = readFileSync(join(REPO_ROOT, 'packages/rules-engine/src/index.ts'), 'utf8');
    expect(engineDoor).toContain("export { resolvePlan } from './plan/resolve.ts';");
    expect(engineDoor).toContain(
      "export { decodePlanRules, PlanRulesCodecError } from './plan/rules-codec.ts';",
    );

    // AND THE SIGNATURE IS THE ONE `resolvePlan` TAKES, which is the property a
    // name in a barrel does not carry: a decoder returning something adjacent to
    // `PlanRulesJson` would satisfy the export assertion and satisfy nothing
    // else.
    expect(codeOf(join(REPO_ROOT, 'packages/rules-engine/src/plan/rules-codec.ts'))).toContain(
      "export function decodePlanRules(value: unknown, at = '$'): PlanRulesJson {",
    );
    expect(codeOf(join(REPO_ROOT, 'packages/rules-engine/src/plan/resolve.ts'))).toContain(
      'export function resolvePlan(rules: PlanRulesJson, size: PlanVersionSizeRow): ResolvedPlan {',
    );
  });

  test('the tree states this one predicate THREE times, and the census is held at exactly three', () => {
    // **`FM-16` IS TWO STATEMENTS OF ONE PREDICATE WITH NOTHING COMPARING THEM,
    // AND THIS TREE NOW HAS THREE.** That is stated rather than softened.
    // `ADR-283` landed the HOME `ADR-239` slice A ruled, and the two copies it
    // exists to retire live in `apps/worker/src/**` and `apps/site/src/**`,
    // which row `283`'s fence declared out of bounds. Collapsing them is the row
    // that follows and this census is what makes its completion visible: the
    // list drops to one member the day it lands.
    //
    // **A FOURTH ENTRY IS THE FAILURE THIS CASE EXISTS TO CATCH**, and it is the
    // shape `ADR-269` already refused one port over for this same value: a
    // decoder written into `apps/api` because the engine's was not noticed.
    const decoders = deployableSources()
      .filter((path) => /\)\s*:\s*(?:PlanRulesJson|PublishedRules)\b/.test(codeOf(path)))
      .map(rel)
      .sort();

    expect(decoders).toEqual([
      'apps/site/src/catalog/adapter.ts',
      'apps/worker/src/batch/adapter.ts',
      'packages/rules-engine/src/plan/rules-codec.ts',
    ]);
    expect(decoders.filter((path) => path.startsWith('apps/api/'))).toEqual([]);

    // AND EACH IS WHAT IT IS SAID TO BE, because a census that named only the
    // count would be satisfied by three files that had drifted into the pattern.
    expect(codeOf(join(REPO_ROOT, 'apps/worker/src/batch/adapter.ts'))).toContain(
      'function toPublishedRules(value: unknown, at: string): PublishedRules {',
    );
    expect(codeOf(join(REPO_ROOT, 'apps/site/src/catalog/adapter.ts'))).toContain(
      'function decodeRules(value: unknown, where: string): PlanRulesJson {',
    );

    // **AND ONLY ONE OF THE THREE IS EXPORTED**, which is what makes it the home
    // rather than a third peer: the other two are module-private to deployables
    // nothing may import.
    expect(codeOf(join(REPO_ROOT, 'packages/rules-engine/src/plan/rules-codec.ts'))).toContain(
      'export function decodePlanRules',
    );
  });

  test('what `plan` waits on now is the SIZE ROW, which is measured rather than assumed', () => {
    // **THE HONEST RESIDUE, NAMED HERE SO THE NEXT SESSION DOES NOT DISCOVER
    // IT.** `resolvePlan` takes TWO arguments and this row cleared the first.
    // `ScopedTx.catalogRowAt` returns `Promise<unknown>`, so the size row arrives
    // untyped exactly as the blob did, and one of its columns is itself `jsonb`
    // carrying money.
    const scoped = readFileSync(join(REPO_ROOT, 'packages/db/src/scoped-db.ts'), 'utf8');
    expect(scoped).toContain('catalogRowAt<K extends CatalogTableKey, A extends RowAddress<K>>(');
    expect(scoped).toContain('  ): Promise<unknown>;');

    const migration = readFileSync(
      join(REPO_ROOT, 'packages/db/migrations/0004_catalog.sql'),
      'utf8',
    );
    expect(migration).toMatch(/payout_cap_schedule_cents\s+jsonb NOT NULL/);

    // **THE SPELLING DIFFERENCE IS REAL AND `ADR-286` RE-DERIVED IT RATHER THAN
    // TAKING `ADR-283`'s WORD FOR IT**, because the whole case for treating the
    // size row differently from the blob rested on it. `apps/worker` reads a
    // driver row whose properties are `packages/db`'s camelCase; `apps/site`
    // reads a wire object under the stored snake_case column names.
    expect(codeOf(join(REPO_ROOT, 'apps/worker/src/batch/adapter.ts'))).toContain(
      "size_cents: bigintOf(row, 'sizeCents', at),",
    );
    expect(codeOf(join(REPO_ROOT, 'apps/site/src/catalog/adapter.ts'))).toContain(
      "size_cents: bigintCents(field(source, 'size_cents', where), `${where}.size_cents`),",
    );
    expect(readFileSync(join(REPO_ROOT, 'packages/db/src/schema.ts'), 'utf8')).toContain(
      "sizeCents: bigint('size_cents', { mode: 'bigint' }).notNull(),",
    );
  });

  test('the spelling is the DEPENDENCY GRAPH and not a preference either reader could trade', () => {
    // **`ADR-286` RULING 2. THIS IS THE CASE THAT RETIRES "ONE CALLER HAS TO
    // RENAME".** `ADR-283` section 5 read the two spellings and concluded that a
    // canonical decoder must pick one and make the other caller rename, which it
    // correctly declined to decide. What it did not measure is WHY each reader
    // spells its source the way it does, and the answer is in the manifests
    // rather than in the readers: **`apps/site` DECLARES NO `@merit/db` AT ALL.**
    //
    // So `apps/site` reads snake_case because it reads Merit's own HTTP response
    // and has no database to read instead, and `apps/worker` reads camelCase
    // because Drizzle hands back property names. **NEITHER SPELLING IS A CHOICE,
    // SO NEITHER IS TRADEABLE**: asking the site to read camelCase is asking the
    // wire contract to change, and asking the worker to read snake_case is asking
    // `packages/db` to stop mapping. There is no rename to negotiate.
    const manifest = (unit: string): { dependencies?: Record<string, string> } =>
      JSON.parse(readFileSync(join(REPO_ROOT, 'apps', unit, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
      };

    expect(manifest('worker').dependencies?.['@merit/db']).toBe('workspace:*');
    expect(manifest('api').dependencies?.['@merit/db']).toBe('workspace:*');
    expect(
      manifest('site').dependencies?.['@merit/db'],
      'the site gained a database dependency, so ADR-286 ruling 2 has lost its ground',
    ).toBeUndefined();

    // **AND THE PAYOUT PATH IS ON THE DRIVER SIDE OF THAT SPLIT, WHICH IS WHY IT
    // NEEDS NO RENAME FROM ANYBODY.** `apps/api` already reads `plan_version_sizes`
    // off this door under the driver spelling, in its own catalogue route. What it
    // lacks is not a spelling ruling; it is a decoder for the spelling it already
    // reads, in a home both driver-side deployables can reach.
    expect(codeOf(join(REPO_ROOT, 'apps/api/src/routes/catalog.ts'))).toContain(
      "size_cents: cents(row, 'sizeCents', PLAN_VERSION_SIZES),",
    );
  });

  test('and the engine may not be that home, which is `RI-01` and not a preference', () => {
    // **`ADR-286` RULING 3.** A decoder for the DRIVER spelling has to know
    // `packages/db`'s property names. `packages/rules-engine` declares no
    // workspace dependency in any field and its own manifest says it never may,
    // so the engine is foreclosed as the home for the driver-side decoder by the
    // invariant rather than by taste. That is the same argument `ADR-239` slice A
    // used to PUT `gates-codec.ts` in the engine, read in the other direction:
    // the gates predicate needs no database naming and this one does.
    const engine = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages/rules-engine/package.json'), 'utf8'),
    ) as Record<string, unknown>;

    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'])
      expect(engine[field], `the engine declares ${field}, so RI-01 has moved`).toBeUndefined();

    const dev = (engine['devDependencies'] ?? {}) as Record<string, string>;
    expect(Object.values(dev).filter((range) => range.startsWith('workspace:'))).toEqual([]);

    // AND THE TWO DRIVER-SIDE DEPLOYABLES CANNOT REACH EACH OTHER EITHER, so
    // `apps/worker`'s existing `toSizeRow` is not a home for `apps/api` however
    // exactly it already fits.
    const apiDeps = (
      JSON.parse(readFileSync(join(REPO_ROOT, 'apps/api/package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
      }
    ).dependencies;
    expect(apiDeps?.['@merit/worker']).toBeUndefined();
    expect(codeOf(join(REPO_ROOT, 'apps/worker/src/batch/adapter.ts'))).toContain(
      'function toSizeRow(value: unknown, at: string): PublishedSizeRow {',
    );
  });

  test('the ONE `FM-16` here WAS the CAP SCHEDULE, and its census is now ONE', () => {
    // **`ADR-302`, AND THIS CASE IS THE ROW'S STOP CONDITION RATHER THAN
    // PAPERWORK AFTER IT.** It read THREE and refused a fourth. It now reads ONE.
    //
    // The retired framing, described rather than left in place, because this file
    // is asserted against by grep and a retired sentence left standing reads as
    // live: `ADR-286` ruling 5 counted the readers of the size ROW and found two,
    // then found that the `jsonb` COLUMN inside the row had a THIRD reader
    // invisible to that count because it returned a LOCAL step type rather than
    // the engine's. All three spelled the blob's own keys identically, because
    // `from_ordinal` and `cap_cents` are what Postgres stores and what every
    // reader asks for, so the spelling ruling that keeps the size ROW apart never
    // reached inside the column. That half WAS one predicate stated three times,
    // on the value that fixes a payout ceiling.
    //
    // **THE NEEDLE IS STILL THE QUOTED KEY AND NOT THE NAME**, and the difference
    // is still the whole census. A file that reads `'cap_cents'` as a STRING is
    // pulling it out of an untyped bag, which is a decode; a file that writes
    // `.cap_cents` is reading a field off a value somebody already decoded, which
    // is a use. The broad question returns eleven files and five of them are
    // consumers, `apps/portal/src/view/eligibility.ts` and
    // `packages/rules-engine/src/plan/resolve.ts` among them.
    const readers = deployableSources()
      .filter((path) => /'cap_cents'/.test(codeOf(path)))
      .map(rel)
      .sort();

    expect(readers).toEqual(['packages/rules-engine/src/plan/cap-schedule-codec.ts']);

    // THE ONE DECODER, NAMED, because a census satisfied by a count would be
    // satisfied by one file that had drifted into the pattern. The engine's other
    // entries DECLARE and CONSUME the step; they decode nothing.
    expect(
      codeOf(join(REPO_ROOT, 'packages/rules-engine/src/plan/cap-schedule-codec.ts')),
    ).toContain("cap_cents: cents(bag, 'cap_cents', path),");

    // AND ALL THREE DEPLOYABLE-SIDE STATEMENTS ARE GONE. The census above would
    // already be red if any of them survived; these three say WHICH one came
    // back.
    //
    // **THE NEEDLE IS THE `cap_cents` LINE AND NOT THE `from_ordinal` ONE, AND
    // THAT IS A CORRECTION TO THIS CASE RATHER THAN A STYLE CHOICE.** Until
    // `ADR-302` two of the three assertions here quoted
    // `from_ordinal: jsonInteger(...)` and `from_ordinal: integer(...)`, and
    // BOTH LINES EXIST VERBATIM A SECOND TIME IN THE SAME TWO FILES, in
    // `toCapScheduleBp` (`apps/worker/src/batch/adapter.ts`) and
    // `decodeCapScheduleBp` (`apps/site/src/catalog/adapter.ts`), which decode
    // `plan_versions.rules`' BASIS-POINT schedule and not this column at all. So
    // those two needles would have stayed green on a file whose cents reader had
    // been deleted. The `'cap_cents'` sweep above was the control that actually
    // held; these lines are now chosen to be unique to the cents reader too.
    expect(codeOf(join(REPO_ROOT, 'apps/worker/src/batch/adapter.ts'))).not.toContain(
      "cap_cents: jsonCents(jsonField(source, 'cap_cents', where), `${where}.cap_cents`),",
    );
    expect(codeOf(join(REPO_ROOT, 'apps/site/src/catalog/adapter.ts'))).not.toContain(
      "cap_cents: bigintCents(field(source, 'cap_cents', at), `${at}.cap_cents`),",
    );
    expect(codeOf(join(REPO_ROOT, 'apps/api/src/routes/catalog.ts'))).not.toContain(
      'function readCapSchedule(',
    );

    // AND THE TWO BASIS-POINT READERS ARE STILL THERE AND ARE NOT THIS ROW'S,
    // asserted so a future session does not read the deletions above as reaching
    // them. `cap_bp` lives in `plan_versions.rules` and `ADR-283`'s codec is the
    // one that would collapse it.
    expect(codeOf(join(REPO_ROOT, 'apps/worker/src/batch/adapter.ts'))).toContain(
      "cap_bp: jsonInteger(jsonField(source, 'cap_bp', where), `${where}.cap_bp`),",
    );
    expect(codeOf(join(REPO_ROOT, 'apps/site/src/catalog/adapter.ts'))).toContain(
      "cap_bp: integer(field(source, 'cap_bp', at), `${at}.cap_bp`),",
    );

    // AND ALL THREE NOW CALL THE ENGINE'S, which is what separates a collapse
    // from three deletions plus a fourth statement nobody reaches. `ADR-286`
    // refused a fourth and `ADR-269` refused one before it for this same value,
    // and `ADR-299` section 7 named a session that wrote the codec without this
    // as having made the tree WORSE.
    for (const path of [
      'apps/worker/src/batch/adapter.ts',
      'apps/site/src/catalog/adapter.ts',
      'apps/api/src/routes/catalog.ts',
    ])
      expect(codeOf(join(REPO_ROOT, path)), `${path} does not call the engine's codec`).toContain(
        'decodeCapScheduleCents(',
      );
  });

  test('and the THIRD statement no longer DIVERGES, because there is no third statement', () => {
    // **THIS CASE WAS WRITTEN BY `ADR-286` RULING 7 AS RED-ON-REPAIR AND THE
    // REPAIR HAS LANDED, SO IT IS REWRITTEN TO ASSERT THE REPAIRED PROPERTY
    // RATHER THAN DELETED.** `ADR-299` section 7 made that rewrite the row's stop
    // condition. What it used to assert, paraphrased so this file does not put
    // the false sentence back into its own grep results: that `apps/worker` and
    // `apps/site` each admitted a cents value as a safe-integer JSON number or a
    // base-10 string of digits and each refused a number past
    // `Number.MAX_SAFE_INTEGER`, while `apps/api`'s copy tested `Number.isInteger`
    // -- TRUE of `2 ** 53 + 1` -- and then converted with `BigInt`, taking the
    // rounded double, and refused the string outright. The divergence ran in BOTH
    // directions on a served money value.
    //
    // THE PROPERTY IS NOW ASSERTED OF THE ONE STATEMENT, because there is nothing
    // left to compare it to.
    const codec = codeOf(join(REPO_ROOT, 'packages/rules-engine/src/plan/cap-schedule-codec.ts'));

    expect(codec, 'the codec stopped refusing an unsafe cents number').toContain(
      'Number.isSafeInteger(value)',
    );
    expect(codec, 'the codec stopped admitting a base-10 cents string').toContain(
      "if (typeof value === 'string') {",
    );
    expect(codec, 'the codec admits a number past the ceiling again').not.toContain(
      'Number.isInteger(',
    );

    // AND THE REFUSAL IS EXECUTED RATHER THAN READ OFF THE SOURCE, because a
    // claim about a double is the kind this file has been wrong about before and
    // a source sweep cannot tell a live check from a quoted one.
    const stored = JSON.parse('{"cap_cents":9007199254740993}') as { cap_cents: number };
    expect(Number.isInteger(stored.cap_cents)).toBe(true);
    expect(Number.isSafeInteger(stored.cap_cents)).toBe(false);
    expect(BigInt(stored.cap_cents)).toBe(9_007_199_254_740_992n);

    // THE ROUNDING ABOVE IS WHAT THE OLD READER RETURNED. THIS IS WHAT THE
    // COLLAPSE RETURNS INSTEAD, on the same stored bytes.
    expect(() =>
      decodeCapScheduleCents([{ from_ordinal: 1, cap_cents: stored.cap_cents }]),
    ).toThrow(CapScheduleCodecError);

    // AND THE OTHER DIRECTION: the rendering `ADR-283` ruling 5 ruled the only
    // one that survives above the ceiling is ADMITTED, EXACTLY, by the reader
    // that used to refuse it.
    expect(decodeCapScheduleCents([{ from_ordinal: 1, cap_cents: '9007199254740993' }])).toEqual([
      { from_ordinal: 1, cap_cents: 9_007_199_254_740_993n },
    ]);
  });

  test('and an ABSENT `rule_states` row now has an HONEST refusal rather than a 500', () => {
    // **THE SECOND INDEPENDENT GROUND, AND IT IS THE ONE THAT MOVED. `ADR-285`.**
    // Row `281` asked whether the port refuses on an empty table or wires and
    // answers honestly that there is no state for the day, `ADR-283` answered
    // that the second arm DID NOT EXIST, and this row built it.
    //
    // THE RETIRED ASSERTION IS DESCRIBED RATHER THAN LEFT IN PLACE. This link
    // used to require that `payouts.ts` contain no `RuleStateAbsent` at all, on
    // the ground that a wired backend meeting an unfolded day answered 500. That
    // is now false and the check is INVERTED rather than deleted: an arm nothing
    // asserts is an arm the next refactor removes.
    //
    // **THE PORT IS NOT WIRED BY ANY OF THIS**, which is why the two links
    // around this one are the ones that still hold: the size row above and the
    // absent `PayoutTx` below.
    const route = codeOf(join(REPO_ROOT, 'apps/api/src/routes/payouts.ts'));

    // The rethrow is UNCHANGED, so the arm is a case beside it and never a
    // widening of it: an `unwiredOrThrow` that stopped rethrowing would answer
    // every internal fault on this route with a retryable 503.
    expect(route).toContain('if (!(err instanceof PayoutBackendUnwired)) throw err;');

    // THE ARM IS REACHED FROM THE TRANSACTION'S OWN CATCH, ahead of the rethrow.
    expect(route).toContain(
      'if (err instanceof RuleStateAbsent) return stateNotFolded(err, request, reply);',
    );
    expect(route).toContain(
      "handlerProblem('service_unavailable', 'Service unavailable', 503, request.id),",
    );

    // **AND `RuleStateUnreadable` IS NOT CAUGHT, WHICH IS THE HALF THAT KEEPS
    // THIS FROM BEING A BLANKET CATCH.** A malformed row is an internal error
    // and a 503 would tell a trader to retry something no retry can fix.
    expect(route).not.toContain('RuleStateUnreadable');

    // **NO SYNTHESISED DEFAULT, WHICH IS THE PROPERTY FIVE SESSIONS REFUSED TO
    // GIVE UP.** The honest arm builds a problem document and never a state:
    // this route constructs no `RuleState` and calls no folding function.
    expect(route).not.toMatch(/\bfoldRuleState\b/);
    expect(route).not.toMatch(/:\s*RuleState\s*=/);

    // AND THE READER STILL REFUSES, so the arm is the route's and never a
    // licence to answer the absence where the row is read.
    expect(codeOf(join(REPO_ROOT, 'apps/api/src/rule-state-reader.ts'))).toContain(
      'throw new RuleStateAbsent',
    );
  });

  test('ONE file implements `PayoutTx` now, and it is still not installed', () => {
    // **THE CLAUSE THAT OUTLIVED EVERY OTHER ONE HAS CLOSED, AND THE CHECK IS
    // INVERTED RATHER THAN DELETED**, on this file's own idiom one link up: an
    // arm nothing asserts is an arm the next refactor removes.
    //
    // THE RETIRED ASSERTION IS DESCRIBED RATHER THAN LEFT IN PLACE. This case
    // required the list to be EMPTY, on `wiring.test.ts` clause FIVE, which had
    // said since `ADR-239` that there was no value to install. `ADR-291` built
    // one: `postgresPayoutBackend` implements `transact` and `identityStatus()`,
    // and `ADR-295` added `insertPayoutRequest`'s approval branch, so THREE
    // members answer and the other four reject with `PayoutBackendUnwired`.
    //
    // **THE COUNT IS EXACT AND THAT IS THE POINT OF KEEPING IT A CENSUS.** A
    // SECOND implementation appearing under a deployable's `src/` is either a
    // fixture that escaped a test directory or a second payout adapter, and the
    // day either arrives this goes red rather than stale.
    const backends = deployableSources()
      .filter((path) => /:\s*PayoutTx\b/.test(codeOf(path)) && !rel(path).endsWith('payouts.ts'))
      .map(rel)
      .sort();
    expect(backends).toEqual(['apps/api/src/payout-backend.ts']);

    // **AND THE HALF THAT MATTERS MOST IS UNCHANGED.** Building the backend is
    // `ADR-287` slice 3 and INSTALLING it is slice 9, which is a separate
    // money-path session behind a founder `E2` read. A module that exists and is
    // not reached moves no count, and this is the line that says so: the wired
    // set is what `start.ts` CALLS.
    expect(codeOf(join(REPO_ROOT, 'apps/api/src/start.ts'))).not.toContain('usePayoutBackend(');

    // **AND IT IS A PARTIAL BACKEND THAT REFUSES AS A WHOLE.** `listPayouts` and
    // `idempotency` are both constructible today, and installing them beside a
    // `transact` whose `subject` rejects is what `usePayoutBackend`'s entry
    // refuses in its own closing sentence. Asserted at the module rather than
    // only in its own suite, because this is the file the entry cites.
    const backend = codeOf(join(REPO_ROOT, 'apps/api/src/payout-backend.ts'));
    for (const member of ['holdFlag', 'listPayouts'])
      expect(backend).toContain(`new PayoutBackendUnwired('${member}')`);
    expect(backend).not.toContain('databaseIdempotencyStore');

    // **AND THE FIFTH MEMBER LEFT THAT LIST THE WAY THE FOURTH DID, WHICH IS
    // ADR-306 IN THREE ASSERTIONS.** `subject` refused WHOLESALE on one line
    // under a comment naming ADR-287 slices 4 AND 5 together, and that blanket
    // rejection cost a session: neither record could tell a member nobody had
    // started from a member three quarters built, and both named slice 5 as next
    // while slice 4 had never been built. Slice 4 built the `null` arm, `gates`
    // and `plan` up to the size decode, so the plain refusal is gone and TWO
    // NARROWER ones stand in its place, exactly as `insertPayoutRequest.hold`
    // stands below.
    //
    // THE NEEDLES ARE THE TWO UNBUILT LEGS AND THEY ARE THE REMAINDER ADR-287
    // SECTION 7 SIZES AS SLICE 5. A session that "completed" this member by
    // folding a `RuleState` in the request path or by asserting a
    // `PlanVersionSizeRow` onto an untyped row would delete exactly these lines,
    // and a session that collapsed the two back into one blanket refusal would
    // go red on the first.
    expect(backend).not.toContain("new PayoutBackendUnwired('subject')");
    expect(backend).toContain("member: 'subject.state'");
    expect(backend).toContain("member: 'subject.plan.size'");

    // **AND THE FOURTH MEMBER LEFT THIS LIST WITHOUT LEAVING THE REFUSAL SET,
    // WHICH IS ADR-295 IN ONE ASSERTION.** `insertPayoutRequest` answers on the
    // APPROVAL branch and refuses on the HOLD branch, so the plain refusal is
    // gone and a NARROWER one stands beside it. The needle is the hold arm,
    // asserted rather than dropped: slice 8 cannot be scheduled because
    // `HoldFlag.tosClause` has no value space and `DEP-M7-05` owes the clauses
    // to counsel, and a session that "completed" this member by inventing a
    // clause id would delete exactly this line.
    expect(backend).not.toContain("new PayoutBackendUnwired('insertPayoutRequest')");
    expect(backend).toContain("new PayoutBackendUnwired('insertPayoutRequest.hold')");
  });

  test('and the entry names what the SIZE ROW waits on as a HOME rather than as a rename', () => {
    // **`ADR-286` RULING 8, AND THIS IS THE CASE THAT KEEPS THE ENTRY FROM
    // SENDING THE NEXT SESSION AT THE WRONG TARGET.** The entry carried
    // `ADR-283`'s framing, which said a canonical decoder has to make one caller
    // rename. `ADR-286` measured the manifests and found the spelling is the
    // dependency graph rather than a preference, so there is no rename to
    // negotiate and the residue is a HOME: a driver-side decoder is needed by
    // `apps/api` and `apps/worker`, `RI-01` forecloses the engine, and the two
    // deployables cannot import each other.
    const reason = payoutReason();

    expect(reason).toContain('ADR-286');
    expect(reason).toContain('@merit/db');
    expect(reason).toContain('RI-01');
    expect(reason).toContain('payout_cap_schedule_cents');
    expect(reason).toContain('readCapSchedule');

    // THE RETIRED FRAMING, ASSERTED ABSENT AND ASSEMBLED RATHER THAN WRITTEN
    // OUT, on this file's own standing rule: a reason that reproduces its own
    // retired sentence reads as live to every grep, and to the predicate that
    // checks it is gone.
    expect(reason).not.toContain('has to make one caller ' + 'rename');
  });

  test('and the entry names the decoding that LANDED rather than the one that was missing', () => {
    // THE CLAUSE `ADR-283` RETIRED, ASSERTED AS ABSENT, on link 4's idiom and
    // for its reason: an entry still saying the blob cannot be decoded sends the
    // next session to build a codec that landed this wave.
    const reason = payoutReason();
    expect(reason).toContain('lastClosedTradingDay');
    expect(reason).toContain('ResolvedPlan');
    expect(reason).toContain('decodePlanRules');

    // THE TWO RETIRED SUMMARIES, ASSEMBLED RATHER THAN WRITTEN OUT, so this file
    // does not put either false sentence back into the repository's own grep
    // results.
    expect(reason).not.toContain('`plan` waits on ' + 'NOTHING');
    expect(reason).not.toContain('THE ENGINE DECLARES ' + 'NONE');
  });
});

describe("link 8: DATA_MODEL section 11's own example, decoded rather than paraphrased", () => {
  // **THESE CASES BELONG TO `packages/rules-engine` BY SUBJECT AND CANNOT LIVE
  // THERE.** That package's tsconfig declares no `node` types, which is `M01`'s
  // purity boundary reaching its test project, so `tsc --noEmit` refuses
  // `node:fs` inside it. Widening that project to read a document would be
  // spending the engine's I/O boundary on a test. This file already walks the
  // tree, and the question these cases ask -- what this deployable can produce
  // from a stored row -- is the question the file is named after.

  /** The `plan_versions.rules` block of the data-model README, parsed. */
  function corpusExample(): Record<string, unknown> {
    const doc = readFileSync(join(REPO_ROOT, 'docs/architecture/data-model/README.md'), 'utf8');
    const anchor = doc.indexOf('`plan_versions.rules` shape.');
    expect(anchor, 'the data-model README no longer carries the rules example').toBeGreaterThan(0);
    const open = doc.indexOf('```jsonc', anchor);
    const start = doc.indexOf('\n', open) + 1;
    return JSON.parse(doc.slice(start, doc.indexOf('```', start))) as Record<string, unknown>;
  }

  test('it carries `limits` and `kyc`, which are NOT on `PlanRulesJson`', () => {
    // **THE REASON THIS CODEC TOLERATES AN UNDECLARED KEY AND `gates-codec.ts`
    // DOES NOT.** The stored document is a SUPERSET by construction: `types.ts`
    // says `limits` and `kyc` are outside this module because "what
    // `validatePlan` may not see, it may not validate". A stray-key refusal here
    // would refuse the corpus's own example, which is MEASURED rather than
    // asserted.
    expect(Object.keys(corpusExample()).sort()).toEqual([
      'kyc',
      'limits',
      'phase_eval',
      'phase_funded',
      'schema_version',
    ]);
  });

  test('and it is REFUSED, by the name of the key two approved documents disagree about', () => {
    // **THIS IS ROW `283`'s QUESTION ANSWERED EXECUTABLY**: what happens to a
    // document written before a rule existed. `M01` section 2.4 requires
    // `min_settlement_lag_trading_days` and this example does not carry it, and
    // `ADR-258` section 6 ruled one field over that the key is READ and never
    // defaulted, "because a default here would be a plan parameter in
    // application code, and it would be invisible". So the corpus's own example
    // does not decode, LOUDLY and by name, rather than folding to `ADR-019`'s
    // zero behind a reader's back.
    //
    // WHAT CLOSES IT IS ONE LINE IN ONE OF TWO APPROVED DOCUMENTS, WHICH IS AN
    // ADR, and it is still cheap because no `plan_versions` row exists.
    expect(() => decodePlanRules(corpusExample())).toThrow(PlanRulesCodecError);
    expect(() => decodePlanRules(corpusExample())).toThrow(
      /phase_funded\.min_settlement_lag_trading_days: is absent/,
    );
  });

  test('and every OTHER key of the example decodes, so the refusal is that one key alone', () => {
    // The example plus the single key `M01` requires. If anything else in the
    // document disagreed with `PlanRulesJson`, this would name it instead, which
    // is what makes the case above a statement about ONE disagreement rather
    // than about a document nobody checked.
    const example = corpusExample();
    (example['phase_funded'] as Record<string, unknown>)['min_settlement_lag_trading_days'] = 0;
    const decoded = decodePlanRules(example);

    expect(decoded.schema_version).toBe(1);
    expect(decoded.phase_funded.min_payout_cents).toBe(10_000n);
    expect(decoded.phase_funded.split_bp).toBe(9000);
    expect(decoded.phase_eval.max_days).toBeNull();

    // AND THE UNDECLARED KEYS DID NOT SURVIVE INTO THE ENGINE'S VALUE, which is
    // the other half of tolerating them: they are ignored rather than carried,
    // so no rule downstream can grow a reader for one.
    expect(Object.keys(decoded).sort()).toEqual(['phase_eval', 'phase_funded', 'schema_version']);
  });
});
