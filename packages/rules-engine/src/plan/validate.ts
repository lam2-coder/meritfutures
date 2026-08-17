// =============================================================================
// packages/rules-engine/src/plan/validate.ts
// =============================================================================
// CV-01 TO CV-19, PW-01 TO PW-04, TRANSCRIBED FROM M01 SECTION 2.4 AND FROM
// NOWHERE ELSE.
//
// M01: "`validatePlan` runs in `POST /admin/plans/versions/:id/publish` and
// BLOCKS THE PUBLISH. A config that reaches an account is a config that already
// passed all of these."
//
// -----------------------------------------------------------------------------
// WHY THIS FILE IS NOT DERIVED FROM `test/generators/validate-plan.ts`
// -----------------------------------------------------------------------------
// That file is the ORACLE. It transcribed the same nineteen rules from the same
// table in session 40, months before any engine code existed, and its own header
// says why it is deliberately not the generator: "If one module did both, the
// counterfactual would prove only that the code agrees with itself."
//
// The same argument applies one layer out, so this file was written from M01's
// table and the two were compared afterwards rather than one being copied from
// the other. That comparison is `RE-C-oracle` in `plan-validate.test.ts`, and it
// is the writer/reviewer split constitution C10 requires, arriving as an
// executable check instead of a process claim.
//
// THE TWO DIFFER IN THREE PLACES, none of them a rule, and each is documented at
// its site below rather than absorbed:
//
//   1. THE ORACLE CALLS `isInt` ON MONEY AND THIS FILE CANNOT. Its money is
//      `number`, so half a cent is constructible and has to be rejected; here
//      money is `Cents`, which is `bigint`, so half a cent does not exist.
//   2. THE ORACLE READS ONE MERGED `MaterializedPlan` AND THIS FILE READS TWO
//      STORED SHAPES. Where the merged view has one field, the tree has a jsonb
//      key and a materialized column that can disagree. CV-09, CV-11, CV-12,
//      CV-16 and CV-17 therefore name WHICH of the two they read, and the three
//      `MZ-` findings are what make that choice safe instead of arbitrary.
//   3. THE ORACLE STOPS AT THE NINETEEN. PW-01 to PW-04 and the materialization
//      findings are here because `validatePlan` is the publish path and the
//      oracle is a generator's counterfactual, which needs only the blocking set.
//
// -----------------------------------------------------------------------------
// RULES-LEVEL VERSUS SIZE-LEVEL, WHICH IS WHY THE SIGNATURE TAKES AN ARRAY
// -----------------------------------------------------------------------------
// M01 section 1.3: `validatePlan(rules, sizes: PlanVersionSizeRow[])`. Nine of
// the nineteen read only `plan_versions.rules` and are therefore true or false
// for the whole version; eight read `plan_version_sizes` and are evaluated once
// per size; CV-05 and CV-16 are split across both. A violation carries the
// `size_cents` it was found on, or `null` when it belongs to the version.
//
// A VALIDATOR HANDED ONE SIZE AT A TIME COULD NOT SEE THE PLAN. CV-11 and CV-12
// are inequalities across the jsonb and one size row; every size must satisfy
// them independently, and the 150K row failing while 25K passes is a version
// that must not publish.
//
// -----------------------------------------------------------------------------
// EVERY VIOLATION IS RETURNED, NEVER THE FIRST
// -----------------------------------------------------------------------------
// A publish-time validator that stops at the first finding makes a config with
// three defects take three publish attempts to discover, and each attempt is a
// founder reading a diff. The oracle made the same call for the same reason.
// =============================================================================

import type {
  Cents,
  CvId,
  CvViolation,
  MaterializationFinding,
  PlanRulesJson,
  PlanVersionSizeRow,
  PublishDiff,
  PublishedDailyLossLimit,
  PublishedDrawdown,
  PublishedConsistency,
  ValidationResult,
} from '../types.js';

/** CV-15's literal, which is the ONE money value M01 fixes in the document itself. */
const MIN_PAYOUT_CENTS = 10_000n;

/** CV-06's and CV-13's upper bound. One hundred percent, in basis points. */
const FULL_SHARE_BP = 10_000;

