// =============================================================================
// apps/admin/src/liability-read.ts
// =============================================================================
// THE READ SIDE OF THE LIABILITY HOME: ONE RESPONSE IN, ONE PAGE INPUT OUT.
//
// `page.ts` assembles the page from a `LiabilityHomeInput` whose every member is
// passed rather than read ambiently, and `api/types.ts` transcribes the body
// `GET /admin/liability` sends. NOTHING JOINED THE TWO. This file is that join
// and it is deliberately the only one: a screen that narrowed its own body
// inline would put a second answer to "what does this response mean" in every
// route that ever reads it.
//
// -----------------------------------------------------------------------------
// THE NARROWING IS THE SCREEN'S, AND `http/client.ts` SAYS SO AT THE POINT IT
// REFUSES TO DO IT
// -----------------------------------------------------------------------------
// `AdminApiClient.get` returns `unknown`, and its declaration argues the
// refusal: "a type parameter a caller supplies is a cast the compiler cannot
// check ... Narrowing is the screen's, and `unknown` is what forces the screen
// to write the check beside the shape it transcribed." So the check is here,
// beside `../api/types.ts`, and it is STRUCTURAL rather than a cast: every field
// this file reads is read out of an `unknown` and refused when it is not there.
//
// -----------------------------------------------------------------------------
// `ADR-203` RULING 2 IS ENFORCED ON THE READING SIDE AS WELL AS THE WRITING ONE
// -----------------------------------------------------------------------------
// `assertLiabilityGapsPaired` in `apps/api/src/routes/admin-reads.ts` refuses a
// bare `null` and refuses a gap over a present figure, in both directions. THAT
// GUARD IS ON THE PRODUCER AND THIS CONSOLE IS NOT ITS ONLY CLIENT'S ONLY
// DEPLOYMENT. A console that trusted the producer to have run it would render a
// bare `null` as an indistinguishable zero the first time it read a body from
// anything else, which is the exact failure `ADR-203` exists against. So the
// pairing is checked again here, on the bytes this page actually received.
//
// THE MAPPING IS `ADR-203` SECTION 5's AND IT IS TRANSCRIBED RATHER THAN
// INVENTED: "Every `gaps` entry becomes exactly one `absent()` call: `detail` is
// the `reason`, and the console supplies from its own roster the three fields
// the wire deliberately does not carry."
//
// AND THE MEASUREMENT THAT MATTERS MORE THAN THE MAPPING: NO `gaps` ENTRY CAN
// REACH A FIGURE THIS PAGE RENDERS TODAY. The two nullable sites on the response
// are `payout_velocity` and `per_plan[].cusum`, and `LiabilityHomeInput` has no
// member for either: they are `P-M6-04` and `P-M6-06`, both of which `page.ts`
// holds in `PENDING`. See {@link WIRE_FIELDS_THIS_PAGE_DOES_NOT_READ}. The two
// layers agree on what an absence means and there is not yet one place where
// both of them speak about the same figure, which is a measurement rather than
// a disagreement and is reported as one.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE REFUSES TO SUPPLY, WHICH IS THE HALF A READER SHOULD CHECK
// FIRST
// -----------------------------------------------------------------------------
// A projection that fills every optional member of `LiabilityHomeInput` renders
// a fuller page than the response can pay for. THREE MEMBERS ARE DELIBERATELY
// LEFT UNSUPPLIED and each has a reason that is a measurement:
//
//   `snapshot.withdrawalsInFlight`  no column, therefore no field. `ADR-195`
//                                   section 6 row 1, and `page.ts` renders it
//                                   ABSENT with the total marked INCOMPLETE
//   `eligibleNextSevenDays`         the response carries the FIGURE and not its
//                                   AS-OF. See {@link liabilityHomeInputFrom}
//   `trustSignals`                  the response carries two of `P-M6-09`'s five
//                                   inputs as FIGURES and neither as a STATE.
//                                   See {@link TRUST_INPUTS_CARRIED_WITHOUT_A_STATE}
//
// In every one of the three the alternative is a value this console would have
// chosen, and `AS-M6-04` is the failure a chosen value produces: a confident
// number with a source citation attached.
//
// -----------------------------------------------------------------------------
// THIS FILE HOLDS NO TRANSPORT AND MAY NOT
// -----------------------------------------------------------------------------
// `test/surface.test.ts` admits exactly one `fetch(` call site in this package
// and it is `http/client.ts`. This file takes an `AdminApiResult` that somebody
// else obtained, which is also why it is testable without a network and why
// `src/app/**` can consume it without a network call of its own: `M6-A-41`
// refuses one under that directory.

import type { Cents } from '@merit/rules-engine';

import type { LiabilityResponse } from './api/types.ts';
import type { TrustKey } from './data-trust.ts';
import type { AdminApiResult, AdminErrorKind } from './http/client.ts';
import {
  RCR_BREAKER_BP,
  type LiabilitySnapshot,
  type ReserveCoverageSnapshot,
} from './liability.ts';
import type { LiabilityHomeInput } from './page.ts';
import type { Environment } from './origin.ts';

