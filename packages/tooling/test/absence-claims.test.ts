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

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  //
  // **ADR-387 AMENDED THIS CASE AND THE REASON IS THE FINDING RATHER THAN THE
  // REPAIR.** It asserted the whole check EMPTY, which was a true reading of the
  // probe and an accidental reading of the sweep: this fixture's own body is the
  // shape of `apps/worker/src/index.ts:449`, the SECOND unregistered site, and
  // the case went green over it because the vocabulary carried no marker that
  // reached `Nothing calls`. With the needle and that marker registered, leg 6
  // reports the seeded line, correctly. So the assertion is now made AT THE
  // PROBE, which is what the case was always about and is stronger than an
  // emptiness that two mechanisms had to agree on, and what the sweep says is
  // stated rather than folded into a zero.
  test('GREEN: a comment naming the call shape is not a caller', () => {
    const root = runbookTree({
      rel: 'apps/worker/src/index.ts',
      body: '// STILL NOT SCHEDULED. Nothing calls `runReplayAudit(ports, config)`: no cron.\n',
    });
    expect(artifact('replay-audit-src-caller').probe(root)).toBe('absent');

    const findings = checkAbsenceClaims(root, register);
    expect(findings.filter((f) => f.startsWith('docs/ops/runbooks/'))).toEqual([]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('apps/worker/src/index.ts:1');
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
  test('the anchor occurs exactly once in the runbook, in the note it is about', () => {
    const body = readFileSync(join(REPO_ROOT, 'docs/ops/runbooks/CRON_INVENTORY.md'), 'utf8');
    const all = body.split('\n');
    const lines = all
      .map((line, index) => ({ line, at: index + 1 }))
      .filter(({ line }) => line.includes('nothing under any `src/` calls `runReplayAudit`'));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.line).toContain('`RI-35` registers the caller clause below');

    // **AND IT IS FILED UNDER THE JOB IT NAMES.** Before ADR-392 the whole row
    // was one line and `**Replay self-audit**` was on it, so containment said
    // this. The severity prose is a `### Replay self-audit` note now, and the
    // heading the anchor sits under is what says the same thing about the shape
    // the page actually has. **THE REGISTER DID NOT MOVE AND COULD NOT**: it
    // stores this substring with no line number, which is why it survived a
    // restructure of the whole page untouched.
    const heading = all
      .slice(0, lines[0]?.at ?? 0)
      .reverse()
      .find((line) => line.startsWith('### '));
    expect(heading).toBe('### Replay self-audit');
  });
});

// =============================================================================
// ADR-387. THE SECOND SITE, AND THE VERB THAT HID IT
// =============================================================================
// ADR-384 registered the runbook clause, measured that a needle on the entry
// point reaches ONE unregistered line, and left the needle and that site for
// whoever held `apps/worker/**` next. The measurement reproduces. What it does
// not say, because it is a statement about a NEEDLE and not about the tree, is
// that a SECOND site states the same absence about the same job one file away,
// in the words `Nothing calls`, which no marker in the vocabulary reached.
//
// THAT IS OCCURRENCE 3's SHAPE INSIDE THE REGISTER WRITTEN TO END IT: a repair
// that binds the site somebody named and leaves an identical sentence one file
// over, because nothing binds the second. These cases hold both bindings open
// and hold the marker that reaches the second one accountable to a
// counterfactual, so a later narrowing of the vocabulary fails here rather than
// going quietly green.
// =============================================================================

