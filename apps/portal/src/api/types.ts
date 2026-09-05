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
// The account views, the marks, the timeline, the eligibility display, the
// economic-calendar panel, and (P4-h) the pinned plan version, the purchase
// list, the certificate, the KYC status and the affiliate stats, and now
// (SC-M4-10, SC-M4-11) the wallet and the active-session list.
//
// THIS PARAGRAPH READ "there is deliberately no `Me`, NO AUTH TYPE, no payout
// request body and no sensitive-action declaration ... it gets its own session",
// AND THIS IS THAT SESSION, SO THE SENTENCE IS NARROWED RATHER THAN DELETED.
// What it was protecting is the WRITE half of C-27, and every part of that half
// is still absent: no `Me`, no elevation ceremony, no OTP body, no passkey
// challenge, no payout request body, no withdrawal body, and no
// sensitive-action declaration. `SessionRow` and `AuthFactor` are the two READ
// shapes SC-M4-11 renders, and API_CONTRACT section 3.1 rules them reads in
// their own line -- `GET /sessions` "is a read and takes any single factor,
// deliberately", because "a session you cannot see is one you cannot revoke, and
// requiring elevation to look would lock a compromised account's real owner out
// of the one screen that helps them". A screen that could not be typed could not
// be built, and the surface AS-M4-05 has been owed since it was approved would
// have stayed homeless to keep a sentence true that was never about it.
//
// EVERY TYPE IN THIS FILE IS NOW A TRANSCRIPTION AGAIN, WHICH IT WAS NOT.
// `EconomicCalendarPanelResponse` and `ImpersonationSession` were shaped from
// the migrations they read because no contract row existed for either, and both
// said so at the point of declaration. ADR-111 wrote the rows: the panel is
// API_CONTRACT section 6.1 and the impersonation session is section 3.2. The
// reconciliation those headers asked for was run and came back a NO-OP, field
// for field, which is the outcome a shape derived from the same columns should
// produce and is worth stating because it is not the outcome anybody was owed.
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
// Section 1. Conventions. THE LIST ENVELOPE, WHICH THIS FILE DID NOT HAVE
// -----------------------------------------------------------------------------
// API_CONTRACT section 1, one sentence, and it governs every list on this
// surface: "Cursor only, never offset: `?limit=50&cursor=<opaque>`. Responses
// carry `{ data, next_cursor }`. `limit` maximum 100, default 25."
//
// THIS FILE DECLARED THE ITEMS AND NEVER THE ENVELOPE, AND TWO SEGMENTS HAVE
// NOW PAID FOR IT. `apps/portal/src/app/accounts/source.ts` refused to wire
// `GET /accounts/:accountId/marks` an hour before this was written and gave the
// absence as one of its two reasons: "`../../api/types.ts` declares
// `MarkListItem` and NO envelope type at all, and that file is the
// transcription of the contract and is outside this segment." The calendar
// segment reaches the same wall on `GET /accounts/:accountId/timeline`, whose
// server type is `TimelinePage` in `apps/api/src/routes/account-reads.ts` and
// whose portal type was an unenveloped `TimelineItem[]`.
//
// SO IT IS TRANSCRIBED HERE ONCE RATHER THAN INVENTED PER SEGMENT. It is a
// convention rather than an endpoint, so it is generic: the contract writes the
// pair out longhand per response (`WalletEntriesResponse`,
// `CertificateListResponse`) and section 1 is the rule those two are instances
// of. A per-endpoint alias for each would be six copies of one shape, and the
// sixth is the one that disagrees.
//
// THE ITEM TYPE IS NOT CONSTRAINED AND `data` IS NOT OPTIONAL. Section 1 states
// the envelope unconditionally, so a list response that omits `next_cursor` is
// a server that answered wrongly rather than a shape this file should admit.
// `GET /plans` is the one documented departure -- `PlansResponse` declares
// `data` and no cursor, on the contract's own ground that "the catalogue is
// three rows" -- and it is a different type rather than this one with an
// optional field, because an optional cursor makes "there may be more" and "the
// endpoint does not page" the same value.

