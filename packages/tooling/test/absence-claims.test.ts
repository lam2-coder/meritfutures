// =============================================================================
// RI-35 IS WATCHED CATCHING THE FOUR OCCURRENCES THAT MOTIVATED IT
// =============================================================================
// `repo-invariants.test.ts`'s rule, which is falsify.mjs's rule: a check that
// has only ever been seen pass is indistinguishable from a check that cannot
// fail. This file goes further than one seed per leg because ADR-328's stop
// condition is stronger than that one.
//
// THE FOUR ROWS OF THE DEFECT'S RECORD ARE REBUILT AS THEY STOOD THE DAY THEY
// WENT STALE, EACH FROM `git show` ON THE COMMIT THAT REPAIRED IT, and each is
// watched going RED. Beside every reconstruction sits its COUNTERFACTUAL: the
// same tree with the artifact taken away, which is the tree the sentence was
// TRUE on, watched GREEN. A gate that is red on both is not catching anything.
//
// THE PROBES ARE THE SHIPPED ONES AND NOT COPIES. Every reconstruction reaches
// into `ABSENCE_ARTIFACTS` for the artifact by key, so a probe that stopped
// working would fail these cases rather than pass a second implementation of
// itself. What the fixtures write is the DDL and the prose, which is the input
// side, and that is where this file is allowed to keep its own spelling.
// =============================================================================

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  ABSENCE_ARTIFACTS,
  ABSENCE_CLAIMS,
  checkAbsenceClaims,
  ri35,
} from '../checks/absence-claims.mjs';
import { REPO_ROOT } from '../checks/repo-invariants.mjs';

const seeded: string[] = [];
afterEach(() => {
  for (const dir of seeded.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const write = (root: string, rel: string, body: string): void => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), body);
};

/**
 * A tree with a migration set and one source file, and nothing else.
 *
 * THE TWO SENTINELS ARE WHY BOTH ARE HERE. `migrations()` throws on a missing
 * or empty directory and the sweep throws on a `src/` walk that finds nothing,
 * both on ADR-294's rule that a check which cannot run is not a check that
 * passed. A fixture without them would make every case in this file an ERROR,
 * which is the sentinel working and the fixture wrong.
 */
function bareTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'merit-absence-'));
  seeded.push(root);
  write(root, 'packages/db/migrations/0001_init.sql', 'CREATE TABLE identities (id uuid);\n');
  write(root, 'packages/queue/src/job-queue.ts', 'export const JOB_QUEUE_METHODS = [];\n');
  return root;
}

/** The shipped artifact with this key, so a case never re-implements a probe. */
const artifact = (key: string) => {
  const found = ABSENCE_ARTIFACTS.find((a) => a.key === key);
  if (!found) throw new Error(`no such artifact: ${key}`);
  return found;
};

const only = (keys: readonly string[]) => keys.map(artifact);

// =============================================================================
// THE FOUR RECONSTRUCTIONS
// =============================================================================