describe('ADR-387: the runbook`s absence, stated twice more in the deployable', () => {
  const CALLER_CLAIMS = ABSENCE_CLAIMS.filter((c) => c.artifact === 'replay-audit-src-caller');
  const RUNBOOK_ANCHOR = 'nothing under any `src/` calls `runReplayAudit`';

  /** The three registered sentences in a tree of their own, plus whatever `src/` a case wants. */
  function threeSites(src?: { rel: string; body: string }): string {
    const root = bareTree();
    for (const claim of CALLER_CLAIMS) write(root, claim.site, `${claim.claim}\n`);
    if (src) write(root, src.rel, src.body);
    return root;
  }

  const register = { artifacts: only(['replay-audit-src-caller']), claims: CALLER_CLAIMS };

  test('three sites are registered live, one runbook and two in the deployable', () => {
    expect(CALLER_CLAIMS.map((c) => c.site).sort()).toEqual([
      'apps/worker/src/index.ts',
      'apps/worker/src/schedule.ts',
      'docs/ops/runbooks/CRON_INVENTORY.md',
    ]);
    for (const claim of CALLER_CLAIMS) expect(claim.disposition).toBe('live');
  });

  // THE ANCHOR IS THE RUNBOOK'S OWN, CHARACTER FOR CHARACTER. ADR-384 section 13
  // said the registry row "states the same absence in the same words", and this
  // is that sentence asserted rather than believed: one substring binds a
  // markdown table cell and a TypeScript string literal, in two files.
  test('the schedule row carries the runbook`s clause verbatim', () => {
    const sites = CALLER_CLAIMS.filter((c) => c.claim === RUNBOOK_ANCHOR).map((c) => c.site);
    expect(sites.sort()).toEqual([
      'apps/worker/src/schedule.ts',
      'docs/ops/runbooks/CRON_INVENTORY.md',
    ]);
  });

  // LEG 1's DEMAND, READ AT THE SHIPPED SITES. Zero means the sentence moved
  // without the register; two means the disposition is about a line nobody
  // chose. The check would report both, and this reports WHICH file.
  test('each anchor occurs exactly once in the file it names', () => {
    for (const claim of CALLER_CLAIMS) {
      const hits = readFileSync(join(REPO_ROOT, claim.site), 'utf8')
        .split('\n')
        .filter((line) => line.includes(claim.claim));
      expect({ site: claim.site, hits: hits.length }).toEqual({ site: claim.site, hits: 1 });
    }
  });

  // THE CASE THE REGISTRATION EXISTS FOR, AND IT FAILS ON GOOD NEWS AT THREE
  // LINES AT ONCE. A row that had repaired the runbook alone would leave two
  // sentences telling the next session this job has no caller.
  test('RED: one `src/` caller falsifies all three sentences in one commit', () => {
    const root = threeSites({
      rel: 'apps/worker/src/job.ts',
      body: 'const report = await runReplayAudit(ports, config);\n',
    });
    const findings = checkAbsenceClaims(root, register);
    expect(findings).toHaveLength(3);
    expect(findings.filter((f) => f.includes('EXISTS'))).toHaveLength(3);
    for (const claim of CALLER_CLAIMS) {
      expect(findings.some((f) => f.startsWith(claim.site))).toBe(true);
    }
  });

  test('GREEN: the counterfactual is the same three sentences with no caller', () => {
    expect(checkAbsenceClaims(threeSites(), register)).toEqual([]);
  });

  // THE NEEDLE, WHICH ADR-384 MEASURED AND COULD NOT ADD. Its whole purpose is
  // that a FOURTH site cannot arrive unregistered, so the assertion is a
  // discovery on a tree that has one.
  test('LEG 6 REPORTS A FOURTH SITE, which is what the needle buys', () => {
    const root = threeSites({
      rel: 'apps/worker/src/sweeps/ports.ts',
      body: '// no caller: nothing hands `runReplayAudit` a port here either.\n',
    });
    const findings = checkAbsenceClaims(root, register);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('apps/worker/src/sweeps/ports.ts:1');
  });

  // AND THE VERB IS THE WHOLE OF WHY THE SECOND SITE WAS INVISIBLE. `Nothing
  // calls` is reached only because ADR-387 wrote it into the vocabulary; a
  // sentence phrased outside the vocabulary is still silent, which is this
  // check's own written limit and is asserted here rather than assumed. Both
  // halves, because the RED alone would pass over a vocabulary that had grown
  // to match everything.
  test('the marker reaches `nothing calls`, and the vocabulary is still written', () => {
    const reached = checkAbsenceClaims(
      threeSites({
        rel: 'apps/worker/src/sweeps/ports.ts',
        body: '// Nothing calls `runReplayAudit` from this adapter.\n',
      }),
      register,
    );
    expect(reached).toHaveLength(1);
    expect(reached[0]).toContain('apps/worker/src/sweeps/ports.ts:1');

    const silent = checkAbsenceClaims(
      threeSites({
        rel: 'apps/worker/src/sweeps/ports.ts',
        body: '// There is no cron in front of `runReplayAudit` on this tree.\n',
      }),
      register,
    );
    expect(silent).toEqual([]);
  });

  // THE BARREL'S BINDING DOES NOT REST ON THE WIDENING. Leg 1 reads the site the
  // register names whatever the vocabulary says, so a later row that narrowed
  // the marker would lose the SWEEP over that phrasing and keep the binding.
  test('leg 1 binds the barrel site with no needle and no marker in play', () => {
    const barrel = CALLER_CLAIMS.find((c) => c.site === 'apps/worker/src/index.ts');
    expect(barrel).toBeDefined();
    const root = bareTree();
    write(root, 'apps/worker/src/index.ts', `${barrel?.claim ?? ''}\n`);
    write(root, 'apps/worker/src/job.ts', 'await runReplayAudit(ports, config);\n');
    const findings = checkAbsenceClaims(root, {
      artifacts: [{ ...artifact('replay-audit-src-caller'), needles: [] }],
      claims: barrel === undefined ? [] : [barrel],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('apps/worker/src/index.ts');
    expect(findings[0]).toContain('EXISTS');
  });
});

// =============================================================================
// ADR-415: THE `event-sink-caller` ENTRY AFTER ADR-410 MOVED THE PRODUCER
// =============================================================================
// ADR-410 moved the producer to `packages/ledger` and repaired the ONE constant
// the probe reads. It left the register's own prose behind, and the prose is
// where this artifact keeps its argument: `needles` is empty, so `sweptBy` is
// the whole of the case for binding this artifact to named sites and to no
// others.
//
// **THE INTEGER IS NOT WHAT THESE CASES BIND, AND THAT IS A CHOICE WITH A
// REASON.** The entry's census is anchored to a commit because it is a fact
// about a moment; a case asserting it against the live tree would go red the
// day any row rewraps a comment in `apps/worker/src`, and a case that fires on
// a rewrap is a case somebody deletes rather than answers. What has to stay
// true is the ARGUMENT -- that every line a needle would reach is already
// bound, published, left behind, or true about a different artifact -- and that
// is what is asserted here. It still FAILS ON GOOD NEWS, and on a narrower
// signal than a number would: a reached line in a FIFTH place is a needle
// arriving somewhere the entry does not account for, which is the shape of a
// real install landing.
//
// AND THE FALSE POSITIVE THE ENTRY REGISTERS IS WATCHED RATHER THAN CLAIMED.
// ADR-410 section 7 found that the probe cannot tell a publication from an
// install, answered it in the barrel, and left the registration owed to this
// package. A registered false positive nobody has seen fire is a paragraph.
// These cases fire it, hold the counterfactual open beside it, and hold the
// probe's power over a REAL install open beside both, so the registration
// cannot be read as an argument for widening anything.
// =============================================================================

describe('ADR-415: the `event-sink-caller` register after the producer moved', () => {
  const HOME = 'packages/ledger/src/events.ts';
  const BARREL = 'packages/ledger/src/index.ts';
  const OLD_PATH = 'apps/api/src/events.ts';
  const NAMES = ['makeEventSink', 'TRANSACTION_EVENT_WRITER'];

  const entry = artifact('event-sink-caller');
  const claims = ABSENCE_CLAIMS.filter((c) => c.artifact === 'event-sink-caller');

  /**
   * Every `.ts`, `.tsx`, `.mts`, `.mjs` and `.js` under `apps/*&#47;src` and
   * `packages/*&#47;src`, repo-relative.
   *
   * IT REPRODUCES `shippedSources` RATHER THAN IMPORTING IT, because that
   * function is not exported and widening its module's surface to reach it
   * would be an edit to the check in service of a case. The extension list and
   * the two parents are the check's own.
   */
  function shipped(): string[] {
    const out: string[] = [];
    for (const parent of ['apps', 'packages']) {
      for (const entryName of readdirSync(join(REPO_ROOT, parent)).sort()) {
        const src = `${parent}/${entryName}/src`;
        let listing: string[];
        try {
          listing = readdirSync(join(REPO_ROOT, src), { recursive: true, encoding: 'utf8' });
        } catch {
          continue;
        }
        for (const rel of listing) {
          const path = `${src}/${String(rel).split('\\').join('/')}`;
          if (path.includes('/node_modules/')) continue;
          if (/\.(ts|tsx|mts|mjs|js)$/.test(path)) out.push(path);
        }
      }
    }
    return out.sort();
  }

  test('one claim names this artifact, live, and it is the registered anchor', () => {
    expect(claims).toHaveLength(1);
    expect(claims[0]?.disposition).toBe('live');
    expect(claims[0]?.claim).toBe('`makeEventSink` is called by NO file');
  });

  // A CHECK THAT CANNOT RUN IS NOT A CHECK THAT PASSED. An empty walk would make
  // the census below vacuously true, which is the value the next case treats as
  // the good outcome, so the guard comes first.
  test('the walk reaches files, so the census below is measured', () => {
    expect(shipped().length).toBeGreaterThan(0);
  });

  // THE ARGUMENT, ASSERTED. `sweptBy` says a needle on either name would sweep
  // the declaration this register already binds, a publication, a compatibility
  // name and true sentences about a different artifact. Those are four places.
  // A fifth is a line the entry does not account for, and the likeliest fifth
  // is the one this artifact exists to catch.
  test('every line the two names reach is in one of the four places the entry accounts for', () => {
    const stray: string[] = [];
    for (const rel of shipped()) {
      if (rel === HOME || rel === BARREL || rel === OLD_PATH) continue;
      if (rel.startsWith('apps/worker/src/')) continue;
      readFileSync(join(REPO_ROOT, rel), 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (NAMES.some((name) => line.includes(name))) stray.push(`${rel}:${index + 1}`);
        });
    }
    expect(stray).toEqual([]);
  });

  // **THE ANCHOR IS CARRIED BY TWO FILES AND THE REGISTER BINDS ONE.** Leg 1
  // reads only the site it is told about, so nothing in the shipped check
  // reports this. The compatibility module says the register anchors the claim
  // to ITS path, which is true while the `site` says so; the producer at the
  // home says `RI-35` turns RED at ITS sentence, which is FALSE today. This is
  // what tells the row that moves the `site` that the second sentence is not a
  // spare copy: two files claim to be the bound one and exactly one can be.
  test('the registered sentence occurs once at the old path and once at the home', () => {
    const anchor = claims[0]?.claim ?? '';
    for (const rel of [OLD_PATH, HOME]) {
      const hits = readFileSync(join(REPO_ROOT, rel), 'utf8')
        .split('\n')
        .filter((line) => line.includes(anchor));
      expect({ rel, hits: hits.length }).toEqual({ rel, hits: 1 });
    }
    expect(claims[0]?.site).toBe(OLD_PATH);
  });

  // ---------------------------------------------------------------------------
  // THE REGISTERED FALSE POSITIVE, FIRED.
  // ---------------------------------------------------------------------------
  /** A tree with the producer at its home and a barrel publishing `exported`. */
  function ledgerTree(exported: string): string {
    const root = bareTree();
    write(
      root,
      HOME,
      'export function makeEventSink(deps) {\n  return deps;\n}\n' +
        'export const TRANSACTION_EVENT_WRITER = { write() {} };\n',
    );
    write(root, BARREL, exported);
    return root;
  }

  const OWN_STATEMENT = "export { TRANSACTION_EVENT_WRITER } from './events.ts';\n";
  const IN_A_LIST =
    'export {\n  makeEventSink,\n  TRANSACTION_EVENT_WRITER,\n} from ' + "'./events.ts';\n";
  // THE WRITER IS NOT LAST IN THIS ONE, AND THE POSITION IS THE POINT. The old
  // proxy read the SEPARATOR comma, so a list ending in the writer put a brace
  // after the name and stayed green while a list continuing past it went red.
  // Written with the writer last, this case passed on the old behaviour too and
  // proved nothing; that is a mistake this row made and measured.
  const ONE_LINE_LIST = "export { TRANSACTION_EVENT_WRITER, makeEventSink } from './events.ts';\n";
  const WRAPPED_SINGLE = "export {\n  TRANSACTION_EVENT_WRITER,\n} from './events.ts';\n";

  // ---------------------------------------------------------------------------
  // ADR-431: THE REGISTERED FALSE POSITIVE IS REPAIRED, AND THIS IS THE CASE
  // THAT FAILS ON THE OLD BEHAVIOUR AND PASSES ON THE NEW.
  //
  // **THE SENTENCE THIS EXPECTATION USED TO CARRY IS KEPT BESIDE ITS CORRECTION**
  // (`RI-14`). It read `RED: the writer inside a re-export list is read as an
  // INSTALL` and asserted `present`, which was ADR-415 watching a defect it was
  // forbidden to repair rather than asserting a property anybody wanted. The
  // register said so in its own `sweptBy` and the barrel said so in a comment
  // asking the next reader not to add a second name to one export statement.
  // ---------------------------------------------------------------------------
  test('GREEN: the writer inside a re-export list is a BINDING and not an install', () => {
    expect(entry.probe(ledgerTree(IN_A_LIST))).toBe('absent');
  });

  // **AND THE LINE BREAK WAS NEVER THE TRIGGER**, which is where this row parts
  // company with the account it inherited. ADR-415 and the barrel both say the
  // green is held by prettier leaving the statement on one line. The ONE-LINE
  // form of the same list fired too, because the comma the proxy reads is the
  // SEPARATOR and arrives with the second name whether or not the statement
  // wraps. Both spellings are asserted so neither can regress alone.
  test('GREEN: the same list on ONE line is a binding too', () => {
    expect(entry.probe(ledgerTree(ONE_LINE_LIST))).toBe('absent');
  });

  // AND PRETTIER REACHES IT FROM THE OTHER SIDE. `trailingComma: "all"` puts a
  // comma after the LAST name of any list long enough to wrap, so a SINGLE-name
  // list that prettier decides to break carries the comma with nothing added to
  // it at all. This is the purest form of the defect: identical exported
  // surface, identical module, one line break.
  test('GREEN: a single name wrapped with a trailing comma is a binding too', () => {
    expect(entry.probe(ledgerTree(WRAPPED_SINGLE))).toBe('absent');
  });

  // THE COUNTERFACTUAL, AND IT IS THE LINE ADR-410 ACTUALLY WROTE. The same
  // barrel, the same package, the same name published: the only difference is
  // that the next character is a space rather than a comma. A green that turns
  // on one character is a green worth writing down, which is why the entry says
  // so rather than leaving the arrangement to look deliberate on its own.
  test('GREEN: the same name published on a statement of its own reads absent', () => {
    expect(entry.probe(ledgerTree(OWN_STATEMENT))).toBe('absent');
  });

  // AND THE FACTORY NAME IS SAFE IN A LIST WHILE THE WRITER IS NOT, which is the
  // asymmetry the proxy creates: one shape is a CALL and the other is three
  // punctuation marks. This is why the block above may carry `makeEventSink`.
  test('GREEN: the factory name in the same list is not an install', () => {
    expect(entry.probe(ledgerTree("export { makeEventSink } from './events.ts';\n"))).toBe(
      'absent',
    );
  });

  // THE PROBE'S POWER OVER A REAL INSTALL IS UNTOUCHED, asserted beside the
  // false positive so the registration cannot be read as a case for widening
  // or for narrowing. Both shapes, because either alone is the arrival.
  test('RED: a real install is still caught, through the factory and through the writer', () => {
    const composed = ledgerTree(OWN_STATEMENT);
    write(
      composed,
      'apps/worker/src/install.ts',
      'export const sink = makeEventSink({ writer: TRANSACTION_EVENT_WRITER, clock });\n',
    );
    expect(entry.probe(composed)).toBe('present');

    const wrapped = ledgerTree(OWN_STATEMENT);
    write(
      wrapped,
      'apps/worker/src/install.ts',
      'export const sink = { write: (e) => TRANSACTION_EVENT_WRITER.write(e) };\n',
    );
    expect(entry.probe(wrapped)).toBe('present');
  });

  // ---------------------------------------------------------------------------
  // **THIS IS THE CASE THAT STOPS ADR-431 BEING A QUIET WEAKENING, AND IT IS THE
  // MORE IMPORTANT OF THE PAIR.**
  //
  // The repair blanks specifier lists. The failure it could introduce is exactly
  // this one: a REAL install whose importing file reaches the writer through a
  // MULTI-NAME import list -- the same syntax the repair now discards -- read as
  // `absent` because the discarded comma was the only thing the proxy ever saw.
  // A check that stops firing on a real change is far worse than one that fires
  // on a reflow, so the install is written in the shape most likely to be lost
  // and asserted RED end to end, through `checkAbsenceClaims` and not only
  // through the probe.
  //
  // BOTH HALVES OF THE INSTALL, ON THE PROBE'S OWN REASON THAT EITHER ALONE IS
  // THE ARRIVAL, and both behind a multi-name import.
  // ---------------------------------------------------------------------------
  test('RED: an install reached through a MULTI-NAME import list is still caught', () => {
    const composed = ledgerTree(OWN_STATEMENT);
    write(
      composed,
      'apps/worker/src/install.ts',
      "import { EVENT_NAMES, TRANSACTION_EVENT_WRITER, makeEventSink } from '@merit/ledger';\n" +
        'export const sink = makeEventSink({ writer: TRANSACTION_EVENT_WRITER, clock });\n' +
        'export const names = EVENT_NAMES;\n',
    );
    expect(entry.probe(composed)).toBe('present');

    const member = ledgerTree(OWN_STATEMENT);
    write(
      member,
      'apps/worker/src/install.ts',
      "import { EVENT_NAMES, TRANSACTION_EVENT_WRITER } from '@merit/ledger';\n" +
        'export const sink = { write: (e) => TRANSACTION_EVENT_WRITER.write(e), EVENT_NAMES };\n',
    );
    expect(entry.probe(member)).toBe('present');
  });

  // AND THE SPAN IS THE BRACE AND NEVER THE LINE. An import and an install
  // written as ONE statement is a line the shipped tree does not carry today and
  // is the line a repair that blanked whole lines would lose outright. The
  // per-line `reexport` heuristic one artifact over discards any line carrying
  // `from '`, which is the shape this case is written against.
  test('RED: an install sharing a line with its own import is still caught', () => {
    const inline = ledgerTree(OWN_STATEMENT);
    write(
      inline,
      'apps/worker/src/install.ts',
      "import { TRANSACTION_EVENT_WRITER } from '@merit/ledger'; " +
        'export const sink = wrap(TRANSACTION_EVENT_WRITER);\n',
    );
    expect(entry.probe(inline)).toBe('present');
  });

  // THE WHOLE CHECK AND NOT THE PROBE ALONE, so the repair is watched where a
  // reader meets it: leg 2 going RED at the claim site, with the sentence named.
  test('RED: leg 2 still fires at the claim site over a real install', () => {
    const composed = ledgerTree(OWN_STATEMENT);
    write(composed, OLD_PATH, '// `makeEventSink` is called by NO file under any `src/`.\n');
    write(
      composed,
      'apps/worker/src/install.ts',
      "import { EVENT_NAMES, TRANSACTION_EVENT_WRITER, makeEventSink } from '@merit/ledger';\n" +
        'export const sink = makeEventSink({ writer: TRANSACTION_EVENT_WRITER, clock });\n' +
        'export const names = EVENT_NAMES;\n',
    );
    const findings = checkAbsenceClaims(composed, { artifacts: [entry], claims });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('`makeEventSink` is called by NO file');
  });
});

// =============================================================================
// ADR-433: THE VALUE-POSITION PROXY LEARNS ASSIGNMENT
// =============================================================================
// ADR-431 SECTION 10 FOUND THIS AND DID NOT REPAIR IT, ON A REASON THAT IS THE
// WHOLE JUSTIFICATION FOR THIS BLOCK EXISTING SEPARATELY. `const sink =
// TRANSACTION_EVENT_WRITER;` is an install and matches none of `.`, `,`, `)`,
// so the probe reported `absent` over a tree carrying one. Closing that is a
// WIDENING OF WHAT THE PROBE ASSERTS rather than a repair to how it reads
// formatting, and a widening changes what the corpus claims.
//
// WHAT IS ASSERTED AFTER THIS BLOCK THAT WAS NOT ASSERTED BEFORE IT: the name
// standing as the whole right-hand side of an assignment is an install. One
// shape added to the value-position class, none removed, which is why the
// ADR-431 cases above stand unchanged beside these.
//
// THE MISS WAS DEMONSTRATED BEFORE IT WAS WIDENED. Against the check as it
// stood, cases 1 to 5 below report `absent` over a tree holding a real install,
// with `RI-35` reporting nothing at all. The counterfactual is one character:
// `.write` after the same name in the same file turned the artifact `present`.
//
// AND THE SECOND HALF IS THE MORE IMPORTANT ONE. A widened probe that fires on
// something innocent gets relaxed later by somebody in a hurry, so cases 6 to 11
// are what the check must still REFUSE: a comparison, a type position, a
// re-export list, a refusal string that names the writer in order to deny it.
// =============================================================================
describe('ADR-433: the caller probes read an ASSIGNMENT, and still refuse what they refused', () => {
  const HOME = 'packages/ledger/src/events.ts';
  const BARREL = 'packages/ledger/src/index.ts';
  const OLD_PATH = 'apps/api/src/events.ts';
  const INSTALL = 'apps/worker/src/install.ts';
  const OWN_STATEMENT = "export { TRANSACTION_EVENT_WRITER } from './events.ts';\n";

  const entry = artifact('event-sink-caller');
  const claims = ABSENCE_CLAIMS.filter((c) => c.artifact === 'event-sink-caller');

  /** The producer at its home, the barrel publishing the writer on its own line. */
  function ledgerTree(): string {
    const root = bareTree();
    write(
      root,
      HOME,
      'export function makeEventSink(deps) {\n  return deps;\n}\n' +
        'export const TRANSACTION_EVENT_WRITER = { write() {} };\n',
    );
    write(root, BARREL, OWN_STATEMENT);
    return root;
  }

  /** That tree, with `body` standing at a deployable under `apps/worker/src`. */
  const withInstall = (body: string): string => {
    const root = ledgerTree();
    write(root, INSTALL, body);
    return root;
  };

  const IMPORT_ONE = "import { TRANSACTION_EVENT_WRITER } from '@merit/ledger';\n";
  const IMPORT_TWO = "import { EVENT_NAMES, TRANSACTION_EVENT_WRITER } from '@merit/ledger';\n";

  // ---------------------------------------------------------------------------
  // THE FIVE THAT FAIL ON THE OLD BEHAVIOUR AND PASS ON THE NEW.
  // ---------------------------------------------------------------------------

  // 1. THE SHAPE ADR-431 SECTION 10 NAMED, WRITTEN AS IT NAMED IT. A deployable
  // that imports the writer on a statement of its own and binds it. Nothing here
  // is exotic: it is the shortest install anybody would write.
  test('RED: the writer assigned to a binding is an install', () => {
    expect(
      entry.probe(withInstall(IMPORT_ONE + 'export const sink = TRANSACTION_EVENT_WRITER;\n')),
    ).toBe('present');
  });

  // 2. AND BEHIND A MULTI-NAME IMPORT, WHICH IS THE HALF ADR-431 SECTION 6 GAVE
  // UP DELIBERATELY. That entry recorded the shape as caught before its repair
  // only BY ACCIDENT, off the import's own separator comma, and lost even the
  // accident when specifier lists were blanked. It is now caught on purpose,
  // which is the difference between a backstop and an assertion.
  test('RED: the same assignment behind a MULTI-NAME import is caught on purpose', () => {
    expect(
      entry.probe(
        withInstall(
          IMPORT_TWO +
            'export const sink = TRANSACTION_EVENT_WRITER;\nexport const n = EVENT_NAMES;\n',
        ),
      ),
    ).toBe('present');
  });

  // 3. **AND THE ASSIGNMENT PRETTIER ITSELF WRITES.** `printWidth` is 100 and
  // prettier breaks after the `=` when the statement passes it: a 102-character
  // `export const ... = TRANSACTION_EVENT_WRITER;` came back from
  // `prettier --write` as two lines with the name alone on the second. A
  // line-scoped assignment test would ship the exact formatting sensitivity
  // ADR-431 was sent to remove, one leg over, so the read spans the newline and
  // this case is what holds it there.
  test('RED: the assignment wrapped after the `=`, which is what prettier writes', () => {
    expect(
      entry.probe(
        withInstall(
          IMPORT_ONE +
            'export const provisioningEventWriterForTheWorkerDeployableSingletonInstance =\n' +
            '  TRANSACTION_EVENT_WRITER;\n',
        ),
      ),
    ).toBe('present');
  });

  // 4. AND A REASSIGNMENT RATHER THAN A DECLARATION, because the install a
  // deployable actually writes is as likely to be a late binding into a slot
  // that already exists as a `const` at the top of a module.
  test('RED: a reassignment and a compound assignment are installs too', () => {
    expect(
      entry.probe(withInstall(IMPORT_ONE + 'let sink;\nsink = TRANSACTION_EVENT_WRITER;\n')),
    ).toBe('present');
    expect(
      entry.probe(withInstall(IMPORT_ONE + 'let sink;\nsink ??= TRANSACTION_EVENT_WRITER;\n')),
    ).toBe('present');
  });

  // 5. THE WHOLE CHECK AND NOT THE PROBE ALONE, so the widening is watched where
  // a reader meets it: leg 2 going RED at the claim site with the sentence
  // named. A probe verdict nobody reaches through `checkAbsenceClaims` is a
  // verdict the corpus does not actually assert.
  test('RED: leg 2 fires at the claim site over an assignment install', () => {
    const root = withInstall(IMPORT_ONE + 'export const sink = TRANSACTION_EVENT_WRITER;\n');
    write(root, OLD_PATH, '// `makeEventSink` is called by NO file under any `src/`.\n');
    const findings = checkAbsenceClaims(root, { artifacts: [entry], claims });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('`makeEventSink` is called by NO file');
  });

  // ---------------------------------------------------------------------------
  // **THE SIX THAT STOP THIS BEING A WEAKENING, AND THEY ARE THE MORE IMPORTANT
  // HALF.** Widening a probe until it catches things that are not installs, then
  // loosening the assertion to compensate, is the failure this row was forbidden
  // outright. These are the line it must not cross, written as runs.
  // ---------------------------------------------------------------------------

  // 6. A COMPARISON IS NOT AN INSTALL, AND IT IS ROUTINELY THE LINE SAYING SO.
  // `=\s*NAME` matches the last `=` of `===` unless the lookbehind stops it, and
  // a file guarding `if (writer === TRANSACTION_EVENT_WRITER) throw ...` asserts
  // the opposite of an install. The shipped scope carries 2,223 comparisons
  // against a bare identifier and 50 against a SCREAMING_CASE name, so the shape
  // is dense in this tree even though neither name is on either side today.
  test('GREEN: a COMPARISON against the writer is not an install', () => {
    for (const op of ['===', '==', '!==', '!=', '>=', '<=']) {
      const root = withInstall(
        IMPORT_ONE + `export const isDefault = (w) => w ${op} TRANSACTION_EVENT_WRITER;\n`,
      );
      expect({ op, verdict: entry.probe(root) }).toEqual({ op, verdict: 'absent' });
    }
  });

  // 7. **AND A TYPE POSITION IS NOT AN INSTALL, WHICH IS THE CASE THAT SETTLES
  // WHY THE PROXY IS `=` AND NOT `;`.** `replay-audit-src-caller` three
  // artifacts down admits `;` and end-of-line, so it would catch assignment
  // through a STATEMENT-END proxy and this line with it. `export type W = typeof
  // TRANSACTION_EVENT_WRITER;` names the writer's type and installs nothing. The
  // narrower proxy was chosen for exactly this, before it cost anything.
  test('GREEN: a TYPE position is not an install, which is why the proxy is `=` and not `;`', () => {
    const root = withInstall(
      IMPORT_ONE + 'export type Writer = typeof TRANSACTION_EVENT_WRITER;\n',
    );
    expect(entry.probe(root)).toBe('absent');
  });

  // 8. THE FIVE REAL FILES' SHAPE, WHICH IS THE FALSE-POSITIVE SURFACE THIS
  // WIDENING OPENS AND THE ONE IT WAS MEASURED AGAINST. `stripComments` cannot
  // remove a string literal, and ADR-431 section 5 measured five files under
  // `apps/worker/src` whose refusal STRINGS name the writer in order to say this
  // deployable installs none. They spell `is TRANSACTION_EVENT_WRITER` and
  // backticked prose; NONE spells an assignment, and this case holds the probe
  // silent on the shape they do write.
  test('GREEN: a refusal string naming the writer in order to deny it is not an install', () => {
    const root = withInstall(
      'export const EVENT_SINK_BLOCKER =\n' +
        "  'the only composed event writer in this workspace is TRANSACTION_EVENT_WRITER and ' +\n" +
        "  'this deployable INSTALLS no writer for it';\n",
    );
    expect(entry.probe(root)).toBe('absent');
  });

  // 9. AND ADR-431'S OWN PROPERTY, RE-ASSERTED UNDER THE WIDENING. A name in a
  // re-export specifier list is a BINDING position, the repair one row back
  // blanks those lists, and a widening that reached back through the blanking
  // would undo it silently. Both spellings that entry measured, so neither can
  // regress alone.
  test('GREEN: a re-export list is still a binding and not an install', () => {
    for (const exported of [
      'export {\n  makeEventSink,\n  TRANSACTION_EVENT_WRITER,\n} from ' + "'./events.ts';\n",
      "export { TRANSACTION_EVENT_WRITER, makeEventSink } from './events.ts';\n",
      "export {\n  TRANSACTION_EVENT_WRITER,\n} from './events.ts';\n",
    ]) {
      const root = bareTree();
      write(
        root,
        HOME,
        'export function makeEventSink(deps) {\n  return deps;\n}\n' +
          'export const TRANSACTION_EVENT_WRITER = { write() {} };\n',
      );
      write(root, BARREL, exported);
      expect({ exported, verdict: entry.probe(root) }).toEqual({ exported, verdict: 'absent' });
    }
  });

  // 10. **THE BOUNDARY OF THE WIDENING, ASSERTED RATHER THAN LEFT TO LOOK
  // DELIBERATE.** `() => TRANSACTION_EVENT_WRITER` is a value position and is
  // arguably an install; `=>` is excluded structurally, since `>` is not
  // whitespace, and this row was sent to catch ASSIGNMENT and no further. So
  // this reads `absent`, and that is a REMAINING MISS stated in ADR-433 section
  // 6 rather than a property anybody wants. A later row closing it will find
  // this case telling it exactly what it is changing.
  test('GREEN: an arrow body returning the writer is still missed, and that is the fence', () => {
    const root = withInstall(IMPORT_ONE + 'export const get = () => TRANSACTION_EVENT_WRITER;\n');
    expect(entry.probe(root)).toBe('absent');
  });

  // 11. THE CONTROL. The same tree with no install at all, so a probe that had
  // been widened into reporting `present` on everything would fail here rather
  // than pass the ten cases above by accident.
  test('GREEN: the tree with no install at all reports absent', () => {
    expect(entry.probe(ledgerTree())).toBe('absent');
  });

  // ---------------------------------------------------------------------------
  // AND THE SIBLING PROBE, WHICH CARRIES THE IDENTICAL PROXY.
  //
  // ADR-431 SECTION 10 ROW 4 NAMED THIS RATHER THAN LEAVING A READER TO DERIVE
  // IT: `worker-queue-door-caller` reads `LIVE_QUEUE` followed by `.`, `,` or
  // `)`, which is the same three characters, so `const q = LIVE_QUEUE;` was the
  // same miss one probe over. Repairing one and not the other would leave the
  // file holding two answers to one question, which is that entry's row 2 and is
  // the defect this file is already carrying once.
  // ---------------------------------------------------------------------------
  describe('the door probe carries the same proxy and takes the same widening', () => {
    const DOOR = 'apps/worker/src/queue.ts';
    const door = artifact('worker-queue-door-caller');

    /** The door declared at its module, and `body` at a second file. */
    const doorTree = (body: string): string => {
      const root = bareTree();
      write(
        root,
        DOOR,
        'export const LIVE_QUEUE = { declareQueue() {} };\n' +
          'export function workerQueue(q) {\n  return q;\n}\n',
      );
      write(root, 'apps/worker/src/adapter.ts', body);
      return root;
    };

    test('RED: the door assigned to a binding is an install', () => {
      expect(
        door.probe(
          doorTree("import { LIVE_QUEUE } from './queue.ts';\nexport const q = LIVE_QUEUE;\n"),
        ),
      ).toBe('present');
    });

    test('GREEN: a comparison against the door is not an install', () => {
      expect(
        door.probe(
          doorTree(
            "import { LIVE_QUEUE } from './queue.ts';\nexport const isLive = (q) => q === LIVE_QUEUE;\n",
          ),
        ),
      ).toBe('absent');
    });

    // **A DECLARATION IS NOT AN INSTALL, AND GETTING THE DIRECTION OF THE
    // ASSIGNMENT BACKWARDS IS THE LIKELIEST WAY TO WRITE THIS WIDENING WRONG.**
    // `const LIVE_QUEUE = ...` binds the name; `const q = LIVE_QUEUE` installs
    // it, and only the second is what the register asserts about. The door's own
    // module is excluded by path so it cannot show this, and a SECOND file
    // declaring a binding of the same name can: a local shadow installs nothing.
    // A proxy reading the name on the LEFT of the `=` reports it as the door
    // arriving.
    test('GREEN: a DECLARATION of the same name elsewhere is not the door being installed', () => {
      const shadow = doorTree('const LIVE_QUEUE = 1;\nexport default LIVE_QUEUE;\n');
      expect(door.probe(shadow)).toBe('absent');
    });
  });

  // ---------------------------------------------------------------------------
  // AND THE FALSE-POSITIVE SURFACE, BOUND OVER THE REAL TREE RATHER THAN
  // ASSERTED IN PROSE.
  //
  // The widening adds ZERO files to what either probe reports over this
  // repository: measured at the moment it landed, 350 shipped files carry 4,897
  // assignments of a bare identifier, 175 of them to a SCREAMING_CASE name, and
  // NONE inside a string literal. The day somebody writes a refusal string that
  // spells `sink = TRANSACTION_EVENT_WRITER`, this case goes red and names the
  // file, which is the whole of the surface this row opened.
  // ---------------------------------------------------------------------------
  test('the widening moves no verdict over this repository', () => {
    expect(artifact('event-sink-caller').probe(REPO_ROOT)).toBe('absent');
    expect(artifact('worker-queue-door-caller').probe(REPO_ROOT)).toBe('present');
    expect(ri35.run(REPO_ROOT)).toEqual([]);
  });
});

// =============================================================================
// ADR-417: LEG 7, THE REGISTER'S OWN ARITHMETIC
// =============================================================================
// `sweptBy` argues for a needle or against one, and the argument is routinely a
// COUNT. NOTHING DERIVED ANY OF THEM. ADR-415 measured two wrong, one of them
// from the commit that wrote it, and ADR-417 measured the class.
//
// THE CASES BELOW BIND THE PROPERTY THAT MADE THE FIX HARD RATHER THAN ONLY THE
// FIX. A control over derived figures must not become a control that reddens
// when prettier rewraps a comment: that is the defect ADR-415 found the estate
// already holding a green on, and reproducing it in a new leg would be shipping
// the thing this row was sent to fix. `stays green under a reflow` is that
// property, watched over a fixture where the reflow really does change the
// derived total.
// =============================================================================
describe('ADR-417: leg 7 derives both sides of the register`s arithmetic', () => {
  const NAMES = ['LIVE_QUEUE'];

  /** A tree with the door named in two places, and a census over it. */
  const doorTree = (): string => {
    const root = bareTree();
    write(root, 'apps/worker/src/queue.ts', 'export const LIVE_QUEUE = 1;\nuse(LIVE_QUEUE);\n');
    write(root, 'apps/worker/src/adapter.ts', 'import { LIVE_QUEUE } from "./queue.ts";\n');
    return root;
  };

  const withCensus = (places: { where: string; is: string }[], over = {}) => [
    {
      ...artifact('pgboss-job-store-migration'),
      census: { names: NAMES, scope: 'shipped' as const, places },
      ...over,
    },
  ];

  const claim = {
    site: 'apps/worker/src/queue.ts',
    claim: 'export const LIVE_QUEUE = 1;',
    disposition: 'live' as const,
    artifact: 'pgboss-job-store-migration',
    why: 'a synthetic claim, so leg 7 is the only leg with anything to say',
  };

  // THE SEED IS THE DEFECT'S OWN SHAPE: an account that names one place while
  // the names reach two. This is what `worker-queue-door-caller` carried in
  // prose for two waves and what nothing in this package would have reported.
  test('a place the names reach and the census does not account for is a finding', () => {
    const root = doorTree();
    const findings = checkAbsenceClaims(root, {
      artifacts: withCensus([{ where: 'apps/worker/src/queue.ts', is: 'the declaring module' }]),
      claims: [claim],
    });
    expect(findings.join('\n')).toContain('does not add up');
    expect(findings.join('\n')).toContain('reach 3 line(s)');
    expect(findings.join('\n')).toContain('hold 2 of them');
    expect(findings.join('\n')).toContain('apps/worker/src/adapter.ts (1 line(s))');
  });

  test('the same tree with the second place accounted for is green', () => {
    const root = doorTree();
    const findings = checkAbsenceClaims(root, {
      artifacts: withCensus([
        { where: 'apps/worker/src/queue.ts', is: 'the declaring module' },
        { where: 'apps/worker/src/adapter.ts', is: 'the importer' },
      ]),
      claims: [claim],
    });
    expect(findings).toEqual([]);
  });

  // **THE HARD CONSTRAINT, BOUND RATHER THAN ASSERTED.** The reflow below is a
  // real one: the same three mentions, rewrapped so the file holds FOUR lines
  // carrying a name instead of three. A leg holding a written integer would go
  // red here at a diff that changed no meaning. This one derives both sides
  // from the same walk, so the rewrap moves the total and the part together.
  test('a reflow that changes the derived total leaves leg 7 green', () => {
    const root = doorTree();
    const places = [
      { where: 'apps/worker/src/queue.ts', is: 'the declaring module' },
      { where: 'apps/worker/src/adapter.ts', is: 'the importer' },
    ];
    const before = checkAbsenceClaims(root, { artifacts: withCensus(places), claims: [claim] });
    expect(before).toEqual([]);
    const reachedBefore = Number(
      /reach (\d+) line\(s\)/.exec(
        checkAbsenceClaims(root, {
          artifacts: withCensus([places[0] as { where: string; is: string }]),
          claims: [claim],
        }).join('\n'),
      )?.[1] ?? '0',
    );
    expect(reachedBefore).toBeGreaterThan(0);

    // The rewrap: one more line in an ACCOUNTED file carrying the name.
    write(
      root,
      'apps/worker/src/adapter.ts',
      'import {\n  LIVE_QUEUE,\n} from "./queue.ts";\nconst q = LIVE_QUEUE;\n',
    );
    const after = checkAbsenceClaims(root, { artifacts: withCensus(places), claims: [claim] });
    expect(after).toEqual([]);

    // AND THE REFLOW REALLY DID MOVE THE NUMBER, which is what makes the case
    // above evidence rather than a tautology. THE TWO TOTALS ARE DERIVED RATHER
    // THAN TYPED, on this row's own subject: a case asserting the integer would
    // be the defect ADR-417 exists about, reproduced inside its own suite.
    // Dropping the accounted place makes leg 7 report the total it derived.
    const reachedBy = (body: string): number =>
      Number(/reach (\d+) line\(s\)/.exec(body)?.[1] ?? '0');
    const expose = (): number =>
      reachedBy(
        checkAbsenceClaims(root, {
          artifacts: withCensus([places[0] as { where: string; is: string }]),
          claims: [claim],
        }).join('\n'),
      );
    expect(expose()).toBeGreaterThan(reachedBefore);
  });

  // A NEIGHBOUR'S CORRECT REPAIR IS NOT A FINDING. A place empties when the
  // thing in it is removed, and reddening on that would hand the next row a
  // failure for doing the work it was sent to do.
  test('an accounted place that reaches zero lines is not a finding', () => {
    const root = doorTree();
    const findings = checkAbsenceClaims(root, {
      artifacts: withCensus([
        { where: 'apps/worker/src/queue.ts', is: 'the declaring module' },
        { where: 'apps/worker/src/adapter.ts', is: 'the importer' },
        { where: 'apps/worker/src/gone.ts', is: 'a place whose contents were removed' },
      ]),
      claims: [claim],
    });
    expect(findings).toEqual([]);
  });

  // `strip` IS READ AND NOT ASSUMED, because two shipped entries name different
  // instruments and a census that quietly picked one would measure something
  // neither of them claims.
  test('`strip` decides whether a mention in a comment counts', () => {
    const root = bareTree();
    write(root, 'apps/worker/src/queue.ts', 'export const LIVE_QUEUE = 1;\n');
    write(root, 'apps/worker/src/prose.ts', '// this file never touches LIVE_QUEUE\n');
    const places = [{ where: 'apps/worker/src/queue.ts', is: 'the declaring module' }];
    const raw = checkAbsenceClaims(root, {
      artifacts: withCensus(places),
      claims: [{ ...claim }],
    });
    expect(raw.join('\n')).toContain('apps/worker/src/prose.ts (1 line(s))');

    const stripped = checkAbsenceClaims(root, {
      artifacts: [
        {
          ...artifact('pgboss-job-store-migration'),
          census: { names: NAMES, scope: 'shipped' as const, strip: true, places },
        },
      ],
      claims: [{ ...claim }],
    });
    expect(stripped).toEqual([]);
  });

  // A DIRECTORY PREFIX ACCOUNTS FOR WHAT IS UNDER IT, which is how
  // `event-sink-caller` accounts for a deployable that names the writer in
  // order to say it cannot reach it.
  test('a place ending in `/` accounts for the files under it', () => {
    const root = doorTree();
    write(root, 'apps/worker/src/deep/nested.ts', 'const a = LIVE_QUEUE;\n');
    const findings = checkAbsenceClaims(root, {
      artifacts: withCensus([
        { where: 'apps/worker/src/queue.ts', is: 'the declaring module' },
        { where: 'apps/worker/src/', is: 'everything else in the deployable' },
      ]),
      claims: [claim],
    });
    expect(findings).toEqual([]);
  });

  // A CHECK THAT CANNOT RUN IS NOT A CHECK THAT PASSED. An empty scope would
  // make the identity hold trivially, which is the runner's rule 2 and the one
  // failure mode this leg shares with every probe above it.
  test('an empty scope throws rather than holding the identity vacuously', () => {
    const root = mkdtempSync(join(tmpdir(), 'merit-absence-'));
    seeded.push(root);
    write(root, 'packages/db/migrations/0001_init.sql', 'CREATE TABLE identities (id uuid);\n');
    expect(() =>
      checkAbsenceClaims(root, {
        artifacts: withCensus([{ where: 'apps/worker/src/queue.ts', is: 'the declaring module' }]),
        claims: [],
      }),
    ).toThrow(/found no file in the `shipped` scope/);
  });
});

// =============================================================================
// ADR-417: THE SHIPPED CENSUSES, ON THIS REPOSITORY
// =============================================================================
describe('ADR-417: the shipped censuses hold, and the old sentences do not', () => {
  const withCensus = ABSENCE_ARTIFACTS.filter((a) => a.census !== undefined);

  // NON-VACUITY FIRST. Leg 7 is a no-op over a register with no census, so the
  // cases below would pass over an empty one. The bound is a floor rather than
  // an equality so a later row adding a census is not a test failure.
  test('the register carries censuses for leg 7 to derive', () => {
    expect(withCensus.length).toBeGreaterThanOrEqual(3);
  });

  // NO CENSUS WRITES AN INTEGER, which is ADR-034's second branch and the whole
  // of why this leg cannot go stale. A count typed into the data would decay at
  // the rate the tree moves, exactly as the prose it replaced did.
  //
  // THE INSTRUMENT IS THE FIELDS LEG 7 READS, and it is narrowed to those on
  // purpose. `is` is prose for a reader and carries ADR citations, which are
  // addresses rather than counts; scanning it for digits would fail this case
  // on a reference. What must hold no number is what the mechanism consumes.
  test('no census carries a count in any field leg 7 reads', () => {
    for (const entry of withCensus) {
      const census = entry.census;
      if (census === undefined) throw new Error(`${entry.key} lost its census`);
      const read = [census.scope, ...census.names, ...census.places.map((p) => p.where)];
      expect({ key: entry.key, numeric: read.filter((value) => /\d/.test(value)) }).toEqual({
        key: entry.key,
        numeric: [],
      });
      const values = [...read, census.strip].filter((value) => typeof value === 'number');
      expect({ key: entry.key, numbers: values.length }).toEqual({ key: entry.key, numbers: 0 });
    }
  });

  // EVERY CENSUS IS MEASURED AGAINST SOMETHING. A census whose names reach no
  // line at all would satisfy the identity while asserting nothing, which is
  // the vacuous pass this file refuses everywhere else.
  test('every census reaches lines on this repository', () => {
    for (const entry of withCensus) {
      const found = checkAbsenceClaims(REPO_ROOT, {
        artifacts: [{ ...entry, census: { ...entry.census!, places: [] } }],
        claims: ABSENCE_CLAIMS.filter((c) => c.artifact === entry.key),
      });
      expect({
        key: entry.key,
        measured: found.some((f) => f.includes('does not add up')),
      }).toEqual({ key: entry.key, measured: true });
    }
  });

  // **THE OLD SENTENCE, AS DATA, WATCHED RED AGAINST THE REAL TREE.**
  // `worker-queue-door-caller` read that the door's two names "reach three
  // lines in the shipped scope and all three are its own declaration". That is
  // the census below, and this repository says otherwise.
  test('`worker-queue-door-caller`s deleted figure is red as a census', () => {
    const entry = artifact('worker-queue-door-caller');
    const findings = checkAbsenceClaims(REPO_ROOT, {
      artifacts: [
        {
          ...entry,
          census: {
            names: ['LIVE_QUEUE', 'workerQueue'],
            scope: 'shipped' as const,
            places: [{ where: 'apps/worker/src/queue.ts', is: 'the declaring module' }],
          },
        },
      ],
      claims: ABSENCE_CLAIMS.filter((c) => c.artifact === 'worker-queue-door-caller'),
    });
    expect(findings.join('\n')).toContain('does not add up');
    expect(findings.join('\n')).toContain('apps/worker/src/provisioning/queue-adapter.ts');
  });

  // **AND THE PARTITION DOES NOT DEPEND ON A REPAIR THIS ROW DOES NOT OWN.**
  // ADR-415 found `apps/api/src/events.ts` and `packages/ledger/src/events.ts`
  // both claiming to carry the anchored sentence, one of them falsely, and a
  // later row is resolving it. BOTH are accounted places, so the identity holds
  // whichever way that goes: this case drops each in turn and asserts leg 7
  // stays silent, which is the claim `sweptBy` makes in words.
  test('`event-sink-caller`s census survives either events.ts going away', () => {
    const entry = artifact('event-sink-caller');
    const claims = ABSENCE_CLAIMS.filter((c) => c.artifact === 'event-sink-caller');
    for (const dropped of ['apps/api/src/events.ts', 'packages/ledger/src/events.ts']) {
      const places = entry.census!.places.filter((place) => place.where !== dropped);
      const findings = checkAbsenceClaims(REPO_ROOT, {
        artifacts: [{ ...entry, census: { ...entry.census!, places } }],
        claims,
      });
      // Dropping a place is not the same as the file going away: what this
      // asserts is that the file is ACCOUNTED, so its lines are named in the
      // finding rather than silently folded into a neighbour.
      expect({ dropped, named: findings.join('\n').includes(dropped) }).toEqual({
        dropped,
        named: true,
      });
    }
  });
});