/** Thrown when a body this console received is not one it may render. */
export class LiabilityReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiabilityReadError';
  }
}

/**
 * The endpoint, as `API_CONTRACT` section 8 spells it and as
 * `http/client.ts`'s `requestPath` wants it: a leading slash, an operator
 * prefix, and no `API_BASE_PATH`.
 */
export const ADMIN_LIABILITY_PATH = '/admin/liability';

/** `LiabilityResponse`'s gap vocabulary, indexed off the shape rather than retyped. */
export type WireGapCause = LiabilityResponse['gaps'][number]['cause'];

/**
 * {@link WireGapCause}'s members as data, EXHAUSTIVE IN BOTH DIRECTIONS.
 *
 * A `Record` KEYED BY THE UNION RATHER THAN AN ARRAY WITH A `satisfies`, and
 * `ADR-203` section 6 is why the difference is worth the extra line. That entry
 * takes `ADR-179`'s device, `as const satisfies readonly LiabilityGapCause[]`,
 * which refuses a member the union does not have and CANNOT SEE A MEMBER THE
 * UNION GAINED: an array of two still satisfies a union of three. A record keyed
 * by the union fails both ways, so a fourth cause minted in `admin-reads.ts` is
 * a type error in this console on the day it lands rather than a `default` arm
 * nobody wrote.
 *
 * The values are what the reader DOES, which is `ADR-203` section 6's own table
 * and is the reason the vocabulary is closed at all: the field is an input to a
 * person's decision.
 */
const GAP_CAUSE_REMEDY: Readonly<Record<WireGapCause, string>> = {
  awaiting_dependency: 'read the deliverable `awaiting` names',
  insufficient_history: 'wait, and nothing is wrong',
  estate_uncovered: 'load what is missing, today',
};

/** {@link WireGapCause} as data, in declaration order. */
export const WIRE_GAP_CAUSES: readonly WireGapCause[] = Object.keys(
  GAP_CAUSE_REMEDY,
) as readonly WireGapCause[];

/** What a reader does about one cause. `ADR-203` section 6's table, as a lookup. */
export function gapCauseRemedy(cause: WireGapCause): string {
  return GAP_CAUSE_REMEDY[cause];
}

/**
 * A figure the response carries that `LiabilityHomeInput` has no member for.
 *
 * IT IS NOT A `PendingPanel` AND THE DIFFERENCE IS THE POINT. `page.ts`'s
 * `PENDING` names a panel whose INPUT nobody supplies. These are fields the wire
 * DECLARES and this page's input shape cannot receive, so the gap is between two
 * files in this package rather than between this package and a producer.
 */
export interface UnreadWireField {
  /** The JSON path on `LiabilityResponse`, as `gaps.field` spells one. */
  readonly field: string;
  /** The `M06` section 3.1 panel it belongs to, or `-` where it belongs to none. */
  readonly origin: string;
  /** Why `liabilityHomeInputFrom` drops it rather than rendering it. */
  readonly reason: string;
}

/**
 * Every field on `LiabilityResponse` this projection does NOT carry into the
 * page, named with its reason.
 *
 * A PROJECTION THAT DROPS A FIELD SILENTLY IS THE DASHBOARD FAILURE `page.ts`
 * WROTE `PENDING` AGAINST, one layer down: "a page that silently renders five
 * panels where the plan defines ten is a page whose reader believes they are
 * looking at the whole board". The same argument applies to a response whose
 * twelve top-level fields become five page inputs, and the list is here so that
 * the count is checkable rather than a reader's arithmetic.
 *
 * **BOTH NULLABLE SITES ON THE RESPONSE ARE IN THIS LIST**, which is the
 * measurement the header states: `ADR-203`'s `gaps` mechanism is total and
 * correct and has no figure on this page to speak about yet.
 */
