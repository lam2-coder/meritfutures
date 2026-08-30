// =============================================================================
// apps/api/test/admin-write-plan-validation.test.ts
// =============================================================================
// `ADR-257`. THE PROJECTION `useAdminWriteBackend` NAMED AS ITS SECOND SUPPLIER,
// DERIVED FROM THE TWO DECLARED SHAPES RATHER THAN DESCRIBED BETWEEN THEM.
//
// The entry said `ValidationResult` has to reach `PlanValidation` and that
// nothing performed the map. `projectPlanValidation` performs it now, and the
// interesting half is what it CANNOT carry: four fields per finding arriving at
// two slots, one of the two lost being INTEGER CENTS on a plan an operator is
// about to publish.
//
// SO THE LOSS IS MEASURED HERE INSTEAD OF ASSERTED. Every claim in the narrowed
// entry and every clause of `ADR-257` is executed against the real engine: the
// arithmetic is read off the two declarations, the totality of the `sizeCents`
// loss is demonstrated by running `validatePlan` over two size rows carrying the
// same defect, and the `ok` ruling is executed on a plan whose nineteen `CV-nn`
// rules all pass and whose materialization does not.
//
// WHAT THIS FILE DOES NOT DO IS WIRE ANYTHING. The port stays blocked on
// `principal(request)` and the last test is what keeps that honest.
//
// THE PLAN BELOW IS A SHAPE DRIVER AND IS NOT A CLAIM ABOUT ANY MERIT PLAN
// (`TR-01`). Appendix A's parameters are asserted in
// `packages/rules-engine/test/plan-validate.test.ts` against Appendix A; nothing
// here reads a published figure, and every number below was chosen only to make
// `validatePlan` answer the way this file needs it to answer.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { validatePlan } from '@merit/rules-engine';
import type { Cents, PlanRulesJson, PlanVersionId, PlanVersionSizeRow } from '@merit/rules-engine';
import { expect, test } from 'vitest';

import {
  AdminWriteUnwired,
  UNWIRED_ADMIN_WRITE_BACKEND,
  projectPlanValidation,
} from '../src/routes/admin-writes.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SRC = join(import.meta.dirname, '..', 'src');
const read = (path: string): string => readFileSync(path, 'utf8');

const c = (n: bigint): Cents => n as Cents;

/** A plan every `CV-nn` accepts, so that a case can move ONE thing and see it. */
const RULES: PlanRulesJson = {
  schema_version: 1,
  phase_eval: {
    enabled: true,
    profit_target_bp: 800,
    drawdown: {
      type: 'trailing_eod',
      amount_bp: 500,
      lock: { enabled: false, at_profit_cents: null, floor_at_cents: null },
    },
    daily_loss_limit: { type: 'none', amount_bp: null },
    min_trading_days: 1,
    consistency: { enabled: false, max_day_share_bp: null, mode: 'pass_time_dilutable' },
    max_days: null,
  },
  phase_funded: {
    drawdown: {
      type: 'trailing_eod',
      amount_bp: 500,
      lock: { enabled: false, at_profit_cents: null, floor_at_cents: null },
    },
    daily_loss_limit: { type: 'none', amount_bp: null },
    min_trading_days: 0,
    win_days: { required_count: 1, floor_bp: 10, reset_on_payout: true },
    consistency: { enabled: false, max_day_share_bp: null, mode: 'payout_gated' },
    buffer_bp: 100,
    cadence_gap_trading_days: 0,
    min_settlement_lag_trading_days: 0,
    payout_cap_schedule: [{ from_ordinal: 1, cap_bp: 100 }],
    min_payout_cents: c(10_000n),
    split_bp: 8000,
    max_payouts: 3,
    post_payout_floor_rule: { mode: 'none' },
  },
};

/** One `plan_version_sizes` row this plan accepts, at whatever size is asked for. */
const size = (sizeCents: bigint): PlanVersionSizeRow => ({
  plan_version_id: 'pv-shape-driver' as PlanVersionId,
  size_cents: c(sizeCents),
  drawdown_cents: c(sizeCents / 20n),
  profit_target_cents: c(sizeCents / 10n),
  buffer_cents: c(sizeCents / 100n),
  win_day_floor_cents: c(sizeCents / 1000n),
  payout_cap_schedule_cents: [{ from_ordinal: 1, cap_cents: c(sizeCents / 100n) }],
  daily_loss_limit_cents: null,
  floor_lock_enabled: false,
  floor_lock_at_profit_cents: null,
  floor_lock_floor_at_cents: null,
});

const SMALL = 5_000_000n;
const LARGE = 10_000_000n;

test('the base plan passes, so every case below moves exactly one thing', () => {
  // A fixture that was already failing would make every assertion here a
  // reading of the fixture rather than of the projection.
  const result = validatePlan(RULES, [size(SMALL), size(LARGE)]);
  expect(result.errors).toEqual([]);
  expect(result.materialization).toEqual([]);
  expect(result.ok).toBe(true);
  expect(projectPlanValidation(result)).toEqual({ ok: true, errors: [] });
});

