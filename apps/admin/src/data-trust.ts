// =============================================================================
// apps/admin/src/data-trust.ts
// =============================================================================
// P-M6-09, WHICH IS LISTED LAST AND RENDERS FIRST.
//
// M06 section 3.1 says why in one sentence: "Data trust gates every other
// number: an open reconciliation mismatch or a replay divergence means the
// liability figures are computed from state we have said we do not trust.
// Rendering them adjacent, with the trust panel above, is the difference
// between a dashboard and a dashboard that misleads."
//
// FM-M6-01's recovery line is the requirement this file implements: **"the page
// must REFUSE TO LOOK HEALTHY while data trust is red"**. Not a badge. Not a
// colour. A verdict that the page carries into every figure below it.
//
// -----------------------------------------------------------------------------
// A SIGNAL NOBODY SUPPLIED IS RED, AND THAT IS THE LOAD-BEARING DECISION HERE
// -----------------------------------------------------------------------------
// The obvious implementation treats the five inputs as optional and reports
// green on the ones it has. That implementation is green on an empty input,
// which means the trust panel reads healthiest at exactly the moment M2 has
// stopped answering.
//
// DEP-M6-04 states the consequence from the other end: if M2 does not supply
// recon status, completeness gap and unconfirmed setpoints, "P-M6-09 cannot
// gate the page and every number renders as if trustworthy". So an absent
// signal is a red signal with a stated reason, on `repo-invariants.mjs`'s own
// rule: A CHECK THAT CANNOT RUN IS NOT A CHECK THAT PASSED.
//
// -----------------------------------------------------------------------------
// NO STALENESS THRESHOLD IS INVENTED HERE
// -----------------------------------------------------------------------------
// `admin.liability_snapshot_age` is a METRIC in section 9 and no ruling gives it
// a setpoint. A session that picked one would have invented a control: the
// number would then decide whether the page looks healthy, and nobody chose it.
// Each signal carries its own `as_of` (INV-M6-04) and the page renders the age
// beside it, which is arithmetic on stated data. Judging it is the reader's,
// until a ruling says otherwise.
// =============================================================================

import { type AsOf, FigureError } from './figure.js';

/** Thrown when data trust cannot be assessed. Never resolved to green. */
export class DataTrustError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataTrustError';
  }
}

/**
 * P-M6-09's inputs, verbatim from section 3.1: "recon mismatches open, marks
 * completeness gap, unconfirmed setpoints, replay divergences, batch
 * last-success".
 *
 * THE SET IS CLOSED AND EVERY MEMBER IS REQUIRED. A sixth input is a change to
 * the panel, which is a change to the plan, not a value a caller passes.
 */
export const TRUST_KEYS = [
  'recon_mismatches_open',
  'marks_completeness_gap',
  'unconfirmed_setpoints',
  'replay_divergences',
  'batch_last_success',
] as const;

export type TrustKey = (typeof TRUST_KEYS)[number];

/** What the page prints for each input when it has one. */
const TRUST_LABELS: Readonly<Record<TrustKey, string>> = {
  recon_mismatches_open: 'Recon mismatches open',
  marks_completeness_gap: 'Marks completeness gap',
  unconfirmed_setpoints: 'Unconfirmed setpoints',
  replay_divergences: 'Replay divergences',
  batch_last_success: 'Batch last success',
};

/** Who owes each input, named on the missing row so the gap has an owner. */
const TRUST_SUPPLIERS: Readonly<Record<TrustKey, string>> = {
  recon_mismatches_open: 'M2, DEP-M6-04',
  marks_completeness_gap: 'M2, DEP-M6-04',
  unconfirmed_setpoints: 'M2, DEP-M6-04',
  replay_divergences: 'M1 replay self-audit',
  batch_last_success: 'the nightly batch',
};

export type TrustState = 'ok' | 'red';

