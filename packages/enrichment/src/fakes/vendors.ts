// =============================================================================
// packages/enrichment/src/fakes/vendors.ts
// =============================================================================
// THREE FAKES, ONE PER FAILURE DIRECTION, AND NO VENDOR.
//
// `packages/psp` ships two fakes and `packages/rithmic` ships a simulator under
// M02 section 3.5 point 4, and this is that precedent rather than a new
// argument: the port's I/O method is the vendor's, so the implementations of it
// in this tree are fakes and say so in their own file name.
//
// THE THREE ARE THE THREE DIRECTIONS THE APPROVAL LINE NAMES. A vendor that
// answers (including one that answers with a maximal risk score), a vendor that
// does not answer inside the budget, and a vendor that answers with a failure.
// Each exists so the suite can WATCH the checkout commit rather than reason
// that it would.
//
// NO NAME, NO WIRE FORMAT, NO HEADERS. M03 section 7.9.1 makes portability
// history "a condition of acceptance" and the procurement is not reopened here,
// so these fakes model the SHAPE of an answer and nothing about a product.
// `packages/psp`'s two fakes deliberately agree on nothing mechanical because
// two payment providers really do differ in their wire formats; there is
// nothing equivalent to disagree about until a vendor is selected, and
// inventing a disagreement would be inventing a vendor.

import type {
  EnrichmentAdapter,
  EnrichmentAssessment,
  EnrichmentFacet,
  EnrichmentSubject,
  FacetFinding,
} from '../port.ts';
import { SCORE_SCALE_BP } from '../score.ts';

/** The role every fake plays. `contract.ts` states why this is the role and not the vendor. */
const INTEGRATION = 'enrichment';

/**
 * A finding with every reading at its most reputable, which scores to zero risk.
 *
 * `datacenter` IS `null` ON EVERY FACET BUT `ip`, which is rule 2 doing its
 * ordinary job: "this question does not apply" and "we did not find out" are
 * both "we did not learn a value", and neither is a `false`.
 */
function cleanFinding(facet: EnrichmentFacet, reference: string): FacetFinding {
  return {
    facet,
    reference,
    reputationBp: SCORE_SCALE_BP,
    footprintPresent: true,
    ageDays: 3650,
    datacenter: facet === 'ip' ? false : null,
  };
}

/** A finding with every reading at its worst, which scores to `SCORE_SCALE_BP`. */
function maximalFinding(facet: EnrichmentFacet, reference: string): FacetFinding {
  return {
    facet,
    reference,
    reputationBp: 0,
    footprintPresent: false,
    ageDays: 0,
    datacenter: true,
  };
}

/** A finding the vendor did not learn anything about. Every reading is rule 2's `null`. */
function unknownFinding(facet: EnrichmentFacet, reference: string): FacetFinding {
  return {
    facet,
    reference,
    reputationBp: null,
    footprintPresent: null,
    ageDays: null,
    datacenter: null,
  };
}

/** How a fake answers about each facet it was asked. */
export type FakeAnswer = 'clean' | 'maximal' | 'unknown';

const SHAPE: Record<FakeAnswer, (facet: EnrichmentFacet, reference: string) => FacetFinding> = {
  clean: cleanFinding,
  maximal: maximalFinding,
  unknown: unknownFinding,
};

/**
 * A vendor that answers, one finding per facet it was actually sent.
 *
 * IT ANSWERS ABOUT WHAT IT RECEIVED AND NOT ABOUT WHAT IT WAS ASKED FOR, which
 * is the property that lets the suite watch the allowlist doing its job: a
 * facet the contract row does not permit never reaches this function, so it
 * cannot appear in the findings and cannot become an `identity_signals` row.
 *
 * THE REFERENCE IS DERIVED FROM THE VALUE, so the same buyer produces the same
 * node twice and the read-then-write path in `observe.ts` is exercised in both
 * of its branches by two calls rather than by a fixture.
 */
export function answeringVendor(answer: FakeAnswer): EnrichmentAdapter {
  return {
    integration: INTEGRATION,
    assess(subject: EnrichmentSubject): Promise<EnrichmentAssessment> {
      const findings: FacetFinding[] = [];
      for (const [facet, value] of Object.entries(subject)) {
        if (value === undefined) continue;
        findings.push(SHAPE[answer](facet as EnrichmentFacet, `ref:${value}`));
      }
      return Promise.resolve({ findings });
    },
  };
}

/**
 * A vendor that never answers.
 *
 * IT RETURNS A PROMISE THAT NEVER SETTLES AND IGNORES THE SIGNAL, deliberately.
 * An adapter that honoured the abort would be testing the adapter's manners;
 * the property `observe.ts` claims is that a vendor with NO manners still loses
 * the race in `timeoutMs`, and only an adapter that ignores the signal can
 * demonstrate it.
 */
export function hangingVendor(): EnrichmentAdapter {
  return {
    integration: INTEGRATION,
    assess(): Promise<EnrichmentAssessment> {
      return new Promise<EnrichmentAssessment>(() => undefined);
    },
  };
}

/**
 * A vendor that answers with a failure.
 *
 * IT REJECTS RATHER THAN RETURNING AN ERROR SHAPE, because that is what a
 * network client does and because `assess`'s own contract says so: "@throws
 * anything at all. `observe.ts` catches it and the checkout commits."
 */
export function failingVendor(message = 'vendor unavailable'): EnrichmentAdapter {
  return {
    integration: INTEGRATION,
    assess(): Promise<EnrichmentAssessment> {
      return Promise.reject(new Error(message));
    },
  };
}

/**
 * A vendor that rejects LATE, after the budget has already expired.
 *
 * IT EXISTS FOR ONE PROPERTY AND IT IS A PROCESS-LEVEL ONE. A rejection
 * arriving after the race is over has no `await` waiting on it, and an
 * unhandled rejection in Node is a process exit. `callVendor` attaches the
 * handler when the call is made rather than when the result is used, and this
 * fake is how that is watched rather than asserted.
 */
export function lateFailingVendor(delayMs: number): EnrichmentAdapter {
  return {
    integration: INTEGRATION,
    assess(): Promise<EnrichmentAssessment> {
      return new Promise<EnrichmentAssessment>((_resolve, reject) => {
        setTimeout(() => reject(new Error('late vendor failure')), delayMs);
      });
    },
  };
}