/**
 * `Number.isInteger`, applied ONLY to the `number`-typed fields.
 *
 * THE ORACLE CALLS ITS `isInt` ON MONEY AND THIS FILE CANNOT, which is the first
 * of the three documented differences and it is a difference in the types rather
 * than in the rules. `plan-config.ts` models money as `number`, so `drawdown_cents
 * = 0.5` is constructible there and has to be rejected by a check. Here money is
 * `Cents`, which is `bigint`, so a fractional cent does not exist to reject
 * (INV-02). Every `isInt` call below is on a basis-point figure, a day count or
 * an ordinal, and those are `number` in both files.
 */
const isInt = (n: number): boolean => Number.isInteger(n);

/** A violation belonging to the version rather than to one size. */
function versionViolation(id: CvId, path: string, detail: string): CvViolation {
  return { id, path, detail, sizeCents: null };
}

// -----------------------------------------------------------------------------
// CV-01 and CV-02, which hold of every drawdown a plan declares
// -----------------------------------------------------------------------------
// A PLAN DECLARES TWO AND THE ORACLE CHECKS BOTH, for the reason its own comment
// gives: "Checking only the funded one would leave an eval phase publishable
// with `intraday_trailing`, which is the value CV-01 exists to refuse."
//
// CV-01 IS R-17's DISCHARGE AND IS THE REASON THIS FILE DECLARES THAT RULE.
// R-17: "Intraday trailing is config-supported and unimplemented ... Rejected at
// publish by CV-01." `PublishedDrawdownType` carries the third member so this
// comparison has something to reject; `DrawdownType` carries two so a resolved
// plan cannot hold it. The rule is the narrowing between them, and `resolvePlan`
// refuses rather than narrowing silently.

function checkDrawdownType(d: PublishedDrawdown, path: string, out: CvViolation[]): void {
  // CV-01. "`intraday_trailing` is config-supported and deliberately
  // unimplemented in v1. Publishing it must fail loudly, never compute something
  // plausible (GS-078)."
  if (d.type !== 'trailing_eod' && d.type !== 'static') {
    out.push(versionViolation('CV-01', `${path}.drawdown.type`, `type is "${d.type}"`));
  }
}

// -----------------------------------------------------------------------------
// CV-06, on either phase
// -----------------------------------------------------------------------------

function checkConsistency(c: PublishedConsistency, path: string, out: CvViolation[]): void {
  // CV-06. "0 bp is unsatisfiable, above 10000 bp is meaningless (GS-077)."
  if (!c.enabled) return;
  const bp = c.max_day_share_bp;
  if (bp === null || !(bp > 0 && bp <= FULL_SHARE_BP) || !isInt(bp)) {
    out.push(
      versionViolation(
        'CV-06',
        `${path}.consistency.max_day_share_bp`,
        `enabled consistency has max_day_share_bp ${String(bp)}`,
      ),
    );
  }
}

// -----------------------------------------------------------------------------
// CV-16's vocabulary half, on either phase
// -----------------------------------------------------------------------------

function checkLossLimitType(dll: PublishedDailyLossLimit, path: string, out: CvViolation[]): void {
  // CV-16, first clause: the type is one of three.
  if (dll.type !== 'none' && dll.type !== 'soft' && dll.type !== 'hard') {
    out.push(versionViolation('CV-16', `${path}.daily_loss_limit.type`, `type is "${dll.type}"`));
  }
}

// -----------------------------------------------------------------------------
// The nine that read only `plan_versions.rules`
// -----------------------------------------------------------------------------