export const WIRE_FIELDS_THIS_PAGE_DOES_NOT_READ: readonly UnreadWireField[] = [
  {
    field: 'funded_accounts',
    origin: '-',
    reason:
      'a COUNT and not a figure. `INV-M6-04` binds a number to an as-of and a source and ' +
      '`figure.ts` carries `cents`, so a count has no admissible shape on this page. M06 ' +
      'section 3.1 names no panel for it',
  },
  {
    field: 'eligible_next_7d.account_count',
    origin: 'P-M6-03',
    reason:
      'the same, one panel down. `EligibleNextSevenDays` carries the total and the largest ' +
      'single identity share (`SD-M6-01`) and no count',
  },
  {
    field: 'payout_velocity',
    origin: 'P-M6-04',
    reason:
      'NO MEMBER OF `LiabilityHomeInput`. `page.ts` holds `P-M6-04` in `PENDING`. It is one of ' +
      'the two nullable sites `ADR-203` ruled, so the first `gaps` entry this console could ' +
      'render names a panel this page does not have',
  },
  {
    field: 'reserve.breaker_armed',
    origin: 'P-M6-07',
    reason:
      'READ AS A CHECK RATHER THAN DROPPED. `0049_reserve_coverage_snapshots.sql` deliberately ' +
      'does not store the arming and `liability.ts` computes it from the stored ratio against ' +
      '`RCR_BREAKER_BP`, so `ReserveCoverageSnapshot` has no member to put the sent flag in. ' +
      '`narrowLiabilityResponse` refuses a response whose flag and ratio disagree instead of ' +
      'picking one of the two answers',
  },
  {
    field: 'per_plan',
    origin: 'P-M6-05 and P-M6-06',
    reason:
      'NO MEMBER OF `LiabilityHomeInput`. `page.ts` holds both in `PENDING`. `per_plan[].cusum` ' +
      'is the second nullable site `ADR-203` ruled',
  },
  {
    field: 'integrations.mid_health',
    origin: 'P-M6-08',
    reason:
      'NO MEMBER OF `LiabilityHomeInput`, and `api/types.ts` states the sharper half: PSP health ' +
      'is a payments signal that no `TRUST_KEYS` member names, so feeding it to `assessDataTrust` ' +
      'under one of the other names would be a supplier invented at the point of use',
  },
];

/**
 * The `P-M6-09` inputs this response carries as a FIGURE and not as a STATE.
 *
 * `api/types.ts` maps two of `TRUST_KEYS`' five onto this body:
 * `integrations.recon.mismatches_open` is `recon_mismatches_open` and
 * `integrations.batch.last_success_at` is `batch_last_success`. **AND NEITHER
 * CAN BE PASSED TO `assessDataTrust`, BECAUSE `TrustSignal` REQUIRES A `state`
 * AND THE RESPONSE SENDS NONE.**
 *
 * `data-trust.ts` declares `TrustSignal` as "one of `P-M6-09`'s five inputs, AS
 * ITS SUPPLIER REPORTED IT". A state this console derived is not what a supplier
 * reported, and each of the two needs a boundary nobody has ruled:
 * `mismatches_open` needs the count above which the estate is distrusted, and
 * `last_success_at` needs an age above which a batch is late. `page.ts` refuses
 * exactly this move for staleness and states the reason, "picking the boundary
 * would invent a control nobody chose", and `INV-M6-12` refuses it for an alarm.
 *
 * SO THIS PROJECTION SUPPLIES NO TRUST SIGNAL AT ALL AND THE VERDICT IS RED ON
 * FIVE MISSING INPUTS RATHER THAN GREEN ON TWO INVENTED ONES. `assessDataTrust`
 * names an owner for each of the five, so a red board built this way tells an
 * operator who owes what; a board built from two derived states would tell them
 * the trust panel is working.
 *
 * **THE REPAIR IS A RULING AND NOT A PATCH**, and it is one of two shapes: the
 * response grows a state beside each figure, or a document fixes the two
 * boundaries. Either is `API_CONTRACT` or a panel definition, and neither is a
 * console file.
 */
export const TRUST_INPUTS_CARRIED_WITHOUT_A_STATE: readonly {
  readonly key: TrustKey;
  /** The JSON path on `LiabilityResponse` that carries the figure. */
  readonly field: string;
  /** The boundary a state would need, and which no document fixes. */
  readonly boundaryNobodyRuled: string;
}[] = [
  {
    key: 'recon_mismatches_open',
    field: 'integrations.recon.mismatches_open',
    boundaryNobodyRuled:
      'the count above which the estate is distrusted. M06 section 3.1 says an open ' +
      'reconciliation mismatch means the liability figures are computed from state Merit has ' +
      'said it does not trust, which reads as "above zero" and is a sentence about the panel ' +
      'rather than a threshold any document fixes',
  },
  {
    key: 'batch_last_success',
    field: 'integrations.batch.last_success_at',
    boundaryNobodyRuled:
      'the age above which a batch is late. `admin.liability_snapshot_age` is a metric with no ' +
      'ruled setpoint and `page.ts` renders an age without judging it for that reason',
  },
];

// -----------------------------------------------------------------------------
// The structural readers. `unknown` in, one field out, a refusal in between
// -----------------------------------------------------------------------------
// EACH TAKES THE PATH IT IS READING SO THE REFUSAL NAMES THE FIELD. A narrowing
// that throws "expected a number" tells an operator nothing an operator can act
// on; one that names `integrations.recon.mismatches_open` tells them which
// producer to go and look at.

function record(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new LiabilityReadError(
      `\`${path}\` is ${describe(value)} and \`GET ${ADMIN_LIABILITY_PATH}\` declares an object ` +
        'there. `api/types.ts` is the transcription this check reads against',
    );
  return value as Readonly<Record<string, unknown>>;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new LiabilityReadError(
      `\`${path}\` is ${describe(value)} and this console requires a non-blank string. A blank ` +
        'string where an instant or a code belongs is the same silence as a missing field',
    );
  return value;
}

