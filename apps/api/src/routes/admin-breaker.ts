// =============================================================================
// apps/api/src/routes/admin-breaker.ts
// =============================================================================
// `API_CONTRACT` SECTION 8's TWO FOCUSED PROJECTIONS NOBODY HAD BUILT:
// `GET /admin/loss-ratios` and `GET /admin/cusum`.
//
// `ADR-166` clause 10 measured their absence from `CompositionReport` on BOTH
// surfaces rather than from a grep: they were "in NEITHER list on EITHER
// surface", so they answered 404 on the admin origin as well as on the public
// one, which is not the 404 `registry.ts` describes as "this list being
// non-empty and nothing else". Its clause 14 allocated them, by name, to `P7-k`.
// This is that file.
//
// -----------------------------------------------------------------------------
// 1. IT DECLARES NO PORT, AND THAT IS A RULING RATHER THAN A CONVENIENCE
// -----------------------------------------------------------------------------
// Section 8: "`GET /admin/eligible-forecast`, `GET /admin/loss-ratios` and
// `GET /admin/cusum` are focused projections of `GET /admin/liability`'s
// UNDERLYING DATA for charting." So they are projections of `LiabilityResponse`
// and not reads of their own, which is `admin-reads.ts`'s own reason for
// `/admin/eligible-forecast`: "Two queries are two answers to one question, and
// the chart and the dashboard disagreeing is how a number stops being believed."
//
// A SECOND PORT WOULD HAVE BEEN THE SECOND QUERY, and it would have cost
// something else as well: `wiring.test.ts` reports `{declared, wired, blocked}`
// over every `export function useX(` / `setX(` in `src/routes/`, and a new one
// here moves that triple and needs its own entry in that file's `BLOCKED` map.
// **THAT FILE IS NOT THIS SLICE'S** and a fence is not widened to finish. So
// this module composes with `admin-reads.ts`'s `adminHandler`, exactly as
// `admin-wallet.ts` composes with `admin-writes.ts`, and every route it
// declares runs the same cookie read, the same role check and the same scalar
// sweep as the seven that were already there.
//
// -----------------------------------------------------------------------------
// 2. WHAT THE PORT CANNOT CARRY IS RENDERED AS AN ABSENCE AND NEVER GUESSED
// -----------------------------------------------------------------------------
// `INV-M6-07` and `AS-M6-02`: "the ratio is shown next to its sample size
// EVERYWHERE it appears", because "an alert that omits it invites exactly the
// override that destroys the control". `P7-k`'s worker half writes
// `plan_breaker_state.sample_size` beside `min_sample` on every row, and
// `LiabilityResponse.per_plan` carries NEITHER, which section 8 says in its own
// words: `P7-k` "writes `sample_size` beside `min_sample` and an
// `insufficient_data` state that no field on `LiabilityResponse.per_plan`
// carries today".
//
// **SO `sample_size` IS `null` HERE AND THE REASON IS PRINTED WHERE THE NUMBER
// WOULD HAVE BEEN.** That is `P-M6-09`'s `suppressed` idiom applied one surface
// over: "a live number derived from a feed we already distrust is worse than no
// number", and a figure that silently vanishes is one the reader assumes is
// still being computed. {@link ProjectionGap} names the field, what it waits on,
// and where the repair goes.
//
// **`sales_paused` IS CARRIED AND THE THREE-STATE DISTINCTION IS NOT, AND THAT
// IS THE SECOND GAP.** `plan_breaker_state.state` has four values and
// `sales_paused` is `state = 'paused'`, so `false` covers BOTH `armed` and
// `insufficient_data` and a reader cannot tell "not paused because the breaker
// is watching and has no complaint" from "not paused because there is not
// enough data to have one". `GS-113` is about exactly that difference. It is a
// gap and not a defect this file can repair, because the field it needs is on a
// type `admin-reads.ts` owns.
//
// -----------------------------------------------------------------------------
// 3. THE CUSUM IS ABSENT BY RULING AND IS NOT PASSED THROUGH
// -----------------------------------------------------------------------------
// `ADR-167` clause 5: "`P7-k` renders `per_plan[].cusum` as ABSENT until
// `DEP-M6-05` lands, on `apps/admin`'s own existing disposition of `P-M6-06`,
// and does not manufacture one."
//
// `LiabilityResponse.per_plan[].cusum` is a NON-OPTIONAL field on that type, so
// a source will hand this module a `{statistic, threshold, alarm}` object. **IT
// IS NOT PASSED THROUGH**, and that is the clause rather than a preference: the
// parameters do not exist (`DEP-M6-05` is M06 Wave 4), `FM-M6-07` reads that an
// uncalibrated CUSUM is "either constant alarms or none, which is the same as no
// chart", and `apps/admin/src/page.ts` already lists `P-M6-06` as PENDING naming
// that blocker rather than drawing the chart. A statistic served from an
// uncalibrated source IS the manufactured one, whichever module computed it.
//
// `admin-breaker.test.ts` seeds the pass-through and watches it fail.
//
// -----------------------------------------------------------------------------
// 4. WHAT THIS FILE DOES NOT DO
// -----------------------------------------------------------------------------
//   - It does not edit `API_CONTRACT`, which is `approved` and `P7-b`'s, and it
//     does not have to: both headings say the body "is deliberately NOT fixed
//     here (ADR-166 clause 3)" and hand it to this slice.
//   - It does not edit `admin-reads.ts` or its suite. Section 2's two gaps are
//     REPORTED, and the repair is a field on `LiabilityResponse`.
//   - It declares no new role set. Section 8 gives `owner`, `ops` and `readonly`
//     the read, and narrowing one here would be this file inventing a control
//     the contract does not carry.
// =============================================================================