function validateRules(rules: PlanRulesJson, out: CvViolation[]): void {
  const ev = rules.phase_eval;
  const fu = rules.phase_funded;

  checkDrawdownType(ev.drawdown, 'phase_eval', out);
  checkDrawdownType(fu.drawdown, 'phase_funded', out);

  // CV-04. STATED WITHOUT A PRECONDITION AND TRANSCRIBED THAT WAY, and the
  // oracle reads it identically, which is worth saying because it looks like a
  // difference and is not. M01 gives CV-03 the qualifier "when `phase_eval.enabled`" and
  // gives CV-04 none, one row apart, so the asymmetry is on the page rather than
  // in the reading. The consequence is real and is reported in the session log:
  // a Direct plan, whose eval phase is disabled (Appendix A.3), must still
  // publish `phase_eval.min_trading_days >= 1` for a phase it never runs.
  if (!(ev.min_trading_days >= 1) || !isInt(ev.min_trading_days)) {
    out.push(
      versionViolation(
        'CV-04',
        'phase_eval.min_trading_days',
        `min_trading_days is ${ev.min_trading_days}`,
      ),
    );
  }

  // CV-05, first half. "A zero floor makes every traded day a win day, including
  // losing ones, since `0 >= 0`." The floor half is materialized and is checked
  // per size.
  if (!(fu.win_days.required_count >= 1) || !isInt(fu.win_days.required_count)) {
    out.push(
      versionViolation(
        'CV-05',
        'phase_funded.win_days.required_count',
        `required_count is ${fu.win_days.required_count}`,
      ),
    );
  }

  checkConsistency(ev.consistency, 'phase_eval', out);
  checkConsistency(fu.consistency, 'phase_funded', out);

  // CV-08.
  if (!(fu.cadence_gap_trading_days >= 0) || !isInt(fu.cadence_gap_trading_days)) {
    out.push(
      versionViolation(
        'CV-08',
        'phase_funded.cadence_gap_trading_days',
        `cadence_gap_trading_days is ${fu.cadence_gap_trading_days}`,
      ),
    );
  }

  // CV-13.
  if (!(fu.split_bp > 0 && fu.split_bp <= FULL_SHARE_BP) || !isInt(fu.split_bp)) {
    out.push(versionViolation('CV-13', 'phase_funded.split_bp', `split_bp is ${fu.split_bp}`));
  }

  // CV-14, under ADR-030's canonical name. M01's table spells the rule
  // `ladder.payouts_to_graduate >= 1`; ADR-030 ruled the stored key is
  // `phase_funded.max_payouts`, DATA_MODEL section 11 carries it, and
  // `0004_catalog.sql` says "the zod schema and the CV publish validations key
  // off these names". The rule is unchanged and only its spelling moved.
  if (!(fu.max_payouts >= 1) || !isInt(fu.max_payouts)) {
    out.push(
      versionViolation('CV-14', 'phase_funded.max_payouts', `max_payouts is ${fu.max_payouts}`),
    );
  }

  // CV-15. "Fixed by GLOSSARY and never scaled by size. Stated as validation so
  // a well-meaning config edit cannot quietly move it."
  if (fu.min_payout_cents !== MIN_PAYOUT_CENTS) {
    out.push(
      versionViolation(
        'CV-15',
        'phase_funded.min_payout_cents',
        `min_payout_cents is ${fu.min_payout_cents}, not ${MIN_PAYOUT_CENTS}`,
      ),
    );
  }

  checkLossLimitType(ev.daily_loss_limit, 'phase_eval', out);
  checkLossLimitType(fu.daily_loss_limit, 'phase_funded', out);

  // CV-18. "The key is retired but retained, per ADR-014. Stated as validation
  // for the same reason as CV-15: a well-meaning config edit must not be able to
  // quietly reintroduce a floor recompute that no rule, test, or published copy
  // accounts for."
  if (fu.post_payout_floor_rule.mode !== 'none') {
    out.push(
      versionViolation(
        'CV-18',
        'phase_funded.post_payout_floor_rule.mode',
        `mode is "${fu.post_payout_floor_rule.mode}"`,
      ),
    );
  }

  // CV-19. "0 means the gate is disabled and reports `pass: true, skipped:
  // true`." ADR-015 sets it to 0 on all three plans, so the common case is the
  // one that must not read as satisfied when it was never evaluated (GS-080).
  if (!(fu.min_trading_days >= 0) || !isInt(fu.min_trading_days)) {
    out.push(
      versionViolation(
        'CV-19',
        'phase_funded.min_trading_days',
        `min_trading_days is ${fu.min_trading_days}`,
      ),
    );
  }
}

// -----------------------------------------------------------------------------
// The eight evaluated once per `plan_version_sizes` row
// -----------------------------------------------------------------------------