function flag(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean')
    throw new LiabilityReadError(
      `\`${path}\` is ${describe(value)} and the contract declares a boolean`,
    );
  return value;
}

function list(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value))
    throw new LiabilityReadError(
      `\`${path}\` is ${describe(value)} and the contract declares an array`,
    );
  return value;
}

/**
 * One integer. JSON HAS ONE NUMBER TYPE AND THIS IS WHERE THAT COSTS SOMETHING.
 *
 * `api/types.ts` records the disagreement it inherits: the engine declares
 * `type Cents = bigint` and `API_CONTRACT` section 1 declares these same
 * quantities as JSON integers. So a body may carry `4.5` or `1e21` in a field
 * this console will hand to `formatCents`, and both are refused HERE rather
 * than at the renderer, because `CLAUDE.md`'s rule is that no float enters a
 * financial path at all and a float caught two layers later has already been
 * summed.
 *
 * `Number.isSafeInteger` IS THE CHECK AND NOT `Number.isInteger`. Above 2^53 a
 * JSON number has already lost digits by the time this function sees it, so
 * `BigInt` would faithfully widen a value that is already wrong.
 */
function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new LiabilityReadError(
      `\`${path}\` is ${typeof value === 'number' ? String(value) : describe(value)}, and ` +
        'CLAUDE.md puts money in integer cents with no float in any financial path. Above ' +
        'Number.MAX_SAFE_INTEGER a JSON number has already lost digits, so widening it here ' +
        'would carry the loss rather than catch it',
    );
  return value;
}

/** One integer-cents field, as the engine's `Cents`. */
function cents(value: unknown, path: string): Cents {
  return BigInt(integer(value, path));
}

// -----------------------------------------------------------------------------
// `ADR-203` ruling 2, on the reading side
// -----------------------------------------------------------------------------

/**
 * Pair every `null` on the body with the `gaps` entry that explains it, in both
 * directions.
 *
 * THIS IS `assertLiabilityGapsPaired` HELD OVER THE BYTES THIS CONSOLE
 * RECEIVED, and the duplication is deliberate rather than an oversight. That
 * function runs inside `projectLiability` on the producer; `ADR-203` section 10
 * finding 3 records that it "is declared and watched and is on no served path"
 * because `readLiability` is not composed. A console whose only defence against
 * a bare `null` is a guard on a producer that does not run yet has no defence.
 *
 * THE ABSENT PATHS ARE READ OFF THE VALUE AND NEVER OFF A LIST, which is that
 * function's own rule and its reason: a list of the nullable sites is a further
 * copy of the shape and would agree with the type on the day it was written.
 *
 * `per_plan[].cusum` IS ONE PATH AND NOT ONE PER PLAN. `ADR-202` ruling 3 puts
 * the object's absence at the object, and `CUSUM_GAPS` in `admin-breaker.ts`
 * already writes the path this way.
 */
function assertGapsPaired(
  gaps: readonly {
    readonly field: string;
    readonly cause: WireGapCause;
    readonly awaiting: string | null;
  }[],
  absentPaths: ReadonlySet<string>,
): void {
  const named = new Set<string>();
  for (const gap of gaps) {
    if (named.has(gap.field))
      throw new LiabilityReadError(
        `\`gaps\` names \`${gap.field}\` twice, and ADR-203 ruling 2 is one entry per absent ` +
          'figure. Two reasons for one absence is an operator choosing which to believe',
      );
    named.add(gap.field);
  }

  for (const path of absentPaths)
    if (!named.has(path))
      throw new LiabilityReadError(
        `\`${path}\` is null and \`gaps\` does not name it. ADR-203 ruling 2: a null nothing ` +
          'explains is an honest gap arriving as an indistinguishable zero, and on this panel ' +
          'that is the difference between "we do not know" and "there is none"',
      );

  for (const path of named)
    if (!absentPaths.has(path))
      throw new LiabilityReadError(
        `\`gaps\` names \`${path}\` and that figure is PRESENT on this response. ADR-203 ` +
          'ruling 2 pairs the two in both directions: a gap over a figure an operator is ' +
          'looking straight at is worse than no gap at all',
      );
}