/** One of P-M6-09's five inputs, as its supplier reported it. */
export interface TrustSignal {
  readonly key: TrustKey;
  readonly state: TrustState;
  /**
   * The figure behind the state, in words: "3 mismatches open", "0 divergences".
   * A state with no detail is a verdict a reader cannot check.
   */
  readonly detail: string;
  /** INV-M6-04 binds here too. A trust signal is a number on this page. */
  readonly asOf: AsOf;
}

/** A signal nobody supplied, which is a red signal that names its owner. */
export interface MissingSignal {
  readonly key: TrustKey;
  readonly label: string;
  readonly reason: string;
}

/** P-M6-09, assessed. The verdict is what every figure below it inherits. */
export interface DataTrust {
  readonly verdict: TrustState;
  /** The supplied inputs, in `TRUST_KEYS` order. */
  readonly signals: readonly (TrustSignal & { readonly label: string })[];
  /** The inputs nobody supplied. Non-empty means the verdict is red. */
  readonly missing: readonly MissingSignal[];
  /** The sentence the page prints above every number. */
  readonly statement: string;
}

const RED_STATEMENT =
  'DATA TRUST IS RED. Every number below is computed from state Merit has said it does not ' +
  'trust, and is suspect until this panel is green. FM-M6-01: the page must refuse to look ' +
  'healthy while data trust is red.';

const OK_STATEMENT =
  'Data trust is green: all five of P-M6-09 inputs answered and none is in a bad state. Every ' +
  'figure below still carries its own as-of, because green is not the same as fresh.';

function isTrustKey(key: string): key is TrustKey {
  return (TRUST_KEYS as readonly string[]).includes(key);
}

/**
 * Assess P-M6-09 from whatever its suppliers reported.
 *
 * Red if any signal is red OR any of the five is missing. Green only when all
 * five answered and none is bad.
 */
export function assessDataTrust(supplied: readonly TrustSignal[]): DataTrust {
  const byKey = new Map<TrustKey, TrustSignal>();
  for (const signal of supplied) {
    if (!isTrustKey(signal.key))
      throw new DataTrustError(
        `${JSON.stringify(String(signal.key))} is not one of P-M6-09 five inputs; ` +
          'a sixth input is a change to the panel rather than a value a caller passes',
      );
    if (byKey.has(signal.key))
      throw new DataTrustError(
        `two answers supplied for ${signal.key}, and a trust panel with two answers to one ` +
          'question is a trust panel that will be quoted selectively',
      );
    if (signal.detail.trim() === '')
      throw new DataTrustError(
        `${signal.key} reported ${signal.state} with no detail, and a verdict a reader cannot ` +
          'check is the kind of control that gets muted',
      );
    // INV-M6-04 on a trust signal, enforced by the same constructor every other
    // number on this page goes through.
    if (signal.asOf.source.trim() === '' || !signal.asOf.instant.endsWith('Z'))
      throw new FigureError(
        `${signal.key} carries no usable as-of: INV-M6-04 binds a trust signal exactly as it ` +
          'binds a liability figure',
      );
    byKey.set(signal.key, signal);
  }

  const signals = TRUST_KEYS.filter((key) => byKey.has(key)).map((key) => {
    const signal = byKey.get(key);
    if (signal === undefined) throw new DataTrustError(`unreachable: ${key} filtered but absent`);
    return { ...signal, label: TRUST_LABELS[key] };
  });

  const missing: MissingSignal[] = TRUST_KEYS.filter((key) => !byKey.has(key)).map((key) => ({
    key,
    label: TRUST_LABELS[key],
    reason:
      `not supplied by ${TRUST_SUPPLIERS[key]}. An unanswered trust input is RED, never green: ` +
      'a check that cannot run is not a check that passed',
  }));

  const anyRed = signals.some((signal) => signal.state === 'red');
  const verdict: TrustState = anyRed || missing.length > 0 ? 'red' : 'ok';

  return {
    verdict,
    signals,
    missing,
    statement: verdict === 'red' ? RED_STATEMENT : OK_STATEMENT,
  };
}
