// =============================================================================
// packages/rules-engine/test/generators/validate-plan.ts
// =============================================================================
// CV-01 TO CV-19, TRANSCRIBED FROM M01's TABLE AND FROM NOWHERE ELSE.
//
// THIS FILE IS THE ORACLE AND IT IS DELIBERATELY NOT THE GENERATOR. `plan.ts`
// builds valid plans by CONSTRUCTION; this file checks them by READING. If one
// module did both, the counterfactual in `plan.property.test.ts` would prove
// only that the code agrees with itself, which is the shape STRATEGY section
// 4.4 exists to reject and which this repository has now caught repeatedly:
// the CHECK that evaluated to NULL (ADR-035), the DO block that read a prefix
// of the schema (OI-08), the probe whose four successes were rolled back before
// the deferred trigger could fire, and the counterfactual harness that read
// `tee`'s exit status instead of `psql`'s.
//
// Each rule below quotes M01's "Rejected because" column where M01 gives one,
// because the reason is the part a later reader needs and the part a diff loses.
// =============================================================================

import type { Drawdown, MaterializedPlan } from './plan-config.ts';

export type CvId =
  | 'CV-01'
  | 'CV-02'
  | 'CV-03'
  | 'CV-04'
  | 'CV-05'
  | 'CV-06'
  | 'CV-07'
  | 'CV-08'
  | 'CV-09'
  | 'CV-10'
  | 'CV-11'
  | 'CV-12'
  | 'CV-13'
  | 'CV-14'
  | 'CV-15'
  | 'CV-16'
  | 'CV-17'
  | 'CV-18'
  | 'CV-19';

/** Every rule id, in order, so a caller can iterate the contract rather than retype it. */
export const CV_IDS: readonly CvId[] = [
  'CV-01',
  'CV-02',
  'CV-03',
  'CV-04',
  'CV-05',
  'CV-06',
  'CV-07',
  'CV-08',
  'CV-09',
  'CV-10',
  'CV-11',
  'CV-12',
  'CV-13',
  'CV-14',
  'CV-15',
  'CV-16',
  'CV-17',
  'CV-18',
  'CV-19',
];

export interface CvViolation {
  readonly id: CvId;
  /** Where it was found, so a shrunk counterexample says which phase. */
  readonly path: string;
  readonly detail: string;
}

const isInt = (n: number): boolean => Number.isInteger(n);

/**
 * CV-01 and CV-02 hold of every drawdown a plan declares, and a plan declares
 * two. Checking only the funded one would leave an eval phase publishable with
 * `intraday_trailing`, which is the value CV-01 exists to refuse.
 */
function checkDrawdown(d: Drawdown, path: string, out: CvViolation[]): void {
  // CV-01. `intraday_trailing` is config-supported and deliberately
  // unimplemented in v1. Publishing it must fail loudly, never compute
  // something plausible (GS-078).
  if (d.type !== 'trailing_eod' && d.type !== 'static') {
    out.push({ id: 'CV-01', path: `${path}.drawdown.type`, detail: `type is "${d.type}"` });
  }

  // CV-02. A zero drawdown means the floor is the balance and every losing tick
  // breaches.
  if (!(d.drawdown_cents > 0) || !isInt(d.drawdown_cents)) {
    out.push({
      id: 'CV-02',
      path: `${path}.drawdown.drawdown_cents`,
      detail: `drawdown_cents is ${d.drawdown_cents}`,
    });
  }
}

/**
 * Every CV rule M01 states, evaluated against one materialized plan.
 *
 * Returns every violation rather than the first, because a publish-time
 * validator that stops at the first finding makes a config with three defects
 * take three publish attempts to discover.
 */