/**
 * Section 1's list envelope. `{ data, next_cursor }`, cursor only, never offset.
 *
 * `next_cursor` IS `string | null` AND THE `null` IS THE END OF THE LIST. It is
 * `<opaque>` in the contract's words, which binds the CLIENT: nothing in this
 * application may construct one, parse one, or read a meaning out of one. The
 * portal's only legitimate use of it is the boolean "is there more", and
 * `app/calendar/load.ts` argues what a screen does with that answer.
 */
export type CursorPage<T> = {
  readonly data: readonly T[];
  readonly next_cursor: string | null;
};

/** Section 1's stated bounds, as the contract's own numbers. */
export const PAGE_LIMIT_DEFAULT = 25;
export const PAGE_LIMIT_MAX = 100;

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
// THIS ONE WAS NOT A TRANSCRIPTION AND NOW IT IS. `grep economic_calendar
// docs/architecture/API_CONTRACT.md` returned nothing when this type was
// written, so the shape below was the MINIMUM that discharges DEP-M4-09, named
// after the columns it reads rather than invented: every field is a column on
// `economic_calendar` as declared in packages/db/migrations/0039_economic_
// calendar.sql, read through the `economic_calendar_current` view, plus the
// coverage fact from `economic_calendar_loads`.
//
// ADR-111 WROTE THE ROW AS API_CONTRACT SECTION 6.1, `GET /economic-calendar`,
// `Auth: session`, and this file's own instruction was followed: "when the
// contract row lands, this type is the thing to reconcile against it". It was
// reconciled and NOTHING MOVED. The contract row took this shape rather than
// the other way round, which is only defensible because the shape was derived
// from the DDL the endpoint will read, and the ADR says so rather than
// presenting the agreement as independent corroboration.

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
//
// ADR-111 DECLARED IT AS API_CONTRACT SECTION 3.2 AND DID NOT GIVE IT AN
// ENDPOINT, WHICH IS THE ONE THING TO KNOW BEFORE READING THIS TYPE AS SETTLED.
// The carrier is `Me.impersonation` on `GET /me`, so the banner and the session
// it describes arrive on one response and cannot disagree by the width of a
// request; a dedicated read would be a second session resolution and would
// reintroduce GS-301. `GET /me` is the auth surface's and P4 section 6 puts
// auth in no phase's contents, so the member is NOT declared yet and this type
// is a shape waiting for its field.

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

// -----------------------------------------------------------------------------
// Section 4. Catalog. The PINNED plan version a rules page and a rule diff read
// -----------------------------------------------------------------------------
// `GET /plans/:planId/versions/:version` is public and returns "the full rules
// object plus published copy, INCLUDING FOR RETIRED VERSIONS, so a trader can
// always retrieve the contract they bought". That last clause is why the rules
// page reads this endpoint and not `GET /plans`: M04 section 4's obligation is
// "the rules page for an account reads the pinned version, not the current one",
// and the current one is a different contract with the same plan's name on it.

/** One JSON value, for the one field the contract declares as opaque JSON. */
export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * `plan_versions.rules`. OPAQUE ON PURPOSE, AND THE OPACITY IS THE CONTROL.
 *
 * API_CONTRACT declares this field as `PlanRules`, "exact JSON from DATA_MODEL
 * §11", and §11 is a jsonc example rather than a TypeScript declaration. So a
 * portal type enumerating its keys would be a SECOND COPY OF THE RULE SCHEMA,
 * maintained here.
 *
 * THIS COMMENT READ "against a zod validator that lives at the write boundary"
 * AND THAT WAS FALSE ABOUT THIS TREE. ADR-225 is the finding and the ruling:
 * `zod` is a dependency of no `package.json` in this workspace, no file under
 * `apps/**` or `packages/**` imports it, and after `pnpm install
 * --frozen-lockfile` a resolve of `zod` from `apps/portal/src` fails
 * `MODULE_NOT_FOUND`. This was the ONE citation of the five that ASSERTED the
 * validator rather than quoting a document that names it.
 *
 * THE REFUSAL IS UNCHANGED AND THE REPAIRED REASON IS STRONGER THAN THE ONE IT
 * REPLACES. What stands at that boundary is `validatePlan`, hand-written, in
 * `packages/rules-engine/src/plan/validate.ts`, reached through
 * `AdminWriteBackend` at `POST /admin/plans/versions/:versionId/publish`. It is
 * `CV-01` to `CV-19` over NAMED keys: it enumerates no key set and refuses
 * nothing for being unknown, and the draft INSERT one route earlier checks only
 * that `rules` is a JSON object. So the rules object can carry a key that no
 * validator anywhere names, and a typed portal walk would drop exactly that key.
 *
 * THE FAILURE THAT COPY PRODUCES IS THE WORST ONE AVAILABLE ON THIS SURFACE.
 * The rule diff (SC-M4-06) walks two of these and reports where they differ. A
 * typed walk can only compare keys the type knows, so the day a rule gains a
 * key, the diff renders "nothing changed" about a contract that changed. An
 * omission that reads as a positive claim is exactly what INV-M4-05 refuses one
 * level down, and here it would be a positive claim about a repurchase.
 *
 * So the portal treats the rule contract as data it renders and never as a
 * shape it knows, which is also M04 section 1.2's boundary line: "the portal
 * does not know a plan's rules at all".
 */
