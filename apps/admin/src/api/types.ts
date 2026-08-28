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
// `GET /admin/liability` and nothing else, which is API_CONTRACT section 8's
// first heading and the data source for the liability home `W6-d` renders.
//
// THE PARTITION IS THE WAVE'S AND IT IS WRITTEN DOWN. WAVE-06 section 9's row
// for this file reads "FIVE SLICES, ONE TRANSCRIPTION ... each screen slice
// adds the shapes its own contract rows carry", so the four other declared read
// shapes in section 8 are deliberately absent and each has an owner:
//
//   `AdminAccountSearchItem`   `GET /admin/accounts?query=`         `W6-j`
//   `FlagListItem`             `GET /admin/flags`                   `W6-f`
//   `IdentityGraph`            `GET /admin/identities/:id/graph`    `W6-g`
//   `EvidencePackResponse`     `GET /admin/evidence/:accountId`     wave 5,
//                              blocked on ADR-171 (the export is an audited ACT
//                              and therefore behind the actor)
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
// THE EVENT FEED HAS NO SHAPE HERE BECAUSE IT HAS NO CONTRACT ROW, AND THAT IS
// A MEASUREMENT RATHER THAN AN OMISSION. WAVE-06 section 4.2 found that M06
// section 1.1 names the feed a launch surface and `feed.ts` implements it in 507
// lines while API_CONTRACT sections 8 and 9 carry no endpoint for it. `W6-e` is
// the slice that writes the row and it is the one slice in this wave that
// REQUIRES an ADR. Transcribing a feed shape here would mean inventing the
// contract this file exists to copy.
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
  readonly open_liability_cents: number;
  readonly funded_accounts: number;
  readonly eligible_next_7d: {
    readonly total_cents: number;
    readonly account_count: number;
    readonly by_day: readonly {
      readonly trading_day: string;
      readonly cents: number;
      readonly accounts: number;
    }[];
  };
  readonly payout_velocity: {
    readonly last_7d_cents: number;
    readonly avg_30d_cents: number;
    readonly ratio_bp: number;

    /** The server's verdict. `INV-M6-12`: no client recomputes an alarm. */
    readonly alarm: boolean;
  };

  /**
   * `P-M6-07`'s reserve position, and FLOAT IS NOT IN IT.
   *
   * That is the contract agreeing with `../liability.ts`, which computes the
   * ratio from reserve alone and renders float beside it. `AS-M20-08` names the
   * misreading this shape forecloses: a coverage ratio that counts wallet float
   * as reserve "flatters itself with the same money on both sides". There is no
   * float field on this response to add into `reserve_cents` by accident, and
   * `GET /admin/wallet/reconciliation` is where the float position lives.
   */
  readonly reserve: {
    readonly reserve_cents: number;
    readonly cvar99_cents: number;
    readonly rcr_bp: number;
    readonly breaker_armed: boolean;
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
    };
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
};
