// =============================================================================
// packages/enrichment/src/observe.ts
// =============================================================================
// OBSERVE MODE. THE SIGNALS ARE RECORDED AND SCORED AND NOTHING IS BLOCKED.
//
// ADR-023's rollout is graduated and this is step 1, in its own words: "Observe
// mode from launch. Signals recorded, scored, and reported; nothing is blocked.
// The purpose is to learn the distribution on Merit's own traffic." Step 3, the
// soft decline plus review queue, is not this file's and is not reachable from
// it.
//
// -----------------------------------------------------------------------------
// THREE STRUCTURAL CONTROLS, IN PLACE OF A COMMENT SAYING IT IS NON-BLOCKING
// -----------------------------------------------------------------------------
//   1. `observeEnrichment` RETURNS `Promise<void>`. There is no value for a
//      call site to branch on, so "an enrichment outcome changes what checkout
//      returns" is not a code path somebody has to avoid writing: it is a shape
//      that does not exist. This is `packages/psp`'s "nothing in the interface
//      returns a decision" tightened one notch, because a payment port at least
//      reports what the provider said and this one reports nothing at all to
//      its caller.
//
//   2. IT NEVER THROWS. Every direction is caught. A throw inside checkout's
//      transaction is a ROLLBACK, so a throwing enrichment call is enforcement
//      by exception, and enforcement by exception is a SILENT decline: the
//      customer is refused and told nothing, which ADR-023's step 3 forbids
//      even in the mode that is allowed to refuse.
//
//   3. THE REPORT IS A SINK AND NOT A RETURN VALUE. The outcome goes to an
//      injected reporter, which is the surface RB-11 step 5 means by "watch the
//      enrichment vendor separately", and the reporter's own throw is caught
//      too. An observability call that can abort a purchase is the same defect
//      one layer out.
//
// -----------------------------------------------------------------------------
// THE TIMEOUT, AND WHAT HAPPENS ON EACH SIDE OF IT
// -----------------------------------------------------------------------------
// This runs INSIDE checkout's transaction, so a vendor that hangs is a
// transaction that stays open and a connection that stays held. The budget is
// `ENRICHMENT_TIMEOUT_MS` and it is exported rather than passed, so an operator
// reading one constant learns the whole latency checkout carries for this.
//
// THE RACE IS AGAINST THE PROMISE AND NOT AGAINST THE ADAPTER'S GOOD BEHAVIOUR.
// The `AbortSignal` is passed so an adapter CAN drop its socket, and nothing
// here depends on it doing so: an adapter that ignores the signal loses the
// race exactly as fast as one that honours it. The abandoned call is given its
// rejection handler at the moment it is made, so a failure arriving after the
// request is gone cannot surface as an unhandled rejection and take the process
// with it.
//
// WHEN IT FIRES: nothing from the vendor is recorded, because there is nothing
// to record; the DISPATCH row is still written, because the subject already
// LEFT MERIT and `integration_dispatches` answers "what did we send about this
// person" rather than "what did we get back"; the outcome is reported; and this
// function RESOLVES, so the purchase commits.
//
// -----------------------------------------------------------------------------
// THE WRITE IS A READ THEN A WRITE, AND THAT IS A MIGRATION READ RATHER THAN A
// PREFERENCE
// -----------------------------------------------------------------------------
// `identity_signals_identity_kind_value_uq` is a `CREATE UNIQUE INDEX` on
// `(identity_id, kind, value_hash)` in `0002_identity.sql`. A returning trader
// buying a second account presents the same enrichment references, so a blind
// insert raises `23505` on the ORDINARY path, and inside checkout's transaction
// a `23505` makes Postgres turn the `COMMIT` into a `ROLLBACK`. That is
// enrichment blocking a purchase through the database rather than through a
// decision, and it is exactly what this ruling forecloses.
//
// THE UPSERT THAT WOULD CLOSE IT IS NOT AVAILABLE FROM HERE AND IS NAMED
// RATHER THAN REACHED AROUND. ADR-112's `updateAt` needs an address containing
// a unique key `schema.ts` DECLARES, `uniqueKeys()` reads Drizzle's primary and
// unique CONSTRAINTS and deliberately not a `uniqueIndex`, and the
// transcription declares no key for that index, so `{ kind, valueHash }` is
// refused and `{ id }` is the only address this table has. An `ON CONFLICT` or
// a savepoint would close the residual race below, and both are diffs on
// `packages/db/src/scoped-db.ts`, which is outside this session's fence.
//
// THE RESIDUAL, STATED: two checkouts by ONE identity, in flight at the same
// moment, presenting the same reference, can both read no row and both insert.
// The loser gets `23505` and its purchase rolls back. It is narrow, it is real,
// and ADR-115 records it with the two constructions that would close it.