export type PlanRules = Readonly<Record<string, JsonValue>>;

/** One size row of a plan version. API_CONTRACT section 4, `GET /plans`. */
export type PlanSize = {
  readonly size_cents: number;
  readonly price_cents: number;
  readonly reset_price_cents: number;
  readonly drawdown_cents: number;
  readonly profit_target_cents: number | null;
  readonly buffer_cents: number;
  readonly win_day_floor_cents: number;
  readonly payout_cap_cents: number;
  readonly min_payout_cents: number;
};

/** `GET /plans/:planId/versions/:version`. API_CONTRACT section 4. */
export type PlanVersionResponse = {
  readonly plan_version_id: string;
  readonly plan_id: string;
  readonly version: number;

  /** A retired version is still served, which is the whole point of the row. */
  readonly status: 'published' | 'retired';
  readonly published_at: string;
  readonly retired_at: string | null;

  /** The full config. Opaque here; see {@link PlanRules}. */
  readonly rules: PlanRules;

  /** Published rule text keyed by rule path. INV-M4-08's only legal source. */
  readonly copy_blocks: Readonly<Record<string, string>>;
  readonly sizes: readonly PlanSize[];
};

// -----------------------------------------------------------------------------
// Section 5. Commerce, READ ONLY
// -----------------------------------------------------------------------------
// `GET /purchases` and nothing else from this section. `POST /checkout` and
// `POST /accounts/:accountId/reset` are writes and are not here, and neither is
// `rule_diff_acknowledged_at`: SD-M4-02 put the column on `purchases` at
// 0006:173 and no contract row exposes it, so the portal renders the diff and
// captures nothing. ADR-111 section 5 records that seam rather than closing it.

/** `GET /purchases`. Cursor list of the caller's purchases. */
export type PurchaseListItem = {
  readonly purchase_id: string;
  readonly created_at: string;

  /** A reset is a repurchase onto a breached or expired account. */
  readonly kind: 'new' | 'reset';
  readonly plan: {
    readonly plan_id: string;
    readonly code: string;
    readonly version: number;
  };
  readonly size_cents: number;
  readonly amount_paid_cents: number;
  readonly discount_cents: number;
  readonly status: 'pending' | 'paid' | 'failed' | 'refunded' | 'charged_back';

  /** Null until the purchase provisions an account. */
  readonly account_id: string | null;
};

// -----------------------------------------------------------------------------
// Section 6. The certificate
// -----------------------------------------------------------------------------

/** `GET /accounts/:accountId/certificate`, `kind=pass|payout`. Section 6. */
export type CertificateResponse = {
  readonly certificate_id: string;
  readonly kind: 'pass' | 'payout';

  /** Signed and time limited. A RENDERING, and never the authority (AS-M4-03). */
  readonly image_url: string;

  /** The public verification page. THE AUTHORITY, and the reason a card is worth anything. */
  readonly verify_url: string;
  readonly issued_at: string;

  /**
   * "Claims are minimal by construction: no identity, no email, no cumulative
   * totals" (AS-M4-03). The smaller the claim, the less there is to forge
   * usefully, so the absence of a field here is a control and not an oversight.
   */
  readonly claims: {
    readonly plan_code: string;
    readonly size_cents: number;

    /** Payout cards only. A pass card claims no amount. */
    readonly amount_cents?: number;
    readonly trading_day: string;
  };
};