function validateSize(rules: PlanRulesJson, size: PlanVersionSizeRow, out: CvViolation[]): void {
  const ev = rules.phase_eval;
  const fu = rules.phase_funded;
  const at = size.size_cents;
  const push = (id: CvId, path: string, detail: string): void => {
    out.push({ id, path, detail, sizeCents: at });
  };

  // CV-02. "A zero drawdown means the floor is the balance and every losing tick
  // breaches." ONE COLUMN SERVES BOTH PHASES; `MZ-per-phase` is what makes that
  // safe rather than assumed.
  if (!(size.drawdown_cents > 0n)) {
    push('CV-02', 'drawdown_cents', `drawdown_cents is ${size.drawdown_cents}`);
  }

  // CV-03. "An eval with no target passes on day one." Binds only when the
  // evaluation phase is enabled, which is where Direct sits out.
  if (ev.enabled && (size.profit_target_cents === null || !(size.profit_target_cents > 0n))) {
    push(
      'CV-03',
      'profit_target_cents',
      `enabled eval has profit_target_cents ${String(size.profit_target_cents)}`,
    );
  }

  // CV-05, second half.
  if (!(size.win_day_floor_cents > 0n)) {
    push('CV-05', 'win_day_floor_cents', `win_day_floor_cents is ${size.win_day_floor_cents}`);
  }

  // CV-07.
  if (!(size.buffer_cents >= 0n)) {
    push('CV-07', 'buffer_cents', `buffer_cents is ${size.buffer_cents}`);
  }

  // CV-09. "A gap in the schedule leaves an ordinal with no cap." EVALUATED ON
  // THE MATERIALIZED SCHEDULE, because that is the array R-42 resolves a cap out
  // of at runtime and therefore the array whose gaps would reach an account. The
  // rules-side ordinals are held to agree with it by `MZ-cap-ordinals`.
  const sched = size.payout_cap_schedule_cents;
  if (sched.length === 0) {
    push('CV-09', 'payout_cap_schedule_cents', 'schedule is empty');
  } else {
    const first = sched[0]!;
    if (first.from_ordinal !== 1) {
      push(
        'CV-09',
        'payout_cap_schedule_cents[0].from_ordinal',
        `first ordinal is ${first.from_ordinal}, not 1`,
      );
    }
    for (let i = 1; i < sched.length; i++) {
      const prev = sched[i - 1]!.from_ordinal;
      const here = sched[i]!.from_ordinal;
      if (!(here > prev)) {
        push(
          'CV-09',
          `payout_cap_schedule_cents[${i}].from_ordinal`,
          `ordinal ${here} does not exceed ${prev}`,
        );
      }
    }
    for (let i = 0; i < sched.length; i++) {
      if (!isInt(sched[i]!.from_ordinal)) {
        push(
          'CV-09',
          `payout_cap_schedule_cents[${i}].from_ordinal`,
          `ordinal ${sched[i]!.from_ordinal} is not an integer`,
        );
      }
      if (!(sched[i]!.cap_cents > 0n)) {
        push(
          'CV-09',
          `payout_cap_schedule_cents[${i}].cap_cents`,
          `cap_cents is ${sched[i]!.cap_cents}`,
        );
      }
    }
  }

  // CV-10. "Otherwise no payout at that rung can ever satisfy the minimum, and
  // the account is permanently ineligible while looking healthy (GS-076)."
  for (let i = 0; i < sched.length; i++) {
    if (!(sched[i]!.cap_cents >= fu.min_payout_cents)) {
      push(
        'CV-10',
        `payout_cap_schedule_cents[${i}].cap_cents`,
        `cap ${sched[i]!.cap_cents} is below min_payout_cents ${fu.min_payout_cents}`,
      );
    }
  }

  // CV-11 and CV-12 bind only when the FUNDED lock is enabled. Both are stated
  // against the funded phase because that is the phase that pays, and both read
  // the size row: `rules` carries `null` in `at_profit_cents` and
  // `floor_at_cents` on all three v1 plans and the values are materialized here.
  //
  // THE ENABLING FLAG READ IS THE SIZE ROW'S. SD-10 materialized it precisely so
  // a CHECK constraint could see it, and `MZ-lock-flag` is what stops the two
  // copies disagreeing. Reading the jsonb's flag here and the size row's cents
  // below would evaluate half of each rule against a different plan.
  if (size.floor_lock_enabled) {
    const floorAt = size.floor_lock_floor_at_cents;
    const atProfit = size.floor_lock_at_profit_cents;

    if (floorAt === null || atProfit === null) {
      // SD-10's CHECK makes this unreachable through the database, and it is
      // checked anyway because `validatePlan` runs BEFORE the insert. Reporting
      // both is honest: neither inequality is evaluable, and reporting one would
      // imply the other had been tested.
      const detail =
        'lock enabled with a null floor_lock_floor_at_cents or floor_lock_at_profit_cents';
      push('CV-11', 'floor_lock', detail);
      push('CV-12', 'floor_lock', detail);
    } else {
      const offset = floorAt - size.size_cents;

      // CV-11. "Half of INV-21 ... this inequality is what stops a payout from
      // breaching the account that earned it. Load bearing since ADR-014 removed
      // the post-payout reset."
      if (!(size.buffer_cents > offset)) {
        push(
          'CV-11',
          'buffer_cents',
          `buffer ${size.buffer_cents} does not exceed floor_lock_floor_at - size (${offset})`,
        );
      }

      // CV-12. "Forces the lock to engage exactly where the trailing floor
      // already sits, so the floor never jumps. See R-15."
      const expected = size.drawdown_cents + offset;
      if (atProfit !== expected) {
        push(
          'CV-12',
          'floor_lock_at_profit_cents',
          `at_profit ${atProfit} is not drawdown + (floor_at - size) = ${expected}`,
        );
      }
    }
  }

  // CV-16, second clause: the amount is present when the type is not `none`.
  // ONE COLUMN SERVES BOTH PHASES, so a plan whose eval limit is `none` and
  // whose funded limit is `hard` needs the column populated, and the reverse
  // pairing needs it too. `MZ-per-phase` is what stops the column being right
  // for one phase and wrong for the other.
  for (const [path, dll] of [
    ['phase_eval', ev.daily_loss_limit],
    ['phase_funded', fu.daily_loss_limit],
  ] as const) {
    if (dll.type === 'soft' || dll.type === 'hard') {
      if (size.daily_loss_limit_cents === null || !(size.daily_loss_limit_cents > 0n)) {
        push(
          'CV-16',
          'daily_loss_limit_cents',
          `${path}.daily_loss_limit.type is "${dll.type}" with daily_loss_limit_cents ${String(size.daily_loss_limit_cents)}`,
        );
      }
    }
  }

  // CV-17. "The other half of INV-21, and it exists only because ADR-014 removed
  // the post-payout reset. Without a reset the floor stays put while a payout
  // drops the balance ... If `cap >= drawdown`, the payout breaches the account
  // that earned it. No v1 plan can reach this, which is exactly why it has to be
  // validated rather than remembered (GS-083)."
  if (fu.drawdown.type === 'trailing_eod' && !size.floor_lock_enabled) {
    for (let i = 0; i < sched.length; i++) {
      if (!(sched[i]!.cap_cents < size.drawdown_cents)) {
        push(
          'CV-17',
          `payout_cap_schedule_cents[${i}].cap_cents`,
          `cap ${sched[i]!.cap_cents} is not below drawdown ${size.drawdown_cents} with the lock disabled`,
        );
      }
    }
  }
}

