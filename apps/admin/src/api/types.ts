// =============================================================================
// apps/admin/src/api/types.ts
// =============================================================================
// THE WIRE SHAPES THIS CONSOLE READS, TRANSCRIBED AND NOT DESIGNED.
//
// `apps/portal/src/api/types.ts` states the discipline this file inherits and
// it is one sentence: "A field that is not in the contract is not in this
// file, and adding one here is how the portal starts believing in data the
// server does not send." The same sentence with the same force applies here,
// and the operator surface makes it sharper rather than softer: M06 section 1.2
// makes this module an aggregator of "numbers other modules computed", so a
// field invented here would be a number with no producer rendered beside
// numbers that have one.
//
// SO EVERY TYPE BELOW IS A COPY OF A DECLARATION IN
// `docs/architecture/API_CONTRACT.md` AND THE ONLY EDITS ARE `readonly` AND
// COMMENTS. The nested objects are left inline exactly as the contract writes
// them rather than lifted into named types, because naming them is a
// restructuring and "readonly and comments" is the whole of the licence.
//
// -----------------------------------------------------------------------------
// WHAT IS HERE, AND THE ABSENCES ARE THIS SLICE'S FENCE
// -----------------------------------------------------------------------------
// `GET /admin/liability`, the data source for the liability home `W6-d`
// renders; `GET /admin/flags`, the data source for the flags queue `W6-f`
// renders; `GET /admin/identities/:identityId/graph`, the data source for the
// identity drill-down `W6-g` renders; `GET /admin/events`, the data source for
// the event feed `W6-h` renders; and `GET /admin/accounts?query=` and `GET
// /admin/accounts/:accountId`, which `W6-j` takes together because this file's
// partition assigns it the first and its screen renders the second. All six are
// API_CONTRACT section 8 headings.
//
// THE LAST OF THOSE SIX IS THE ONE THE CONTRACT DOES NOT TYPE, and the shape of
// its absence is recorded at the declaration rather than here: section 8 gives
// the drill-down a SENTENCE where every other row gives a `ts` block, so what is
// transcribed for it is the section roster and nothing below it.
//
// THE PARTITION IS THE WAVE'S AND IT IS WRITTEN DOWN. WAVE-06 section 9's row
// for this file reads "FIVE SLICES, ONE TRANSCRIPTION ... each screen slice
// adds the shapes its own contract rows carry", so the other declared read
// shapes in section 8 are deliberately absent and each has an owner:
//
//   `EvidencePackResponse`     `GET /admin/evidence/:accountId`     wave 5,
//                              blocked on ADR-171 (the export is an audited ACT
//                              and therefore behind the actor)
//
// `AdminAccountSearchItem` WAS THE FIRST ROW OF THAT TABLE AND IS NOT ANY MORE:
// `W6-j` landed it at the foot of this file, beside the drill-down's roster.
// **IT WAS ALSO THE ONE SHAPE HERE WITH NO CONSUMER IN THIS PACKAGE, AND IT HAS
// ONE NOW.** `src/app/search/account-search.tsx` renders it, and the two
// reasons that sentence gave have both expired: the search screen is built, at
// `/search`, and `AdminReadSource.searchAccounts` is
// `apps/api/src/admin-source/search.ts`, which session 371 wrote. So every
// shape in this file is read by a screen in this package.
//
// A slice that adds one of these adds it here beside its screen, which is the
// same division WAVE-06 section 9 draws and the reason four slices can share
// one file without four of them colliding on it in one wave.
//
// EVERY WRITE SHAPE IN SECTION 8 IS ABSENT AND THAT IS A BLOCKER RATHER THAN A
// PREFERENCE. `FreezeRequest`, `UnfreezeRequest`, `CloseRequest`,
// `FlagStatusRequest`, `CertificateRevokeRequest`, `CreateVersionRequest`,
// `PublishRequest`, `PayoutReleaseRequest`, `PayoutEnforceRequest`,
// `WalletCorrectionRequest` and `SpendLimitRequest` are WAVE-06 wave 5's, which
// is not dispatched: ADR-171 finding 4 measured that no table in the registry
// holds an operator, a role or an operator session, so `setAdminSessionSource`
// has no supplier and every mutating route is behind an admin identity provider
// the founder buys. A console that transcribed the request bodies anyway would
// look like it had started on them, which is `apps/portal/src/api/types.ts`'s
// stated reason for the same absence one surface over.
//
// THE EVENT FEED HAD NO SHAPE HERE BECAUSE IT HAD NO CONTRACT ROW, AND THAT
// SENTENCE IS NOW FALSE RATHER THAN STALE, WHICH IS WHY IT MOVED RATHER THAN
// STOOD. WAVE-06 section 4.2 found that M06 section 1.1 names the feed a launch
// surface and `../feed.ts` implements it while API_CONTRACT sections 8 and 9
// carried no endpoint for it; `W6-e` was the slice that wrote the row and it is
// the one slice in this wave that REQUIRED an ADR. ADR-184 is that entry, the
// row is `GET /admin/events` in section 8, and the three types at the foot of
// this file are its transcription. Nothing here invents it: the query shape,
// the item and the envelope are the contract's own declarations with `readonly`
// and comments added.
//
// SECTION 9 CONTRIBUTES NO TYPE AND THE REASON IS THE SECTION'S OWN SHAPE.
// It is a five-row table. Four of its rows (`POST /internal/batch/run`,
// `GET /internal/recon/status`, `GET /internal/jobs`,
// `GET /internal/health/deep`) declare no response body at all, so there is
// nothing to transcribe and writing one would be this file inventing a contract.
// The fifth, `GET /health`, is the only section-9 row with a fixed body,
// `{ status: "ok" }`, and it is marked **Public**; `http/client.ts` refuses any
// path that does not carry one of `surface.ts`'s operator prefixes, so this
// console cannot reach it and a type for it here would be a shape with no
// caller.
//
// -----------------------------------------------------------------------------
// WHY THE MONEY FIELDS SAY `number` HERE AND `bigint` ONE DIRECTORY OVER
// -----------------------------------------------------------------------------
// `apps/portal/src/api/types.ts` records the disagreement in full and it is the
// same one: M01's `INV-02` makes all money `bigint` integer cents at every
// boundary and `packages/rules-engine/src/types.ts` declares `type Cents =
// bigint`, while API_CONTRACT section 1 declares these same quantities as JSON
// integers because JSON has one number type.
//
// THIS CONSOLE ROUTES AROUND IT FOR A STRONGER REASON THAN THE PORTAL HAS.
// M06 section 1.2: "M6 aggregates numbers other modules computed. It has no
// arithmetic on a rule." So the width of the integer never matters here either,
// and the one permitted consumer of a `_cents` field is `formatCents` in
// `../figure.ts`, whose signature already accepts what the wire sends. The
// disagreement is recorded rather than settled, because settling it is a
// contract change and this file is a transcription.
//
// -----------------------------------------------------------------------------
// NO HOSTNAME, INCLUDING IN A COMMENT
// -----------------------------------------------------------------------------
// ADR-012 keeps the admin domain out of the corpus, the repository and any
// artifact. Nothing in this file names a host, and `test/surface.test.ts`
// asserts that mechanically over the whole package rather than leaving it to a
// reader. This file names PATHS, which are the contract's own and carry no
// origin.