import { createHash } from 'node:crypto';

import {
  ENRICHMENT_EVENT_NAME,
  ENRICHMENT_INTEGRATION,
  readLiveContract,
  redactToAllowlist,
  type ContractSource,
} from './contract.ts';
import type {
  EnrichmentAdapter,
  EnrichmentAssessment,
  EnrichmentFacet,
  EnrichmentSubject,
  FacetFinding,
} from './port.ts';
import { scoreAssessment, type FootprintScore } from './score.ts';
import type { EnrichmentTx } from './tx.ts';

/**
 * The whole latency budget checkout carries for enrichment, in INTEGER
 * milliseconds.
 *
 * A CONSTANT AND NOT A CALL-SITE ARGUMENT, so the number is read in one place
 * by whoever is answering "how long can a purchase wait on a fraud signal". The
 * `timeoutMs` override on `ObserveDeps` exists so a suite can watch the timeout
 * fire without waiting for it, and a route that passed it would be moving a
 * shared budget into one caller.
 */
export const ENRICHMENT_TIMEOUT_MS = 800;

/**
 * `U-04`. The `identity_signals.kind` the corpus created for exactly this
 * vendor, in `0002_identity.sql` and re-declared under an explicit constraint
 * name in `0029`.
 */
export const ENRICHMENT_SIGNAL_KIND = 'footprint_enrichment';

/** What happened, as one closed word. */
export type ObserveOutcomeKind =
  /** No enabled `integration_contracts` row. Nothing was sent and nothing was asked. */
  | 'not_configured'
  /** A contract, and nothing this checkout holds that it permits. No call was made. */
  | 'nothing_to_send'
  /** The subject left Merit and the vendor did not answer inside the budget. */
  | 'timed_out'
  /** The subject left Merit and the vendor answered with a failure. */
  | 'vendor_error'
  /** The vendor answered, the signals are recorded and the score is in this outcome. */
  | 'recorded'
  /**
   * A write failed.
   *
   * BY THE TIME THIS IS REPORTED THE CALLER'S TRANSACTION IS ALREADY ABORTED,
   * and that is why swallowing the error is not hiding anything: Postgres put
   * the transaction into the aborted state at the failing statement, its
   * `COMMIT` is already a `ROLLBACK`, and the only thing this catch changes is
   * that checkout is not ALSO handed a second exception from a path that
   * decides nothing.
   */
  | 'record_failed';

/** An age the vendor reported, carried so it can be measured and NOT scored. See `score.ts`. */
export interface RecordedAge {
  readonly facet: EnrichmentFacet;
  readonly ageDays: number;
}

/** Everything one observation produced, for the sink. Never returned to the caller. */
export interface ObserveOutcome {
  readonly kind: ObserveOutcomeKind;
  readonly integration: string;
  readonly eventName: string;
  /** WHAT ACTUALLY WENT. Empty whenever no call was made. */
  readonly fieldsSent: readonly EnrichmentFacet[];
  /** `identity_signals` rows created by this observation. */
  readonly signalsInserted: number;
  /** `identity_signals` rows whose `observation_count` this observation advanced. */
  readonly signalsUpdated: number;
  /** The score, or `null` when there was nothing to score. */
  readonly score: FootprintScore | null;
  /** Reported by the vendor, recorded here, contributing nothing to the score. */
  readonly ages: readonly RecordedAge[];
  /** Names the contract permits that this integration cannot produce. See `contract.ts`. */
  readonly unknownAllowlistNames: readonly string[];
  /** Wall clock across the vendor call, in INTEGER milliseconds. Zero when no call was made. */
  readonly vendorElapsedMs: number;
  /** The failure's message, or `null`. Never an object, so a sink cannot serialise a subject. */
  readonly failure: string | null;
}