describe('the four recorded occurrences, rebuilt as they stood, each watched red', () => {
  // ---------------------------------------------------------------------------
  // OCCURRENCE 1. `apps/api/src/routes/affiliate.ts`, falsified by `0078`.
  //
  // The text is `git show cd5dc8f9^:apps/api/src/routes/affiliate.ts` line 525,
  // which is the message `GET /affiliate/stats` served for a wave after the
  // migration merged. ADR-324 repaired it by hand and wrote a derivation for
  // that one site.
  // ---------------------------------------------------------------------------
  const OCCURRENCE_1 =
    "  'over `affiliate_commissions`, which is UNREGISTERED in `packages/db/src/scope.ts` and ' +";

  const occurrence1Register = {
    artifacts: only(['affiliate-commissions-owner-column']),
    claims: [
      {
        site: 'apps/api/src/routes/affiliate.ts',
        claim: OCCURRENCE_1,
        disposition: 'live' as const,
        artifact: 'affiliate-commissions-owner-column',
        why: 'the served refusal, as it stood on 2026-09-04',
      },
    ],
  };

  test('RED: the refusal says UNREGISTERED and `0078` is in the migration set', () => {
    const root = bareTree();
    write(root, 'apps/api/src/routes/affiliate.ts', `${OCCURRENCE_1}\n`);
    write(
      root,
      'packages/db/migrations/0078_affiliate_commission_owner.sql',
      'ALTER TABLE affiliate_commissions\n' +
        '  ADD COLUMN affiliate_id uuid NOT NULL REFERENCES affiliates(id) ON DELETE RESTRICT;\n',
    );

    const findings = checkAbsenceClaims(root, occurrence1Register);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('apps/api/src/routes/affiliate.ts says');
    expect(findings[0]).toContain('UNREGISTERED');
    expect(findings[0]).toContain('EXISTS. The sentence is false');
  });

  test('GREEN: the same tree with `0078` not yet written, which is when it was true', () => {
    const root = bareTree();
    write(root, 'apps/api/src/routes/affiliate.ts', `${OCCURRENCE_1}\n`);
    expect(checkAbsenceClaims(root, occurrence1Register)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // OCCURRENCE 2. `apps/worker/src/index.ts`, falsified by `0079`.
  //
  // `git show 886dbccb^:apps/worker/src/index.ts` lines 1416-1417. Three days
  // after the migration merged, the barrel still told a reader there was
  // nothing to enqueue into. ADR-326 repaired it and wrote a second derivation.
  // ---------------------------------------------------------------------------
  const OCCURRENCE_2 = [
    ' * WHAT IS STILL ABSENT IS NAMED RATHER THAN IMPLIED. The job store is still not',
    " * installed: pg-boss's schema is not in `packages/db/migrations`, so there is",
    ' * nothing to enqueue into, and the five other jobs this deployable has built',
  ].join('\n');

  const occurrence2Claim = {
    site: 'apps/worker/src/index.ts',
    claim: " * installed: pg-boss's schema is not in `packages/db/migrations`, so there is",
    disposition: 'live' as const,
    artifact: 'pgboss-job-store-migration',
    why: 'the worker barrel, as it stood on 2026-09-04',
  };

  test('RED: the barrel says the store is not installed and `0079` is in the set', () => {
    const root = bareTree();
    write(root, 'apps/worker/src/index.ts', `${OCCURRENCE_2}\n`);
    write(
      root,
      'packages/db/migrations/0079_pgboss_job_store.sql',
      'CREATE SCHEMA IF NOT EXISTS pgboss;\n',
    );

    const findings = checkAbsenceClaims(root, {
      artifacts: only(['pgboss-job-store-migration']),
      claims: [occurrence2Claim],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('apps/worker/src/index.ts says');
    expect(findings[0]).toContain("pg-boss's schema is not in");
    expect(findings[0]).toContain('EXISTS. The sentence is false');
  });

  test('GREEN: the same tree before `0079`, which is the tree the sentence was written on', () => {
    const root = bareTree();
    write(root, 'apps/worker/src/index.ts', `${OCCURRENCE_2}\n`);
    expect(
      checkAbsenceClaims(root, {
        artifacts: only(['pgboss-job-store-migration']),
        claims: [occurrence2Claim],
      }),
    ).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // OCCURRENCE 3. `packages/queue/src/pg-boss-queue.ts`, falsified by the SAME
  // `0079`, and this is the one that proves a hand repair does not scale.
  //
  // `git show e96cb8f0^:packages/queue/src/pg-boss-queue.ts`. ADR-326 repaired
  // the barrel, named this site in its section 8 finding 1, and left it; ADR-327
  // repaired it a row later. NOTHING BOUND THE SECOND SITE TO THE MIGRATION THAT
  // HAD ALREADY FALSIFIED IT.
  //
  // SO THIS CASE REGISTERS ONLY OCCURRENCE 2 AND PUTS BOTH FILES IN THE TREE.
  // Leg 2 reports the registered sentence and leg 6 reports the unregistered
  // one, which is the whole claim this row makes about scaling: register the
  // ARTIFACT once and every site naming it has to be accounted for.
  // ---------------------------------------------------------------------------
  const OCCURRENCE_3 = [
    '// arrives: as a numbered migration, whose body pg-boss itself emits through',
    '// `getConstructionPlans(schema)`. THAT MIGRATION DOES NOT EXIST YET and this',
    '// package cannot write it: migration numbers are allocated in ALLOCATION and',
  ].join('\n');

  test('RED TWICE: ADR-326`s repair would have reported ADR-327`s site as unregistered', () => {
    const root = bareTree();
    write(root, 'apps/worker/src/index.ts', `${OCCURRENCE_2}\n`);
    write(root, 'packages/queue/src/pg-boss-queue.ts', `${OCCURRENCE_3}\n`);
    write(
      root,
      'packages/db/migrations/0079_pgboss_job_store.sql',
      'CREATE SCHEMA IF NOT EXISTS pgboss;\n',
    );

    const findings = checkAbsenceClaims(root, {
      artifacts: only(['pgboss-job-store-migration', 'queue-door']),
      claims: [occurrence2Claim],
    });

    const registered = findings.filter((f) => f.includes('EXISTS. The sentence is false'));
    const swept = findings.filter((f) => f.includes('names a registered artifact and asserts'));
    expect(registered).toHaveLength(1);
    expect(registered[0]).toContain('apps/worker/src/index.ts says');
    expect(swept).toHaveLength(1);
    expect(swept[0]).toContain('packages/queue/src/pg-boss-queue.ts:2');
    expect(swept[0]).toContain('THAT MIGRATION DOES NOT EXIST YET');
  });

  test('THE WINDOW IS WHY IT IS SEEN: the needle sits on the line ABOVE the absence word', () => {
    // A line-scoped sweep reads `THAT MIGRATION DOES NOT EXIST YET and this` and
    // finds no artifact name on it, because `pg-boss itself emits` wrapped onto
    // the previous line. That is not a hypothetical: it is the real text.
    const root = bareTree();
    write(root, 'packages/queue/src/pg-boss-queue.ts', `${OCCURRENCE_3}\n`);
    write(
      root,
      'packages/db/migrations/0079_pgboss_job_store.sql',
      'CREATE SCHEMA IF NOT EXISTS pgboss;\n',
    );

    const line = OCCURRENCE_3.split('\n')[1] ?? '';
    expect(line).toContain('DOES NOT EXIST YET');
    expect(/pgboss|pg-boss|@merit\/queue|pgBossQueue/i.test(line)).toBe(false);

    const findings = checkAbsenceClaims(root, {
      artifacts: only(['queue-door']),
      claims: [
        {
          site: 'packages/queue/src/job-queue.ts',
          claim: 'export const JOB_QUEUE_METHODS = [];',
          disposition: 'live' as const,
          artifact: 'queue-door',
          why: 'the filler that keeps `queue-door` off leg 5 so the sweep reports alone',
        },
      ],
    });
    expect(findings.filter((f) => f.includes('names a registered artifact'))).toHaveLength(1);
  });

  test('GREEN: the same two files before `0079`', () => {
    const root = bareTree();
    write(root, 'apps/worker/src/index.ts', `${OCCURRENCE_2}\n`);
    write(root, 'packages/queue/src/pg-boss-queue.ts', `${OCCURRENCE_3}\n`);
    const findings = checkAbsenceClaims(root, {
      artifacts: only(['pgboss-job-store-migration', 'queue-door']),
      claims: [
        occurrence2Claim,
        {
          site: 'packages/queue/src/pg-boss-queue.ts',
          claim: '// `getConstructionPlans(schema)`. THAT MIGRATION DOES NOT EXIST YET and this',
          disposition: 'live' as const,
          artifact: 'pgboss-job-store-migration',
          why: 'the second site, as it stood on 2026-09-04',
        },
        {
          site: 'packages/queue/src/job-queue.ts',
          claim: 'export const JOB_QUEUE_METHODS = [];',
          disposition: 'live' as const,
          artifact: 'queue-door',
          why: 'the filler that keeps `queue-door` off leg 5 so the sweep reports alone',
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // OCCURRENCE 4. `scripts/db/probe_pgboss_job_store.sql`, falsified by `0082`.
  //
  // `git show 855f08f6:scripts/db/probe_pgboss_job_store.sql`. THE ROW SPLITS IN
  // TWO AND ONLY ONE HALF IS CATCHABLE HERE. The ABSENCE half -- "`0079`
  // deliberately grants nothing" -- is a claim about the migration set and this
  // check reports it. The other half -- that making the queue usable "means
  // granting CREATE" -- is a claim about what pg-boss DOES, which ADR-327
  // falsified by RUNNING it, and no probe over this tree can report a function's
  // behaviour under an option no caller in this workspace passes. It is
  // registered UNBINDABLE with that reason, which is `CI-06/gate-inventory`'s
  // own shape for a condition that is estate rather than tree.
  //
  // AND THE SITE IS A `.sql` FILE, so the sweep never reaches it. This
  // occurrence is caught by the REGISTER and not by leg 6, which is stated here
  // rather than left for a reader to infer from a passing test.
  // ---------------------------------------------------------------------------
  const OCCURRENCE_4 = [
    '-- and default privileges IN SCHEMA public only, so `merit_app` cannot see this',
    "-- schema at all. `0079` deliberately grants nothing, because pg-boss's",
    '-- `create_queue` runs `CREATE TABLE pgboss.%I` and making the queue usable by',
    "-- the application role means granting CREATE on a schema inside the ledger's",
  ].join('\n');

  const occurrence4Register = {
    artifacts: only(['pgboss-app-grant-migration']),
    claims: [
      {
        site: 'scripts/db/probe_pgboss_job_store.sql',
        claim: "-- schema at all. `0079` deliberately grants nothing, because pg-boss's",
        disposition: 'live' as const,
        artifact: 'pgboss-app-grant-migration',
        why: 'REJECTION 5`s header, as it stood on 2026-09-04',
      },
      {
        site: 'scripts/db/probe_pgboss_job_store.sql',
        claim: '-- the application role means granting CREATE on a schema inside the ledger',
        unbindable:
          'it is a claim about what `pgboss.create_queue` DOES rather than about what this ' +
          'tree contains. ADR-327 falsified it by running pg-boss under `SET ROLE merit_app`, ' +
          'and no probe over the tree reports a function`s behaviour under an option no ' +
          'caller in this workspace passes',
        why: 'the half of this header that measurement rather than a migration falsified',
      },
    ],
  };

  test('RED: the probe header says `0079` grants nothing and `0082` grants USAGE', () => {
    const root = bareTree();
    write(root, 'scripts/db/probe_pgboss_job_store.sql', `${OCCURRENCE_4}\n`);
    write(
      root,
      'packages/db/migrations/0082_pgboss_app_grants.sql',
      'GRANT USAGE ON SCHEMA pgboss TO merit_app;\n',
    );

    const findings = checkAbsenceClaims(root, occurrence4Register);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('scripts/db/probe_pgboss_job_store.sql says');
    expect(findings[0]).toContain('deliberately grants nothing');
    expect(findings[0]).toContain('EXISTS. The sentence is false');
  });

  test('GREEN: the same header before `0082`, and the unbindable half stays quiet', () => {
    const root = bareTree();
    write(root, 'scripts/db/probe_pgboss_job_store.sql', `${OCCURRENCE_4}\n`);
    expect(checkAbsenceClaims(root, occurrence4Register)).toEqual([]);
  });
});

// =============================================================================
// ONE SEEDED VIOLATION PER LEG
// =============================================================================

describe('each leg fails on the violation it names', () => {
  const bound = (over: Partial<Record<string, unknown>> = {}) => ({
    site: 'apps/worker/src/index.ts',
    claim: '// the job store is not installed and no migration installs it',
    disposition: 'live' as const,
    artifact: 'pgboss-job-store-migration',
    why: 'a synthetic claim, so a case can break exactly one clause of it',
    ...over,
  });

  const withClaimFile = (): string => {
    const root = bareTree();
    write(root, 'apps/worker/src/index.ts', `${bound().claim}\n`);
    return root;
  };

  test('LEG 1 reports a site that does not exist', () => {
    const root = bareTree();
    const findings = checkAbsenceClaims(root, {
      artifacts: only(['pgboss-job-store-migration']),
      claims: [bound()],
    });
    expect(findings.join('\n')).toContain('is registered as an absence-claim site and does not');
  });

  test('LEG 1 reports a sentence that was reworded out from under its entry', () => {
    const root = bareTree();
    write(root, 'apps/worker/src/index.ts', '// the job store is not installed, and it is fine\n');
    const findings = checkAbsenceClaims(root, {
      artifacts: only(['pgboss-job-store-migration']),
      claims: [bound()],
    });
    expect(findings.join('\n')).toContain('0 times');
    expect(findings.join('\n')).toContain('the register did not move with it');
  });

  test('LEG 1 reports an anchor that identifies two lines', () => {
    const root = bareTree();
    write(root, 'apps/worker/src/index.ts', `${bound().claim}\n${bound().claim}\n`);
    const findings = checkAbsenceClaims(root, {
      artifacts: only(['pgboss-job-store-migration']),
      claims: [bound()],
    });
    expect(findings.join('\n')).toContain('2 times');
    expect(findings.join('\n')).toContain('does not identify one site');
  });

  test('LEG 2 reports a live claim whose artifact landed', () => {
    const root = withClaimFile();
    write(
      root,
      'packages/db/migrations/0079_pgboss_job_store.sql',
      'CREATE SCHEMA IF NOT EXISTS pgboss;\n',
    );
    const findings = checkAbsenceClaims(root, {
      artifacts: only(['pgboss-job-store-migration']),
      claims: [bound()],
    });
    expect(findings.join('\n')).toContain('EXISTS. The sentence is false');
  });

  test('LEG 3 reports a sentence retired while it was still true', () => {
    const root = withClaimFile();
    const findings = checkAbsenceClaims(root, {
      artifacts: only(['pgboss-job-store-migration']),
      claims: [bound({ disposition: 'retired' })],
    });
    expect(findings.join('\n')).toContain('as a RETIRED absence claim');
    expect(findings.join('\n')).toContain('is still ABSENT');
  });

  test('LEG 3 is quiet when the retired sentence`s artifact really did land', () => {
    const root = withClaimFile();
    write(
      root,
      'packages/db/migrations/0079_pgboss_job_store.sql',
      'CREATE SCHEMA IF NOT EXISTS pgboss;\n',
    );
    expect(
      checkAbsenceClaims(root, {
        artifacts: only(['pgboss-job-store-migration']),
        claims: [bound({ disposition: 'retired' })],
      }),
    ).toEqual([]);
  });

  test('LEG 4 refuses an unbindable entry that also names an artifact', () => {
    const root = withClaimFile();
    const findings = checkAbsenceClaims(root, {
      artifacts: only(['pgboss-job-store-migration']),
      claims: [
        bound({
          unbindable: 'a reason long enough to pass the length leg but not the shape leg',
        }),
      ],
    });
    expect(findings.join('\n')).toContain('as unbindable AND names an artifact');
  });

  test('LEG 4 refuses an unbindable entry whose reason says nothing', () => {
    const root = withClaimFile();
    const findings = checkAbsenceClaims(root, {
      artifacts: only(['pgboss-job-store-migration']),
      claims: [
        {
          site: 'apps/worker/src/index.ts',
          claim: bound().claim,
          unbindable: 'no probe exists',
          why: 'a reason nobody could weigh',
        },
        bound({ disposition: 'retired' as const, site: 'apps/worker/src/index.ts' }),
      ],
    });
    expect(findings.join('\n')).toContain('character(s)');
    expect(findings.join('\n')).toContain('the reason is');
  });

  test('LEG 4 reports a claim bound to an artifact nobody declared', () => {
    const root = withClaimFile();
    const findings = checkAbsenceClaims(root, {
      artifacts: only(['pgboss-job-store-migration']),
      claims: [bound({ artifact: 'a-key-no-register-entry-declares' })],
    });
    expect(findings.join('\n')).toContain('which no artifact register entry declares');
  });

  test('LEG 5 reports an artifact no claim names', () => {
    const root = withClaimFile();
    const findings = checkAbsenceClaims(root, {
      artifacts: only(['pgboss-job-store-migration', 'worker-queue-manifest']),
      claims: [bound()],
    });
    expect(findings.join('\n')).toContain('`worker-queue-manifest` and no claim names it');
  });

  test('LEG 6 reports an absence claim about a registered artifact that nobody registered', () => {
    const root = bareTree();
    write(
      root,
      'apps/worker/src/db.ts',
      '// `@merit/queue` publishes a `JobQueue` and\n// no module here imports it\n',
    );
    const findings = checkAbsenceClaims(root, {
      artifacts: only(['queue-door']),
      claims: [
        {
          site: 'packages/queue/src/job-queue.ts',
          claim: 'export const JOB_QUEUE_METHODS = [];',
          disposition: 'live' as const,
          artifact: 'queue-door',
          why: 'the filler that keeps `queue-door` off leg 5 so the sweep reports alone',
        },
      ],
    });
    expect(findings.join('\n')).toContain('apps/worker/src/db.ts:2');
    expect(findings.join('\n')).toContain('names a registered artifact and asserts an absence');
  });

  test('LEG 6 is quiet on a needle with no absence word beside it', () => {
    const root = bareTree();
    write(root, 'apps/worker/src/db.ts', '// `@merit/queue` publishes a `JobQueue`.\n');
    expect(
      checkAbsenceClaims(root, {
        artifacts: only(['queue-door']),
        claims: [
          {
            site: 'packages/queue/src/job-queue.ts',
            claim: 'export const JOB_QUEUE_METHODS = [];',
            disposition: 'live' as const,
            artifact: 'queue-door',
            why: 'the filler that keeps `queue-door` off leg 5 so the sweep reports alone',
          },
        ],
      }),
    ).toEqual([]);
  });
});

// =============================================================================
// THE SENTINELS, WHICH ARE ERRORS AND NEVER SILENCES
// =============================================================================

describe('a check that cannot reach its inputs throws rather than passing', () => {
  const claim = {
    site: 'apps/worker/src/index.ts',
    claim: '// the job store is not installed and no migration installs it',
    disposition: 'live' as const,
    artifact: 'pgboss-job-store-migration',
    why: 'a synthetic claim',
  };

  test('a missing migration set is an ERROR and not an absent migration', () => {
    const root = mkdtempSync(join(tmpdir(), 'merit-absence-'));
    seeded.push(root);
    write(root, 'apps/worker/src/index.ts', `${claim.claim}\n`);
    expect(() =>
      checkAbsenceClaims(root, {
        artifacts: only(['pgboss-job-store-migration']),
        claims: [claim],
      }),
    ).toThrow(/does not exist, and three of the four occurrences/);
  });

  test('an empty migration set is an ERROR too', () => {
    const root = mkdtempSync(join(tmpdir(), 'merit-absence-'));
    seeded.push(root);
    mkdirSync(join(root, 'packages/db/migrations'), { recursive: true });
    write(root, 'apps/worker/src/index.ts', `${claim.claim}\n`);
    expect(() =>
      checkAbsenceClaims(root, {
        artifacts: only(['pgboss-job-store-migration']),
        claims: [claim],
      }),
    ).toThrow(/found no `\.sql` file/);
  });

  test('a tree with no shipped source is an ERROR for the import probes', () => {
    const root = mkdtempSync(join(tmpdir(), 'merit-absence-'));
    seeded.push(root);
    write(root, 'apps/worker/src/index.ts', '');
    rmSync(join(root, 'apps/worker/src/index.ts'));
    expect(() =>
      checkAbsenceClaims(root, {
        artifacts: only(['queue-door']),
        claims: [
          {
            site: 'apps/worker/src/index.ts',
            claim: 'x',
            disposition: 'live' as const,
            artifact: 'queue-door',
            why: 'a synthetic claim',
          },
        ],
      }),
    ).toThrow(/found no source file under any/);
  });

  test('a missing manifest is an ERROR and not a manifest declaring nothing', () => {
    const root = bareTree();
    write(root, 'apps/worker/src/index.ts', `${claim.claim}\n`);
    expect(() =>
      checkAbsenceClaims(root, {
        artifacts: only(['api-queue-manifest']),
        claims: [
          {
            site: 'apps/worker/src/index.ts',
            claim: claim.claim,
            disposition: 'live' as const,
            artifact: 'api-queue-manifest',
            why: 'a synthetic claim',
          },
        ],
      }),
    ).toThrow(/apps\/api\/package\.json does not exist/);
  });

  test('two artifacts under one key is an ERROR, because one probe would shadow the other', () => {
    const root = bareTree();
    const one = artifact('pgboss-job-store-migration');
    expect(() => checkAbsenceClaims(root, { artifacts: [one, one], claims: [] })).toThrow(
      /two artifacts registered under one key/,
    );
  });
});

// =============================================================================
// THE LIVE REGISTER, AGAINST THE TREE IT IS ABOUT
// =============================================================================

describe('the shipped register holds on this repository', () => {
  test('RI-35 finds nothing', () => {
    expect(ri35.run(REPO_ROOT)).toEqual([]);
  });

  // NON-VACUITY, AND IT IS THE CASE THIS CHECK WOULD BE DECORATION WITHOUT.
  // A register of zero claims passes every leg, so the shape has to be
  // measured rather than assumed. The numbers are DERIVED from the register at
  // the moment the case runs, and the assertions are bounds rather than
  // equalities so that adding a claim is not a test failure.
  test('the register binds real claims in both dispositions', () => {
    const live = ABSENCE_CLAIMS.filter((c) => c.disposition === 'live');
    const retired = ABSENCE_CLAIMS.filter((c) => c.disposition === 'retired');
    expect(live.length).toBeGreaterThanOrEqual(5);
    expect(retired.length).toBeGreaterThanOrEqual(4);
    expect(ABSENCE_ARTIFACTS.length).toBeGreaterThanOrEqual(5);
    expect(ABSENCE_ARTIFACTS.some((a) => a.needles.length > 0)).toBe(true);
  });

  // THE FOUR RECORDED OCCURRENCES ARE EACH REGISTERED AT THEIR OWN SITE, so a
  // later session cannot quietly drop the binding that this row exists to
  // install. The sites are named here and read out of the register, which is
  // the one place this file states a fact about the shipped data.
  test('all four occurrences are registered, retired, at their own files', () => {
    for (const site of [
      'apps/api/src/routes/affiliate.ts',
      'apps/worker/src/index.ts',
      'packages/queue/src/pg-boss-queue.ts',
      'scripts/db/probe_pgboss_job_store.sql',
    ]) {
      const at = ABSENCE_CLAIMS.filter((c) => c.site === site && c.disposition === 'retired');
      expect({ site, retired: at.length > 0 }).toEqual({ site, retired: true });
    }
  });

  // EVERY PROBE IS WATCHED RETURNING BOTH VALUES SOMEWHERE IN THIS FILE OR
  // HERE. A probe that can only ever answer one way is a leg that cannot fail,
  // which is the defect one layer under the one this check is about.
  test('every shipped probe answers on this tree without throwing', () => {
    for (const a of ABSENCE_ARTIFACTS) {
      expect({ key: a.key, answer: a.probe(REPO_ROOT) }).toEqual({
        key: a.key,
        answer: expect.stringMatching(/^(present|absent)$/) as unknown as string,
      });
    }
  });

  test('both answers occur on this tree, so neither branch is unreachable', () => {
    const answers = new Set(ABSENCE_ARTIFACTS.map((a) => a.probe(REPO_ROOT)));
    expect([...answers].sort()).toEqual(['absent', 'present']);
  });
});