// -----------------------------------------------------------------------------
// The materialization checks, which carry no `CV-nn`
// -----------------------------------------------------------------------------
// `plan_version_sizes` EXISTS TO HOLD WHAT `plan_versions.rules` MEANS AT ONE
// SIZE. Three of its columns can disagree with the jsonb they were computed
// from, and M01's CV table enumerates none of the three. `0004_catalog.sql` is
// the primary source that puts the check at publish, about the first of them:
// "The publish path writes both, and CV-publish validation asserts the
// materialized flag matches the parent's jsonb."
//
// THEY BLOCK. FM-07 is "plan config published with impossible values", whose
// blast radius is "accounts permanently ineligible while looking healthy, or a
// gate that does nothing", and its recovery line is "publish blocked". A size
// row that disagrees with its own rules is two plans wearing one version number,
// and which of the two an account gets depends on which field a rule happens to
// read.

function checkMaterialization(
  rules: PlanRulesJson,
  sizes: readonly PlanVersionSizeRow[],
  out: MaterializationFinding[],
): void {
  const ev = rules.phase_eval;
  const fu = rules.phase_funded;

  // MZ-per-phase. THE SIZE ROW MATERIALIZES ONE `drawdown_cents` AND ONE
  // `daily_loss_limit_cents`, AND `rules` DECLARES A DRAWDOWN AND A LOSS LIMIT
  // PER PHASE. M01 Appendix A lists "Eval drawdown" and "Funded drawdown" as
  // separate rows, R-12 says the funded reset uses "the FUNDED drawdown", and
  // R-31 spells it `size_cents - funded drawdown_cents`. All three v1 plans set
  // the two equal (500bp and 500bp on Core EOD and Merit Rapid; Direct has no
  // eval phase at all), so nothing in the corpus exercises a difference and
  // `0004_catalog.sql` committed to one column.
  //
  // If the two bp figures ever differ, `resolvePlan` cannot honour both: it has
  // one number and two phases to hand it to, and whichever phase loses gets the
  // other's drawdown SILENTLY. That is the eval floor moving without a rule
  // saying so, which is why this refuses the publish instead of picking.
  //
  // GATED ON `ev.enabled` BECAUSE A DISABLED EVAL PHASE IS NEVER RESOLVED.
  // `ResolvedPlan.eval` is `null` on Direct, so no eval drawdown is read and a
  // stale bp figure in the jsonb cannot reach an account.
  if (ev.enabled) {
    if (ev.drawdown.amount_bp !== fu.drawdown.amount_bp) {
      out.push({
        id: 'MZ-per-phase',
        path: 'phase_eval.drawdown.amount_bp',
        detail:
          `eval drawdown ${ev.drawdown.amount_bp}bp and funded drawdown ${fu.drawdown.amount_bp}bp differ, ` +
          'and `plan_version_sizes` materializes one `drawdown_cents` for both',
        sizeCents: null,
      });
    }
    if (
      ev.daily_loss_limit.type !== fu.daily_loss_limit.type ||
      ev.daily_loss_limit.amount_bp !== fu.daily_loss_limit.amount_bp
    ) {
      out.push({
        id: 'MZ-per-phase',
        path: 'phase_eval.daily_loss_limit',
        detail:
          `eval limit "${ev.daily_loss_limit.type}"/${String(ev.daily_loss_limit.amount_bp)}bp and ` +
          `funded limit "${fu.daily_loss_limit.type}"/${String(fu.daily_loss_limit.amount_bp)}bp differ, ` +
          'and `plan_version_sizes` materializes one `daily_loss_limit_cents` for both',
        sizeCents: null,
      });
    }
  }

  for (const size of sizes) {
    // MZ-lock-flag. SD-10, and `0004_catalog.sql` names this check by name.
    if (size.floor_lock_enabled !== fu.drawdown.lock.enabled) {
      out.push({
        id: 'MZ-lock-flag',
        path: 'floor_lock_enabled',
        detail:
          `size row says ${size.floor_lock_enabled} and ` +
          `phase_funded.drawdown.lock.enabled says ${fu.drawdown.lock.enabled}`,
        sizeCents: size.size_cents,
      });
    }

    // MZ-cap-ordinals. CV-09 is evaluated on the materialized schedule, so a
    // rules-side schedule with different rungs would be validated at neither
    // end: the published rung list and the executed one would be different
    // lists, and `copy_blocks` publishes the first.
    const ruleSched = fu.payout_cap_schedule;
    const sizeSched = size.payout_cap_schedule_cents;
    if (ruleSched.length !== sizeSched.length) {
      out.push({
        id: 'MZ-cap-ordinals',
        path: 'payout_cap_schedule_cents',
        detail: `rules declare ${ruleSched.length} rung(s) and the size row materializes ${sizeSched.length}`,
        sizeCents: size.size_cents,
      });
    } else {
      for (let i = 0; i < ruleSched.length; i++) {
        if (ruleSched[i]!.from_ordinal !== sizeSched[i]!.from_ordinal) {
          out.push({
            id: 'MZ-cap-ordinals',
            path: `payout_cap_schedule_cents[${i}].from_ordinal`,
            detail:
              `rules declare rung ${i} at ordinal ${ruleSched[i]!.from_ordinal} and ` +
              `the size row materializes it at ${sizeSched[i]!.from_ordinal}`,
            sizeCents: size.size_cents,
          });
        }
      }
    }
  }
}

