// =============================================================================
// apps/portal/src/api/types.ts
// =============================================================================
// THE WIRE SHAPES THIS APP READS, TRANSCRIBED AND NOT DESIGNED. M04 section 4:
// "M4 owns no endpoint. It consumes API_CONTRACT sections 3, 5, 6, and 7
// verbatim, and adds no field to any of them." So every type below is a copy of
// a declaration in docs/architecture/API_CONTRACT.md and the only edits are
// `readonly` and comments. A field that is not in the contract is not in this
// file, and adding one here is how the portal starts believing in data the
// server does not send.
//
// ONLY THE READ ENDPOINTS ARE HERE, AND THE ABSENCES ARE THE SESSION FENCE.
// This session builds M04's read surfaces: the account views, the marks, the
// timeline, the eligibility display and the economic-calendar panel. There is
// deliberately no `Me`, no auth type, no payout request body and no
// sensitive-action declaration, because C-27's authority boundary is auth and
// therefore money path (CLAUDE.md's regime table, ADR-003), and it gets its own
// session. A read-only app that transcribed the auth types anyway would look
// like it had started on them.
//
// WHY THE MONEY FIELDS SAY `number` HERE AND `bigint` IN THE ENGINE.
// M01 INV-02 is "all money is `bigint` integer cents at every boundary", and
// packages/rules-engine/src/types.ts declares `type Cents = bigint`.
// API_CONTRACT declares these same quantities as `number`, because the wire is
// JSON and JSON has one number type. Both statements are in approved documents
// and the portal is the first consumer to stand between them.
//
// THE PORTAL DOES NOT RESOLVE THAT DISAGREEMENT, IT ROUTES AROUND IT. This app
// performs no arithmetic on money at all (INV-M4-01), so the width of the
// integer never matters to it: the single permitted consumer of any `_cents` or
// `_bp` field is `formatCents`/`formatBasisPoints` in ../format/money.ts, and
// those accept `number | bigint` and refuse a value that is not an exact
// integer. When the transport moves to `bigint`, nothing in this app changes.
// The disagreement itself is recorded for the founder rather than settled by a
// session: see docs/sessions/2026-08-21-session-111.md.

// -----------------------------------------------------------------------------
// Section 6. Accounts
// -----------------------------------------------------------------------------

/** `GET /accounts`. API_CONTRACT section 6. */
export type AccountListItem = {
  readonly account_id: string;
  readonly plan: {
    readonly plan_id: string;
    readonly code: string;
    readonly name: string;
    readonly version: number;
  };
  readonly size_cents: number;
  readonly phase: 'eval' | 'funded' | 'closed' | 'graduated';
  readonly status:
    | 'provisioning_pending'
    | 'active'
    | 'breached'
    | 'expired'
    | 'closed_admin'
    | 'closed_chargeback'
    | 'graduated';
  readonly balance_cents: number;
  readonly floor_cents: number;

  /**
   * `balance - floor`, THE NUMBER TRADERS ACTUALLY WATCH, and the server's own
   * subtraction. SC-M4-02's "one thing it must get right". The portal reads
   * this field and never computes it from the two above it, which is INV-M4-01
   * at the one place the subtraction is most obviously harmless.
   */
  readonly floor_distance_cents: number;
  readonly withdrawable_cents: number;

  /** The last closed day. Every number above is as of this date. INV-M4-02. */
  readonly as_of_trading_day: string;
  readonly blocked: {
    readonly payouts_frozen: boolean;
    readonly recon_blocked: boolean;
    readonly kyc_required: boolean;
  };
};