function readGap(
  value: unknown,
  index: number,
): {
  readonly field: string;
  readonly cause: WireGapCause;
  readonly awaiting: string | null;
  readonly detail: string;
} {
  const path = `gaps[${index}]`;
  const row = record(value, path);
  const cause = text(row['cause'], `${path}.cause`);
  if (!WIRE_GAP_CAUSES.includes(cause as WireGapCause))
    throw new LiabilityReadError(
      `\`${path}.cause\` is ${JSON.stringify(cause)} and ADR-203 ruling 4 closes the vocabulary ` +
        `at ${WIRE_GAP_CAUSES.join(', ')}. A cause this console cannot branch on is a free-text ` +
        'reason with an enum spelling, which is the silence that ruling refuses',
    );

  // `detail` IS REQUIRED AND BLANK IS REFUSED WITH A `.trim()`, which is
  // `figure.ts`'s own bar carried across the boundary: `AbsentFigure.reason` is
  // where this text lands and "'unavailable' written by the schema is the same
  // silence, spelled". Whitespace is that sentence's loophole.
  const detail = text(row['detail'], `${path}.detail`);

  const rawAwaiting = row['awaiting'];
  const awaiting = rawAwaiting === null ? null : text(rawAwaiting, `${path}.awaiting`);
  const awaits = cause === 'awaiting_dependency';
  if (awaits !== (awaiting !== null))
    throw new LiabilityReadError(
      `\`${path}\` names \`${text(row['field'], `${path}.field`)}\` with cause \`${cause}\` and ` +
        `awaiting ${JSON.stringify(awaiting)}. ADR-203 ruling 4 makes \`awaiting\` non-null ` +
        'EXACTLY when the cause is `awaiting_dependency`, because that is the one cause that ' +
        'names something a reader can go and look at',
    );

  return {
    field: text(row['field'], `${path}.field`),
    cause: cause as WireGapCause,
    awaiting,
    detail,
  };
}

// -----------------------------------------------------------------------------
// The narrowing
// -----------------------------------------------------------------------------

/**
 * Turn one `unknown` body into a `LiabilityResponse`, or refuse it with the
 * field that failed.
 *
 * IT REBUILDS RATHER THAN VALIDATES-AND-CASTS. A predicate that returns
 * `body is LiabilityResponse` still hands the caller the original object, so
 * every field the predicate forgot travels on unchecked and every field the
 * server added travels on unnamed. This returns a value assembled field by
 * field out of what was read, which is `projectLiability`'s shape on the
 * producer and for the same reason.
 *
 * WHAT IT DOES NOT CHECK, STATED SO A READER DOES NOT ASSUME IT: no instant is
 * checked here. `figure.ts` already refuses an instant that is not a
 * round-tripping UTC ISO-8601 stamp, and it does so at every site that renders
 * one; a second copy of that rule here would be a second answer to what an
 * instant is. Non-negativity is `theThreeNumbers`' and it argues its own
 * messages. This function's subject is SHAPE, INTEGRALITY and `ADR-203`.
 */