/** Where an outcome is reported. Its own throw is caught. */
export type ObserveReporter = (outcome: ObserveOutcome) => void;

/** Everything the observation needs, injected, because this package reaches nothing on its own. */
export interface ObserveDeps {
  readonly adapter: EnrichmentAdapter;
  /** The `firm` reader for the contract row. `firmDb()` satisfies it. See `contract.ts`. */
  readonly contracts: ContractSource;
  /** What checkout knows, BEFORE the allowlist narrows it. */
  readonly subject: EnrichmentSubject;
  /**
   * `purchases.id`, which is this disclosure's idempotency key.
   *
   * `integration_dispatches_idempotency_uq` is `UNIQUE (integration,
   * idempotency_key)`, so ONE enrichment disclosure exists per purchase. A
   * retried payment attempt is a new session against the SAME purchase (M03
   * section 3.2), and asking the vendor twice about one purchase would be two
   * disclosures of the same person for one event.
   */
  readonly purchaseId: string;
  /** The clock, injected so a suite is deterministic. */
  readonly now: () => Date;
  readonly report: ObserveReporter;
  /** Overrides `ENRICHMENT_TIMEOUT_MS`. For suites, not for routes. */
  readonly timeoutMs?: number;
}

/** One `identity_signals` row, in the two columns the update path reads. */
interface SignalRow {
  readonly id: string;
  readonly observationCount: number;
}

function asSignalRow(row: unknown): SignalRow {
  if (typeof row !== 'object' || row === null) {
    throw new TypeError(`identity_signals row is ${String(row)} and not a row.`);
  }
  const candidate = row as Record<string, unknown>;
  const { id, observationCount } = candidate;
  if (typeof id !== 'string' || typeof observationCount !== 'number') {
    throw new TypeError(
      'identity_signals row does not carry id as a string and observationCount as a number: ' +
        `${JSON.stringify(Object.keys(candidate))}. The accessor returns unknown[] and this ` +
        'package establishes the shape rather than assuming it.',
    );
  }
  return { id, observationCount };
}

/**
 * The node's digest.
 *
 * `INV-M7-08`: hashed, NEVER raw. `identity_signals.value_hash` is `bytea` and
 * the DDL's own comment says a row is evidence of a MATCH rather than a copy of
 * the value that matched, so a breach of that table yields "these two accounts
 * shared something" instead of the value they shared.
 *
 * THE FACET IS INSIDE THE DIGEST AND NOT ONLY BESIDE IT, with a separator that
 * cannot occur in a facet name. Without it, a vendor that happened to issue the
 * same reference string for a device and for an IP would collide into ONE node,
 * and the entity graph would report a link that is an encoding accident.
 */
function signalDigest(facet: EnrichmentFacet, reference: string): Uint8Array {
  return createHash('sha256').update(`${facet}|${reference}`, 'utf8').digest();
}

