// =============================================================================
// apps/admin/test/liability-read.test.ts
// =============================================================================
// `M6-A-80` to `M6-A-85`. The read side of the liability home.
//
// EVERY CASE HERE STARTS FROM A `structuredClone` OF ONE FIXTURE AND BREAKS
// EXACTLY ONE THING. A suite that hand-writes a fresh malformed body per case
// proves that the narrowing refuses a body which is wrong in several ways at
// once, which is not the property anybody needs: the property is that it refuses
// a body wrong in ONE way, because that is the body a producer actually sends.
//
// THE ACCEPTANCE CASES FIRE AS WELL AS THE REFUSALS. `DISPATCH_PROTOCOL` section
// 6 states the reason in its own register: "a probe that only ever attempts
// forbidden things passes against a guard that rejects everything". So the
// fixture is narrowed, projected AND built into a real `LiabilityHomePage`
// through `buildLiabilityHome`, and the bytes are read.

import { describe, expect, test } from 'vitest';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assessDataTrust } from '../src/data-trust.ts';
import { formatCents, readingIsPresent } from '../src/figure.ts';
import type { AdminApiResult } from '../src/http/client.ts';
import {
  ADMIN_LIABILITY_PATH,
  LiabilityReadError,
  TRUST_INPUTS_CARRIED_WITHOUT_A_STATE,
  WIRE_FIELDS_THIS_PAGE_DOES_NOT_READ,
  WIRE_GAP_CAUSES,
  gapCauseRemedy,
  liabilityHomeInputFrom,
  narrowLiabilityResponse,
  readLiabilityHome,
} from '../src/liability-read.ts';
import { theThreeNumbers } from '../src/liability.ts';
import { buildLiabilityHome, renderLiabilityHome } from '../src/page.ts';

// -----------------------------------------------------------------------------
// The fixture
// -----------------------------------------------------------------------------
// EVERY MONEY FIELD IS INTEGER CENTS, INCLUDING HERE. CLAUDE.md puts that rule
// on fixtures by name, and this file would be the easiest place in the package
// to break it without anything noticing.
//
// The ratio is the one the database would have generated:
// `(reserve_cents * 10000) / cvar99_cents` is `(6_000_000 * 10000) / 5_000_000`,
// which is 12,000 basis points, and 12,000 is at or above `RCR_BREAKER_BP` so
// the breaker is not armed. A fixture that got either wrong would be refused by
// the code under test rather than rendering, which is the point of both checks.

const BODY = (): Record<string, unknown> => ({
  as_of: '2026-08-28T00:00:00.000Z',
  open_liability_cents: 750_000,
  wallet_balances_cents: 125_000,
  bounded_near_term_cents: 500_000,
  remaining_ladder_exposure_cents: 4_000_000,
  absorbed_corrections_cents: -2_500,
  funded_accounts: 42,
  eligible_next_7d: {
    total_cents: 300_000,
    account_count: 12,
    by_day: [{ trading_day: '2026-08-31', cents: 100_000, accounts: 4 }],
  },
  payout_velocity: {
    last_7d_cents: 200_000,
    avg_30d_cents: 150_000,
    ratio_bp: 13_333,
    alarm: false,
  },
  reserve: {
    as_of: '2026-08-28T06:00:00.000Z',
    reserve_cents: 6_000_000,
    cvar99_cents: 5_000_000,
    rcr_bp: 12_000,
    breaker_armed: false,
    treasury_account_code: 'rail-operating',
    treasury_as_of: '2026-08-28T05:55:00.000Z',
    treasury_source: 'provider_api',
  },
  per_plan: [
    {
      plan_id: 'plan-eval-50k',
      code: 'EVAL-50K',
      loss_ratio_bp: 1_200,
      threshold_bp: 2_500,
      sales_paused: false,
      cusum: { statistic: 1.5, threshold: 4, alarm: false },
    },
  ],
  integrations: {
    mid_health: [{ psp: 'primary', decline_rate_bp: 300, chargeback_rate_bp: 12, healthy: true }],
    recon: { last_run_at: '2026-08-28T03:00:00.000Z', mismatches_open: 0 },
    batch: { last_success_at: '2026-08-28T02:00:00.000Z', last_duration_ms: 42_000 },
  },
  gaps: [],
});