export function narrowLiabilityResponse(body: unknown): LiabilityResponse {
  const root = record(body, 'body');

  const eligible = record(root['eligible_next_7d'], 'eligible_next_7d');
  const reserve = record(root['reserve'], 'reserve');
  const integrations = record(root['integrations'], 'integrations');
  const recon = record(integrations['recon'], 'integrations.recon');
  const batch = record(integrations['batch'], 'integrations.batch');

  const rawVelocity = root['payout_velocity'];
  const velocity =
    rawVelocity === null
      ? null
      : ((): NonNullable<LiabilityResponse['payout_velocity']> => {
          const group = record(rawVelocity, 'payout_velocity');
          return {
            last_7d_cents: integer(group['last_7d_cents'], 'payout_velocity.last_7d_cents'),
            avg_30d_cents: integer(group['avg_30d_cents'], 'payout_velocity.avg_30d_cents'),
            ratio_bp: integer(group['ratio_bp'], 'payout_velocity.ratio_bp'),
            alarm: flag(group['alarm'], 'payout_velocity.alarm'),
          };
        })();

  const perPlan = list(root['per_plan'], 'per_plan').map((entry, index) => {
    const path = `per_plan[${index}]`;
    const plan = record(entry, path);
    const rawCusum = plan['cusum'];
    return {
      plan_id: text(plan['plan_id'], `${path}.plan_id`),
      code: text(plan['code'], `${path}.code`),
      loss_ratio_bp: integer(plan['loss_ratio_bp'], `${path}.loss_ratio_bp`),
      threshold_bp: integer(plan['threshold_bp'], `${path}.threshold_bp`),
      sales_paused: flag(plan['sales_paused'], `${path}.sales_paused`),
      cusum:
        rawCusum === null
          ? null
          : ((): {
              readonly statistic: number;
              readonly threshold: number;
              readonly alarm: boolean;
            } => {
              const group = record(rawCusum, `${path}.cusum`);

              // NEITHER CENTS NOR BASIS POINTS, which is why `integer` is not
              // the reader here. `api/types.ts` carries the contract's own
              // sentence: a CUSUM statistic is a standardised deviation and
              // rounding it to either is a calibration defect (`FM-M6-07`)
              // rather than a fix. These are the only two non-integer-scaled
              // numbers on this response.
              const real = (value: unknown, at: string): number => {
                if (typeof value !== 'number' || !Number.isFinite(value))
                  throw new LiabilityReadError(
                    `\`${at}\` is ${describe(value)} and the contract declares a finite number`,
                  );
                return value;
              };
              return {
                statistic: real(group['statistic'], `${path}.cusum.statistic`),
                threshold: real(group['threshold'], `${path}.cusum.threshold`),
                alarm: flag(group['alarm'], `${path}.cusum.alarm`),
              };
            })(),
    };
  });

  const gaps = list(root['gaps'], 'gaps').map((entry, index) => readGap(entry, index));

  const absentPaths = new Set<string>();
  if (velocity === null) absentPaths.add('payout_velocity');
  if (perPlan.some((plan) => plan.cusum === null)) absentPaths.add('per_plan[].cusum');
  assertGapsPaired(gaps, absentPaths);

  const rcrBp = cents(reserve['rcr_bp'], 'reserve.rcr_bp');
  const breakerArmed = flag(reserve['breaker_armed'], 'reserve.breaker_armed');
  assertArmingAgrees(breakerArmed, rcrBp);

  const treasurySource = text(reserve['treasury_source'], 'reserve.treasury_source');
  if (treasurySource !== 'provider_api' && treasurySource !== 'manual_attestation')
    throw new LiabilityReadError(
      `\`reserve.treasury_source\` is ${JSON.stringify(treasurySource)} and API_CONTRACT ` +
        'section 8 closes it at `provider_api` and `manual_attestation`. `P-M6-07` requires ' +
        'attestation staleness shown when the balance is a manual attestation, so a third ' +
        'spelling is a panel that cannot tell which of the two kinds it is rendering',
    );

  return {
    as_of: text(root['as_of'], 'as_of'),
    open_liability_cents: integer(root['open_liability_cents'], 'open_liability_cents'),
    wallet_balances_cents: integer(root['wallet_balances_cents'], 'wallet_balances_cents'),
    bounded_near_term_cents: integer(root['bounded_near_term_cents'], 'bounded_near_term_cents'),
    remaining_ladder_exposure_cents: integer(
      root['remaining_ladder_exposure_cents'],
      'remaining_ladder_exposure_cents',
    ),

    // SIGNED, AND THE ONE FIELD ON THIS RESPONSE THAT MAY BE NEGATIVE.
    // `api/types.ts`: a renderer that clamps it at zero reports an absorbed
    // correction as none, which is the one way this field can be rendered
    // wrongly without looking wrong. `integer` imposes no sign for that reason.
    absorbed_corrections_cents: integer(
      root['absorbed_corrections_cents'],
      'absorbed_corrections_cents',
    ),
    funded_accounts: integer(root['funded_accounts'], 'funded_accounts'),
    eligible_next_7d: {
      total_cents: integer(eligible['total_cents'], 'eligible_next_7d.total_cents'),
      account_count: integer(eligible['account_count'], 'eligible_next_7d.account_count'),
      by_day: list(eligible['by_day'], 'eligible_next_7d.by_day').map((entry, index) => {
        const path = `eligible_next_7d.by_day[${index}]`;
        const day = record(entry, path);
        return {
          trading_day: text(day['trading_day'], `${path}.trading_day`),
          cents: integer(day['cents'], `${path}.cents`),
          accounts: integer(day['accounts'], `${path}.accounts`),
        };
      }),
    },
    payout_velocity: velocity,
    reserve: {
      as_of: text(reserve['as_of'], 'reserve.as_of'),
      reserve_cents: integer(reserve['reserve_cents'], 'reserve.reserve_cents'),
      cvar99_cents: integer(reserve['cvar99_cents'], 'reserve.cvar99_cents'),
      rcr_bp: integer(reserve['rcr_bp'], 'reserve.rcr_bp'),
      breaker_armed: breakerArmed,
      treasury_account_code: text(
        reserve['treasury_account_code'],
        'reserve.treasury_account_code',
      ),
      treasury_as_of: text(reserve['treasury_as_of'], 'reserve.treasury_as_of'),
      treasury_source: treasurySource,
    },
    per_plan: perPlan,
    integrations: {
      mid_health: list(integrations['mid_health'], 'integrations.mid_health').map(
        (entry, index) => {
          const path = `integrations.mid_health[${index}]`;
          const mid = record(entry, path);
          return {
            psp: text(mid['psp'], `${path}.psp`),
            decline_rate_bp: integer(mid['decline_rate_bp'], `${path}.decline_rate_bp`),
            chargeback_rate_bp: integer(mid['chargeback_rate_bp'], `${path}.chargeback_rate_bp`),
            healthy: flag(mid['healthy'], `${path}.healthy`),
          };
        },
      ),
      recon: {
        last_run_at: text(recon['last_run_at'], 'integrations.recon.last_run_at'),
        mismatches_open: integer(recon['mismatches_open'], 'integrations.recon.mismatches_open'),
      },
      batch: {
        last_success_at: text(batch['last_success_at'], 'integrations.batch.last_success_at'),
        last_duration_ms: integer(batch['last_duration_ms'], 'integrations.batch.last_duration_ms'),
      },
    },
    gaps,
  };
}