import { ADMIN_READ_ROLES, adminNotFound, toAdminRoutes, adminRoleTable } from './admin-reads.ts';
import type { AdminEndpointSpec } from './admin-reads.ts';
import { defineRoutes } from '../registry.ts';

/**
 * A field this projection must carry and cannot, with what it waits on.
 *
 * SECTION 2. It is a value on the body rather than a comment in this file,
 * because the reader who needs it is the one holding the chart.
 *
 * **`awaiting` AND NOT `blocked_on`.** `assertContractScalars` refuses any key
 * ending `_on` or `_day` that is not a `YYYY-MM-DD` trading day, and it is
 * right to: a container named for a day that is not one is how a timestamp
 * reaches a chart axis. The name moves rather than the sweep.
 */
export interface ProjectionGap {
  /** The field, as it appears on the body. */
  readonly field: string;
  /** The dependency, the ADR or the type that has to move first. */
  readonly awaiting: string;
  /** What a reader should do with the absence. */
  readonly detail: string;
}

/** One plan's loss ratio, as `GET /admin/loss-ratios` renders it. */
export interface LossRatioPlan {
  readonly plan_id: string;
  readonly code: string;
  readonly loss_ratio_bp: number;
  readonly threshold_bp: number;
  /** `plan_breaker_state.state = 'paused'`. NEVER anything about a payout. */
  readonly sales_paused: boolean;
  /**
   * `INV-M6-07`'s sample size, beside the ratio it belongs to.
   *
   * `null` today, and section 2 is why. It is NOT omitted: a body with no field
   * reads as a ratio that never had a sample size, and this one has one that
   * has not reached the port yet.
   */
  readonly sample_size: number | null;
}

/** `GET /admin/loss-ratios`'s body. */
export interface LossRatioResponse {
  readonly as_of: string;
  readonly per_plan: readonly LossRatioPlan[];
  readonly gaps: readonly ProjectionGap[];
}

/** One plan's CUSUM, as `GET /admin/cusum` renders it. */
export interface CusumPlan {
  readonly plan_id: string;
  readonly code: string;
  /** ABSENT by `ADR-167` clause 5, and section 3 is why it is not passed through. */
  readonly cusum: null;
}

/** `GET /admin/cusum`'s body. */
export interface CusumResponse {
  readonly as_of: string;
  readonly per_plan: readonly CusumPlan[];
  readonly gaps: readonly ProjectionGap[];
}

/**
 * The two gaps `/admin/loss-ratios` carries, and each names its own repair.
 *
 * They are CONSTANTS rather than strings built in the handler so that
 * `admin-breaker.test.ts` can assert the endpoint declares exactly these two
 * and no more: a gap silently added is a field silently dropped, and a gap
 * silently removed is a `null` a reader will take for a zero.
 */