// -----------------------------------------------------------------------------
// Section 8. Admin (RBAC, admin origin only)
// -----------------------------------------------------------------------------
// Roles are `owner`, `ops` and `readonly`, and they are NOT re-declared here:
// `../roles.ts` already transcribes that closed set from this same section and
// a second copy would be a second answer to "what is an admin role". This file
// carries response shapes and the role vocabulary is not one.

/**
 * `GET /admin/liability`. API_CONTRACT section 8, transcribed field for field.
 *
 * THE LIVE FIGURE IS NOT A FIELD ON THIS TYPE AND MUST NEVER BECOME ONE. The
 * contract says so at the point of declaration, in its own words: "It is never
 * a field on `GET /admin/liability` above. That response is the one an operator
 * opens during an incident, and a live field on it makes the number Merit is
 * most often disputed about depend on a feed that is down." `AdminLiveLiability`
 * is a separate payload in the same section and it is absent from this file for
 * the reason above: no route registers it, `P6-j` is the slice that gives it a
 * producer, and `P6-j` is behind `P6-g`, which is behind a `VG-12` catalog
 * admission that WAVE-06 section 8.1 states is a human approval.
 *
 * `as_of` IS THE FIELD EVERY OTHER FIELD DEPENDS ON. `INV-M6-04` makes a number
 * without its as-of and its source a number this console may not render, and
 * `../figure.ts` is where that obligation is a type rather than a habit. A view
 * that reads `open_liability_cents` and drops `as_of` has produced exactly the
 * confidently-wrong figure `AS-M6-04` is about.
 */
