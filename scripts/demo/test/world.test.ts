// =============================================================================
// scripts/demo/test/world.test.ts
// =============================================================================
// THE DEMO WORLD, AND THE THING THAT MAKES IT WORTH SEEDING: that a replay over
// it can FAIL.
//
// `CI-09`'s replay self-audit leg was closed `(b) Waiting` on the ground that
// "having a subject and having an input are different things" ([session 118],
// [ADR-073] section 5). This suite asserts, in order, that the input now exists,
// that INV-04 holds over it, and that the audit which reports INV-04 holding is
// looking at something.
//
// THE THIRD IS THE ONE THAT CANNOT BE LEFT OUT. `runReplayAudit` over an empty
// world returns `accountsAudited: 0, diverged: 0` and reads exactly like a clean
// audit; that is the whole reason ADR-073 refused to build this leg in session
// 114. A suite that asserted only `diverged === 0` would pass over the empty
// world, over a world whose rows were never read, and over an audit whose
// comparison had been deleted.
//
// THE SUITE RUNS IN CI-02's `unit` PROJECT, because `scripts/demo` is a source
// root in `vitest.config.ts` and this file carries no stage suffix. That is
// where the demo's determinism suite already runs and it is the right stage: a
// fold over six accounts and twenty-five sessions is a unit of compute, not an
// integration.
// =============================================================================

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WORLD,
  DEMO_WORLD_CALENDAR_REVISION,
  DEMO_WORLD_ENGINE_VERSION,
  DemoWorldRefusal,
  assertIntegerCents,
  auditDemoWorld,
  buildDemoWorld,
  checkAgainstExpectation,
  demoAccountId,
  demoWorldPorts,
  perturbDemoWorld,
  type DemoWorld,
} from '../world.ts';
import { runSeedWorld } from '../seed-world.ts';

/** Built once. The fold is pure, so every case below reads the same world. */
const world: DemoWorld = buildDemoWorld(DEFAULT_WORLD);