export const LOSS_RATIO_GAPS: readonly ProjectionGap[] = [
  {
    field: 'per_plan[].sample_size',
    awaiting: 'LiabilityResponse.per_plan, in routes/admin-reads.ts',
    detail:
      'INV-M6-07 and AS-M6-02 require the sample size beside every ratio. P7-k writes ' +
      'plan_breaker_state.sample_size beside min_sample on every row and AdminReadSource cannot ' +
      'yet carry it, which API_CONTRACT section 8 states in its own words. Until it does, a ' +
      'reader must not treat this ratio as evidence of anything on its own.',
  },
  {
    field: 'per_plan[].state',
    awaiting: 'LiabilityResponse.per_plan, in routes/admin-reads.ts',
    detail:
      "plan_breaker_state.state has four values and sales_paused is state = 'paused', so false " +
      'covers both armed and insufficient_data. GS-113 is that difference: a plan that is not ' +
      'paused because the breaker has no opinion reads here exactly like one the breaker is ' +
      'watching and content with.',
  },
];

/** The one gap `/admin/cusum` carries. `ADR-167` clause 5. */
export const CUSUM_GAPS: readonly ProjectionGap[] = [
  {
    field: 'per_plan[].cusum',
    awaiting: 'DEP-M6-05',
    detail:
      'ADR-167 clause 5 renders the CUSUM absent until the simulation harness supplies mu_0 and ' +
      'sigma. FM-M6-07: an uncalibrated CUSUM is either constant alarms or none, which is the ' +
      'same as no chart, and apps/admin already lists P-M6-06 as pending for that reason. The ' +
      'statistic is recomputed and never stored (ADR-167 ruling 1), so nothing is lost by waiting.',
  },
];

/**
 * Section 8: the focused projections are "cursor-free and cached for 60
 * seconds". `private`, because the body is the firm's own position and no shared
 * cache has any business holding it. `admin-reads.ts` sets the same header on
 * `/admin/eligible-forecast` for the same sentence.
 */
const CACHE_CONTROL = 'private, max-age=60';

/** The two endpoints, as data. */
export const ADMIN_BREAKER_ENDPOINTS: readonly AdminEndpointSpec[] = [
  {
    method: 'GET',
    path: '/admin/loss-ratios',
    roles: ADMIN_READ_ROLES,
    handle: async ({ request, reply, source }) => {
      const liability = await source.readLiability();
      if (liability === null) return adminNotFound(reply, request.id);
      void reply.header('Cache-Control', CACHE_CONTROL);
      const body: LossRatioResponse = {
        as_of: liability.as_of,
        per_plan: liability.per_plan.map((plan) => ({
          plan_id: plan.plan_id,
          code: plan.code,
          loss_ratio_bp: plan.loss_ratio_bp,
          threshold_bp: plan.threshold_bp,
          sales_paused: plan.sales_paused,
          sample_size: null,
        })),
        gaps: LOSS_RATIO_GAPS,
      };
      return body;
    },
  },
  {
    method: 'GET',
    path: '/admin/cusum',
    roles: ADMIN_READ_ROLES,
    handle: async ({ request, reply, source }) => {
      const liability = await source.readLiability();
      if (liability === null) return adminNotFound(reply, request.id);
      void reply.header('Cache-Control', CACHE_CONTROL);
      const body: CusumResponse = {
        as_of: liability.as_of,
        // `plan.cusum` IS READ AND DELIBERATELY NOT CARRIED. Section 3.
        per_plan: liability.per_plan.map((plan) => ({
          plan_id: plan.plan_id,
          code: plan.code,
          cusum: null,
        })),
        gaps: CUSUM_GAPS,
      };
      return body;
    },
  },
];

/** Published as data, on `ADMIN_READ_ROLE_TABLE`'s reason. */
export const ADMIN_BREAKER_ROLE_TABLE = adminRoleTable(ADMIN_BREAKER_ENDPOINTS);

export default defineRoutes({
  name: 'admin-breaker',
  routes: toAdminRoutes(ADMIN_BREAKER_ENDPOINTS),
});