/** Record one finding. Returns whether it created a node or advanced an existing one. */
async function recordFinding(
  tx: EnrichmentTx,
  finding: FacetFinding,
  at: Date,
): Promise<'inserted' | 'updated'> {
  const valueHash = signalDigest(finding.facet, finding.reference);
  const found = await tx.rowsWhere('identitySignals', {
    kind: ENRICHMENT_SIGNAL_KIND,
    valueHash,
  });

  if (found.length === 0) {
    // `identityId` IS ABSENT ON PURPOSE. It is this table's tenancy column, the
    // scoped handle stamps it, and `refuseTenancyColumn` throws on a caller
    // that names it: "the handle supplies it on insert".
    //
    // `valuePreview` IS THE FACET NAME AND NOTHING ELSE. The column is "a
    // non-identifying display fragment for admin ... deliberately not enough to
    // reconstruct what it previews", and the facet name says which question was
    // asked without saying anything about the answer.
    await tx.insert('identitySignals', {
      kind: ENRICHMENT_SIGNAL_KIND,
      valueHash,
      valuePreview: finding.facet,
      firstSeenAt: at,
      lastSeenAt: at,
      observationCount: 1,
    });
    return 'inserted';
  }

  // ADDRESSED BY `id` BECAUSE `id` IS THE ONLY ADDRESS THIS TABLE HAS. The
  // natural key is a `uniqueIndex` and `uniqueKeys()` reads constraints, so
  // `{ kind, valueHash }` is refused by `refuseUnaddressed`. The header states
  // the whole argument.
  //
  // A LOST INCREMENT IS A COUNT AND NOT A CORRECTNESS FAILURE. Two concurrent
  // observations of one node can both read the same `observation_count` and
  // both write one more than it, so the counter can undercount under
  // contention. It is a weak-signal weight (`0002`'s own word), the node itself
  // is exact, and no atomic increment is reachable through the accessor.
  const row = asSignalRow(found[0]);
  await tx.updateAt(
    'identitySignals',
    { id: row.id },
    { lastSeenAt: at, observationCount: row.observationCount + 1 },
  );
  return 'updated';
}

/**
 * Record the disclosure.
 *
 * WRITTEN WHENEVER THE SUBJECT LEFT MERIT, INCLUDING ON A TIMEOUT AND ON AN
 * ERROR. `integration_dispatches` answers "what did we send about this person",
 * which "a privacy deletion request and a vendor breach ask ... IDENTICAL"; a
 * vendor that received a buyer's email and then failed to answer received it
 * exactly as much as one that answered.
 *
 * `eventId` IS NULL AND `responseCode` IS NULL. The first because this is a
 * synchronous lookup rather than a dispatch off M10's outbound bus, and the
 * column is nullable for cases like it. The second because `EnrichmentAdapter`
 * carries no transport status, deliberately: a port that reported an HTTP code
 * would be a port that knew it was HTTP.
 */
async function recordDispatch(
  tx: EnrichmentTx,
  deps: ObserveDeps,
  fieldsSent: readonly EnrichmentFacet[],
  status: 'sent' | 'failed',
  dispatchedAt: Date,
): Promise<void> {
  await tx.insert('integrationDispatches', {
    integration: deps.adapter.integration,
    eventId: null,
    fieldsSent: [...fieldsSent],
    status,
    attempts: 1,
    responseCode: null,
    // `integration_dispatches_sent_has_timestamp` CHECKs that a `sent` row
    // carries one. It is written on both statuses because the moment the data
    // left is the fact the breach query needs either way.
    dispatchedAt,
    idempotencyKey: `${ENRICHMENT_EVENT_NAME}:${deps.purchaseId}`,
  });
}

/** Report without letting the sink reach the caller. */
function safeReport(report: ObserveReporter, outcome: ObserveOutcome): void {
  try {
    report(outcome);
  } catch {
    // AN OBSERVABILITY CALL CANNOT ABORT A PURCHASE. This is control 3 and it
    // is the same argument as control 2 one layer out.
  }
}

/** The message of whatever was thrown, never the object, so a sink cannot serialise a subject. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Every field of an outcome that a path which asked nothing leaves at its zero. */
const EMPTY_OUTCOME = {
  integration: ENRICHMENT_INTEGRATION,
  eventName: ENRICHMENT_EVENT_NAME,
  fieldsSent: [] as readonly EnrichmentFacet[],
  signalsInserted: 0,
  signalsUpdated: 0,
  score: null,
  ages: [] as readonly RecordedAge[],
  unknownAllowlistNames: [] as readonly string[],
  vendorElapsedMs: 0,
  failure: null,
} as const;

/** What the race produced. `timed_out` is a VALUE here rather than an exception. */
type VendorResult =
  | { readonly kind: 'answered'; readonly assessment: EnrichmentAssessment }
  | { readonly kind: 'failed'; readonly error: unknown }
  | { readonly kind: 'timed_out' };

/**
 * Call the vendor with a hard budget.
 *
 * THE ADAPTER'S PROMISE IS HANDLED BEFORE IT IS RACED. `.then(onFulfilled,
 * onRejected)` gives the rejection a handler at the moment the call is made, so
 * a failure arriving after the timeout has already been reported settles a
 * promise nobody is waiting on instead of becoming an unhandled rejection.
 */
