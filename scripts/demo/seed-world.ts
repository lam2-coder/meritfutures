// =============================================================================
// scripts/demo/seed-world.ts
// =============================================================================
// THE RUN: seed the world, replay it, compare the replay against the seed's own
// expectation, and then prove the comparison can fail.
//
//   node scripts/demo/seed-world.mjs
//   node scripts/demo/seed-world.mjs --seed abc --days 40 --accounts 3
//
// `runSeedWorld` IS PURE AND `main` IS THE ONLY THING THAT WRITES, which is
// `main.ts`'s rule and is what lets the whole run be asserted from a test
// without capturing stdout.
//
// -----------------------------------------------------------------------------
// THREE CHECKS, AND THE THIRD IS THE ONE THAT MAKES THE OTHER TWO WORTH READING
// -----------------------------------------------------------------------------
//   1. THE WORLD IS THERE. `accountsAudited > 0`, which is the refusal
//      [ADR-073](../../docs/decisions/ADR-073.md) section 5 promised this leg
//      would carry: "when it is built it refuses on `accountsAudited === 0`".
//      `runReplayAudit`'s own `OI-14` guard fires on `storedRows > 0 &&
//      inScope === 0` and therefore cannot see the empty world at all.
//      **THAT REFUSAL IS THE AUDIT'S AND NOT THIS RUNNER'S**, as of
//      [ADR-123](../../docs/decisions/ADR-123.md): it lived in
//      [`world.ts`](world.ts)'s caller until then, because `apps/worker` was
//      outside session 231's fence, and ADR-119 clause 7 rowed the move as owed
//      on the ground that "a refusal in the caller is weaker than a refusal in
//      the audit, because the next caller inherits nothing". This run inherits
//      it. So does the nightly job, and so does every caller after them.
//   2. THE REPLAY REPRODUCES THE SEED. Every counter of the report against the
//      figure the seed counted BEFORE the audit ran: accounts, stored rows, in
//      scope, out of scope, matched, diverged, and the number of divergences
//      actually handed to the write port. This is INV-04 over a world that
//      exists, which is the sentence `CI-09`'s row has been waiting to be able
//      to say since 2026-08-20.
//   3. THE AUDIT CAN FAIL. One stored row is given a balance the engine never
//      computed and a hash over that wrong balance, and the audit must report
//      exactly one divergence, on exactly that account and day, naming
//      `balance_cents`. Without this a green run proves the audit ran, not that
//      it looks at anything.
//
// **CHECK 3 IS NOT A UNIT TEST THAT WANDERED IN.** `repo-invariants.mjs` rule 2,
// inherited by every gate runner in this tree, is "A CHECK THAT CANNOT RUN IS
// NOT A CHECK THAT PASSED", and its nightly-shaped corollary is that a check
// that cannot FAIL is not a check that passed either. `nightly.yml` already
// makes the same argument about the harness leg and spends a whole job on it:
// "a NIGHTLY that quietly stops asserting is green forever and nobody is
// looking."
//
// -----------------------------------------------------------------------------
// WHAT THIS RUN DOES NOT PROVE, STATED IN THE OUTPUT AND NOT ONLY HERE
// -----------------------------------------------------------------------------
// It is a fold and a replay over a synthetic population, and every boundary
// `scripts/demo/README.md` states about the demo holds here unchanged: no
// settlement ever happens, the calendar is consecutive weekdays and not the CME
// publication, the context gates are constants, and the file and the normalizer
// are skipped. It also proves nothing about Postgres, because there is no
// adapter implementing `BatchPorts` over it; that is ADR-119's central
// measurement and it is printed on every run rather than left in a ruling.
// =============================================================================

import { ReplayAuditRefusal } from '../../apps/worker/src/index.ts';

import {
  DEFAULT_WORLD,
  DemoWorldRefusal,
  auditDemoWorld,
  buildDemoWorld,
  checkAgainstExpectation,
  perturbDemoWorld,
  type DemoWorld,
  type DemoWorldOptions,
} from './world.ts';

export const USAGE = `merit demo world: the seeded world, replayed and self-audited

  node scripts/demo/seed-world.mjs [options]

  --seed <string>       the run seed. The same seed seeds the same world
  --days <n>            trading sessions to seed          (default ${String(DEFAULT_WORLD.sessionCount)})
  --accounts <n>        accounts per cohort               (default ${String(DEFAULT_WORLD.accountsPerCohort)})
  --start <yyyy-mm-dd>  first trading day                 (default ${DEFAULT_WORLD.startDay})
  --help                this

Everything runs in memory. There is no database, no file is written, and no
network call is made. See docs/decisions/ADR-119.md for why the world is a value
and not a Postgres seed.
`;