const CONTEXT = {
  env: { ADMIN_ORIGIN: 'https://ops.example.invalid' },
  role: 'owner',
  renderedAt: '2026-08-28T09:30:00.000Z',
} as const;

/** The fixture with one path replaced, so a case breaks exactly one thing. */
function bodyWith(path: readonly string[], value: unknown): Record<string, unknown> {
  const body = BODY();
  let cursor: Record<string, unknown> = body;
  for (const step of path.slice(0, -1)) cursor = cursor[step] as Record<string, unknown>;
  cursor[path[path.length - 1] ?? ''] = value;
  return body;
}

// =============================================================================
// M6-A-80. The narrowing rebuilds the body and refuses what it cannot read
// =============================================================================

describe('M6-A-80: the narrowing is structural, and it names the field that failed', () => {
  test('the fixture narrows, and every field survives the rebuild', () => {
    const response = narrowLiabilityResponse(BODY());

    // THE ACCEPTANCE CASE, and it reads the fields rather than only the absence
    // of a throw. A narrowing that returned an empty object would pass a case
    // that asserted `not.toThrow()`.
    expect(response.as_of).toBe('2026-08-28T00:00:00.000Z');
    expect(response.open_liability_cents).toBe(750_000);
    expect(response.absorbed_corrections_cents).toBe(-2_500);
    expect(response.eligible_next_7d?.by_day).toHaveLength(1);
    expect(response.payout_velocity?.ratio_bp).toBe(13_333);
    expect(response.per_plan[0]?.cusum?.statistic).toBe(1.5);
    expect(response.reserve.treasury_source).toBe('provider_api');
    expect(response.integrations.recon.mismatches_open).toBe(0);
    expect(response.gaps).toEqual([]);
  });

  test('the rebuild is a rebuild and not a cast, so an extra field does not travel', () => {
    // A PREDICATE RETURNING `body is LiabilityResponse` HANDS BACK THE ORIGINAL,
    // so a field the server added arrives at the renderer unnamed. This is the
    // difference, asserted rather than argued in the header alone.
    const narrowed = narrowLiabilityResponse({ ...BODY(), a_field_nobody_declared: 1 });
    expect(Object.keys(narrowed)).not.toContain('a_field_nobody_declared');
    expect(Object.keys(narrowed).sort()).toEqual(
      [
        'absorbed_corrections_cents',
        'as_of',
        'bounded_near_term_cents',
        'eligible_next_7d',
        'funded_accounts',
        'gaps',
        'integrations',
        'open_liability_cents',
        'payout_velocity',
        'per_plan',
        'remaining_ladder_exposure_cents',
        'reserve',
        'wallet_balances_cents',
      ].sort(),
    );
  });

  test('a missing field is refused and the message names its path', () => {
    const body = BODY();
    delete body['open_liability_cents'];
    expect(() => narrowLiabilityResponse(body)).toThrow(LiabilityReadError);
    expect(() => narrowLiabilityResponse(body)).toThrow(/open_liability_cents/);
  });

  test('a nested missing field is refused and the message names the nested path', () => {
    const body = bodyWith(['integrations', 'recon'], { last_run_at: '2026-08-28T03:00:00.000Z' });
    expect(() => narrowLiabilityResponse(body)).toThrow(/integrations\.recon\.mismatches_open/);
  });

  test('a FLOAT in a money field is refused, which is CLAUDE.md`s rule at the boundary', () => {
    // 750,000.5 CENTS IS THE SHAPE THAT MATTERS. It is not absurd, it is what a
    // producer that divided somewhere sends, and `formatCents` would render it
    // as a plausible amount. Money is integer cents and a float caught two
    // layers later has already been summed.
    expect(() => narrowLiabilityResponse(bodyWith(['open_liability_cents'], 750_000.5))).toThrow(
      /integer cents/,
    );
  });

  test('a money field above MAX_SAFE_INTEGER is refused rather than widened', () => {
    // BigInt WOULD FAITHFULLY WIDEN A NUMBER THAT HAS ALREADY LOST DIGITS.
    expect(() =>
      narrowLiabilityResponse(bodyWith(['wallet_balances_cents'], Number.MAX_SAFE_INTEGER + 2)),
    ).toThrow(LiabilityReadError);
  });

  test('the CUSUM pair is NOT read as an integer, because it is neither cents nor bp', () => {
    // THE INVERSE OF THE CASE ABOVE, AND IT IS THE ONE A SWEEPING "everything is
    // an integer" narrowing would fail. `api/types.ts` carries the contract's
    // sentence: rounding a standardised deviation to either scale is a
    // calibration defect (`FM-M6-07`) rather than a fix.
    const response = narrowLiabilityResponse(BODY());
    expect(response.per_plan[0]?.cusum?.statistic).toBe(1.5);
    expect(Number.isInteger(response.per_plan[0]?.cusum?.statistic)).toBe(false);
  });

  test('an absorbed correction stays NEGATIVE, because clamping it reports none', () => {
    expect(narrowLiabilityResponse(BODY()).absorbed_corrections_cents).toBeLessThan(0);
  });

  test('a third treasury source spelling is refused', () => {
    expect(() =>
      narrowLiabilityResponse(bodyWith(['reserve', 'treasury_source'], 'best_guess')),
    ).toThrow(/provider_api/);
  });

  test('a body that is not an object at all is refused', () => {
    for (const value of [null, 'a string', 7, [], undefined])
      expect(() => narrowLiabilityResponse(value)).toThrow(LiabilityReadError);
  });
});