/** `GET /accounts/:accountId`. The dashboard card, computed server side. */
export type AccountDetail = AccountListItem & {
  readonly platform: 'rithmic' | 'tradovate' | 'cqg';
  readonly platform_account_ref: string | null;
  readonly front_end_permissions: readonly string[];
  readonly opened_on: string;
  readonly funded_on: string | null;
  readonly closed_on: string | null;
  readonly close_reason: string | null;

  /**
   * "A projection to display, never an input to a client-side decision"
   * (M04 section 4). Nothing in this app branches on a `progress` number to
   * decide whether an action is permitted; that is the server's answer and it
   * arrives on the eligibility endpoint.
   */
  readonly progress: {
    readonly profit_target_cents: number | null;
    readonly profit_cents: number | null;
    readonly buffer_cents: number | null;
    readonly buffer_progress_cents: number | null;
    readonly win_days: {
      readonly have: number;
      readonly need: number;
      readonly floor_cents: number;
    };
    readonly traded_days: { readonly have: number; readonly need: number };
    readonly consistency: {
      readonly best_day_share_bp: number | null;
      readonly max_bp: number | null;
      readonly skipped: boolean;
    };
    readonly cadence: {
      readonly days_since_last_payout: number | null;
      readonly need: number;

      /** Rendered as a DATE. EC-046: a count of trading days is a rule a trader cannot evaluate. */
      readonly next_eligible_trading_day: string | null;
    };
    readonly ladder: { readonly payouts_settled: number; readonly payouts_to_graduate: number };
  };

  /** The account's PINNED plan version, rendered. Never the current one. */
  readonly rules_url: string;
};

/** `GET /accounts/:accountId/marks`. Cursor paginated by `trading_day` descending. */
export type MarkListItem = {
  readonly trading_day: string;
  readonly opening_balance_cents: number;
  readonly closing_balance_cents: number;
  readonly high_balance_cents: number;
  readonly low_balance_cents: number;
  readonly realized_pnl_cents: number;
  readonly traded_day: boolean;
  readonly win_day: boolean;
  readonly floor_cents: number;
  readonly withdrawable_cents: number;

  /** True when this day has a superseding mark. FM-M4-01's chart half. */
  readonly corrected: boolean;
};

/** `GET /accounts/:accountId/timeline`. Trader-safe projection of EVENTS. */
export type TimelineItem = {
  readonly occurred_at: string;
  readonly trading_day: string | null;

  /** `event_name`, trader-safe subset only. The subsetting is the server's. */
  readonly kind: string;

  /** Rendered from the payload by the server, never raw internals. */
  readonly summary: string;
  readonly detail: Readonly<Record<string, number | string | boolean | null>>;
};

/** One gate's report. Every gate carries `pass`; the rest of the shape is per gate. */
export type EligibilityGates = {
  readonly account_active: { readonly pass: boolean };
  readonly kyc_verified: { readonly pass: boolean; readonly state: string };
  readonly not_frozen: { readonly pass: boolean; readonly reason: string | null };
  readonly recon_clear: { readonly pass: boolean };
  readonly traded_days: { readonly pass: boolean; readonly have: number; readonly need: number };
  readonly win_days: {
    readonly pass: boolean;
    readonly have: number;
    readonly need: number;
    readonly floor_cents: number;
  };
  readonly buffer: {
    readonly pass: boolean;
    readonly have_cents: number;
    readonly need_cents: number;
  };
  readonly consistency: {
    readonly pass: boolean;

    /** INV-M4-05. A skipped gate renders DISABLED, never as satisfied. EC-050. */
    readonly skipped: boolean;
    readonly best_day_share_bp: number | null;
    readonly max_bp: number | null;
    readonly profit_needed_to_dilute_cents: number | null;
  };
  readonly cadence_gap: {
    readonly pass: boolean;
    readonly days_since_last_payout: number | null;
    readonly need: number;
    readonly next_eligible_trading_day: string | null;
  };
  readonly minimum_amount: {
    readonly pass: boolean;
    readonly withdrawable_cents: number;
    readonly min_payout_cents: number;
  };
};

/** `GET /accounts/:accountId/eligibility`. The gate-by-gate breakdown. */
export type EligibilityResponse = {
  readonly account_id: string;
  readonly as_of_trading_day: string;

  /** THE SERVER'S ANSWER. INV-M4-03: no client-side gate evaluation exists. */
  readonly eligible: boolean;

  /** `min(withdrawable, cap)` after clamp, 0 when not eligible. */
  readonly max_payout_cents: number;
  readonly min_payout_cents: number;
  readonly gates: EligibilityGates;
  readonly cap: {
    readonly cap_cents: number;
    readonly ordinal: number;
    readonly schedule_note: string;
  };
};