export type LiabilityResponse = {
  readonly as_of: string;

  /**
   * ONE COMPONENT OF THE PANEL THAT SHARES ITS NAME, AND THE FIELD BELOW IS THE
   * OTHER.
   *
   * ADR-188 clause 2 keeps the column's name on the wire and clause 3 sends NO
   * TOTAL: `P-M6-01` requires the components "shown separately as well as
   * summed" and the sum is the reader's, because a total the server computed is
   * a third number that can disagree with the two beside it AND the one figure
   * a client can render alone under the panel's name. `../liability.ts` is where
   * this console does the addition, and it renames on arrival for that reason.
   */
  readonly open_liability_cents: number;
  readonly wallet_balances_cents: number;
  readonly bounded_near_term_cents: number;
  readonly remaining_ladder_exposure_cents: number;

  /**
   * `P-M6-10`, and IT IS SIGNED.
   *
   * The only field on this response that may be negative. A renderer that clamps
   * it at zero reports an absorbed correction as none, which is the one way this
   * field can be rendered wrongly without looking wrong.
   */
  readonly absorbed_corrections_cents: number;
  readonly funded_accounts: number;
  readonly eligible_next_7d: {
    readonly total_cents: number;
    readonly account_count: number;
    readonly by_day: readonly {
      readonly trading_day: string;
      readonly cents: number;
      readonly accounts: number;
    }[];
  } | null;
  /**
   * `null` WHEN THE SERVER CANNOT SUPPLY THE WINDOW, and `gaps` says which way.
   *
   * `ADR-203`. A console that renders this as `0 / false` when it is absent has
   * reported a quiet week, and the panel is the one an operator opens during an
   * incident. `../figure.ts` is where the absence becomes a `Reading` this page
   * may render: `absent()` takes the `detail` from the matching `gaps` entry and
   * refuses a blank one.
   *
   * THE NULL IS AT THE OBJECT AND NOT AT A MEMBER, so a narrowing check here is
   * one check and never four, and there is no half-supplied velocity panel.
   */
  readonly payout_velocity: {
    readonly last_7d_cents: number;
    readonly avg_30d_cents: number;
    readonly ratio_bp: number;

    /** The server's verdict. `INV-M6-12`: no client recomputes an alarm. */
    readonly alarm: boolean;
  } | null;

  /**
   * `P-M6-07`'s reserve position, and FLOAT IS NOT IN IT.
   *
   * That is the contract agreeing with `../liability.ts`, which computes the
   * ratio from reserve alone and renders float beside it. `AS-M20-08` names the
   * misreading this shape forecloses: a coverage ratio that counts wallet float
   * as reserve "flatters itself with the same money on both sides".
   *
   * THE SENTENCE THAT USED TO STAND HERE IS NARROWED RATHER THAN DELETED, AND
   * ADR-188 registered the narrowing before the field arrived. It read "there is
   * no float field on this response to add into `reserve_cents` by accident".
   * After clause 1 there IS one, `wallet_balances_cents`, and it is on this
   * response deliberately as a LIABILITY component of `P-M6-01`. What stays true
   * is the half that was ever load bearing: it is not inside `reserve`, nothing
   * in this group is a float figure, and `GET /admin/wallet/reconciliation` is
   * where the float position lives. The accident the sentence guarded against is
   * now refused by the grouping rather than by an absence.
   */
  readonly reserve: {
    /**
     * ITS OWN `as_of`, BECAUSE IT IS A DIFFERENT TABLE ON A DIFFERENT CLOCK.
     *
     * `INV-M6-04` makes a number without its as-of a number this console may not
     * render, and dating this group with the top-level `as_of` would put the
     * book's clock on the rail's figure: "one row forces one `as_of` on two
     * sources that do not move together" is why the two are two tables, and a
     * response carrying one instant for both would re-collapse it in the payload.
     */
    readonly as_of: string;
    readonly reserve_cents: number;
    readonly cvar99_cents: number;
    readonly rcr_bp: number;
    readonly breaker_armed: boolean;

    /**
     * The anchor the numerator is asserted against, and its own instant.
     *
     * `treasury_as_of` IS NOT `as_of` ABOVE and staleness is measured from it.
     * `P-M6-07` requires "attestation staleness shown when the balance is a
     * manual attestation", and `treasury_source` is the only field on this
     * response that answers which of the two kinds it is.
     */
    readonly treasury_account_code: string;
    readonly treasury_as_of: string;
    readonly treasury_source: 'provider_api' | 'manual_attestation';
  };
  readonly per_plan: readonly {
    readonly plan_id: string;
    readonly code: string;
    readonly loss_ratio_bp: number;
    readonly threshold_bp: number;
    readonly sales_paused: boolean;

    /**
     * `statistic` and `threshold` are NEITHER CENTS NOR BASIS POINTS, which the
     * contract states under `GET /admin/cusum` and is worth carrying here: "a
     * CUSUM statistic is a standardised deviation and rounding it to either is a
     * calibration defect (`FM-M6-07`) rather than a fix." So these two are the
     * only non-integer-scaled numbers on this response and a renderer that fed
     * them to `formatCents` would be reporting a deviation as money.
     */
    readonly cusum: {
      readonly statistic: number;
      readonly threshold: number;
      readonly alarm: boolean;
    } | null;
  }[];

  /**
   * `P-M6-09`'s signals, as the contract carries them.
   *
   * `../data-trust.ts` is what turns a signal into a verdict every panel below
   * inherits, and `TRUST_KEYS` closes its input set at FIVE:
   * `recon_mismatches_open`, `marks_completeness_gap`, `unconfirmed_setpoints`,
   * `replay_divergences` and `batch_last_success`.
   *
   * THIS RESPONSE CARRIES TWO OF THE FIVE AND `mid_health` IS NEITHER OF THEM.
   * `integrations.recon.mismatches_open` is `recon_mismatches_open` and
   * `integrations.batch.last_success_at` is `batch_last_success`; PSP health is
   * a payments signal that no trust key names, and feeding it to
   * `assessDataTrust` under one of the other three names would be a supplier
   * invented at the point of use. The remaining three have no field on this
   * response and `data-trust.ts` reports a missing input as NOT SUPPLIED with
   * its owner named, which is a red verdict rather than a passed one.
   */
  readonly integrations: {
    readonly mid_health: readonly {
      readonly psp: string;
      readonly decline_rate_bp: number;
      readonly chargeback_rate_bp: number;
      readonly healthy: boolean;
    }[];
    readonly recon: {
      readonly last_run_at: string;
      readonly mismatches_open: number;
    };
    readonly batch: {
      readonly last_success_at: string;
      readonly last_duration_ms: number;
    };
  };

  /**
   * Every `null` on this response, named, with why. `[]` when there are none.
   *
   * `ADR-203` ruling 2: NO `null` TRAVELS ALONE. This is the field that makes an
   * absence on the wire say the thing `../figure.ts` has always required a
   * console absence to say. `AbsentFigure.reason` is non-blank by construction
   * and its docstring gives the bar -- "'unavailable' written by the schema is
   * the same silence, spelled" -- and before this field there was nothing on the
   * wire a renderer could put there.
   *
   * THE TWO SHAPES ARE DELIBERATELY NOT THE SAME AND `ADR-203` SECTION 5 IS WHY.
   * `Reading` tags the absence AT THE SITE and carries `origin`, `label` and
   * `definition` beside it; those three are this page's roster (`requireOrigin`
   * admits `P-M6-01` to `P-M6-10` and `AS-M6-04` and nothing else), and putting
   * them on the wire would move a rendering vocabulary into the API contract,
   * which is the one thing `ADR-188` kept out of it: "no field is named for a
   * panel". So the wire carries the PATH, the CAUSE and the DETAIL, this file's
   * reader supplies the label and the definition, and the distinction both
   * layers draw is the same one.
   */
  readonly gaps: readonly {
    /** The JSON path of the `null` this entry explains. */
    readonly field: string;

    /**
     * WHY, from a CLOSED set of three, and it is closed so that this console can
     * BRANCH on it. `insufficient_history` is a panel that says "not yet";
     * `estate_uncovered` is a panel that says the estate has no opinion, which
     * is `ADR-042` F-4's unknown and is an operational fact rather than a
     * roadmap one. A free-text reason would have made those two a substring
     * match, which is the same silence with more characters in it.
     */
    readonly cause: 'awaiting_dependency' | 'insufficient_history' | 'estate_uncovered';

    /** Non-`null` exactly when `cause` is `awaiting_dependency`. */
    readonly awaiting: string | null;

    /** Required and never blank. What this page renders as the reason. */
    readonly detail: string;
  }[];
};