// =============================================================================
// M6-A-81. ADR-203 ruling 2, enforced on the READING side, in both directions
// =============================================================================

describe('M6-A-81: no null travels alone, and no gap stands over a present figure', () => {
  const velocityGap = {
    field: 'payout_velocity',
    cause: 'insufficient_history',
    awaiting: null,
    detail: 'four trading days short of thirty',
  };

  test('a null WITH its gap entry narrows, and the reason survives', () => {
    const body = { ...bodyWith(['payout_velocity'], null), gaps: [velocityGap] };
    const response = narrowLiabilityResponse(body);
    expect(response.payout_velocity).toBeNull();
    expect(response.gaps[0]?.detail).toBe('four trading days short of thirty');
  });

  test('a BARE null is refused, which is the honest gap arriving as a zero', () => {
    expect(() => narrowLiabilityResponse(bodyWith(['payout_velocity'], null))).toThrow(
      /gaps` does not name it/,
    );
  });

  test('a gap over a PRESENT figure is refused, which is the worse direction', () => {
    expect(() => narrowLiabilityResponse({ ...BODY(), gaps: [velocityGap] })).toThrow(
      /is PRESENT on this response/,
    );
  });

  test('`per_plan[].cusum` is ONE path and not one per plan', () => {
    const body = BODY();
    const plans = body['per_plan'] as Record<string, unknown>[];
    const second = { ...(plans[0] as Record<string, unknown>), plan_id: 'plan-eval-100k' };
    body['per_plan'] = [{ ...(plans[0] as Record<string, unknown>), cusum: null }, second];
    body['gaps'] = [
      {
        field: 'per_plan[].cusum',
        cause: 'awaiting_dependency',
        awaiting: 'DEP-M6-05',
        detail: 'the simulation harness supplies mu_0 and sigma',
      },
    ];

    // ONE ENTRY COVERS A NULL ON ONE PLAN OF TWO. An implementation that keyed
    // the path by index would need two entries and would reject this body.
    const response = narrowLiabilityResponse(body);
    expect(response.per_plan.filter((plan) => plan.cusum === null)).toHaveLength(1);
    expect(response.gaps).toHaveLength(1);
  });

  test('a blank detail is refused, and the check is `.trim()` because whitespace is the loophole', () => {
    const body = {
      ...bodyWith(['payout_velocity'], null),
      gaps: [{ ...velocityGap, detail: '  ' }],
    };
    expect(() => narrowLiabilityResponse(body)).toThrow(LiabilityReadError);
  });

  test('`awaiting` is non-null EXACTLY when the cause is awaiting_dependency, both ways', () => {
    const withAwaiting = {
      ...bodyWith(['payout_velocity'], null),
      gaps: [{ ...velocityGap, awaiting: 'DEP-M6-05' }],
    };
    expect(() => narrowLiabilityResponse(withAwaiting)).toThrow(/EXACTLY when the cause/);

    const withoutAwaiting = {
      ...bodyWith(['payout_velocity'], null),
      gaps: [{ ...velocityGap, cause: 'awaiting_dependency', awaiting: null }],
    };
    expect(() => narrowLiabilityResponse(withoutAwaiting)).toThrow(/EXACTLY when the cause/);
  });

  test('one path named twice is refused', () => {
    const body = {
      ...bodyWith(['payout_velocity'], null),
      gaps: [velocityGap, { ...velocityGap, detail: 'a second reason' }],
    };
    expect(() => narrowLiabilityResponse(body)).toThrow(/twice/);
  });

  test('a cause outside the closed three is refused, and the three are the vocabulary', () => {
    const body = {
      ...bodyWith(['payout_velocity'], null),
      gaps: [{ ...velocityGap, cause: 'unavailable' }],
    };
    expect(() => narrowLiabilityResponse(body)).toThrow(/closes the vocabulary/);

    expect([...WIRE_GAP_CAUSES].sort()).toEqual([
      'awaiting_dependency',
      'estate_uncovered',
      'insufficient_history',
    ]);
    for (const cause of WIRE_GAP_CAUSES) expect(gapCauseRemedy(cause).trim()).not.toBe('');
  });

  test('the console vocabulary and the producer vocabulary are the same three', () => {
    // THE CORRESPONDENCE THE DISPATCH ASKED FOR, ASSERTED AGAINST THE PRODUCER'S
    // OWN DECLARATION RATHER THAN AGAINST A COPY OF IT. `WIRE_GAP_CAUSES` is
    // derived from `api/types.ts`'s union by a `Record` key set, and this reads
    // `admin-reads.ts`'s published data. A member minted on one side and not the
    // other fails here.
    const producer = readFileSync(
      join(import.meta.dirname, '..', '..', 'api', 'src', 'routes', 'admin-reads.ts'),
      'utf8',
    );
    const declared = /export const LIABILITY_GAP_CAUSES = \[([\s\S]*?)\] as const/.exec(producer);
    expect(declared, 'admin-reads.ts declares LIABILITY_GAP_CAUSES').not.toBeNull();
    const members = [...(declared?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(members.sort()).toEqual([...WIRE_GAP_CAUSES].sort());
  });
});

// =============================================================================
// M6-A-82. The sent arming and the sent ratio have to agree
// =============================================================================

describe('M6-A-82: a breaker state the body disagrees with itself about is refused', () => {
  test('the coherent fixture narrows', () => {
    expect(narrowLiabilityResponse(BODY()).reserve.breaker_armed).toBe(false);
  });

  test('armed TRUE above the threshold is refused', () => {
    expect(() => narrowLiabilityResponse(bodyWith(['reserve', 'breaker_armed'], true))).toThrow(
      /breaker_armed/,
    );
  });

  test('armed FALSE below the threshold is refused, which is the dangerous direction', () => {
    // A CONSOLE THAT TOOK THE SENT FLAG WOULD SHOW A BREAKER DISARMED WHILE THE
    // RATIO IT PRINTS BESIDE IT IS UNDER 1.0. `liability.ts` computes the arming
    // from the ratio, so the two would disagree ON ONE SCREEN.
    const body = BODY();
    const reserve = body['reserve'] as Record<string, unknown>;
    reserve['reserve_cents'] = 4_000_000;
    reserve['rcr_bp'] = 8_000;
    expect(() => narrowLiabilityResponse(body)).toThrow(/breaker_armed/);

    reserve['breaker_armed'] = true;
    expect(narrowLiabilityResponse(body).reserve.rcr_bp).toBe(8_000);
  });
});

// =============================================================================
// M6-A-83. The projection, and the three members it refuses to invent
// =============================================================================

describe('M6-A-83: what the projection supplies, and what it will not', () => {
  const input = liabilityHomeInputFrom({ response: narrowLiabilityResponse(BODY()), ...CONTEXT });

  test('the snapshot renames on arrival, and the money is bigint cents', () => {
    expect(input.snapshot.withdrawableAcrossFundedCents).toBe(750_000n);
    expect(input.snapshot.walletBalancesCents).toBe(125_000n);
    expect(input.snapshot.boundedNearTermCents).toBe(500_000n);
    expect(input.snapshot.remainingLadderExposureCents).toBe(4_000_000n);
    expect(input.absorbedCorrectionsCents).toBe(-2_500n);
  });

  test('the third component is UNSUPPLIED, and undefined is not zero', () => {
    expect(input.snapshot.withdrawalsInFlight).toBeUndefined();

    // AND THE CONSEQUENCE IS THE ONE ADR-195 RULED: the component renders ABSENT
    // with its reason and the total says it is INCOMPLETE. A zero would say the
    // obligation was measured and found empty.
    const three = theThreeNumbers(input.snapshot);
    expect(three.openLiabilityComponents.withdrawalsInFlight.kind).toBe('absent');
    expect(readingIsPresent(three.openLiabilityComponents.withdrawable)).toBe(true);
    expect(readingIsPresent(three.openLiabilityComponents.wallet)).toBe(true);
    expect(readingIsPresent(three.openLiability)).toBe(true);
    expect(
      readingIsPresent(three.openLiability) ? three.openLiability.figure.definition : '',
    ).toContain('INCOMPLETE');
  });

  test('the total is the two supplied components and not a third invented one', () => {
    const three = theThreeNumbers(input.snapshot);
    expect(readingIsPresent(three.openLiability) ? three.openLiability.figure.cents : 0n).toBe(
      875_000n,
    );
  });

  test('eligibleNextSevenDays is UNSUPPLIED, because the wire carries the figure and no as-of', () => {
    // THE FIGURE IS ON THE BODY AND THE INSTANT IS NOT. Filling the as-of from
    // the top-level `as_of` would put the book's clock on a forecast from
    // DEP-M6-01's projection, which is the move `api/types.ts` argues against one
    // field down for `reserve`.
    expect(input.eligibleNextSevenDays).toBeUndefined();
    expect(narrowLiabilityResponse(BODY()).eligible_next_7d?.total_cents).toBe(300_000);
  });

  test('no trust signal is supplied, and the verdict is red on five missing', () => {
    expect(input.trustSignals).toEqual([]);

    const trust = assessDataTrust(input.trustSignals);
    expect(trust.verdict).toBe('red');
    expect(trust.missing).toHaveLength(5);

    // AND EVERY ONE OF THE FIVE NAMES AN OWNER, which is what makes a red board
    // built this way more useful than a green one built from two derived states.
    for (const gap of trust.missing) expect(gap.reason.trim()).not.toBe('');
  });

  test('the live figure is UNSUPPLIED and there is no field for it to come from', () => {
    expect(input.live).toBeUndefined();
    expect(Object.keys(narrowLiabilityResponse(BODY()))).not.toContain('live');
  });

  test('reserve coverage IS supplied, whole, on its own clock', () => {
    expect(input.reserveCoverage?.asOfInstant).toBe('2026-08-28T06:00:00.000Z');
    expect(input.reserveCoverage?.asOfInstant).not.toBe(input.snapshot.asOfInstant);
    expect(input.reserveCoverage?.reserveCents).toBe(6_000_000n);
    expect(input.reserveCoverage?.cvar99Cents).toBe(5_000_000n);
    expect(input.reserveCoverage?.rcrBp).toBe(12_000n);
    expect(input.reserveCoverage?.anchor.source).toBe('provider_api');
  });

  test('THE WHOLE PAGE BUILDS FROM ONE RESPONSE, and the bytes carry the figures', () => {
    // THE ACCEPTANCE CASE THAT MATTERS. Everything above asserts one member;
    // this asserts that the members together are a page `page.ts` accepts, which
    // is the claim "the screen is ready" reduces to.
    const page = buildLiabilityHome(input);
    const lines = renderLiabilityHome(page).join('\n');

    expect(lines).toContain(formatCents(875_000n));
    expect(lines).toContain(formatCents(500_000n));
    expect(lines).toContain(formatCents(4_000_000n));
    expect(lines).toContain('2026-08-28T06:00:00.000Z');

    // AND THE PANEL SAYS SO IN THE BYTES. Session 364 landmine 2: an unsupplied
    // third term defaulted to zero is a confident wrong answer with a source
    // citation attached. A seed that supplied `0n` here turned exactly ONE case
    // red before this line, and the one it turned red was two functions away
    // from the page an operator reads.
    expect(lines).toContain('INCOMPLETE');
    expect(lines).toContain('THE THIRD COMPONENT IS UNSUPPLIED ON THIS ROW');

    // P-M6-09 IS RED AND EVERY FIGURE BELOW SAYS SO IN THE LINE. FM-M6-01: the
    // page must refuse to look healthy while data trust is red, and it is red
    // here because three of the five inputs have no supplier at all.
    expect(page.dataTrust.verdict).toBe('red');
    expect(lines).toContain('SUSPECT');
  });

  test('a role that may not read this page is refused at the page and not here', () => {
    // THE PROJECTION TAKES A ROLE AS A STRING AND DOES NOT CHECK IT, which is
    // `roles.ts`'s decision and not a hole: `requireAdminRole` and
    // `mayReadLiabilityHome` are one function call away and a second copy of a
    // closed role set is a second answer to what an admin role is.
    const projected = liabilityHomeInputFrom({
      response: narrowLiabilityResponse(BODY()),
      ...CONTEXT,
      role: 'auditor',
    });
    expect(projected.role).toBe('auditor');
    expect(() => buildLiabilityHome(projected)).toThrow();
  });
});

// =============================================================================
// M6-A-84. The seam, and its three arms
// =============================================================================

describe('M6-A-84: readLiabilityHome answers three ways and never throws', () => {
  test('a body that narrows is `supplied`', () => {
    const read = readLiabilityHome({ ok: true, body: BODY() }, CONTEXT);
    expect(read.kind).toBe('supplied');
    expect(read.kind === 'supplied' ? read.input.snapshot.walletBalancesCents : 0n).toBe(125_000n);
  });

  test('an API failure is `failed`, and it carries the status it was derived from', () => {
    // THE STATUS THIS CONSOLE WOULD ACTUALLY RECEIVE TODAY. ADR-190 measured
    // `GET /admin/liability` answering 401 with no admin session cookie, and
    // nothing in this repository can mint one.
    const failure: AdminApiResult = { ok: false, error: 'unauthenticated', status: 401 };
    const read = readLiabilityHome(failure, CONTEXT);
    expect(read).toEqual({ kind: 'failed', error: 'unauthenticated', status: 401 });
  });

  test('a transport failure keeps its null status, so "nothing answered" stays distinguishable', () => {
    const read = readLiabilityHome({ ok: false, error: 'server_error', status: null }, CONTEXT);
    expect(read).toEqual({ kind: 'failed', error: 'server_error', status: null });
  });

  test('a 200 carrying a body this console refuses is `refused` and NOT `failed`', () => {
    // THE ARM A TWO-ARM UNION LOSES. Collapsing it into `failed` would tell an
    // operator the console cannot reach a service it just reached.
    const body = BODY();
    delete body['open_liability_cents'];
    const read = readLiabilityHome({ ok: true, body }, CONTEXT);
    expect(read.kind).toBe('refused');
    expect(read.kind === 'refused' ? read.reason : '').toMatch(/open_liability_cents/);
  });

  test('a bare null on a 200 is `refused` with ADR-203`s reason, and never rendered as a zero', () => {
    const read = readLiabilityHome(
      { ok: true, body: bodyWith(['payout_velocity'], null) },
      CONTEXT,
    );
    expect(read.kind).toBe('refused');
    expect(read.kind === 'refused' ? read.reason : '').toMatch(/indistinguishable zero/);
  });

  test('the seam never throws, on any of the shapes above', () => {
    for (const result of [
      { ok: true as const, body: BODY() },
      { ok: true as const, body: null },
      { ok: true as const, body: 'not json we asked for' },
      { ok: false as const, error: 'forbidden' as const, status: 403 },
    ])
      expect(() => readLiabilityHome(result, CONTEXT)).not.toThrow();
  });

  test('the path is the contract`s, with an operator prefix and no API base', () => {
    expect(ADMIN_LIABILITY_PATH).toBe('/admin/liability');
    expect(ADMIN_LIABILITY_PATH.startsWith('/admin/')).toBe(true);
    expect(ADMIN_LIABILITY_PATH).not.toContain('/api/v1');
  });
});

// =============================================================================
// M6-A-85. Every reason this module states is BOUND to the thing it describes
// =============================================================================
// SESSION 364's LANDMINE 5, APPLIED BEFORE THE FACT: "a reason is a claim and
// claims go stale silently". Each case below reads the file whose content the
// reason asserts, so the sentence fails when the thing it describes moves.

describe('M6-A-85: the dropped-field list and the trust gap are read from the wire', () => {
  const wireTypes = readFileSync(join(import.meta.dirname, '..', 'src', 'api', 'types.ts'), 'utf8');

  test('every field the projection drops is still DECLARED on the response', () => {
    // A LIST OF DROPPED FIELDS THAT NAMES A FIELD THE WIRE NO LONGER CARRIES IS
    // WORSE THAN NO LIST: a reader chasing it finds nothing and concludes the
    // projection is complete.
    for (const entry of WIRE_FIELDS_THIS_PAGE_DOES_NOT_READ) {
      const leaf = entry.field.split('.').pop() ?? '';
      expect(wireTypes, `${entry.field} is dropped and api/types.ts does not declare it`).toContain(
        `readonly ${leaf.replace('[]', '')}`,
      );
      expect(entry.reason.trim().length).toBeGreaterThan(40);
    }
  });

  test('BOTH nullable sites on the response are in the dropped list', () => {
    // THE MEASUREMENT THE HEADER STATES. ADR-203's `gaps` mechanism is total and
    // has no figure on THIS page to speak about, because both of the figures it
    // can explain belong to panels `page.ts` holds in `PENDING`.
    const dropped = WIRE_FIELDS_THIS_PAGE_DOES_NOT_READ.map((entry) => entry.field);
    expect(dropped).toContain('payout_velocity');
    expect(dropped).toContain('per_plan');
  });

  test('the two trust inputs are carried as figures and NEITHER carries a state', () => {
    for (const entry of TRUST_INPUTS_CARRIED_WITHOUT_A_STATE) {
      const leaf = entry.field.split('.').pop() ?? '';
      expect(wireTypes, `${entry.field} is claimed on the response`).toContain(`readonly ${leaf}`);
      expect(entry.boundaryNobodyRuled.trim().length).toBeGreaterThan(40);
    }

    // AND THE CLAIM THAT MAKES THEM UNUSABLE: no `state` field anywhere in the
    // `integrations` group. A response that grew one would make this case fail,
    // which is the day the reason above should be deleted.
    const group = /readonly integrations: \{[\s\S]*?\n {2}\};/.exec(wireTypes);
    expect(group, 'api/types.ts declares an integrations group').not.toBeNull();
    expect(group?.[0]).not.toContain('state');
  });

  test('`readLiability` is still not composed, which is why the screen renders and the source does not', () => {
    // THE ONE CLAIM THIS MODULE MAKES ABOUT ANOTHER PACKAGE, DERIVED AT THE
    // MOMENT OF RUNNING RATHER THAN QUOTED FROM A DISPATCH.
    const source = readFileSync(
      join(import.meta.dirname, '..', '..', 'api', 'src', 'admin-source', 'index.ts'),
      'utf8',
    );
    const declared = /export const IMPLEMENTED_ADMIN_READS = \[([\s\S]*?)\] as const/.exec(source);
    expect(declared, 'admin-source/index.ts declares IMPLEMENTED_ADMIN_READS').not.toBeNull();
    const names = [...(declared?.[1] ?? '').matchAll(/'([A-Za-z]+)'/g)].map((match) => match[1]);
    expect(names).not.toContain('readLiability');
    expect(names).toHaveLength(5);
  });
});
