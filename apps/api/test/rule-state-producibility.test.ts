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

  test("and `hasPayoutInFlight` has NO single ruled predicate, because M01 states R-38's grain both ways", () => {
    // **THE THIRD FIELD'S SECOND LEG IS NOT A MISSING FUNCTION. IT IS A
    // CONTRADICTED ONE.** ADR-245 sized this leg as four column reads and one
    // refusal, and ADR-248 re-derived it and found that the in-flight leg has no
    // predicate to read: `M01` says R-38 counts an outstanding leg FOR THIS
    // ACCOUNT where it declares the field, and FOR THIS IDENTITY where it states
    // the rule. The two readings differ by exactly the population of identities
    // holding more than one account, which is every copy trader on the plan
    // maximum, and they differ ON THE DOOR WHERE MERIT PAYS.
    //
    // BOTH SIDES ARE SLICED OUT OF THE DOCUMENT RATHER THAN TYPED HERE, so the
    // day an ADR rules the grain one of these slices stops matching and this
    // case names it instead of going quietly stale.
    const m01 = readFileSync(join(REPO_ROOT, 'docs/plans/M01-rules-engine.md'), 'utf8');

    // Section 2.1's `ExternalGates` block, where the field is DECLARED.
    const block = m01.slice(m01.indexOf('interface ExternalGates {'));
    const declared = block.slice(0, block.indexOf('\n}')).split('\n');
    const field = declared.filter((line) => line.includes('hasPayoutInFlight:'));
    expect(field, 'section 2.1 no longer declares `hasPayoutInFlight` exactly once').toHaveLength(
      1,
    );
    expect(field[0]).toContain('exists for this account');

    // Group F's R-38 row, where the rule is STATED. It appears twice, because
    // M01 carries the rule table and its context-gate restatement, and both
    // copies say the same thing: naming the count keeps a future edit to one of
    // two visible, which is `0031`'s own reason for writing its two SD-09
    // predicates adjacent.
    const stated = m01
      .split('\n')
      .filter((line) => line.startsWith('| R-38 ') && line.includes('wallet-to-rail withdrawal'));
    expect(stated).toHaveLength(2);
    for (const row of stated) expect(row).toContain('withdrawal for this identity in');

    // AND THE ENGINE'S OWN CONTRACT MAY NOT PICK ONE EITHER. `types.ts` claimed
    // to reproduce section 2.1 verbatim and then wrote the identity reading
    // twice, which is the claim ADR-248 repaired: a caller reading the interface
    // to learn what to supply was being told a settled answer to an open
    // question. The repaired comment names both and rules neither, and this
    // assertion is what stops the next edit from quietly resolving it.
    const engine = readFileSync(join(REPO_ROOT, 'packages/rules-engine/src/types.ts'), 'utf8');
    const contract = engine.slice(
      engine.lastIndexOf('/**', engine.indexOf('export interface ExternalGates {')),
      engine.indexOf('/** R-40. Account `active` AND phase `funded`. */'),
    );
    expect(contract).toContain('for this account');
    expect(contract).toContain('for this identity');
    expect(contract).toContain('rules NEITHER');
  });

  test('and SD-09, the second line of defence for the same rule, is ACCOUNT grained', () => {
    // **THE INDEX IS THE ONE PLACE R-38 IS ENFORCED TODAY AND IT AGREES WITH THE
    // DECLARATION RATHER THAN WITH THE RULE ROW.** M01's AS-01 residual says the
    // same thing in prose ("None at account level. At identity level, ten
    // accounts can each hold one in-flight payout, which is AS-09") and AS-09 is
    // RULED at the gate as visibility rather than a rule, so a resolver taking
    // the identity reading would refuse nine of a copy trader's ten accounts
    // under a ceiling the corpus declined to impose.
    //
    // THAT IS WHY THIS LEG IS NOT A DEFAULT ANYBODY MAY PICK. One reading
    // refuses payouts the corpus permits; the other permits a stack the rule row
    // forbids. A resolver written today would be a route or a worker ruling a
    // contradiction inside a FROZEN plan, in a line nobody would read again.
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

    // AND THE STATUS SET HAS MOVED TWICE SINCE M01 WAS FROZEN, WHICH IS THE
    // SECOND HALF OF WHY THE LEG HAS NO PREDICATE. `evaluate.ts` records it:
    // ADR-028 retired `transferring` from this table and ADR-040 added
    // `held_pending_review`. The engine reads a resolved boolean so the drift
    // cannot reach the arithmetic, and the resolver is exactly where it lands.
    const m01 = readFileSync(join(REPO_ROOT, 'docs/plans/M01-rules-engine.md'), 'utf8');
    const block = m01.slice(m01.indexOf('interface ExternalGates {'));
    const line = block
      .slice(0, block.indexOf('\n}'))
      .split('\n')
      .find((row) => row.includes('hasPayoutInFlight:'));
    const note = (line ?? '').slice((line ?? '').indexOf('//') + 2);
    const frozen = note
      .slice(0, note.indexOf('exists for'))
      .split('|')
      .map((word) => word.trim());
    expect(frozen).toEqual(['approved', 'transferring', 'frozen']);
    expect(frozen.filter((member) => !outstanding.includes(member))).toEqual(['transferring']);
    expect(outstanding.filter((member) => !frozen.includes(member))).toEqual([
      'held_pending_review',
    ]);

    // NON-VACUITY, on this file's own standard: the identical parser is shown
    // reading the SUPERSEDED predicate, which carries two members rather than
    // three, so a parser that silently matched nothing would fail here.
    const superseded = [...statement('0010_payouts.sql').matchAll(/'(\w+)'/g)].map(
      (match) => match[1] ?? '',
    );
    expect(superseded).toEqual(['approved', 'frozen']);
  });
});
