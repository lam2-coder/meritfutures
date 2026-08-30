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

describe('link 6: the READER exists now, and the DAY it must select by does not reach it', () => {
  // **THE FIRST LINK ON THIS LIST TO CLOSE ON THIS DEPLOYABLE'S OWN SIDE.**
  // Links 1 to 3 were all `apps/worker`'s: a job nothing called, an adapter that
  // refused, a codec nobody had written. Link 4 is the empty table. What was
  // never a link at all, because nobody had asked for it, is the thing that
  // turns a stored row into the `RuleState` `PayoutSubject.state` declares, and
  // `ADR-264` writes it.
  //
  // AND THE LINK UNDER IT IS NEW, WHICH IS THIS ENTRY'S FIFTH TIME. `R-06` is
  // that no endpoint may evaluate eligibility against anything other than the
  // LAST CLOSED DAY. The reader therefore takes the day as an argument and has
  // no `latest` arm; the caller is the only thing that could know which day the
  // calendar says is closed, and a scoped payout transaction cannot read the
  // calendar at all.

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

  test('and `tradingCalendar` is `firm` and OUTSIDE the five keys ADR-233 catalogued', () => {
    // **THE BLOCKER UNDER THE READER, DERIVED ON THIS TREE RATHER THAN
    // ASSERTED.** `subject()` runs on the payout transaction, which is a
    // `ScopedTx`. `ADR-233` gave that handle a `firm`-class read over
    // `CATALOG_TABLE_KEYS`, a CLOSED list, and the calendar is not on it. So the
    // one fact that decides WHICH stored row `R-06` permits is unreadable
    // exactly where the state is read.
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

    // **AND THE READ EXISTS IN THIS DEPLOYABLE, ON A DIFFERENT DOOR, WHICH IS
    // WHY THIS IS A SECOND TRANSACTION RATHER THAN A MISSING CAPABILITY.**
    // `databaseEconomicCalendar` reads the same table through `ApiDb.firm`. So
    // what `subject()` needs is `ADR-211` clause 2's two-transaction remedy,
    // which `ADR-233` removed the need for on the CATALOGUE half and which
    // nothing has ruled on the CALENDAR half, or a sixth catalogued key. Both
    // are somebody's ruling and `ADR-264` takes neither.
    const api = codeOf(join(REPO_ROOT, 'apps/api/src/routes/economic-calendar.ts'));
    expect(api).toContain("tx.rowsWhere('tradingCalendar'");
    expect(api).toContain('db.firm(');
    expect(codeOf(join(REPO_ROOT, 'apps/api/src/db.ts'))).toContain(
      'firm<T>(fn: (tx: FirmTx) => Promise<T>): Promise<T>;',
    );
  });
});