// -----------------------------------------------------------------------------
// The economic-calendar panel (M04 section 3.8, ADR-066, GS-285)
// -----------------------------------------------------------------------------
// THIS ONE IS NOT A TRANSCRIPTION AND SAYING SO IS THE POINT. `grep
// economic_calendar docs/architecture/API_CONTRACT.md` returns nothing: the
// panel's contract row has not been written. M04 section 4 records that the
// rows for surfaces added by a fold "land with API_CONTRACT in the registries
// session, not here", and DEP-M4-09 states the obligation the row must carry:
// "the portal is served the current revision plus the calendar's freshness".
//
// So the shape below is the MINIMUM that discharges DEP-M4-09, named after the
// columns it reads rather than invented: every field is a column on
// `economic_calendar` as declared in packages/db/migrations/0039_economic_
// calendar.sql, read through the `economic_calendar_current` view, plus the
// coverage fact from `economic_calendar_loads`. When the contract row lands,
// this type is the thing to reconcile against it, and the reconciliation is a
// diff on one file rather than a search.

/**
 * One occurrence at its current revision, from `economic_calendar_current`.
 *
 * THERE IS NO TIMEZONE FIELD AND THERE MUST NEVER BE ONE. 0039's header item 4:
 * the table stores one UTC instant and the trader's timezone is a rendering
 * concern. GS-285 is exactly the assertion that one row renders correctly on
 * two dashboards in two timezones, so a timezone here would be the second
 * answer to "when was the news" that FM-M7-08 guards, arrived at from inside
 * the building.
 */
export type EconomicCalendarOccurrence = {
  readonly event_key: string;
  readonly occurrence_key: string;

  /**
   * 1 through 3. A COLUMN AND NOT AN IMPORT FILTER (0039 header item 3), which
   * is what lets the panel ask for Tier-1 as a query instead of trusting that
   * only Tier-1 was ever loaded.
   */
  readonly tier: number;

  /** The one stored UTC instant. Converted per trader at the point of display. */
  readonly scheduled_release_at: string;

  /** The exchange-session day the release falls in. Stored, never derived (0039 header item 5). */
  readonly release_trading_day: string;

  /** A revision is a ROW, not an update (0039 header item 1). `> 0` means this time moved. */
  readonly revision: number;
  readonly revision_reason: string | null;
};

/**
 * The coverage fact from `economic_calendar_loads`, which is the staleness
 * clock. DEP-M4-09: "the dangerous failure is not the empty panel, it is the
 * confident one." Without this, an uncovered week and a quiet week produce the
 * same empty list and mean opposite things.
 */
export type EconomicCalendarFreshness = {
  /** The server's answer, evaluated against its own threshold. The portal reads it. */
  readonly stale: boolean;

  /** The last day any load covers, or null when nothing has ever been loaded. */
  readonly covered_through_day: string | null;
};

/** What the dashboard panel is served. Section 3.8, DEP-M4-09. */
export type EconomicCalendarPanelResponse = {
  readonly freshness: EconomicCalendarFreshness;
  readonly occurrences: readonly EconomicCalendarOccurrence[];
};

// -----------------------------------------------------------------------------
// The impersonation session (ADR-068, M04 section 3.9)
// -----------------------------------------------------------------------------
// EVERY FIELD IS A COLUMN ON `impersonation_sessions`, and M04 section 3.9 says
// why in those words: the banner renders columns "rather than a string the
// portal composes". This type is the server's resolution of the session that
// served the request, so a hard refresh and a deep link both produce it and
// neither depends on client state.

/** The impersonation session the server resolved, or its absence. */
export type ImpersonationSession = {
  /** `admin_user_id`. An operator on a shared machine sees whose session this is. */
  readonly admin_user_id: string;

  /** `subject_identity_id`. The wrong subject is the mistake the banner exists to surface. */
  readonly subject_identity_id: string;

  /** Closed vocabulary, `NOT NULL`. ADR-068 requirement 5. */
  readonly reason_code: string;

  /** `NOT NULL` and non-blank, so there is always something true to render. */
  readonly reason_detail: string;

  /**
   * The box. Rendered as the server declared it and never authoritative:
   * IMPERSONATION-C2 makes a page view outside the box unwritable, so a request
   * served late fails when it tries to record itself. M04 section 3.9.
   */
  readonly expires_at: string;
};