test('the arithmetic: four fields per finding arrive at two slots', () => {
  // READ OFF THE TWO DECLARATIONS, because the whole ruling rests on a count
  // that a later edit to either shape would change.
  const engine = read(join(ROOT, 'packages', 'rules-engine', 'src', 'types.ts'));
  const declaration = engine.slice(engine.indexOf('export interface CvViolation'));
  const body = declaration.slice(0, declaration.indexOf('}'));
  for (const field of ['id', 'path', 'detail', 'sizeCents']) {
    expect(body).toContain(`readonly ${field}`);
  }

  // And the target carries two, one of which is free text.
  expect(read(join(SRC, 'routes', 'admin-writes.ts'))).toContain(
    'readonly errors: readonly { readonly code: string; readonly message: string }[];',
  );

  // The projected entries carry those two keys and no third, which is the half
  // a declaration cannot show: a widened object would still type-check here.
  const failing = validatePlan(RULES, [{ ...size(SMALL), drawdown_cents: c(0n) }]);
  const projected = projectPlanValidation(failing);
  expect(projected.errors.length).toBeGreaterThan(0);
  for (const entry of projected.errors) {
    expect(Object.keys(entry).sort()).toEqual(['code', 'message']);
  }
});

test('`sizeCents` is the ONLY discriminator between two size rows, and it is lost entirely', () => {
  // THIS IS THE WHOLE FINDING AND IT IS A MEASUREMENT. Two rows carrying the
  // same defect produce two violations that agree on `id`, on `path` and on
  // `detail`. `sizeCents` is the one field that tells them apart.
  const zeroed = (n: bigint): PlanVersionSizeRow => ({ ...size(n), drawdown_cents: c(0n) });
  const result = validatePlan(RULES, [zeroed(SMALL), zeroed(LARGE)]);
  const found = result.errors.filter((violation) => violation.id === 'CV-02');

  expect(found).toHaveLength(2);
  expect(found[0]!.path).toBe(found[1]!.path);
  expect(found[0]!.detail).toBe(found[1]!.detail);
  expect(found[0]!.sizeCents).toBe(c(SMALL));
  expect(found[1]!.sizeCents).toBe(c(LARGE));

  // AND AFTER THE PROJECTION THE TWO ARE INDISTINGUISHABLE. Not degraded, not
  // approximated: equal. An operator reading the problem document cannot tell
  // whether one size row is broken or five are.
  const projected = projectPlanValidation(result).errors.filter((entry) => entry.code === 'CV-02');
  expect(projected).toHaveLength(2);
  expect(projected[0]).toEqual(projected[1]);
});

test('nothing is folded into `message`: it is `detail`, byte for byte', () => {
  // THE TRAP THE ROW NAMED. A `sizeCents` stringified into prose is a number no
  // caller can read, so the refusal is asserted rather than the intention.
  const zeroed = (n: bigint): PlanVersionSizeRow => ({ ...size(n), drawdown_cents: c(0n) });
  const result = validatePlan(RULES, [zeroed(SMALL), zeroed(LARGE)]);
  const projected = projectPlanValidation(result);

  const details = [...result.errors, ...result.materialization].map((f) => f.detail);
  expect(projected.errors.map((entry) => entry.message)).toEqual(details);

  // The two sizes are five million and ten million cents and neither appears
  // anywhere in what a caller is handed.
  const wire = JSON.stringify(projected);
  expect(wire).not.toContain(String(SMALL));
  expect(wire).not.toContain(String(LARGE));
});

test('the `ok` ruling: the engine`s, carried without arithmetic', () => {
  // A PLAN WHOSE NINETEEN `CV-nn` RULES ALL PASS AND WHOSE MATERIALIZATION DOES
  // NOT. `plan_version_sizes` materializes ONE `daily_loss_limit_cents` and
  // `rules` declares a limit per phase, so two differing phases are a row that
  // cannot be right for both.
  const split: PlanRulesJson = {
    ...RULES,
    phase_eval: { ...RULES.phase_eval, daily_loss_limit: { type: 'soft', amount_bp: 200 } },
  };
  const result = validatePlan(split, [{ ...size(SMALL), daily_loss_limit_cents: c(100_000n) }]);

  expect(result.errors).toEqual([]);
  expect(result.materialization).toHaveLength(1);
  expect(result.materialization[0]!.id).toBe('MZ-per-phase');
  expect(result.ok).toBe(false);

  // The projection carries that `false` rather than deriving one. A projection
  // that recomputed `ok` from its own CV list would have said `true` here, and
  // `0004_catalog.sql` puts this check at publish in the migration that declares
  // the column.
  expect(projectPlanValidation(result).ok).toBe(false);
  expect(read(join(ROOT, 'packages', 'db', 'migrations', '0004_catalog.sql'))).toContain(
    'CV-publish validation asserts the materialized flag matches',
  );
});