export function validatePlan(plan: MaterializedPlan): readonly CvViolation[] {
  const out: CvViolation[] = [];
  const ev = plan.phase_eval;
  const fu = plan.phase_funded;

  checkDrawdown(ev.drawdown, 'phase_eval', out);
  checkDrawdown(fu.drawdown, 'phase_funded', out);

  // CV-03. An eval with no target passes on day one.
  if (ev.enabled && !(ev.profit_target_cents > 0)) {
    out.push({
      id: 'CV-03',
      path: 'phase_eval.profit_target_cents',
      detail: `enabled eval has profit_target_cents ${ev.profit_target_cents}`,
    });
  }

  // CV-04.
  if (!(ev.min_trading_days >= 1) || !isInt(ev.min_trading_days)) {
    out.push({
      id: 'CV-04',
      path: 'phase_eval.min_trading_days',
      detail: `min_trading_days is ${ev.min_trading_days}`,
    });
  }

  // CV-05. A zero floor makes every traded day a win day, including losing
  // ones, since `0 >= 0`.
  if (!(fu.win_days.required_count >= 1) || !isInt(fu.win_days.required_count)) {
    out.push({
      id: 'CV-05',
      path: 'phase_funded.win_days.required_count',
      detail: `required_count is ${fu.win_days.required_count}`,
    });
  }
  if (!(fu.win_days.win_day_floor_cents > 0) || !isInt(fu.win_days.win_day_floor_cents)) {
    out.push({
      id: 'CV-05',
      path: 'phase_funded.win_days.win_day_floor_cents',
      detail: `win_day_floor_cents is ${fu.win_days.win_day_floor_cents}`,
    });
  }

  // CV-06. 0 bp is unsatisfiable, above 10000 bp is meaningless (GS-077).
  // It binds on both phases: either may enable consistency, in different modes.
  for (const [phase, c] of [
    ['phase_eval', ev.consistency],
    ['phase_funded', fu.consistency],
  ] as const) {
    if (!c.enabled) continue;
    const bp = c.max_day_share_bp;
    if (bp === null || !(bp > 0 && bp <= 10_000) || !isInt(bp)) {
      out.push({
        id: 'CV-06',
        path: `${phase}.consistency.max_day_share_bp`,
        detail: `enabled consistency has max_day_share_bp ${String(bp)}`,
      });
    }
  }

  // CV-07.
  if (!(fu.buffer_cents >= 0) || !isInt(fu.buffer_cents)) {
    out.push({
      id: 'CV-07',
      path: 'phase_funded.buffer_cents',
      detail: `buffer_cents is ${fu.buffer_cents}`,
    });
  }

  // CV-08.
  if (!(fu.cadence_gap_trading_days >= 0) || !isInt(fu.cadence_gap_trading_days)) {
    out.push({
      id: 'CV-08',
      path: 'phase_funded.cadence_gap_trading_days',
      detail: `cadence_gap_trading_days is ${fu.cadence_gap_trading_days}`,
    });
  }

  // CV-09. A gap in the schedule leaves an ordinal with no cap.
  const sched = fu.payout_cap_schedule;
  if (sched.length === 0) {
    out.push({
      id: 'CV-09',
      path: 'phase_funded.payout_cap_schedule',
      detail: 'schedule is empty',
    });
  } else {
    if (sched[0]!.from_ordinal !== 1) {
      out.push({
        id: 'CV-09',
        path: 'phase_funded.payout_cap_schedule[0].from_ordinal',
        detail: `first ordinal is ${sched[0]!.from_ordinal}, not 1`,
      });
    }
    for (let i = 1; i < sched.length; i++) {
      if (!(sched[i]!.from_ordinal > sched[i - 1]!.from_ordinal)) {
        out.push({
          id: 'CV-09',
          path: `phase_funded.payout_cap_schedule[${i}].from_ordinal`,
          detail: `ordinal ${sched[i]!.from_ordinal} does not exceed ${sched[i - 1]!.from_ordinal}`,
        });
      }
    }
    for (let i = 0; i < sched.length; i++) {
      const cap = sched[i]!.cap_cents;
      if (!(cap > 0) || !isInt(cap)) {
        out.push({
          id: 'CV-09',
          path: `phase_funded.payout_cap_schedule[${i}].cap_cents`,
          detail: `cap_cents is ${cap}`,
        });
      }
    }
  }

  // CV-10. Otherwise no payout at that rung can ever satisfy the minimum, and
  // the account is permanently ineligible while looking healthy (GS-076).
  for (let i = 0; i < sched.length; i++) {
    if (!(sched[i]!.cap_cents >= fu.min_payout_cents)) {
      out.push({
        id: 'CV-10',
        path: `phase_funded.payout_cap_schedule[${i}].cap_cents`,
        detail: `cap ${sched[i]!.cap_cents} is below min_payout_cents ${fu.min_payout_cents}`,
      });
    }
  }

  // CV-11 and CV-12 bind only when the funded lock is enabled. The lock is what
  // makes the floor a permanent stop (ADR-014), and both rules are stated
  // against the funded phase because that is the phase that pays.
  const lock = fu.drawdown.lock;
  if (lock.enabled) {
    const floorAt = lock.floor_at_cents;
    const atProfit = lock.at_profit_cents;

    if (floorAt === null || atProfit === null) {
      // An enabled lock with a null parameter cannot satisfy either rule, and
      // reporting both is honest: neither inequality is evaluable.
      out.push({
        id: 'CV-11',
        path: 'phase_funded.drawdown.lock',
        detail: 'lock enabled with a null floor_at_cents or at_profit_cents',
      });
      out.push({
        id: 'CV-12',
        path: 'phase_funded.drawdown.lock',
        detail: 'lock enabled with a null floor_at_cents or at_profit_cents',
      });
    } else {
      const offset = floorAt - plan.size_cents;

      // CV-11. Half of INV-21: this inequality is what stops a payout from
      // breaching the account that earned it. Load bearing since ADR-014
      // removed the post-payout reset.
      if (!(fu.buffer_cents > offset)) {
        out.push({
          id: 'CV-11',
          path: 'phase_funded.buffer_cents',
          detail: `buffer ${fu.buffer_cents} does not exceed floor_at - size (${offset})`,
        });
      }

      // CV-12. Forces the lock to engage exactly where the trailing floor
      // already sits, so the floor never jumps. See R-15.
      const expected = fu.drawdown.drawdown_cents + offset;
      if (atProfit !== expected) {
        out.push({
          id: 'CV-12',
          path: 'phase_funded.drawdown.lock.at_profit_cents',
          detail: `at_profit ${atProfit} is not drawdown + (floor_at - size) = ${expected}`,
        });
      }
    }
  }

  // CV-13.
  if (!(fu.split_bp > 0 && fu.split_bp <= 10_000) || !isInt(fu.split_bp)) {
    out.push({
      id: 'CV-13',
      path: 'phase_funded.split_bp',
      detail: `split_bp is ${fu.split_bp}`,
    });
  }

  // CV-14, under ADR-030's canonical name `max_payouts`.
  if (!(fu.max_payouts >= 1) || !isInt(fu.max_payouts)) {
    out.push({
      id: 'CV-14',
      path: 'phase_funded.max_payouts',
      detail: `max_payouts is ${fu.max_payouts}`,
    });
  }

  // CV-15. Fixed by GLOSSARY and never scaled by size. Stated as validation so
  // a well-meaning config edit cannot quietly move it.
  if (fu.min_payout_cents !== 10_000) {
    out.push({
      id: 'CV-15',
      path: 'phase_funded.min_payout_cents',
      detail: `min_payout_cents is ${fu.min_payout_cents}, not 10000`,
    });
  }

  // CV-16, on both phases: each declares its own daily loss limit.
  for (const [phase, dll] of [
    ['phase_eval', ev.daily_loss_limit],
    ['phase_funded', fu.daily_loss_limit],
  ] as const) {
    if (dll.type !== 'none' && dll.type !== 'soft' && dll.type !== 'hard') {
      out.push({
        id: 'CV-16',
        path: `${phase}.daily_loss_limit.type`,
        detail: `type is "${String(dll.type)}"`,
      });
      continue;
    }
    if (dll.type !== 'none' && (dll.amount_cents === null || !(dll.amount_cents > 0))) {
      out.push({
        id: 'CV-16',
        path: `${phase}.daily_loss_limit.amount_cents`,
        detail: `type "${dll.type}" with amount_cents ${String(dll.amount_cents)}`,
      });
    }
  }

  // CV-17. The other half of INV-21, and it exists only because ADR-014 removed
  // the post-payout reset: without a reset the floor stays put while a payout
  // drops the balance. If `cap >= drawdown`, the payout breaches the account
  // that earned it. No v1 plan can reach this, which is exactly why it has to
  // be validated rather than remembered (GS-083).
  if (fu.drawdown.type === 'trailing_eod' && !lock.enabled) {
    for (let i = 0; i < sched.length; i++) {
      if (!(sched[i]!.cap_cents < fu.drawdown.drawdown_cents)) {
        out.push({
          id: 'CV-17',
          path: `phase_funded.payout_cap_schedule[${i}].cap_cents`,
          detail: `cap ${sched[i]!.cap_cents} is not below drawdown ${fu.drawdown.drawdown_cents} with the lock disabled`,
        });
      }
    }
  }

  // CV-18. The key is retired but retained, per ADR-014. Stated as validation
  // for the same reason as CV-15: a well-meaning config edit must not be able
  // to quietly reintroduce a floor recompute that no rule, test, or published
  // copy accounts for.
  if (fu.post_payout_floor_rule.mode !== 'none') {
    out.push({
      id: 'CV-18',
      path: 'phase_funded.post_payout_floor_rule.mode',
      detail: `mode is "${fu.post_payout_floor_rule.mode}"`,
    });
  }

  // CV-19. Zero means the gate is DISABLED and must report `pass: true,
  // skipped: true`. ADR-015 sets it to 0 on all three plans, so the common case
  // is the one that must not read as satisfied when it was never evaluated
  // (GS-080).
  if (!(fu.min_trading_days >= 0) || !isInt(fu.min_trading_days)) {
    out.push({
      id: 'CV-19',
      path: 'phase_funded.min_trading_days',
      detail: `min_trading_days is ${fu.min_trading_days}`,
    });
  }

  return out;
}

/** Convenience for the common assertion. */
export const isValidPlan = (plan: MaterializedPlan): boolean => validatePlan(plan).length === 0;
