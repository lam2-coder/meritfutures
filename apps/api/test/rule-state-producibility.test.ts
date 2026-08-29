// =============================================================================
// apps/api/test/rule-state-producibility.test.ts
// =============================================================================
// WHY A `RuleState` CANNOT BE PRODUCED IN THIS DEPLOYMENT, AS FOUR PREDICATES
// RATHER THAN AS FOUR SENTENCES IN A REFUSAL MESSAGE.
//
// `usePayoutBackend`'s entry in `wiring.test.ts` is down to one clause and the
// clause is "a `RuleState` THIS DEPLOYMENT CANNOT PRODUCE". Session 429 asked
// what stands under it and found FOUR links, of which the first had never been
// named on this port or on `GET /accounts/:id/eligibility`: NOTHING RUNS THE
// JOB. The other three are the ones the two reasons already carry.
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

describe('link 1: no scheduler, and the worker deployable starts, runs nothing and exits 0', () => {
  test("the worker's entrypoint DECLARES `main` and never calls it, and the API's calls it", () => {
    // THE FIRST LINK, AND IT WAS NAMED BY NEITHER REASON UNTIL SESSION 429.
    // Both deployables start the same way, at `node --experimental-strip-types`
    // on one module. `apps/api/src/start.ts` ends with a call. The worker's
    // barrel ends with a DECLARATION, so the process loads 1,277 lines of
    // exports, binds nothing, schedules nothing and exits 0.
    //
    // THE COMPARATOR IS THE POINT AND NOT DECORATION. An assertion that the
    // worker has no `main()` call passes just as well when the spelling of the
    // entrypoint changes, when the barrel is renamed, or when this sweep reads
    // the wrong file. Asserting the API's call with the identical predicate on
    // the identical shape makes the sweep prove it can see one.
    const manifest = (app: string): { readonly scripts: Record<string, string> } =>
      JSON.parse(readFileSync(join(REPO_ROOT, 'apps', app, 'package.json'), 'utf8')) as {
        readonly scripts: Record<string, string>;
      };

    expect(manifest('worker').scripts['start']).toBe(
      'node --experimental-strip-types src/index.ts',
    );
    expect(manifest('api').scripts['start']).toBe('node --experimental-strip-types src/start.ts');

    const workerEntry = codeOf(join(REPO_ROOT, 'apps/worker/src/index.ts'));
    const apiEntry = codeOf(join(REPO_ROOT, 'apps/api/src/start.ts'));

    // The worker DECLARES one and exports it.
    expect(workerEntry).toContain('export function main(): void {');

    // Exactly one CALLS one, and the call is a top-level statement.
    expect(apiEntry).toContain('\nawait main();');
    expect(workerEntry).not.toContain('\nawait main();');
    expect(workerEntry).not.toContain('\nmain();');
  });

  test('nothing under any `src/` calls the batch, so no deployment ever folds a day', () => {
    // `runNightlyBatch` is `writeRuleStateVia`'s only caller and the writer is
    // the only site in the tree that inserts a `rule_states` row. THREE files
    // under `src/` name the batch: the module declaring it, the barrel
    // exporting it, and the API reason that NAMES IT INSIDE A STRING LITERAL,
    // which comment stripping does not reach. A FOURTH would be a scheduler or
    // an adapter. There is none.
    const namers = deployableSources()
      .filter((path) => codeOf(path).includes('runNightlyBatch'))
      .map(rel)
      .sort();
    expect(namers).toEqual([
      'apps/api/src/routes/account-reads.ts',
      'apps/worker/src/batch/nightly.ts',
      'apps/worker/src/index.ts',
    ]);
  });
});

describe('link 2: no `BatchPorts` value is constructed under any `src/`', () => {
  test('every satisfier of the port lives in a test double or in the demo world', () => {
    // The batch takes its I/O as an argument, so a caller needs a value. Under
    // `src/` there is none: `nightly.ts` and `replay.ts` NAME `BatchPorts` as a
    // PARAMETER TYPE, which is the opposite of implementing it.
    //
    // NON-VACUITY IS THE SECOND HALF AND IT IS WHY THE SWEEP RUNS TWICE. A
    // census that finds nothing proves nothing until the same predicate is
    // shown finding the four values that do exist, none of which opens a
    // connection: three test doubles and `scripts/demo/world.ts`, whose
    // `writeRuleState` refuses.
    const constructed = deployableSources()
      .filter((path) => codeOf(path).includes(': BatchPorts = '))
      .map(rel);
    expect(constructed).toEqual([]);

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
    expect(reason).toContain('NOTHING SCHEDULES THE JOB');
    expect(reason).toContain('exits 0');
    expect(reason).toContain('BatchPorts');
    expect(reason).toContain('encodeEngineGates');
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