/** `main.ts`'s parser, over this run's flags. It refuses rather than defaulting. */
export function parseArgs(argv: readonly string[]): DemoWorldOptions | 'help' {
  const options = { ...DEFAULT_WORLD };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') return 'help';

    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${String(flag)} needs a value`);
    i += 1;

    switch (flag) {
      case '--seed':
        options.seed = value;
        break;
      case '--days':
        options.sessionCount = positiveInteger('--days', value);
        break;
      case '--accounts':
        options.accountsPerCohort = positiveInteger('--accounts', value);
        break;
      case '--start':
        options.startDay = value;
        break;
      default:
        throw new Error(`unknown flag ${String(flag)}`);
    }
  }

  return options;
}

function positiveInteger(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} wants a positive integer, not ${value}`);
  }
  return parsed;
}

export interface SeedWorldResult {
  readonly text: string;
  /** 0 when every check held. Non-zero is a finding and never a warning. */
  readonly code: number;
  readonly world: DemoWorld;
}

const money = (cents: bigint): string => {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const part = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}$${whole.toString()}.${part}`;
};

/** The whole run, as a string and an exit code. No I/O. */
export async function runSeedWorld(options: DemoWorldOptions): Promise<SeedWorldResult> {
  const lines: string[] = [];
  const findings: string[] = [];
  const say = (text = ''): void => void lines.push(text);

  const world = buildDemoWorld(options);

  say('merit demo world: seeded, replayed, self-audited');
  say('='.repeat(78));
  say();
  say(`seed                  ${world.seed}`);
  say(`window                ${String(world.sessionCount)} session(s) from ${world.startDay}`);
  say(`plan                  Core EOD at 50K, ${money(world.plan.sizeCents)}`);
  say(`engine_version        ${world.engineVersion}`);
  say(`calendar_revision_id  ${String(world.calendarRevisionId)}`);
  say();

  // ---------------------------------------------------------------------------
  // The world
  // ---------------------------------------------------------------------------
  say('THE WORLD THE SEED BUILT');
  say('-'.repeat(78));
  say('account                                cohort        ref             days rows outcome');
  for (const account of world.accounts) {
    say(
      `${account.accountId}  ${account.cohort.padEnd(12)}  ` +
        `${account.platformAccountRef.padEnd(14)}  ` +
        `${String(account.days.length).padStart(4)} ${String(account.rows.length).padStart(4)} ` +
        `${account.outcome}${account.refusedOn === null ? '' : ` on ${String(account.refusedOn)}`}`,
    );
  }
  say();

  const seeded = world.expectation;
  say(
    `${String(seeded.accountsAudited)} account(s) with stored state, ` +
      `${String(seeded.storedRows)} stored row(s). ` +
      `${String(seeded.reachedFunded)} reached funded, ${String(seeded.breached)} breached, ` +
      `${String(seeded.graduated)} graduated, ${String(seeded.refused)} refused, ` +
      `${String(seeded.stillTrading)} still trading.`,
  );
  say();

  // ---------------------------------------------------------------------------
  // Check 1 and 2: the replay reproduces the seed
  // ---------------------------------------------------------------------------
  say('CHECK 1 and 2  THE WORLD IS THERE, AND THE REPLAY REPRODUCES IT (INV-04)');
  say('-'.repeat(78));

  const audit = await auditDemoWorld(world);
  const mismatches = checkAgainstExpectation(audit);

  say('counter             seeded   replayed');
  for (const field of [
    'accountsAudited',
    'storedRows',
    'inScope',
    'outOfScope',
    'matched',
    'diverged',
  ] as const) {
    say(
      `${field.padEnd(18)}  ${String(seeded[field]).padStart(6)}   ` +
        `${String(audit.report[field]).padStart(8)}`,
    );
  }
  say(
    `${'divergencesRaised'.padEnd(18)}  ${String(seeded.diverged).padStart(6)}   ` +
      `${String(audit.divergences.length).padStart(8)}`,
  );
  say();

  for (const mismatch of mismatches) {
    findings.push(
      `the replay's ${mismatch.field} is ${String(mismatch.reported)} and the seed counted ` +
        `${String(mismatch.expected)}. INV-04 is that replaying every mark from day one ` +
        'reproduces stored state byte-identically, and this world was folded once',
    );
  }
  say(
    mismatches.length === 0
      ? 'HELD. Every counter the seed recorded before the audit ran is the counter the ' +
          'audit reported.'
      : `${String(mismatches.length)} counter(s) disagree. See the findings below.`,
  );
  say();

  // ---------------------------------------------------------------------------
  // Check 3: the audit can fail
  // ---------------------------------------------------------------------------
  say('CHECK 3  THE AUDIT CAN FAIL (one cent, one row, hash recomputed over it)');
  say('-'.repeat(78));

  const perturbed = perturbDemoWorld(world);
  const perturbedAudit = await auditDemoWorld(perturbed);
  const perturbedMismatches = checkAgainstExpectation(perturbedAudit);

  const target = perturbed.accounts[0];
  const targetRow = target?.rows[0];
  const raised = perturbedAudit.divergences;
  const first = raised[0];
  const fields = first === undefined ? [] : first.divergences.map((d) => d.field);

  say(
    `perturbed             ${target?.accountId ?? '<none>'} on ` +
      `${targetRow === undefined ? '<none>' : String(targetRow.tradingDay)}`,
  );
  say(`divergences raised    ${String(raised.length)}`);
  say(`fields named          ${fields.length === 0 ? '<none>' : fields.join(', ')}`);
  say();

  if (perturbedAudit.report.diverged !== 1) {
    findings.push(
      `the perturbed world reported ${String(perturbedAudit.report.diverged)} diverged row(s) ` +
        'and exactly one row was perturbed. An audit that does not see a one-cent balance ' +
        'error in a row whose hash covers it is not comparing what it claims to compare',
    );
  }
  if (raised.length !== 1) {
    findings.push(
      `${String(raised.length)} divergence finding(s) reached the write port and one row was ` +
        'perturbed. EVENTS.md:194 makes `replay.divergence_detected` one of the two events ' +
        'that must never be quiet',
    );
  }
  if (!fields.includes('balance_cents')) {
    findings.push(
      `the divergence named ${fields.length === 0 ? 'no field' : fields.join(', ')} and the ` +
        'perturbed field was `balance_cents`. B.2 compares the hash first and diffs field by ' +
        'field only on mismatch, and the field diff exists to NAME the field',
    );
  }
  if (perturbedMismatches.length !== 0) {
    findings.push(
      `the perturbed world disagreed with its own expectation on ` +
        `${perturbedMismatches.map((m) => m.field).join(', ')}. A corrupted stored row poisons ` +
        'no later comparison, because the replay chains its own prior from day one',
    );
  }

  say(
    findings.length === 0
      ? 'HELD. One cent moved, one divergence reported, and it named the column.'
      : 'See the findings below.',
  );
  say();

  // ---------------------------------------------------------------------------
  // What this run does not prove. Printed every time, per nightly-harness.mjs.
  // ---------------------------------------------------------------------------
  say('WHAT THIS RUN DOES NOT PROVE');
  say('-'.repeat(78));
  say('  Postgres      There is no adapter implementing `BatchPorts` over the database');
  say('                (apps/worker/src/index.ts), and `rule_states` has no column for');
  say('                lifetimeSettledCents, breached or breachKind, so `loadAccountDay`');
  say('                could not serve a `prior` even with one. ADR-119 section 3.');
  say('  settlements   Every AccountDay.settlements is empty. Group H never runs and');
  say('                R-37 is skipped on every row.');
  say('  the calendar  Consecutive weekdays, not the CME publication (P2 section 6).');
  say('                R-04 is present in the engine and unexercised here.');
  say('  the file      The EOD report and the normalizer are skipped (INV-M2-11).');
  say("  the schedule  Nothing runs this nightly. CI-09's replay leg is a workflow job");
  say('                that ADR-119 records as OWED; this run is its body.');
  say();

  if (findings.length > 0) {
    say('FINDINGS');
    say('-'.repeat(78));
    for (const [i, finding] of findings.entries()) say(`  ${String(i + 1)}. ${finding}`);
    say();
  }

  say(
    findings.length === 0
      ? 'PASS  the world seeded, the replay reproduced it, and the audit proved it can fail.'
      : `FAIL  ${String(findings.length)} finding(s).`,
  );

  return { text: `${lines.join('\n')}\n`, code: findings.length === 0 ? 0 : 1, world };
}