/**
 * `GET /admin/flags`. API_CONTRACT section 8, transcribed field for field.
 *
 * `corroboration_depth` IS THE FIRST SORT KEY AND IT IS ON THE WIRE BECAUSE
 * THE ORDER IS OTHERWISE NEITHER CHECKABLE NOR READABLE. The contract says so
 * at the point of declaration and gives both halves of the reason:
 * `assertFlagOrder` "cannot enforce a key it cannot see, and an operator shown
 * a severity 3 above a severity 5 has nothing on the row that says why".
 * ADR-178 and `AS-M7-03` clause 3 are where the key itself is ruled: the queue
 * sorts by the number of INDEPENDENT DETECTOR FAMILIES implicated on an
 * identity, never by raw flag count, so that poisoning one detector does not
 * move an identity up the queue.
 *
 * IT IS A COUNT AND NOT A FILTER, AND THE CONTRACT SAYS THAT TOO: "Computed per
 * request and held in no column, so it is NOT a filter and NOT a cursor a
 * client may compose." So this console renders it and composes nothing from it.
 *
 * THE ORDER IS THE SERVER'S AND THIS FILE IS NOT WHERE IT IS RE-DERIVED.
 * `../app/flags/flags-queue.tsx` renders `rows` in the order the response
 * carried them and its header argues why a second comparison here would be a
 * second answer to a question `apps/api/src/routes/admin-reads.ts` already
 * enforces, in a package `RI-04` forbids importing it from.
 *
 * `identity_id` AND `account_id` ARE ON THIS TYPE AND ARE NOT ON THE SCREEN.
 * `INV-M6-10` renders trader-identifying data only when the query names a
 * specific subject and a queue names none, so the shapes are transcribed
 * because the contract carries them and the document renders neither. That is a
 * rendering decision and it is argued where it is taken rather than by omitting
 * a contracted field here, which would be this file believing in a response
 * different from the one the server sends.
 */