test('an `ok: false` never arrives with an empty reason list', () => {
  // The publish handler turns `errors` into the problem document`s `errors[]`,
  // so a projection that dropped the materialization findings would answer
  // `validation_failed` with nothing in it.
  const split: PlanRulesJson = {
    ...RULES,
    phase_eval: { ...RULES.phase_eval, daily_loss_limit: { type: 'soft', amount_bp: 200 } },
  };
  const result = validatePlan(split, [{ ...size(SMALL), daily_loss_limit_cents: c(100_000n) }]);
  const projected = projectPlanValidation(result);

  expect(projected.ok).toBe(false);
  expect(projected.errors).toHaveLength(1);
  expect(projected.errors[0]!.code).toBe('MZ-per-phase');

  // And the handler`s own map is what makes that consequential.
  expect(read(join(SRC, 'routes', 'admin-writes.ts'))).toContain(
    'validation.errors.map((error) => ({ path: error.code, message: error.message })),',
  );
});

test('`diffs` are dropped and are never folded into `errors`', () => {
  // `PublishDiff` NEVER BLOCKS, so a `PW-` value inside a refusal list would
  // make an `info` read as a reason a publish failed. The base plan produces
  // three of them while `ok` is true.
  const result = validatePlan(RULES, [size(SMALL)]);
  expect(result.diffs.length).toBeGreaterThan(0);
  expect(result.ok).toBe(true);

  const projected = projectPlanValidation(result);
  expect(projected.errors).toEqual([]);
  expect(JSON.stringify(projected)).not.toContain('PW-');
});

test('the wire has two slots too, and that is where the loss is forced', () => {
  // THE FINDING IS ABOUT `API_CONTRACT` AND NOT ABOUT THIS PORT. Widening
  // `PlanValidation` would move the loss one line later rather than remove it,
  // because section 2 freezes the envelope at two fields and this endpoint`s
  // refusal travels inside it.
  const contract = read(join(ROOT, 'docs', 'architecture', 'API_CONTRACT.md'));
  expect(contract).toContain('errors?: Array<{ path: string; message: string }>;');

  // `*_cents` are JSON integers everywhere this document carries money, which is
  // the sentence a folded `sizeCents` would be written against.
  expect(contract).toContain('`*_cents` are JSON integers');
});

test('the port is NOT wired, and it still refuses by name', () => {
  // THE DELIVERABLE IS NOT A RAISED WIRED COUNT. `useAdminWriteBackend` stays
  // blocked on `principal(request)` whatever this session landed.
  expect(() => UNWIRED_ADMIN_WRITE_BACKEND.validatePlan({}, [])).toThrow(AdminWriteUnwired);
  expect(() => UNWIRED_ADMIN_WRITE_BACKEND.validatePlan({}, [])).toThrow(/no backend is installed/);

  // Read as text, on `wiring.test.ts`'s own reason: calling the setter is a side
  // effect of importing the entry point, so source is the only observation that
  // does not start a server.
  expect(read(join(SRC, 'start.ts'))).not.toContain('useAdminWriteBackend(');
});

test('the refuted sentence is gone from the port, at the source', () => {
  // A correction recorded in `wiring.test.ts` while the refuted sentence stands
  // in the file it is about is the defect `ADR-172` found twice and `ADR-246`
  // found a third time. It is asserted as an ABSENCE so a keep-both merge
  // cannot bring it back.
  const source = read(join(SRC, 'routes', 'admin-writes.ts'));
  expect(source).not.toContain(
    'boolean. Nothing in this tree performs that projection, so the validator',
  );
  expect(source).toContain('IS\n   * NOW FALSE (ADR-257)');
});

test('the narrowed entry: one supplier left, and the discharged clause is quoted not deleted', () => {
  // THE ENTRY IS THE MAP OF WHAT THIS DEPLOYMENT CANNOT SERVE, so a clause that
  // has become false is worse than one that was never written: a reader who
  // verifies it finds a projection missing and stops there. It is quoted under
  // `READ` and replaced, which is `ADR-255`'s idiom on this same list.
  const entry = read(join(import.meta.dirname, 'wiring.test.ts'));
  const start = entry.indexOf('useAdminWriteBackend:');
  const clause = entry.slice(start, entry.indexOf('// ---', start));

  expect(clause).toContain('ONE SUPPLIER AND IT IS NOT A DOOR');
  expect(clause).toContain(
    'THE SECOND CLAUSE READ "nothing in this tree performs that projection"',
  );
  expect(clause).toContain('`projectPlanValidation`');

  // The count moved with the clause: an entry saying TWO while naming one is
  // the defect `ADR-255` section 4 found on the wallet port.
  expect(clause).not.toContain('TWO SUPPLIERS AND NEITHER OF THEM IS A DOOR');

  // And what is left is named rather than implied.
  expect(clause).toContain('`principal(request)`');
});