describe('the demo world is a world', () => {
  it('seeds accounts, and every one of them has stored rows to audit', () => {
    expect(world.accounts.length).toBeGreaterThan(0);
    for (const account of world.accounts) {
      expect(account.days.length).toBeGreaterThan(0);
      expect(account.accountId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
    expect(world.expectation.accountsAudited).toBeGreaterThan(0);
    expect(world.expectation.storedRows).toBeGreaterThan(0);
  });

  it('reaches the funded phase and the breach path, so the audit covers both', () => {
    // A WORLD OF EVALUATIONS AUDITS LITTLE. Most of M01's funded rules never fire
    // before an eval passes, so a world that never funds replays a fold whose
    // interesting half was never taken. `scripts/demo/README.md` documents the
    // same three shapes on the same default run.
    expect(world.expectation.reachedFunded).toBeGreaterThan(0);
    expect(world.expectation.breached).toBeGreaterThan(0);
  });

  it('stamps one engine version and one calendar revision on every stored row', () => {
    // B.4 step 1 scopes divergence detection on exactly these two fields. A world
    // carrying two of either would put rows out of scope, and an out-of-scope row
    // is a row the audit skips without saying it skipped anything.
    for (const account of world.accounts) {
      for (const row of account.rows) {
        expect(row.engineVersion).toBe(DEMO_WORLD_ENGINE_VERSION);
        expect(row.calendarRevisionId).toBe(DEMO_WORLD_CALENDAR_REVISION);
      }
    }
  });

  it('holds money as integer cents in every row', () => {
    // The constitution's rule, mechanically. A seeded float in a demo world
    // becomes a seeded float in every replay that reads it.
    for (const account of world.accounts) {
      for (const row of account.rows) expect(() => assertIntegerCents(row)).not.toThrow();
    }
  });

  it('refuses a row whose money is not a bigint', () => {
    // The converse, so the assertion above cannot pass vacuously.
    const first = world.accounts[0]?.rows[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const wrong = { ...first, balanceCents: 1234 as unknown as typeof first.balanceCents };
    expect(() => assertIntegerCents(wrong)).toThrow(DemoWorldRefusal);
  });

  it('gives one account id per platform ref, and the same one every time', () => {
    const ids = new Set(world.accounts.map((a) => a.accountId));
    expect(ids.size).toBe(world.accounts.length);
    expect(demoAccountId('merit-demo-001', 'DEMOSTDY000001')).toBe(
      demoAccountId('merit-demo-001', 'DEMOSTDY000001'),
    );
    expect(demoAccountId('merit-demo-001', 'DEMOSTDY000001')).not.toBe(
      demoAccountId('merit-demo-002', 'DEMOSTDY000001'),
    );
  });

  it('is sealed: nothing may write a second rule state into it', () => {
    const { ports } = demoWorldPorts(world);
    const row = world.accounts[0]?.rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    return expect(ports.write.writeRuleState(row)).rejects.toThrow(DemoWorldRefusal);
  });
});

describe('INV-04 holds over the seeded world', () => {
  it('reproduces every stored row byte-identically', async () => {
    const audit = await auditDemoWorld(world);

    expect(checkAgainstExpectation(audit)).toEqual([]);
    expect(audit.report.diverged).toBe(0);
    expect(audit.divergences).toEqual([]);
    // The counters, restated against the world rather than against the report's
    // own expectation object, so a bug that moved both together is still caught.
    expect(audit.report.matched).toBe(world.accounts.reduce((sum, a) => sum + a.rows.length, 0));
    expect(audit.report.outOfScope).toBe(0);
  });

  it('audits every account that holds a stored row', async () => {
    const audit = await auditDemoWorld(world);
    const withRows = world.accounts.filter((a) => a.rows.length > 0);

    expect(audit.report.accountsAudited).toBe(withRows.length);
    expect(audit.report.accounts.map((a) => a.accountId).sort()).toEqual(
      withRows.map((a) => a.accountId).sort(),
    );
  });
});

describe('the audit can fail, which is what makes it green meaningfully', () => {
  it('catches one cent moved in one stored row, and names the column', async () => {
    const perturbed = perturbDemoWorld(world);
    const audit = await auditDemoWorld(perturbed);

    expect(audit.report.diverged).toBe(1);
    expect(audit.divergences).toHaveLength(1);
    expect(audit.divergences[0]?.divergences.map((d) => d.field)).toContain('balance_cents');
    // The rest of the book is untouched: the replay chains its own prior from
    // day one, so a corrupted stored row poisons no later comparison. That is
    // INV-04's "from day one" doing the work `AccountDay.prior` is not allowed
    // to do.
    expect(checkAgainstExpectation(audit)).toEqual([]);
  });

  it('catches the corruption on whichever row it lands on', async () => {
    // A falsification that only worked on day one would be a falsification of
    // the first comparison rather than of the comparison.
    const target = world.accounts.findIndex((a) => a.rows.length > 3);
    expect(target).toBeGreaterThanOrEqual(0);

    const audit = await auditDemoWorld(perturbDemoWorld(world, target, 3, -250n));
    expect(audit.report.diverged).toBe(1);
    expect(audit.divergences[0]?.accountId).toBe(world.accounts[target]?.accountId);
    expect(audit.divergences[0]?.tradingDay).toBe(world.accounts[target]?.rows[3]?.tradingDay);
  });

  it('refuses an empty world instead of reporting a clean audit over nothing', async () => {
    // ADR-073 SECTION 5, VERBATIM: "when it is built it refuses on
    // `accountsAudited === 0`". `runReplayAudit`'s own OI-14 guard fires on
    // `storedRows > 0 && inScope === 0` and cannot see this case at all.
    const empty: DemoWorld = { ...world, accounts: [] };
    await expect(auditDemoWorld(empty)).rejects.toThrow(DemoWorldRefusal);
  });

  it('refuses a perturbation that has no row to perturb', async () => {
    await expect(
      Promise.resolve().then(() => perturbDemoWorld({ ...world, accounts: [] })),
    ).rejects.toThrow(DemoWorldRefusal);
  });
});

describe('the run', () => {
  it('passes on the default world and says so with exit code 0', async () => {
    const result = await runSeedWorld(DEFAULT_WORLD);

    expect(result.code).toBe(0);
    expect(result.text).toContain('PASS');
    expect(result.text).not.toContain('FINDINGS');
  });

  it('reproduces byte for byte from its seed', async () => {
    // The demo's own property, over this run. A `Date`, a `Math.random`, an
    // environment read or a `Map` iteration over an unordered source would each
    // break it while both packages stayed pure.
    const first = await runSeedWorld(DEFAULT_WORLD);
    const second = await runSeedWorld(DEFAULT_WORLD);

    expect(second.text).toBe(first.text);
  });

  it('seeds a different world from a different seed', async () => {
    // So the byte comparison above cannot pass because the report is constant.
    const other = await runSeedWorld({ ...DEFAULT_WORLD, seed: 'merit-demo-002' });
    const base = await runSeedWorld(DEFAULT_WORLD);

    expect(other.text).not.toBe(base.text);
    expect(other.code).toBe(0);
  });
});
