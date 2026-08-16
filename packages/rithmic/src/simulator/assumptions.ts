// =============================================================================
// packages/rithmic/src/simulator/assumptions.ts
// =============================================================================
// THE VENDOR-CALL DIFF, AS DATA RATHER THAN AS A PROMISE.
//
// M02 holds at `status: review` under ADR-005 and section 11's rows are
// unconfirmed, so this package is written against the PUBLIC CSV/SFTP
// description and every place the real spec could differ carries the
// `V-M2-nn` it depends on. The session brief's phrasing is the requirement:
// "when the vendor call happens, THAT COMMENT LIST IS THE DIFF."
//
// A comment list is only a diff if it is complete and if nothing has quietly
// fallen off it, and a hand-maintained list is exactly the class ADR-034 exists
// to end. So the list is a value, and `vendor-assumptions.test.ts` closes three
// ways at once:
//
//   1. IN_SCOPE + OUT_OF_SCOPE is EXACTLY section 11's row set, parsed from
//      M02 itself. Not a count, the set. A row added to M02 fails this file,
//      and a row invented here fails against M02.
//   2. Every IN_SCOPE id is cited by a `V-M2-nn` comment somewhere in `src/`.
//      An assumption nobody depends on is not an assumption, it is a decoration.
//   3. Every `V-M2-nn` comment in `src/` is an IN_SCOPE id. A citation on a row
//      this package claims not to depend on is one of the two lists being wrong.
//
// -----------------------------------------------------------------------------
// WHY OUT_OF_SCOPE IS WRITTEN OUT INSTEAD OF LEFT AS AN ABSENCE
// -----------------------------------------------------------------------------
// M02 section 8.2 does this and states the reason: "saying so here is cheaper
// than a later reader concluding the suite is two cases short." Five of the
// sixteen rows are about provisioning, billing reconciliation, the commercial
// precondition, and the streaming tier, and none of them is a property of an
// inbound EOD file. A reader counting eleven citations against a sixteen-row
// table must be able to find out why in this file rather than by auditing the
// package.
// =============================================================================

/** One row of section 11, as this package depends on it. */
export interface VendorAssumption {
  /** `V-M2-nn`, exactly as M02 section 11 spells it. */
  readonly id: string;
  /** What this package assumed, in its own terms rather than M02's. */
  readonly assumed: string;
  /** What in this package stops being true if the call says otherwise. */
  readonly whatMoves: string;
}

/** A row this package's file mode does not depend on, and why. */
export interface OutOfScopeAssumption {
  readonly id: string;
  readonly why: string;
}

/**
 * The rows the synthetic simulator's FILE MODE depends on.
 *
 * Ordered by id, which is section 11's own order, so the two read side by side.
 */