/**
 * The sent arming and the sent ratio have to agree, and a disagreement is
 * refused rather than resolved.
 *
 * `0049_reserve_coverage_snapshots.sql` DELIBERATELY DOES NOT STORE
 * `breaker_armed` and says why: "Armed is `rcr_bp < 10000`, a rendering of a
 * stored number against a threshold the GLOSSARY fixes at 1.0, and storing it
 * would recreate in one column exactly the drift item 1 removes from another."
 * `liability.ts` therefore computes the arming where the rendering happens,
 * from the stored ratio, and `ReserveCoverageSnapshot` has no member for a sent
 * flag.
 *
 * SO A RESPONSE CARRYING BOTH GIVES THIS CONSOLE TWO ANSWERS AND ONE PLACE TO
 * PUT THEM. Dropping the flag silently would render a breaker state the server
 * did not send; rendering the flag would put the drift back that the generated
 * column removes. Refusing the row is the third answer and it is the one the
 * panel beside it already takes: `assertRatioIsFromReserveAlone` refuses a
 * numerator that disagrees with its own ratio rather than picking either.
 */
function assertArmingAgrees(breakerArmed: boolean, rcrBp: Cents): void {
  const derived = rcrBp < RCR_BREAKER_BP;
  if (breakerArmed !== derived)
    throw new LiabilityReadError(
      `\`reserve.breaker_armed\` is ${String(breakerArmed)} and \`reserve.rcr_bp\` is ${rcrBp}, ` +
        `which is ${derived ? 'below' : 'at or above'} the ${RCR_BREAKER_BP} basis points the ` +
        'GLOSSARY fixes the breaker at. 0049 stores the ratio and not the arming precisely so ' +
        'the two cannot drift, and this console renders the arming it computes from the ratio, ' +
        'so a body that disagrees with itself is refused rather than half rendered',
    );
}

// -----------------------------------------------------------------------------
// The projection
// -----------------------------------------------------------------------------

/**
 * Turn a narrowed response into the page's input.
 *
 * EVERY OPTIONAL MEMBER IT LEAVES UNSUPPLIED IS A MEASUREMENT AND NOT AN
 * OMISSION, and the header lists the three. Two are worth restating at the
 * point of the decision:
 *
 * **`eligibleNextSevenDays` IS DROPPED BECAUSE THE RESPONSE CARRIES THE FIGURE
 * AND NOT ITS AS-OF.** `EligibleNextSevenDays.asOfInstant` is required, and the
 * only instant on the body that could fill it is the top-level `as_of`, which is
 * `liability_snapshots`' clock. `api/types.ts` argues that exact move down one
 * field: `reserve` carries its own `as_of` "BECAUSE IT IS A DIFFERENT TABLE ON A
 * DIFFERENT CLOCK", and dating one group with another's would put "the book's
 * clock on the rail's figure". `P-M6-03` is a FORECAST from `DEP-M6-01`'s
 * projection and is not the snapshot; dating it with the snapshot's instant
 * would tell an operator the forecast was computed at a moment nobody computed
 * it at. `INV-M6-04` is what makes that unrenderable rather than untidy, and
 * `page.ts` already renders `P-M6-03` ABSENT with its owner named.
 *
 * **`live` IS DROPPED AND MUST STAY DROPPED.** `api/types.ts` carries the
 * contract's own sentence: the live figure "is never a field on `GET
 * /admin/liability` above. That response is the one an operator opens during an
 * incident, and a live field on it makes the number Merit is most often disputed
 * about depend on a feed that is down." There is no field to read and there must
 * never be one, so this is the one absence here that is a commitment rather than
 * a gap.
 *
 * WHAT IT DOES SUPPLY IS FIVE FIGURES AND ONE PANEL: `P-M6-01`'s first two
 * components, `P-M6-02`, `AS-M6-04`, `P-M6-10` and the whole of `P-M6-07`.
 */
