// =============================================================================
// apps/portal/src/app/payouts/wire.ts
// =============================================================================
// `GET /payouts`, TRANSCRIBED AND NOT DESIGNED, AND IT IS HERE RATHER THAN IN
// ../../api/types.ts FOR A FENCE REASON THAT IS WORTH STATING.
//
// ../../api/types.ts is the app's transcription of API_CONTRACT sections 3, 5,
// 6 and 7, and it holds every read shape this application consumes. It does
// NOT hold `PayoutListItem`, and its own header says why: the payout surface
// was left to the session that builds it. Session 252 is writing
// `GET /payouts` and `POST /accounts/:id/payout` concurrently with this one,
// so a type added to that file now is a merge conflict on a money-path
// contract, which is the one place in this tree where a conflict resolved by
// whoever pushes second is expensive.
//
// SO THE TYPES LIVE INSIDE THIS SEGMENT AND THE MOVE IS OWED. When 252 lands,
// these declarations are reconciled against its response shape and moved into
// ../../api/types.ts beside the other nine, and this file is deleted. That is
// recorded here rather than in a plan because this is the file the next author
// opens. It is the same treatment `EconomicCalendarOccurrence` got before
// ADR-111 wrote its contract row, and that reconciliation came back a no-op.
//
// EVERY FIELD BELOW IS A LINE IN docs/architecture/API_CONTRACT.md's
// `GET /payouts` BLOCK. Nothing is added, nothing is widened, and the two
// comments the contract itself carries on `approved_at` and on `hold` are
// carried with the fields they annotate because both of them are the shape of
// a state rather than a note about it.

/**
 * The five states a payout request can be in on the wire.
 *
 * `transferring` IS NOT A MEMBER AND MUST NEVER BE ONE. API_CONTRACT records
 * that this union typed `transferring` and not `held_pending_review` until
 * ADR-040, and that the value "left `payout_requests` on 2026-08-14 and is
 * owned by `wallet_withdrawals`". A client written against the old union "would
 * have had a branch that never fires and no branch for the state that does",
 * and this application is that client.
 *
 * THERE IS NO DENIAL VALUE AND THAT IS THE ZERO-DENIAL POLICY IN THE TYPE.
 * `failed` is a transfer that did not land, which M04 section 5 requires to
 * carry "a truthful note and a visible retry". It is not a refusal.
 */
export type PayoutStatus = 'approved' | 'held_pending_review' | 'settled' | 'failed' | 'frozen';

/**
 * The hold, present only when the status is `held_pending_review`.
 *
 * `resolves_by` IS REQUIRED IN THE RESPONSE AND IS NOT OPTIONAL, on
 * API_CONTRACT's own line and M05 section 3.4's reason: "a review the trader
 * cannot see the end of is indistinguishable from a refusal". The trader is
 * shown the fact, the ToS clause and the date it resolves, never the evidence
 * and never the detector.
 *
 * IT IS A STRING AND IS NOT PARSED HERE, for ../../view/as-of.ts's reason one
 * layer along: the portal owns no calendar, and `docs/decisions/ADR-042.md`
 * rules that Merit quotes a wall-clock deadline rather than computing one. The
 * ESLint rule `merit/no-calendar-in-expiry-path` is scoped to
 * `apps/**` + `/payouts/**` + `/*.ts` in eslint.config.js, so this file is
 * inside the glob that enforces it.
 */
export type PayoutHold = {
  readonly held_at: string;

  /** `hold_expires_at`. The date, always. */
  readonly resolves_by: string;
  readonly tos_clause: string;
};

/** One state transition, as the server composed it. */
export type PayoutTimelineEntry = {
  readonly state: string;
  readonly at: string;
};

/** `GET /payouts`. API_CONTRACT section 6. */
export type PayoutListItem = {
  readonly payout_request_id: string;
  readonly account_id: string;
  readonly approved_cents: number;
  readonly trader_cents: number;
  readonly status: PayoutStatus;

  /**
   * NULL WHILE HELD, BECAUSE THE HOLD IS PRE-APPROVAL.
   *
   * API_CONTRACT: "a client that types it as non-null will render an epoch date
   * or crash on the one state that most needs to render correctly". This app
   * renders the absence as an absence and never as a zero, which is
   * ../../format/money.ts's `formatOptionalCents` argument applied to a date.
   */
  readonly approved_at: string | null;
  readonly settled_at: string | null;
  readonly hold: PayoutHold | null;
  readonly timeline: readonly PayoutTimelineEntry[];

  /** Honest, trader-readable, and the server's own sentence. */
  readonly failure_note: string | null;
};