export const FILE_MODE_VENDOR_ASSUMPTIONS: readonly VendorAssumption[] = Object.freeze([
  {
    id: 'V-M2-01',
    assumed:
      'The EOD report is a per-account CSV. Money is stated as decimal currency rather than ' +
      'as minor units, prices are decimal rather than fractional, instants are ISO-8601 UTC, ' +
      'and the intraday high and low are present. THE LAST OF THOSE IS NOT NAMED BY THE ROW ' +
      'and a mark cannot be computed without it (0014, GLOSSARY); it is recorded in ' +
      "eod-report.ts's header and the README rather than added to a table this session does " +
      'not own.',
    whatMoves:
      'The column list in eod-report.ts, formatMoney and formatPrice in csv.ts. If the ' +
      'extremes are absent the blast is DESIGN rather than EDIT: they are not derivable from ' +
      'closed round trips, so either the fills file must carry the path or tier 2 stops being ' +
      'indicative, which INV-M2-14 forbids.',
  },
  {
    id: 'V-M2-02',
    assumed:
      'The report states a session date, so `session_date` is comparable against our calendar ' +
      'containment and SD-M2-04 has two values to keep beside each other.',
    whatMoves:
      "The `session_date` column and SimSession's contract. Without it the divergence signal " +
      'AS-M2-06 depends on is gone and containment is all there is.',
  },
  {
    id: 'V-M2-03',
    assumed:
      'A redelivery is either byte-identical or carries correction markers, so a scenario can ' +
      'state its intent by re-emitting the same bytes (duplicate_ignored) or new bytes under a ' +
      'revision suffix.',
    whatMoves:
      'The file-naming and revision handling in emit.ts. If full_replacement is the common ' +
      'case rather than the exception, every applied day needs an explicit supersession path ' +
      'and the emitter needs to be able to produce one deliberately.',
  },
  {
    id: 'V-M2-04',
    assumed:
      'One post-session delivery per trading day, with no contractual arrival time, so a file ' +
      'name identifies a day and `report_generated_at` is derived from the session close plus ' +
      'a stated lag rather than read from a clock.',
    whatMoves:
      'The one-file-per-day-per-kind naming in emit.ts and the `report_generated_at` column. ' +
      'Multiple or partial deliveries need a completeness-of-delivery concept the emitter ' +
      'cannot express today.',
  },
  {
    id: 'V-M2-05',
    assumed:
      'Non-trading balance movements are applied BETWEEN sessions and are distinguishable in ' +
      'the report, which is why the adjustment lands at the open (opening == prior closing + ' +
      'adjustment) and why `cash_adjustment` and `cash_adjustment_note` are separate columns.',
    whatMoves:
      'The day model in session.ts and two columns. If movements land intraday, daily_marks ' +
      "needs an adjustment timestamp and M01's breach comparison changes shape. This is the " +
      'second-highest risk in the corpus and the emitter cannot soften it.',
  },
  {
    id: 'V-M2-08',
    assumed:
      "The account's current risk setting and its liquidation events are visible in the " +
      'report, so `risk_max_loss`, `liquidation_event`, `liquidation_time` and ' +
      '`liquidation_criterion` are columns and an unreadable setting is an EMPTY cell rather ' +
      'than a zero.',
    whatMoves:
      'Four columns and the unprotected share of the population. Without them setpoint ' +
      "reconciliation has only AS-M2-03's behavioural fallback, which fires after an " +
      'excursion has already happened.',
  },
  {
    id: 'V-M2-09',
    assumed:
      'Billing is per login-month per user, so the report carries a user ref beside the ' +
      'account ref and a population may put several accounts on one user.',
    whatMoves:
      'The `user_id` column and the accountsPerUser grouping. Without an attributable user ' +
      'the invoice is unreconcilable from inside, which is AS-M2-04 unmeasurable.',
  },
  {
    id: 'V-M2-10',
    assumed:
      'Account references are never recycled, so refs are allocated monotonically from ' +
      'firstRefOrdinal and no two synthetic accounts ever share one.',
    whatMoves:
      'Ref allocation in population.ts. If reuse is forced, every reference needs a Merit-side ' +
      'surrogate with an explicit epoch and the simulator must be able to emit a recycled ref ' +
      'on purpose, which is AS-M2-05 and today it cannot.',
  },
  {
    id: 'V-M2-11',
    assumed:
      'Per-fill detail exists, in the EOD file or a sibling, so the simulator emits a fills ' +
      'file alongside the summary and `daily_marks.fill_count` has a source.',
    whatMoves:
      "The whole of fills-report.ts. Without it M7's clustering detectors are gone, the " +
      'evidence pack degrades to day level, and `traded_day` has to be inferred from something ' +
      'other than a fill count.',
  },
  {
    id: 'V-M2-12',
    assumed:
      'Corrections reference the original fill, so `corrects_fill_id` is a column that file ' +
      'mode always leaves empty and a correction session fills in.',
    whatMoves:
      'One column, and the ingest layer synthesizes a correction row from a restatement ' +
      'instead. Already designed for, which is what makes this an edit.',
  },
  {
    id: 'V-M2-13',
    assumed:
      'No vendor sandbox is available before a contract exists, which is why this package is a ' +
      'v1 requirement rather than a convenience: it is the only way the pipeline runs end to ' +
      'end before there is an agreement.',
    whatMoves:
      "Nothing in the code. A sandbox collapses AS-M2-01's residual to near zero and makes " +
      'the conformance suite a diff against real files rather than against assumptions.',
  },
]);

/** The rows a file-mode simulator has no way to depend on. */
export const OUT_OF_SCOPE_FOR_FILE_MODE: readonly OutOfScopeAssumption[] = Object.freeze([
  {
    id: 'V-M2-06',
    why:
      'A provisioning acknowledgement artifact is an OUTBOUND concern. This package reads ' +
      'nothing back and writes no provisioning file.',
  },
  {
    id: 'V-M2-07',
    why:
      'Whether re-uploading an identical filename is safe is a property of the outbound ' +
      'SFTP path, not of an inbound report.',
  },
  {
    id: 'V-M2-14',
    why: 'Server-side copy configuration is module scope and touches no report shape.',
  },
  {
    id: 'V-M2-15',
    why:
      'A commercial precondition rather than a wire format. M02 section 8.2 says its ' +
      'conformance case asserts the CONSEQUENCE (fail-closed provisioning, INV-M2-13 and ' +
      'INV-M2-15), which lives in the provisioning saga and not here.',
  },
  {
    id: 'V-M2-16',
    why:
      "ADR-020's tier 2. Streaming mode is a LATER SESSION by the standing brief; the seam " +
      'it attaches to is SimDay.waypoints in session.ts and the assumption becomes in-scope ' +
      'on the day that session lands.',
  },
]);