export type FlagListItem = {
  readonly flag_id: string;
  readonly identity_id: string;
  readonly account_id: string | null;
  readonly flag_type: string;

  /**
   * The second sort key, descending within one corroboration band.
   *
   * A CLOSED SET OF FIVE AND NOT A `number`, which is the contract's own
   * spelling. A severity outside it is a detector this console has no sentence
   * for, and widening the type here would be the console agreeing to render one.
   */
  readonly severity: 1 | 2 | 3 | 4 | 5;

  /**
   * `STATE_MACHINES` section 7's four, as the contract spells them.
   *
   * NO AUTOMATIC TRANSITION INTO `enforced` (M06 section 3.3, binding), and
   * this console takes none of them: `POST /admin/flags/:flagId/status` is a
   * write and WAVE-06 wave 5 holds every mutating surface behind ADR-171.
   */
  readonly status: 'open' | 'investigating' | 'dismissed' | 'enforced';

  /** The third sort key, oldest first within one band at one severity. */
  readonly first_detected_on: string;
  readonly detector: string;
  readonly evidence_summary: string;

  /** How many INDEPENDENT detector families are implicated on `identity_id`. */
  readonly corroboration_depth: number;
};

/**
 * `GET /admin/identities/:identityId/graph`. API_CONTRACT section 8,
 * transcribed field for field.
 *
 * THE SCREEN THAT READS THIS IS REACHABLE ONLY BY NAMING A SUBJECT, which is
 * M06 section 3.2a's own sentence and the property that separates this endpoint
 * from the bulk PII surface `FM-M6-10` exists to refuse: "A screen that
 * aggregates one human is a convenience; a screen that aggregates humans is the
 * bulk PII surface FM-M6-10 exists to refuse, and the difference is one query
 * parameter." The path parameter is that difference and it is the whole of the
 * licence `INV-M6-10` grants: there is no list endpoint here, and this file
 * carries no shape for one because the contract declares none.
 *
 * THE THREE `_cents` FIELDS ARE ON THIS TYPE AND ARE NOT ON THE SCREEN, AND
 * THAT IS `INV-M6-04` RATHER THAN A RENDERING PREFERENCE. **This response
 * carries no `as_of` and no source, for any of them.** `GET /admin/liability`
 * declares `as_of` as its first field and the header on `LiabilityResponse`
 * above says why: "a number without its as-of and its source is a number this
 * console may not render". `../figure.ts` is where that obligation is a type,
 * and it closes its origin roster at `P-M6-01` to `P-M6-10` and `AS-M6-04`
 * (`ORIGIN_ID`), which are M06 section 3.1's panels, so a figure on section
 * 3.2a's screen has no admissible origin either. `../app/identities/
 * identity-graph.tsx` states all three as a named absence with its owner rather
 * than rendering an undated figure, and the contract gap is REPORTED: both
 * repairs are files outside `W6-g`'s fence.
 */