async function callVendor(
  adapter: EnrichmentAdapter,
  subject: EnrichmentSubject,
  timeoutMs: number,
): Promise<VendorResult> {
  const controller = new AbortController();
  const settled: Promise<VendorResult> = adapter.assess(subject, controller.signal).then(
    (assessment): VendorResult => ({ kind: 'answered', assessment }),
    (error: unknown): VendorResult => ({ kind: 'failed', error }),
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<VendorResult>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timed_out' }), timeoutMs);
  });

  try {
    const result = await Promise.race([settled, expiry]);
    if (result.kind === 'timed_out') controller.abort();
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The body, so `observeEnrichment` is nothing but the catch that makes it total. */
async function run(tx: EnrichmentTx, deps: ObserveDeps): Promise<ObserveOutcome> {
  const contract = await readLiveContract(deps.contracts);
  if (contract === undefined) {
    // NO ENABLED CONTRACT MEANS NO CALL AT ALL. Nothing crosses the boundary
    // without a row a person approved, and a checkout with no enrichment is a
    // checkout that commits exactly as it would have.
    return { ...EMPTY_OUTCOME, kind: 'not_configured' };
  }

  const redacted = redactToAllowlist(contract, deps.subject);
  const base = {
    ...EMPTY_OUTCOME,
    fieldsSent: redacted.fieldsSent,
    unknownAllowlistNames: redacted.unknownAllowlistNames,
  };
  if (redacted.fieldsSent.length === 0) {
    return { ...base, kind: 'nothing_to_send' };
  }

  const budgetMs = deps.timeoutMs ?? ENRICHMENT_TIMEOUT_MS;
  const startedAt = deps.now();
  const result = await callVendor(deps.adapter, redacted.subject, budgetMs);
  const finishedAt = deps.now();
  const vendorElapsedMs = finishedAt.getTime() - startedAt.getTime();

  if (result.kind !== 'answered') {
    await recordDispatch(tx, deps, redacted.fieldsSent, 'failed', startedAt);
    return {
      ...base,
      kind: result.kind === 'timed_out' ? 'timed_out' : 'vendor_error',
      vendorElapsedMs,
      failure:
        result.kind === 'timed_out' ? `no answer within ${budgetMs}ms` : messageOf(result.error),
    };
  }

  await recordDispatch(tx, deps, redacted.fieldsSent, 'sent', startedAt);

  let signalsInserted = 0;
  let signalsUpdated = 0;
  const ages: RecordedAge[] = [];
  for (const finding of result.assessment.findings) {
    if (finding.ageDays !== null && Number.isInteger(finding.ageDays)) {
      ages.push({ facet: finding.facet, ageDays: finding.ageDays });
    }
    const written = await recordFinding(tx, finding, finishedAt);
    if (written === 'inserted') signalsInserted += 1;
    else signalsUpdated += 1;
  }

  return {
    ...base,
    kind: 'recorded',
    signalsInserted,
    signalsUpdated,
    score: scoreAssessment(result.assessment),
    ages,
    vendorElapsedMs,
  };
}

/**
 * Observe one checkout, and decide NOTHING.
 *
 * `Promise<void>` IS CONTROL 1 AND THE `try` IS CONTROL 2. Together they are
 * the approval line: an enrichment call that times out, errors or returns a
 * maximal risk score leaves the checkout COMMITTED and reports the outcome.
 *
 * IT TAKES THE OPEN TRANSACTION AS ITS FIRST ARGUMENT WITH NO OVERLOAD THAT
 * OMITS IT, so the observation commits with the purchase that caused it or not
 * at all, and this package cannot open a connection of its own.
 */
export async function observeEnrichment(tx: EnrichmentTx, deps: ObserveDeps): Promise<void> {
  try {
    safeReport(deps.report, await run(tx, deps));
  } catch (error) {
    safeReport(deps.report, {
      ...EMPTY_OUTCOME,
      kind: 'record_failed',
      failure: messageOf(error),
    });
  }
}