// -----------------------------------------------------------------------------
// Section 7. KYC and affiliate, READ ONLY
// -----------------------------------------------------------------------------
// `POST /kyc/session` and `POST /affiliate/links` are writes and are not here.

/** `GET /kyc/status`. Section 7. Every field is declared as the contract declares it. */
export type KycStatus = {
  /**
   * DECLARED AS AN OPEN `string` BY THE CONTRACT, AND THE VOCABULARY IS
   * `kyc_status` AT 0001:29: `kyc_required`, `pending`, `verified`, `rejected`,
   * `expired`. FIVE, where M04:86 says SC-M4-07 shows "four honest states".
   * The view handles all five and refuses an unknown one loudly rather than
   * rendering a blank; ADR-111 section 7 records the discrepancy and does not
   * rule it, because amending an approved plan needs its own ADR.
   */
  readonly state: string;

  /** Which trigger this verification was raised by. ADR-021's set, not a scalar. */
  readonly placement: string;
  readonly verified_at: string | null;
  readonly expires_at: string | null;

  /**
   * What the trader does next, IN THE SERVER'S WORDS. M04 section 7.9 binds the
   * vocabulary of this string and the view enforces it: no trader-facing
   * verification string contains "fraud", "suspicious", "risk", "flagged" or
   * "review", and "decisions are final" may not appear in any string this
   * module renders.
   */
  readonly action_required: string | null;
};

/** `GET /affiliate/stats`. Section 7. M08's trader-facing surface. */
export type AffiliateStats = {
  readonly code: string;
  readonly commission_bp: number;
  readonly status: string;
  readonly clicks_30d: number;
  readonly conversions_30d: number;
  readonly earned_cents_lifetime: number;

  /** Earned, not yet paid, and past its clawback window. M08's only outflow on a promise. */
  readonly payable_cents: number;
  readonly paid_cents_lifetime: number;
  readonly chargeback_rate_bp: number;
};

// -----------------------------------------------------------------------------
// Section 6.2. THE WALLET, WHICH SC-M4-10 RENDERS
// -----------------------------------------------------------------------------
// Transcribed from API_CONTRACT section 6.2, field for field, comments included
// where the contract's own comment is the shape of a state rather than a note
// about it. `GET /wallet` and `GET /wallet/entries` are both REGISTERED and both
// WIRED, measured through `CompositionReport.registered` over a real `compose()`
// rather than by grep, and `apps/api/src/start.ts:109` calls
// `useWalletBackend(databaseWalletBackend(LIVE_DB))`. THAT POINTER READ LINE 97
// AND WAS EIGHT LINES OUT BEFORE ADR-347 MOVED IT FOUR MORE. No check reported
// it: RI-15's vacancy rule fires on a blank line or a bare closing brace and
// that line was a comment marker, and no backticked name binds ahead of the
// citation, so resolution and range were all that was ever asserted about it.
// The old number is written out of citation grammar on purpose (ADR-212).
//
// THE HEADER OF THIS FILE SAID THE AUTH TYPES WOULD ARRIVE WITH THEIR OWN
// SESSION AND `SessionRow` BELOW IS THAT PROMISE KEPT, not a fence widened. What
// that paragraph reserved was the WRITE half of C-27: the elevation ceremony,
// the OTP bodies, the sensitive-action declarations. None of those is here. What
// is here is the two READS SC-M4-11 renders, and section 3.1's own line is why
// they are reads: `GET /sessions` "takes any single factor, deliberately",
// because "a session you cannot see is one you cannot revoke".