export type IdentityGraph = {
  /**
   * The human the query named.
   *
   * IT IS ALSO THE CHECK THE DRILL-DOWN RUNS FIRST. A response whose `root` is
   * not the identity the path asked for is trader-identifying data about a
   * human the query did not name, which is INV-M6-10 breached by a mismatch
   * rather than by a rendering.
   */
  readonly root: {
    readonly identity_id: string;
    readonly status: string;
    readonly accounts: number;
  };
  readonly nodes: readonly {
    readonly identity_id: string;
    readonly status: string;
    readonly accounts: number;
    readonly total_withdrawable_cents: number;
  }[];

  /**
   * The resolved links, and `evidence` is the field the screen does not render.
   *
   * M06 section 3.2a names what the drill-down shows of an edge and it is two
   * things: "the resolved graph edges with their KIND and CONFIDENCE". It does
   * not name the evidence, and `Record<string, unknown>` is unbounded
   * server-supplied content on the one screen in this console that holds a PII
   * licence. The document's header argues the refusal and its suite asserts the
   * module never reads the field.
   */
  readonly edges: readonly {
    readonly a: string;
    readonly b: string;
    readonly link_kind: string;
    readonly confidence_bp: number;
    readonly evidence: Record<string, unknown>;
  }[];
  readonly aggregate: {
    readonly identities: number;
    readonly accounts: number;
    readonly open_liability_cents: number;
    readonly payouts_lifetime_cents: number;
  };
};

// -----------------------------------------------------------------------------
// `GET /admin/events`. ADR-184's row, and INV-M6-10 lives in the QUERY
// -----------------------------------------------------------------------------

/**
 * `GET /admin/events`'s query. API_CONTRACT section 8, transcribed field for
 * field.
 *
 * `scope` IS REQUIRED AND HAS NO DEFAULT, WHICH IS THE WHOLE SHAPE. ADR-184
 * ruling 2 carried `INV-M6-10`'s two modes into the request rather than into a
 * handler: the invariant is "the admin console renders trader-identifying data
 * only when the query names a specific subject", so whether a query names one
 * is a value the caller STATES. The contract says why neither default is
 * available: `operational` would silently redact a drill-down and either named
 * arm would hand a bulk screen the licence a named query earns.
 *
 * `identity_id` AND `account_id` ARE OPTIONAL IN THE TYPE AND CONDITIONAL IN
 * THE CONTRACT, and the difference is a limit of the transcription rather than
 * a relaxation of the rule. The contract writes them as optional members with
 * "required when `scope` is `identity`, refused otherwise" beside each, and
 * "readonly and comments" is the whole of this file's licence, so the
 * conditionality is not lifted into a discriminated union here. The server
 * enforces it: a subject sent under a scope that does not name it is
 * `validation_failed` and is never ignored. `../app/feed/event-feed.tsx` is
 * where this console holds the closed union, on its own values.
 */
export type EventFeedQuery = {
  readonly scope: 'operational' | 'identity' | 'account';
  /** Required when `scope` is `identity`, refused otherwise. */
  readonly identity_id?: string;
  /** Required when `scope` is `account`, refused otherwise. */
  readonly account_id?: string;
  /** Section 1: cursor only, never offset. Maximum 100, default 25. */
  readonly limit?: number;
  readonly cursor?: string;
};