export function liabilityHomeInputFrom(input: {
  readonly response: LiabilityResponse;
  readonly env: Environment;
  /** The operator's role, as a string. `roles.ts` refuses one that is not a role. */
  readonly role: string;
  readonly renderedAt: string;
}): LiabilityHomeInput {
  const { response } = input;

  const snapshot: LiabilitySnapshot = {
    asOfInstant: response.as_of,

    // THE COLUMN NAME IS KEPT ON THE WIRE AND THE MEANING IS RESTORED HERE.
    // `ADR-188` clause 2 sends `open_liability_cents` because that is what
    // `0009_ledger.sql` calls the column; `liability.ts` renames it on arrival
    // because the column called `open_liability_cents` is not the panel called
    // Open Liability. Reading it into `withdrawableAcrossFundedCents` is that
    // rename, performed once, at the boundary.
    withdrawableAcrossFundedCents: BigInt(response.open_liability_cents),
    walletBalancesCents: BigInt(response.wallet_balances_cents),
    boundedNearTermCents: BigInt(response.bounded_near_term_cents),
    remainingLadderExposureCents: BigInt(response.remaining_ladder_exposure_cents),

    // `withdrawalsInFlight` IS OMITTED AND UNDEFINED IS NOT ZERO. `ADR-195`
    // section 6 row 1: no column of `liability_snapshots` holds the obligation,
    // so `LiabilityResponse` has no field to project. `theThreeNumbers` renders
    // the component ABSENT with that reason and marks the total INCOMPLETE; a
    // zero here would say the obligation was measured and found empty.
  };

  const coverage: ReserveCoverageSnapshot = {
    asOfInstant: response.reserve.as_of,
    reserveCents: BigInt(response.reserve.reserve_cents),
    cvar99Cents: BigInt(response.reserve.cvar99_cents),
    rcrBp: BigInt(response.reserve.rcr_bp),
    anchor: {
      accountCode: response.reserve.treasury_account_code,
      asOfInstant: response.reserve.treasury_as_of,

      // AS TEXT AND NOT AS THE CLOSED UNION, which is `ReserveCoverageSnapshot`'s
      // own instruction: typing it there would move the refusal to a cast
      // somebody writes once and nobody watches. `requireTreasurySource` refuses
      // it inside `reserveCoverage`, and `narrowLiabilityResponse` has already
      // refused a third spelling on the wire, so the string that arrives here
      // has been checked twice against two different declarations of the set.
      source: response.reserve.treasury_source,
    },
  };

  return {
    env: input.env,
    role: input.role,
    renderedAt: input.renderedAt,
    snapshot,
    absorbedCorrectionsCents: BigInt(response.absorbed_corrections_cents),

    // NONE OF THE FIVE, AND THE VERDICT IS RED ON FIVE MISSING RATHER THAN
    // GREEN ON TWO INVENTED. See TRUST_INPUTS_CARRIED_WITHOUT_A_STATE.
    trustSignals: [],
    reserveCoverage: coverage,
  };
}

// -----------------------------------------------------------------------------
// The seam
// -----------------------------------------------------------------------------

/**
 * A read that produced the page's input, or the stated reason it could not.
 *
 * THREE ARMS AND NOT TWO, and the third is the one a two-arm union loses. A
 * transport failure and a 200 carrying a body this console refuses are different
 * events with different remedies: the first is the API, the second is a producer
 * sending something `API_CONTRACT` does not describe, and collapsing them would
 * tell an operator the console cannot reach a service it just reached.
 */
export type LiabilityRead =
  | { readonly kind: 'supplied'; readonly input: LiabilityHomeInput }
  | { readonly kind: 'failed'; readonly error: AdminErrorKind; readonly status: number | null }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * The whole read, from one `AdminApiResult` to one {@link LiabilityRead}.
 *
 * **THIS FUNCTION IS NOT ON A SERVED PATH AND SAYING SO IS PART OF SHIPPING
 * IT.** Nothing in this repository composes `AdminReadSource.readLiability`:
 * `IMPLEMENTED_ADMIN_READS` names `listEvents`, `listFlags`, `readAccount`,
 * `readIdentityGraph` and `searchAccounts`, re-derived at
 * `apps/api/src/admin-source/index.ts`, and `readLiability` is not among them.
 * Nothing calls `setAdminSessionSource` outside a test either, so no deployment
 * can mint the cookie a real read would send and the answer such a read receives
 * today is 401. `src/app/page.tsx` renders the honest unavailable state for
 * exactly that reason and this function is what it will call instead on the day
 * the adapter lands.
 *
 * IT TAKES A RESULT RATHER THAN FETCHING ONE, and that is a control rather than
 * a style. `test/surface.test.ts` admits exactly one `fetch(` in this package,
 * in `http/client.ts`, and `M6-A-41` refuses a network call of any kind under
 * `src/app/`. A read composed here out of a result somebody else obtained keeps
 * both of those true and is testable without a network.
 */
export function readLiabilityHome(
  result: AdminApiResult,
  context: {
    readonly env: Environment;
    readonly role: string;
    readonly renderedAt: string;
  },
): LiabilityRead {
  if (!result.ok) return { kind: 'failed', error: result.error, status: result.status };

  try {
    return {
      kind: 'supplied',
      input: liabilityHomeInputFrom({
        response: narrowLiabilityResponse(result.body),
        env: context.env,
        role: context.role,
        renderedAt: context.renderedAt,
      }),
    };
  } catch (cause) {
    // THE MESSAGE IS CARRIED AND THE ERROR IS NOT RETHROWN. A narrowing failure
    // is a body a producer sent, so it is a thing to RENDER with its reason
    // rather than a fault in this console: an operator who is told which field
    // failed can name the producer, and an unhandled throw on the console's root
    // route tells them the console is broken.
    //
    // ANYTHING THAT IS NOT AN `Error` IS STILL NAMED. A thrown string would
    // otherwise reach the page as `undefined`, which is the blank reason
    // `figure.ts` refuses one layer down.
    if (cause instanceof Error) return { kind: 'refused', reason: cause.message };
    return {
      kind: 'refused',
      reason:
        `\`GET ${ADMIN_LIABILITY_PATH}\` answered with a body this console refused, and the ` +
        `refusal was not an Error: ${JSON.stringify(String(cause))}`,
    };
  }
}