/**
 * The hold vocabulary. A closed union with one member today.
 *
 * M20's P-1 IS NOT A MEMBER AND MUST NOT BECOME ONE. The contract's own comment:
 * P-1 "holds a WITHDRAWAL and appears on POST /wallet/withdrawals, not here: it
 * routes the withdrawal to review and leaves the value spendable, so it
 * subtracts nothing from the figure below".
 */
export type WalletHoldRule = 'chargeback_window';

/** Section 6.2's `WalletHold`. */
export type WalletHold = {
  readonly rule: WalletHoldRule;
  readonly cents: number;

  /** The oldest held credit's `occurred_at`. */
  readonly since: string;

  /**
   * NULL UNDER `chargeback_window`, AND THE CONTRACT CALLS IT "the honest answer
   * today" RATHER THAN AN OMISSION. No landed column carries the card networks'
   * dispute window for a purchase, `OQ-M20-02` asks how long the hold is and is
   * open, and "a date computed by adding a chosen number of days to
   * `earliest_credit_at` would be a number this repository invented".
   *
   * SO THIS SCREEN RENDERS THE ABSENCE AS AN ABSENCE. ../format/money.ts's
   * `formatOptionalCents` argument, applied to a date.
   */
  readonly available_at: string | null;
};

/**
 * `GET /wallet`. Section 6.2.
 *
 * `balance_cents` EQUALS `withdrawable_cents + held_cents` AND THE PORTAL NEVER
 * PERFORMS THAT ADDITION. The contract states the sum "rather than left to a
 * client, because the two components are computed from different inputs and a
 * client that derived one by subtraction would render a stale figure whenever
 * the other moved". That is INV-M4-01's own reason arriving from the server
 * side, and it is why all three figures are read and none is computed.
 *
 * NONE OF THE THREE CAN BE NEGATIVE. `wallet_entries.balance_after_cents` is
 * `CHECK (balance_after_cents >= 0)` in `0011`, so "no response below can carry
 * a negative wallet figure and a client need not branch on one".
 */
export type WalletResponse = {
  readonly balance_cents: number;
  readonly withdrawable_cents: number;
  readonly held_cents: number;

  /** Empty when `held_cents` is 0. */
  readonly holds: readonly WalletHold[];
  readonly as_of: string;
};

/**
 * The CLOSED credit list, `0011`'s own CHECK.
 *
 * THERE IS NO DEPOSIT MEMBER AND THERE MAY NOT BE ONE
 * (`INV-WALLET-NO-DEPOSITS`), and there is no `promotional_credit` member on
 * purpose: the perk lives in `promotional_credit_grants` and is never
 * withdrawable. The contract's reason for keeping it off this response is the
 * reason this union may not grow one either: "a `promotional_credit_cents` field
 * beside `balance_cents` is one client-side addition away from `AS-M20-01`,
 * credit converted to cash".
 */
export type WalletProvenance = 'payout' | 'refund_wallet_funded' | 'correction';

/** `direction`'s two members, `0011`'s CHECK. */
export type WalletDirection = 'credit' | 'debit';

/** Section 6.2's `WalletEntryBase`. */
export type WalletEntryBase = {
  /**
   * A DECIMAL STRING, AND THE ONLY IDENTIFIER IN THE CONTRACT THAT IS NOT A
   * UUID. `wallet_entries.id` is `bigint GENERATED ALWAYS AS IDENTITY`, and a
   * bigint on the wire as a JSON number "admits a value above
   * `Number.MAX_SAFE_INTEGER` that has already lost digits by the time anything
   * reads it". A CLIENT MUST NOT PARSE IT, so nothing in this application does.
   */
  readonly entry_id: string;

  /**
   * A MAGNITUDE, ALWAYS > 0. `direction` carries the sign.
   *
   * `wallet_entries.amount_cents` is `CHECK (amount_cents > 0)` and `0011`
   * states why it is deliberately NOT the ledger's signed convention: "a signed
   * amount on the wire would collapse the two questions back together".
   */
  readonly amount_cents: number;

  /** The business event, human readable, and the server's own sentence. */
  readonly cause: string;

  /** Polymorphic: a payout request, a purchase, or the corrected entry. */
  readonly reference_id: string;

  /** Every wallet movement is posted; there is no unposted entry. */
  readonly ledger_transaction_id: string;

  /** The running balance AFTER this entry. `>= 0` by CHECK. */
  readonly balance_after_cents: number;
  readonly occurred_at: string;
};