/**
 * One `events` row with `INV-M6-10` already applied to it, BY THE SERVER.
 *
 * THE WITHHOLDING IS A PROPERTY OF THIS RESPONSE AND NOT OF A RENDERER, which
 * is ADR-184 ruling 3 and is the reason these fields say `string | null` and
 * carry the word rather than being absent. `api-admin` serves this body on
 * `ADMIN_ORIGIN` with no console in the path, so a redaction living only in a
 * renderer is a redaction a `curl` walks past.
 *
 * THE SET OF WITHHELD VALUES IS NEVER A FIELD ON THIS TYPE AND MUST NEVER
 * BECOME ONE. The contract states it at the point of declaration: a response
 * carrying it would ship every withheld identifier to the caller, which is the
 * bulk read with an extra step.
 *
 * `withheld` AND `instants_incoherent` ARE THE SERVER'S VERDICTS AND NOT
 * DERIVATIONS THIS CONSOLE MAY REDO, which is `LiabilityResponse.payout_velocity
 * .alarm`'s rule (`INV-M6-12`, no client recomputes an alarm) arriving on a
 * different row. They are rendered as sent.
 */
export type AdminEventItem = {
  /** `events.id` is `bigint`, so a string: a JSON number loses the order past 2^53. */
  readonly id: string;
  readonly event_name: string;
  /** When the fact happened. */
  readonly occurred_at: string;
  /** When we learned it. Corrections make these differ. */
  readonly recorded_at: string;
  /** `null` where the row carried none, `"withheld"` where the scope does not admit it. */
  readonly identity_id: string | null;
  readonly account_id: string | null;
  readonly subject_kind: string;
  readonly subject_id: string;
  readonly actor_kind: string;
  readonly actor_id: string | null;
  readonly correlation_id: string | null;
  /** Every key ending `identity_id` or `account_id` withheld the same way. */
  readonly payload: Record<string, unknown>;
  /** Whether anything on THIS row was withheld. */
  readonly withheld: boolean;
  /** We learned it before it happened, which cannot be true. */
  readonly instants_incoherent: boolean;
};

/**
 * `GET /admin/events`. Section 1's envelope plus the scope the page was served
 * under.
 *
 * THE ECHO IS THE MODE AND NOT THE SUBJECT, AND THE ASYMMETRY IS LOAD BEARING
 * FOR THE SCREEN. `scope` is `EventFeedQuery["scope"]`, so a response says
 * WHICH of `INV-M6-10`'s two modes produced it and never which subject was
 * named. A console therefore cannot learn the licence from the response alone:
 * it pairs the body with the query it issued, and
 * `../app/feed/event-feed.tsx` refuses a body whose echoed mode is not the one
 * its query asked for.
 *
 * THERE IS NO `total` AND THERE IS NO WAY TO ADD ONE. ADR-157 refuses the
 * scalar aggregate on the read path. `data.length` is counted rather than
 * claimed and `next_cursor === null` is the difference between an exhausted
 * query and a full page, which is the pair of honest facts the contract puts in
 * place of a number nothing in this system can obtain.
 */
export type EventFeedResponse = {
  readonly scope: EventFeedQuery['scope'];
  readonly data: readonly AdminEventItem[];
  readonly next_cursor: string | null;
};