// -----------------------------------------------------------------------------
// PW-01 to PW-04, the publish diff
// -----------------------------------------------------------------------------
// M01 section 2.4: "Publish-diff messages are typed. THEY DO NOT BLOCK, and they
// are not all the same kind of thing, which matters because a diff whose every
// line says warning trains its reader to skim."
//
//   info      the configuration is intentional and worth seeing
//   warning   a gate is present that CANNOT DO ANYTHING
//
// "Why these are warnings and not errors. A dominated gate is not wrong, it is
// inert, and a future plan may want it inert. What is unacceptable is publishing
// it AS A PROTECTION."

function publishDiff(
  rules: PlanRulesJson,
  sizes: readonly PlanVersionSizeRow[],
  out: PublishDiff[],
): void {
  const fu = rules.phase_funded;
  const requiredWinDays = fu.win_days.required_count;
  const gap = fu.cadence_gap_trading_days;
  const lag = fu.min_settlement_lag_trading_days;

  // PW-01. EC-042. "Fires on all three v1 plans by design", because ADR-015 set
  // funded `min_trading_days` to 0 and every win day is a traded day.
  if (requiredWinDays >= fu.min_trading_days) {
    out.push({
      id: 'PW-01',
      severity: 'warning',
      message: 'The minimum-trading-days gate is dominated by the win-day gate and can never bind.',
      sizeCents: null,
    });
  }

  // PW-02a and PW-02b. ONE MESSAGE SPLIT IN TWO AT THE BATCH 1 GATE, because
  // ADR-019 drove `min_settlement_lag_trading_days` to 0 and "made the old
  // single comparison fire on all three plans at once while meaning two
  // genuinely different things". A tie is co-binding and is information; a
  // strict shortfall is EC-049 and is a defect in waiting.
  if (lag + gap === requiredWinDays) {
    out.push({
      id: 'PW-02a',
      severity: 'info',
      message:
        `Cadence gap and win-day gate co-bind at ${requiredWinDays} trading days. ` +
        "Both are load bearing; changing either changes the plan's cadence.",
      sizeCents: null,
    });
  } else if (lag + gap < requiredWinDays) {
    out.push({
      id: 'PW-02b',
      severity: 'warning',
      message:
        'The cadence gap is dominated by the win-day gate and can never bind. ' +
        'It must not be published as a protection or as the reason the plan is fast.',
      sizeCents: null,
    });
  }

  // PW-04. AS-01, "approaching uncapped daily extraction".
  if (gap === 0 && requiredWinDays <= 1) {
    out.push({
      id: 'PW-04',
      severity: 'warning',
      message: 'Approaching uncapped daily extraction.',
      sizeCents: null,
    });
  }

  // PW-03, per size, because both terms are materialized. THE RUNG READ IS THE
  // FIRST, and the message is why: "The first payout leaves less cushion than
  // the plan implies." Ordinal 1 is the payout that takes the cushion.
  for (const size of sizes) {
    const firstCap: Cents | undefined = size.payout_cap_schedule_cents[0]?.cap_cents;
    if (firstCap !== undefined && firstCap > size.buffer_cents) {
      out.push({
        id: 'PW-03',
        severity: 'info',
        message: 'The first payout leaves less cushion than the plan implies.',
        sizeCents: size.size_cents,
      });
    }
  }
}

/**
 * Every publish validation M01 section 2.4 states, over one plan version and all
 * of its sizes.
 *
 * `ok` is false when anything BLOCKING was found, which is the CV rules and the
 * materialization findings and never the publish diff.
 */
export function validatePlan(
  rules: PlanRulesJson,
  sizes: readonly PlanVersionSizeRow[],
): ValidationResult {
  const errors: CvViolation[] = [];
  const materialization: MaterializationFinding[] = [];
  const diffs: PublishDiff[] = [];

  validateRules(rules, errors);
  for (const size of sizes) validateSize(rules, size, errors);
  checkMaterialization(rules, sizes, materialization);
  publishDiff(rules, sizes, diffs);

  return {
    ok: errors.length === 0 && materialization.length === 0,
    errors,
    materialization,
    diffs,
  };
}