/** A credit, which carries the class of money it is. */
export type WalletCredit = WalletEntryBase & {
  readonly direction: 'credit';
  readonly provenance: WalletProvenance;
};

/**
 * A debit, which carries NO `provenance`.
 *
 * THE OMISSION IS THE SCHEMA REPORTED HONESTLY RATHER THAN A FIELD FORGOTTEN,
 * and it is the contract's own comment: the column is `NOT NULL` on every row
 * and its three members are the CREDIT list, "so a debit is stored carrying a
 * class that does not describe it. What a debit MEANS is `cause` and
 * `reference_id`". The screen therefore renders a provenance on credits only,
 * and rendering one on a debit would state the schema's defect as a fact about
 * the trader's money.
 */
export type WalletDebit = WalletEntryBase & { readonly direction: 'debit' };

/** Section 6.2's `WalletEntry`, discriminated on `direction`. */
export type WalletEntry = WalletCredit | WalletDebit;

/**
 * `GET /wallet/entries`. Section 6.2, and section 1's envelope.
 *
 * Ordering is `occurred_at` DESCENDING, which is
 * `wallet_entries_identity_idx`'s own order. The portal does not sort it.
 */
export type WalletEntriesResponse = CursorPage<WalletEntry>;

// -----------------------------------------------------------------------------
// Section 3.1. THE ACTIVE SESSIONS, WHICH SC-M4-11 RENDERS
// -----------------------------------------------------------------------------

/**
 * How a session was ESTABLISHED. `sessions.auth_factor`.
 *
 * THREE VALUES AND NO PASSWORD, WHICH IS THE WHOLE OF WHY SC-M4-11 HAS NO
 * PASSWORD ROW. ADR-039 and `0002:280`: there is no password table anywhere in
 * this schema by design, so there is nothing on this screen to reset and no
 * reset link to render. `SC-M4-01`'s line says the same thing from the other
 * end: "No password field exists anywhere. There is no password database to
 * stuff (D2)".
 */
export type AuthFactor = 'email_otp' | 'sms_otp' | 'passkey';

/**
 * `GET /sessions`. Section 3.1.
 *
 * THE ESTABLISHING FACTOR IS ON EVERY ROW, and the contract states why in the
 * same breath as the endpoint: it "is what makes a SIM-swapped session visible
 * to the person it was taken from". M04 section 3.7 closes the loop -- "the
 * trader's own defence is SC-M4-11's session list, which is why revocation is
 * on the same screen as the factor that established the session".
 *
 * THERE IS NO IP FIELD HERE AND THE ABSENCE IS TRANSCRIBED RATHER THAN
 * REPAIRED. `AS-M4-05` counter 2 promises the trader "every active session with
 * its creation IP, user agent, and last-seen time", and `SD-M4-03` added
 * `created_ip inet` and `last_seen_ip inet` to `sessions` to serve it. The
 * contract's row carries neither. Both documents are approved and they disagree;
 * M04 section 4 binds this file to the contract ("consumes API_CONTRACT
 * verbatim, and adds no field to any of them"), so the field is absent here and
 * the divergence is reported rather than closed by a portal session inventing a
 * column onto a response.
 */
export type SessionRow = {
  readonly id: string;
  readonly auth_factor: AuthFactor;

  /**
   * Both halves of the elevation pair, or not elevated.
   *
   * The server reads `elevated_at` and `elevated_by_factor` together, on
   * `sessions_elevation_is_complete`: a row that violated the constraint reads
   * as NOT elevated rather than as elevated on a half-written record. The portal
   * is handed the boolean and never the pair, which is `SD-M4-04`'s own line --
   * "the portal reads a boolean it was given and never a clock it interprets".
   */
  readonly elevated: boolean;
  readonly created_at: string;
  readonly last_seen_at: string;

  /** Coarse, never the raw string. The contract's own word. */
  readonly user_agent_family: string;
  readonly is_current: boolean;
};