/** The shell. Returns the exit code rather than calling `process.exit`. */
export async function main(
  argv: readonly string[],
  write: (text: string) => void,
  writeError: (text: string) => void,
): Promise<number> {
  let options: DemoWorldOptions | 'help';
  try {
    options = parseArgs(argv);
  } catch (error) {
    writeError(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }

  if (options === 'help') {
    write(USAGE);
    return 0;
  }

  try {
    const result = await runSeedWorld(options);
    write(result.text);
    return result.code;
  } catch (error) {
    // A REFUSAL IS A FINDING AND NOT A CRASH, and it exits non-zero with the
    // reason on stderr. `DemoWorldRefusal` is the empty world and the money
    // field that is not a bigint; `ReplayAuditRefusal` is OI-14 and the history
    // that is not one account life. Both are the audit declining to report, and
    // an audit that declines to report must never look like one that found
    // nothing (FM-17).
    // `DemoWorldRefusal` is the money field that is not a bigint and the sealed
    // world's write port; `ReplayAuditRefusal` is the AUDIT declining to report,
    // which is now the empty world (ADR-123) as well as OI-14 and the history
    // that is not one account life. BOTH ARE REFUSALS AND NEITHER IS A CRASH, so
    // both carry the label: an audit that declines to report must never look
    // like one that found nothing (FM-17), and it must not look like a bug in
    // the runner either.
    const refused = error instanceof DemoWorldRefusal || error instanceof ReplayAuditRefusal;
    const label = refused ? 'REFUSED' : 'ERROR';
    writeError(`${label}  ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
