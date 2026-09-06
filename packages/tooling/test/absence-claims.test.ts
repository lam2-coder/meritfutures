// =============================================================================
// RI-35 IS WATCHED CATCHING THE OCCURRENCES THAT MOTIVATED IT
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
//
// ADR-330 ADDED THE SEVENTH, AND IT IS THE FIRST ONE A CHECK FOUND RATHER THAN
// A READER. Its reconstruction sits at the foot of this file with the cases
// holding the widened sweep scope open, and its counterfactual is a different
// shape from the four above: it was falsified by a GUARD landing inside a file
// that already existed rather than by a migration arriving.
// =============================================================================

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  // ADR-330. THE SEVENTH IS REGISTERED TOO, and its site is the reason the
  // sweep was widened, so a session that narrows the scope back to the shipped
  // tree loses this binding and this case says so at that moment.
  test('the seventh occurrence is registered, retired, at its own file under `scripts/`', () => {
    const at = ABSENCE_CLAIMS.filter(
      (c) => c.site === 'scripts/corpus/data-model-columns.mjs' && c.disposition === 'retired',
    );
    expect(at).toHaveLength(1);
    expect(at[0]?.artifact).toBe('gates-importable');
  });

  // THE STALE SENTENCE IS ASSERTED ABSENT FROM THE LIVE FILE EXCEPT AS A QUOTED
  // RETIREMENT, which is `RI-14`'s shape and ADR-329 section 6's rule. Without
  // it, the case above goes on asserting a binding over a repair somebody
  // reverted, and reports GREEN while the file says the false thing again.
  test('the repaired header states the retirement and no longer asserts the absence', () => {
    const body = readFileSync(join(REPO_ROOT, 'scripts/corpus/data-model-columns.mjs'), 'utf8');
    const lines = body.split('\n').filter((l) => l.includes('IT CANNOT BE IMPORTED'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('THIS PARAGRAPH READ');
    expect(body).toContain('IT CAN NOW BE IMPORTED');
  });

  // THE TWO THE WIDENED SCOPE SURFACED AND COULD NOT BIND. Both quote somebody
  // else's thrown error text -- pg-boss's and PostgreSQL's -- so both are
  // `unbindable` with a reason rather than a narrowed needle, and leg 4 already
  // demands the reason be readable. This case demands they stay unbound: an
  // entry quietly given a disposition would be a claim about a vendor's
  // behaviour asserted against this tree.
  test('the two claims the widened scope surfaced are unbindable and name no artifact', () => {
    for (const site of [
      'scripts/db/assert_pgboss_schema_matches_library.mjs',
      'scripts/db/probe_pgboss_job_store.sql',
    ]) {
      const at = ABSENCE_CLAIMS.filter((c) => c.site === site && c.unbindable !== undefined);
      expect({ site, count: at.length }).toEqual({ site, count: 1 });
      expect({ site, artifact: at[0]?.artifact, disposition: at[0]?.disposition }).toEqual({
        site,
        artifact: undefined,
        disposition: undefined,
      });
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

// =============================================================================
// ADR-330. THE SEVENTH OCCURRENCE, AND THE SCOPE THAT COULD NOT SEE IT
// =============================================================================
// ADR-328 shipped leg 6 over `apps/*/src` and `packages/*/src` and said in its
// own approval block that `scripts/` was the weakest line it drew, because
// occurrence 4 lived there and was registered by hand for exactly that reason.
// ADR-329 finding 6 then found the SEVENTH occurrence at
// `scripts/corpus/data-model-columns.mjs`, in the directory the sweep did not
// read. These cases hold the widened scope open.
//
// THE COUNTERFACTUAL HERE IS A DIFFERENT SHAPE FROM THE FOUR ABOVE, and it is
// worth naming. Occurrences 1 to 4 were falsified by a MIGRATION, so their
// counterfactual is the migration set with one file removed. This one was
// falsified by a GUARD landing inside a file that already existed, so its
// counterfactual is the same file as it stood before `55824c62`: ending in an
// unguarded `process.exit(main())` with nothing exported.
// =============================================================================

describe('the seventh occurrence, in the directory the sweep learned to read', () => {
  // The verbatim text out of `git show aef3bfc7:scripts/corpus/data-model-columns.mjs`
  // lines 56 to 59, which is the commit that carried the widened sweep and was
  // RED at this line by construction.
  const OCCURRENCE_7 =
    '//    IT CANNOT BE IMPORTED: `gates.mjs` ends in `process.exit(main())` at module\n' +
    '//    scope with no direct-invocation guard, so importing it runs every gate and\n' +
    '//    exits the process. Adding that guard is a behavioural edit to a file two\n' +
    '//    other sessions are live in, which is a merge hazard this file is not worth.\n';

  /** `gates.mjs` as it stands: exporting its gates and guarding its own run. */
  const GUARDED =
    'export const GATES = [];\n' +
    'const invokedDirectly = process.argv[1] !== undefined;\n' +
    'if (invokedDirectly) process.exit(main());\n';

  /** `gates.mjs` as it stood before `55824c62`, which is what the sentence described. */
  const UNGUARDED = 'const GATES = [];\nprocess.exit(main());\n';

  const register = {
    artifacts: only(['gates-importable']),
    claims: [
      {
        site: 'scripts/corpus/data-model-columns.mjs',
        claim: 'IT CANNOT BE IMPORTED: `gates.mjs` ends in `process.exit(main())` at module',
        disposition: 'live' as const,
        artifact: 'gates-importable',
        why: 'the header as it stood on 2026-09-05, before ADR-330 repaired it',
      },
    ],
  };

  test('RED: the header says it cannot be imported and the guard is in the file', () => {
    const root = bareTree();
    write(root, 'scripts/corpus/data-model-columns.mjs', OCCURRENCE_7);
    write(root, 'scripts/corpus/gates.mjs', GUARDED);

    const findings = checkAbsenceClaims(root, register);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('scripts/corpus/data-model-columns.mjs says');
    expect(findings[0]).toContain('IT CANNOT BE IMPORTED');
    expect(findings[0]).toContain('EXISTS. The sentence is false');
  });

  test('GREEN: the same header against an unguarded `gates.mjs`, which is when it was true', () => {
    const root = bareTree();
    write(root, 'scripts/corpus/data-model-columns.mjs', OCCURRENCE_7);
    write(root, 'scripts/corpus/gates.mjs', UNGUARDED);
    expect(checkAbsenceClaims(root, register)).toEqual([]);
  });

  test('THE PROBE READS BOTH HALVES: a guard with nothing exported is still absent', () => {
    // The false sentence justified a DUPLICATED PARSER, and the remedy it names
    // is to import the original. A guard with no export makes the module safe to
    // import and supplies nothing to import, so calling the artifact present off
    // the guard alone would retire a sentence whose remedy is still unavailable.
    const root = bareTree();
    write(root, 'scripts/corpus/data-model-columns.mjs', OCCURRENCE_7);
    write(
      root,
      'scripts/corpus/gates.mjs',
      'const GATES = [];\nconst invokedDirectly = true;\nif (invokedDirectly) process.exit(main());\n',
    );
    expect(checkAbsenceClaims(root, register)).toEqual([]);
  });

  test('LEG 6 REPORTS IT BY DISCOVERY, which is what the widened scope buys', () => {
    // THE HALF THAT PROVES THE SCOPE RATHER THAN THE REGISTER ENTRY. With the
    // artifact registered and the SITE not, leg 6 has to find the line itself.
    // Under ADR-328's scope this file is invisible and the run is clean.
    const root = bareTree();
    write(root, 'scripts/corpus/data-model-columns.mjs', OCCURRENCE_7);
    write(root, 'scripts/corpus/gates.mjs', GUARDED);
    const findings = checkAbsenceClaims(root, {
      artifacts: only(['gates-importable']),
      claims: [
        {
          site: 'scripts/corpus/gates.mjs',
          claim: 'export const GATES = [];',
          disposition: 'retired' as const,
          artifact: 'gates-importable',
          why: 'the filler that keeps `gates-importable` off leg 5 so the sweep reports alone',
        },
      ],
    });
    expect(findings.join('\n')).toContain('scripts/corpus/data-model-columns.mjs:1');
    expect(findings.join('\n')).toContain('names a registered artifact and asserts an absence');
  });

  test('AND THE OLD SCOPE WOULD NOT HAVE SEEN IT, asserted rather than left to be inferred', () => {
    // THE SAME BYTES, ONE DIRECTORY OVER, WHERE NEITHER SCOPE READS. This is the
    // design decision most likely to be reverted by somebody tidying the walk,
    // so it is pinned: the sweep reports the line because of WHERE the file is,
    // and a scope that reaches neither `src/` nor `scripts/` is silent on it.
    const root = bareTree();
    write(root, 'tools/data-model-columns.mjs', OCCURRENCE_7);
    write(root, 'scripts/corpus/gates.mjs', GUARDED);
    expect(
      checkAbsenceClaims(root, {
        artifacts: only(['gates-importable']),
        claims: [
          {
            site: 'scripts/corpus/gates.mjs',
            claim: 'export const GATES = [];',
            disposition: 'retired' as const,
            artifact: 'gates-importable',
            why: 'the filler that keeps `gates-importable` off leg 5',
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe('the widened scope: what it reads, and what it still refuses to read', () => {
  const GUARDED =
    'export const GATES = [];\n' +
    'const invokedDirectly = process.argv[1] !== undefined;\n' +
    'if (invokedDirectly) process.exit(main());\n';

  const filler = {
    site: 'packages/queue/src/job-queue.ts',
    claim: 'export const JOB_QUEUE_METHODS = [];',
    disposition: 'live' as const,
    artifact: 'queue-door',
    why: 'the filler that keeps `queue-door` off leg 5 so the sweep reports alone',
  };

  test('`.sql` UNDER `scripts/` IS SWEPT, which is the shape occurrence 4 lived in', () => {
    const root = bareTree();
    write(
      root,
      'scripts/db/probe_something.sql',
      '-- pg-boss owns this schema and\n-- no module here imports it\n',
    );
    const findings = checkAbsenceClaims(root, {
      artifacts: only(['queue-door']),
      claims: [filler],
    });
    expect(findings.join('\n')).toContain('scripts/db/probe_something.sql:2');
    expect(findings.join('\n')).toContain('names a registered artifact and asserts an absence');
  });

  test('a directory named `test` under `scripts/` is NOT swept', () => {
    // `apps/*/src` gets this exclusion structurally, because the suites sit
    // beside `src/` rather than inside it. Under `scripts/` it is written, and
    // the reason is the one this check's header already gives: a case asserting
    // a refusal QUOTES the refusal, so a test carrying a claim string is the
    // assertion and not a second claim site.
    //
    // THE NON-TEST FILE BESIDE IT IS LOAD BEARING AND SAYS SO. The sentinel
    // below counts swept files AFTER this exclusion, so a `scripts/` holding
    // nothing but a suite is a MOVED LAYOUT and throws. This fixture is a
    // `scripts/` that is being swept normally and is silent on the one
    // directory inside it that is excluded, which is the property under test.
    const root = bareTree();
    write(root, 'scripts/demo/run.mjs', 'export const run = () => 0;\n');
    write(
      root,
      'scripts/demo/test/world.test.ts',
      "it('refuses', () => {\n  // `@merit/queue` is real and no module here imports it\n});\n",
    );
    expect(checkAbsenceClaims(root, { artifacts: only(['queue-door']), claims: [filler] })).toEqual(
      [],
    );
  });

  test('a `scripts/` that exists and yields no swept file is an ERROR, not a narrower sweep', () => {
    // RULE 2, in the half the widening added. A `scripts/` whose layout moved
    // would make leg 6 silently stop reading a directory it was extended to
    // reach, and every claim site under it would go unswept while the run
    // reported clean.
    const root = bareTree();
    write(root, 'scripts/README.md', '# not a swept shape\n');
    expect(() =>
      checkAbsenceClaims(root, { artifacts: only(['queue-door']), claims: [filler] }),
    ).toThrow(/found no swept file under scripts\//);
  });

  test('a tree with NO `scripts/` at all is skipped rather than thrown on', () => {
    // The split `shippedSources` already makes when it skips an absent `apps` or
    // `packages`. A tree that declares no `scripts/` has one fewer place to look
    // and was not mis-measured, which is why every case above this one runs on a
    // `bareTree` that has none.
    const root = bareTree();
    expect(checkAbsenceClaims(root, { artifacts: only(['queue-door']), claims: [filler] })).toEqual(
      [],
    );
  });

  test('THE PROBES DID NOT MOVE WITH THE SWEEP, which is the risk of widening a shared walk', () => {
    // `queue-door` says in words that it is about a module under `apps/*&#47;src`
    // or `packages/*&#47;src`. If the widening had been done by editing
    // `shippedSources` in place, an importer under `scripts/` would have made
    // this probe report the door BUILT, retiring three live claims by editing a
    // file walk. It is a second function for exactly this reason.
    const root = bareTree();
    write(root, 'scripts/demo/run.mjs', "import { pgBossQueue } from '@merit/queue';\n");
    write(root, 'scripts/corpus/gates.mjs', GUARDED);
    expect(artifact('queue-door').probe(root)).toBe('absent');
  });
});

// =============================================================================
// ADR-338. THE TWO WAYS THE DOOR-CALLER PROBE WAS WRONG, EACH WATCHED
// =============================================================================
// The `worker-queue-door-caller` artifact was written by ADR-333 to fail on
// GOOD NEWS: the day somebody wired the saga to the queue door it flips to
// `present` and leg 2 turns red at the sentence that is now lying. ADR-338 is
// that day, and wiring it found the probe wrong in BOTH directions at once.
//
//   FALSE NEGATIVE. It looked for `LIVE_QUEUE.` and `workerQueue(`, which are a
//   property access and a factory DECLARATION's call. The wiring took neither
//   shape: an adapter takes the door as an ARGUMENT, `provisioningJobQueue(
//   LIVE_QUEUE)`, which is `postgresBatchPorts(io.db)`'s arrangement one
//   capability over and the ordinary way a door reaches an adapter here.
//
//   FALSE POSITIVE. It read RAW text. `queue-adapter.ts`'s header names
//   `workerQueue(` in order to explain what it does not do, so with the WIRING
//   DELETED BY HAND the probe still reported `present` and `RI-35` still passed
//   at 35 of 35. That is an absence check going green over an emptied file,
//   which `strip-comments.mjs`'s own header calls the worst direction a defect
//   can fail in, arriving inside the check written to prevent it.
//
// Both were repaired in ADR-338's diff and both are watched here. The cases run
// the SHIPPED probe rather than a copy, on this file's own rule.
// =============================================================================

describe('ADR-338: the door-caller probe reads code, and reads an argument position', () => {
  test('a door handed to a factory is a CALLER, which is the shape the wiring took', () => {
    const root = bareTree();
    write(root, 'apps/worker/src/queue.ts', 'export const LIVE_QUEUE = workerQueue(x);\n');
    write(
      root,
      'apps/worker/src/provisioning/queue-adapter.ts',
      "import { LIVE_QUEUE } from '../queue.ts';\n" +
        'export const LIVE_PROVISIONING_QUEUE = provisioningJobQueue(LIVE_QUEUE);\n',
    );
    expect(artifact('worker-queue-door-caller').probe(root)).toBe('present');
  });

  test('a sentence ABOUT the door is not a caller, even when it quotes the call shape', () => {
    // THE SEEDED VIOLATION IS THE REAL HEADER. `queue-adapter.ts` explains that a
    // bare re-export would be invisible to this probe, and in doing so writes
    // `workerQueue(` and `LIVE_QUEUE.` into a comment. Unstripped, the probe
    // reads its own explanation as the thing explained.
    const root = bareTree();
    write(root, 'apps/worker/src/queue.ts', 'export const LIVE_QUEUE = 1;\n');
    write(
      root,
      'apps/worker/src/provisioning/queue-adapter.ts',
      '// This probe looks for a property access on `LIVE_QUEUE.enqueue` or a\n' +
        '// call to `workerQueue(executor)`, and this file performs neither.\n' +
        '/* A block comment naming LIVE_QUEUE, LIVE_QUEUE) and workerQueue( too. */\n' +
        'export const NOTHING = 0;\n',
    );
    expect(artifact('worker-queue-door-caller').probe(root)).toBe('absent');
  });

  test('the declaring module alone is still not a caller, so the door cannot call itself', () => {
    // ADR-333's own exclusion, re-asserted because ADR-338 widened the shapes
    // this probe accepts and a widened matcher over an unchanged exclusion is
    // how a door starts reporting itself wired.
    const root = bareTree();
    write(
      root,
      'apps/worker/src/queue.ts',
      'export function workerQueue(x) {\n  return x;\n}\n' +
        'export const LIVE_QUEUE = workerQueue(queueExecutor());\n' +
        'export const AGAIN = LIVE_QUEUE.declareQueue;\n',
    );
    expect(artifact('worker-queue-door-caller').probe(root)).toBe('absent');
  });

  test('the saga-caller probe reads code too, and its own comment quotes what it hunts', () => {
    // The same repair one artifact over, and it was NOT hypothetical: the probe's
    // own explanatory comment writes `runProvisioningSaga(`, and so do
    // `schedule.ts`'s registry row and three headers under `apps/worker/src`.
    // It reported `absent` only because the `function` guard happened to catch
    // the forms it met.
    const root = bareTree();
    write(
      root,
      'apps/worker/src/schedule.ts',
      '// Nothing here calls `runProvisioningSaga()`, and the blocker is the\n' +
        '// platform adapter rather than a clock.\n' +
        'export const UNSCHEDULED = 1;\n',
    );
    expect(artifact('provisioning-saga-caller').probe(root)).toBe('absent');

    write(root, 'apps/worker/src/job.ts', 'await runProvisioningSaga(io, subject, ops, at);\n');
    expect(artifact('provisioning-saga-caller').probe(root)).toBe('present');
  });
});

// =============================================================================
// ADR-384. THE FIRST `docs/` SITE, AND THE LINE SPLIT IT DID NOT NEED
// =============================================================================
// `CRON_INVENTORY.md`'s replay self-audit row carries an S1 dead-man switch over
// a job nothing runs, and says so in its own words. Three rows queued a LINE
// SPLIT of that row before the registration, on ADR-375 section 7 obstacle 4:
// both halves of the sentence sit on one markdown table row, so a claim bound to
// that line binds the retired ports half with the live caller half.
//
// LEG 1 BINDS A SUBSTRING AND STORES NO LINE NUMBER, so the anchor selects the
// live half alone and the split buys the register nothing. These cases hold that
// property open, because it is the whole reason the entry could land: a leg 1
// rewritten to anchor on a WHOLE LINE would silently re-arm the obstacle.
// =============================================================================

describe('ADR-384: the replay self-audit`s caller half, bound at a runbook row', () => {
  const ROW =
    '| **Replay self-audit** | after the batch | 07:00 CT | `replay.audit_completed` absent | ' +
    '**S1.** THE RETIRED HALF IS NAMED RATHER THAN RE-QUOTED, and the `calls it` half is ' +
    'unchanged, nothing under any `src/` calls `runReplayAudit`, and wiring and scheduling ' +
    'are two decisions |';

  const register = {
    artifacts: only(['replay-audit-src-caller']),
    claims: [
      {
        site: 'docs/ops/runbooks/CRON_INVENTORY.md',
        claim: 'nothing under any `src/` calls `runReplayAudit`',
        disposition: 'live' as const,
        artifact: 'replay-audit-src-caller',
        why: 'the runbook row, as it stands on the tree that registered it',
      },
    ],
  };

  /** The row, plus whatever `src/` the case wants the probe to read. */
  function runbookTree(src?: { rel: string; body: string }): string {
    const root = bareTree();
    write(root, 'docs/ops/runbooks/CRON_INVENTORY.md', `${ROW}\n`);
    if (src) write(root, src.rel, src.body);
    return root;
  }

  // THE CASE THE REGISTRATION EXISTS FOR, AND IT FAILS ON GOOD NEWS. The day the
  // audit is wired, the runbook sentence telling an operator the switch has no
  // subject is the line this goes red at.
  test('RED: a `src/` file calls the audit and the runbook still says nothing does', () => {
    const root = runbookTree({
      rel: 'apps/worker/src/job.ts',
      body: 'const report = await runReplayAudit(ports, config);\n',
    });
    const findings = checkAbsenceClaims(root, register);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('docs/ops/runbooks/CRON_INVENTORY.md');
    expect(findings[0]).toContain('EXISTS');
  });

  test('GREEN: the counterfactual is the same tree with no caller in it', () => {
    expect(checkAbsenceClaims(runbookTree(), register)).toEqual([]);
  });

  // ADR-338'S LESSON, ASSERTED AT THIS PROBE RATHER THAN INHERITED FROM THE ONE
  // IT WAS LEARNED AT. Three headers under `apps/worker/src/` name this function
  // in order to say nothing runs it. A probe over raw text reads one of those
  // sentences as the wiring and retires a claim that is still true.
  test('GREEN: a comment naming the call shape is not a caller', () => {
    const root = runbookTree({
      rel: 'apps/worker/src/index.ts',
      body: '// STILL NOT SCHEDULED. Nothing calls `runReplayAudit(ports, config)`: no cron.\n',
    });
    expect(checkAbsenceClaims(root, register)).toEqual([]);
  });

  test('GREEN: the declaration is not a call, so the entry point does not wire itself', () => {
    const root = runbookTree({
      rel: 'apps/worker/src/batch/replay.ts',
      body: 'export async function runReplayAudit(ports: BatchPorts): Promise<void> {}\n',
    });
    expect(checkAbsenceClaims(root, register)).toEqual([]);
  });

  // ADR-338'S OTHER HALF. A job can be wired by being HANDED to something rather
  // than called, and a call-only probe reports `absent` over the row that wired
  // it. This is the shape the door probe was found blind to one register entry
  // over, asserted here before it costs anything.
  test('RED: the audit handed to a registry as a value is a wiring', () => {
    const root = runbookTree({
      rel: 'apps/worker/src/start.ts',
      body: 'const JOBS = [runNightlyBatch, runReplayAudit];\n',
    });
    expect(checkAbsenceClaims(root, register)).toHaveLength(1);
  });

  // AND THE ONE LINE THAT SHAPE MUST NOT READ AS A WIRING. `index.ts:456` is a
  // barrel member: the bare name and a comma, inside an export block. It is
  // excluded by SHAPE and not by filename, so a wiring written into the barrel
  // itself is still seen.
  test('GREEN: a barrel re-exporting the name has not wired anything', () => {
    const root = runbookTree({
      rel: 'apps/worker/src/index.ts',
      body: 'export {\n  auditAccount,\n  runReplayAudit,\n} from ./batch/replay.ts;\n',
    });
    expect(checkAbsenceClaims(root, register)).toEqual([]);
  });

  // THE PROPERTY THE THREE QUEUED ROWS DID NOT HAVE. The anchor is a SUBSTRING,
  // so one table row carrying a live clause and a retired one is bindable
  // without being split: the register selects the half it means. A leg 1 that
  // compared whole lines would fail this case and re-arm obstacle 4.
  test('the anchor binds one clause of a row that carries two, unsplit', () => {
    const root = bareTree();
    write(root, 'docs/ops/runbooks/CRON_INVENTORY.md', `${ROW}\n`);
    const line = ROW.split('\n')[0] ?? '';
    expect(line).toContain('THE RETIRED HALF IS NAMED RATHER THAN RE-QUOTED');
    expect(line).toContain(register.claims[0]?.claim);
    expect(checkAbsenceClaims(root, register)).toEqual([]);
  });

  // THE SWEEP IS NOT LIFTED, AND THIS IS THE CASE THAT SAYS SO. A `docs/` file
  // carrying a registered needle AND an absence word is invisible to leg 6,
  // which is what keeps this entry one decision rather than a widening that
  // would reach every dated record in the corpus.
  test('leg 6 still reads no `docs/` file, needle and absence word both present', () => {
    const root = bareTree();
    write(
      root,
      'docs/decisions/ADR-001.md',
      'On 2026-01-01 there was no module importing `@merit/queue`, which does not exist.\n',
    );
    write(
      root,
      'packages/queue/src/index.ts',
      'NO MODULE IN THIS WORKSPACE IMPORTS `@merit/queue`\n',
    );
    const findings = checkAbsenceClaims(root, {
      artifacts: only(['queue-door']),
      claims: [
        {
          site: 'packages/queue/src/index.ts',
          claim: 'NO MODULE IN THIS WORKSPACE IMPORTS `@merit/queue`',
          disposition: 'live' as const,
          artifact: 'queue-door',
          why: 'the door`s own sentence, on a tree with no importer',
        },
      ],
    });
    expect(findings).toEqual([]);

    // THE SAME SENTENCE, MOVED INTO THE SWEPT SCOPE. Without this half the case
    // asserts silence, and a sweep that had stopped working would pass it.
    write(root, 'packages/queue/src/loud.ts', 'const why = `no module imports @merit/queue`;\n');
    const swept = checkAbsenceClaims(root, {
      artifacts: only(['queue-door']),
      claims: [
        {
          site: 'packages/queue/src/index.ts',
          claim: 'NO MODULE IN THIS WORKSPACE IMPORTS `@merit/queue`',
          disposition: 'live' as const,
          artifact: 'queue-door',
          why: 'the door`s own sentence, on a tree with no importer',
        },
      ],
    });
    expect(swept).toHaveLength(1);
    expect(swept[0]).toContain('packages/queue/src/loud.ts:1');
  });
});

// =============================================================================
// ADR-384. THE SHIPPED ENTRY, AND THE RULE THAT ADMITTED IT
// =============================================================================

describe('ADR-384: the one `docs/` site the register admits', () => {
  const DOCS_SITES = ABSENCE_CLAIMS.filter((c) => c.site.startsWith('docs/'));

  test('the runbook row is registered live against the caller probe', () => {
    expect(DOCS_SITES.map((c) => c.site)).toEqual(['docs/ops/runbooks/CRON_INVENTORY.md']);
    expect(DOCS_SITES[0]?.disposition).toBe('live');
    expect(DOCS_SITES[0]?.artifact).toBe('replay-audit-src-caller');
  });

  // THE RULE IS "A LIVE RUNBOOK, NEVER A DATED RECORD", and it is asserted here
  // rather than left in a comment. A row binding an ADR, a session log or a
  // review would demand a repair that rewrites a measurement made on its own
  // day, which is `RI-16`'s exclusion 1 arriving inside this register.
  test('no dated record is a claim site', () => {
    for (const dir of ['docs/decisions/', 'docs/sessions/', 'docs/reviews/']) {
      expect({ dir, sites: ABSENCE_CLAIMS.filter((c) => c.site.startsWith(dir)).length }).toEqual({
        dir,
        sites: 0,
      });
    }
  });

  // THE ANCHOR IS UNIQUE IN THE FILE IT NAMES, which is leg 1's own demand read
  // at the shipped site. Zero would mean the runbook was reworded without the
  // register; two would mean the disposition is about a line nobody chose.
  test('the anchor occurs exactly once in the runbook, on the row it is about', () => {
    const lines = readFileSync(join(REPO_ROOT, 'docs/ops/runbooks/CRON_INVENTORY.md'), 'utf8')
      .split('\n')
      .map((line, index) => ({ line, at: index + 1 }))
      .filter(({ line }) => line.includes('nothing under any `src/` calls `runReplayAudit`'));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.line).toContain('**Replay self-audit**');
    expect(lines[0]?.line).toContain('`RI-35` registers the caller clause below');
  });
});