/**
 * `GET /admin/accounts?query=`. API_CONTRACT section 8, transcribed field for
 * field.
 *
 * **IT WAS TRANSCRIBED HERE WITH NO CONSUMER IN THIS PACKAGE AND IT HAS TWO
 * NOW, ON BOTH SIDES OF THE WIRE.** That paragraph read that the screen behind
 * it is NOT built and that "no slice in `P5`, `P6`, `P7` or `WAVE-06` writes
 * `AdminReadSource.searchAccounts` (WAVE-06 section 10 item 3), so the route is
 * registered against a method nothing supplies". Session 371 wrote
 * `apps/api/src/admin-source/search.ts` and the screen is
 * `src/app/search/account-search.tsx`. The route is registered against a method
 * that is supplied, and the read is blocked on `ADR-171`'s principal like every
 * other read in this console.
 *
 * ITS SEARCH TERM WAS WIDER THAN THE KEYED ACCESSOR CAN EXPRESS, AND THE
 * CONTRACT MOVED RATHER THAN THE ACCESSOR. That paragraph read the contract's
 * list as "account id, platform ref, email, identity id, name fragment, coupon,
 * or payout id", called the fragment a substring predicate `ADR-112`'s
 * vocabulary cannot express, and warned that an adapter quietly serving six of
 * the seven would narrow a contract behaviour behind a green suite. **`ADR-194`
 * REMOVED THE SEVENTH FORM FROM THE CONTRACT RATHER THAN LEAVING IT
 * UNIMPLEMENTED**, on three grounds it states in section 8: the estate holds no
 * legal name at all, `identities.display_name` is a leaderboard handle
 * `INV-M11-10` says is expressly not one, and a fragment cannot satisfy
 * `INV-M6-10` because two people whose handles share letters share no subject.
 * The contract's list here is SIX and `ADR-157`'s refusals are untouched, so
 * the finding that paragraph recorded is closed rather than outstanding.
 *
 * THE MONEY FIELDS ON THIS ROW HAVE NO `as_of` AND NO SOURCE, exactly as
 * `IdentityGraph`'s three do. `INV-M6-04` makes such a number unrenderable by
 * this console and `../figure.ts` closes its origin roster at `P-M6-01` to
 * `P-M6-10` and `AS-M6-04`, which are `M06` section 3.1's panels. A row of this
 * shape rendered on a section 3.2 screen would carry four numbers with no
 * origin any of them may declare.
 */
export type AdminAccountSearchItem = {
  readonly account_id: string;
  readonly identity_id: string;
  readonly email: string;
  readonly plan_code: string;
  readonly size_cents: number;
  readonly phase: string;
  readonly status: string;
  readonly balance_cents: number;
  readonly withdrawable_cents: number;
  readonly open_flags: number;
  readonly payouts_frozen: boolean;
  readonly recon_blocked: boolean;
};

/**
 * The eight sections `GET /admin/accounts/:accountId` returns, in the
 * contract's own order and its own words.
 *
 * THIS IS THE ONE ADMIN READ THE CONTRACT DOES NOT TYPE, AND THAT IS WHY THIS
 * DECLARATION IS A LIST OF NAMES RATHER THAN A LIST OF FIELDS. Section 8's row
 * is prose: "Full drill-down: account, identity, every mark, every rule state
 * per day with `gate_results`, every event, flags with evidence, payouts with
 * snapshots, admin actions." Every other row in that section carries a `ts`
 * block; this one carries a sentence.
 *
 * SO THE TRANSCRIPTION IS THE SECTION ROSTER AND NOTHING BELOW IT. This file's
 * discipline is that a field not in the contract is not in this file, and the
 * drill-down has no field in the contract to transcribe: a field list written
 * here would be this console designing a response and then believing it. The
 * granularity the contract does write is the section, and that is the
 * granularity declared.
 *
 * `apps/api/src/routes/admin-reads.ts` REACHED THE SAME ANSWER INDEPENDENTLY
 * AND ENFORCES IT AT THE SERVER: its `ACCOUNT_DETAIL_SECTIONS` is this list, its
 * `projectAccountDetail` refuses a response carrying a section the contract does
 * not name AND a response omitting one the contract does name, and its own
 * comment records the field-level schema as a DEBT owed by whoever types this
 * drill-down. Two copies of one roster is the cost of the console not importing
 * the server, which is `ADR-182`'s separation and is paid here rather than
 * argued away.
 */
export const ACCOUNT_DETAIL_SECTIONS = [
  'account',
  'identity',
  'marks',
  'rule_states',
  'events',
  'flags',
  'payouts',
  'admin_actions',
] as const;

/** One member of {@link ACCOUNT_DETAIL_SECTIONS}. */
export type AccountDetailSection = (typeof ACCOUNT_DETAIL_SECTIONS)[number];

/**
 * `GET /admin/accounts/:accountId`, at the only granularity the contract
 * declares.
 *
 * EVERY SECTION IS `unknown` AND THAT IS THE TRANSCRIPTION RATHER THAN A GAP TO
 * FILL LATER. `unknown` is the type that forces a reader to prove a shape before
 * using it; `Record<string, unknown>` or an invented interface would each let a
 * renderer read a field name the contract never wrote. The screen that renders
 * this reads no member of any section, and its suite asserts that from the
 * module's own source.
 */
export type AdminAccountDetail = Readonly<Record<AccountDetailSection, unknown>>;
