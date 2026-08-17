// =============================================================================
// packages/golden-loader/src/polarity.ts
// =============================================================================
// ADR-048's LOADER HALF. The ruling, in its own words:
//
//   "Polarity is derived PER FIXTURE, from the rules the fixture already cites.
//    The engine exports the set of rule identifiers it implements. If every
//    rule a fixture's `source` cites is in that set, the fixture is `direct`
//    and must match; otherwise it is `inverted` and must fail."
//
// NO FIXTURE IS EDITED AND NO FLAG IS INTRODUCED, which is the property the
// superseded design had and which this one has to keep. `pending: true` is
// refused by name in this package's own source and by TR-03: it is the quiet
// direction, and its whole purpose is to let one fixture stop asserting without
// anybody deciding to. Nothing here is written in a fixture at all.
//
// -----------------------------------------------------------------------------
// WHAT THE RETIRED PROBE NAMED, CARRIED FORWARD AS ADR-048 REQUIRES
// -----------------------------------------------------------------------------
// `engineIsIdentityStub()` folded one probe day and tested reference equality
// on the returned state. ADR-048 supersedes it "with its header's warning
// carried forward, because the case it names -- an engine that returns its
// input by reference and emits nothing -- is still worth a comment where the
// new derivation lives". This is that place, and the warning turned out to
// have more teeth than a comment: see `declarationReachesTheFold` below.
// =============================================================================

// THIS MODULE IMPORTS NOTHING, AND THAT IS THE SAME ARGUMENT compare.ts MAKES
// FOR ITSELF: it is "deliberately separable from everything that reads a file,
// so the assertion that it FAILS ... can be made against hand-built states
// rather than against whatever the engine happens to do today". The declared
// rule set is a PARAMETER rather than an import for exactly that reason. The
// engine's real `IMPLEMENTED_RULES` is supplied by coverage.ts, which is the
// wiring; the derivation itself can then be seeded and watched failing in a
// tree that has no `node_modules` to resolve the engine through at all.

/**
 * `direct`: the fixture must MATCH. `inverted`: the fixture must FAIL.
 *
 * Under inversion a fixture that matches is the FINDING, because a fixture
 * satisfied by an engine that has not implemented its rules is a fixture
 * pinning nothing.
 */
export type Polarity = 'direct' | 'inverted';

export interface Derivation {
  readonly polarity: Polarity;
  /** The `R-nn` this fixture's `source:` cites, deduplicated, in citation order. */
  readonly cited: readonly string[];
  /** Those the engine does not declare. Non-empty exactly when `inverted`. */
  readonly undeclared: readonly string[];
  /** Why, in one sentence, for a report a reader has to act on. */
  readonly because: string;
}

/**
 * The `R-nn` a `source:` cites. RULES ONLY, not the whole citation.
 *
 * L-13 accepts `R-nn`, `CV-nn` or `INV-nn`, because P2 section 2's traceability
 * tier is about whether an expectation can be traced to something M01 states.
 * POLARITY IS A NARROWER QUESTION: ADR-048 derives it from "the rules the
 * fixture cites" against "the set of rule identifiers the engine implements",
 * and a config validation is not a rule the engine folds. So a fixture citing
 * only `CV-01` cites no rule, and the case below decides what that means.
 */
export function citedRuleIds(source: string): string[] {
  return [...new Set([...source.matchAll(/\bR-\d{2}\b/g)].map((m) => m[0]))];
}

/**
 * Derive one fixture's polarity from its citation and the engine's declaration.
 *
 * THE EMPTY CITED SET IS `inverted`, NOT `direct`, AND THAT IS THE SECOND HALF
 * OF ADR-048's CASE 4. The first half is L-13, which refuses a fixture citing
 * nothing M01 defines. It does not close this case on its own: L-13 is
 * satisfied by a fixture citing only `CV-01` or `INV-06`, which P2 section 2
 * explicitly permits, and such a fixture cites no RULE. "Every rule this
 * fixture cites is implemented" would then be vacuously true of it and it would
 * flip to `direct` against an engine implementing nothing -- the same defect
 * one prefix over.
 *
 * Reading the empty set as `inverted` closes it structurally rather than by
 * care, which is the standard ADR-048 sets for this case. It also keeps the
 * ruling's central property: `inverted` still ASSERTS something (the fixture
 * must fail, and a match is the finding), so there is still no quiet direction.
 */
export function derivePolarity(source: string, declared: ReadonlySet<string>): Derivation {
  const cited = citedRuleIds(source);

  if (cited.length === 0) {
    return {
      polarity: 'inverted',
      cited,
      undeclared: [],
      because:
        'it cites no R-nn, so "every rule it cites is implemented" is vacuously true and ' +
        'may not be read as direct (ADR-048 case 4)',
    };
  }

  const undeclared = cited.filter((id) => !declared.has(id));

  return undeclared.length === 0
    ? {
        polarity: 'direct',
        cited,
        undeclared,
        because: `the engine declares every rule it cites (${cited.join(', ')})`,
      }
    : {
        polarity: 'inverted',
        cited,
        undeclared,
        because: `the engine does not declare ${undeclared.join(', ')}`,
      };
}

// -----------------------------------------------------------------------------
// THE DECLARATION IS CHECKED AGAINST THE FOLD, BEFORE ANY FIXTURE IS CONSULTED
// -----------------------------------------------------------------------------
// ADR-048 names three ways the derivation can be wrong before a fixture is read
// and closes each one. Failure mode 3 is "a rule id is added to the declared set
// without the rule being implemented", answered by cross-checking the declared
// set against the passing `RE-U-nn` set: a declaration is not self-certifying.
//
// THERE IS A FOURTH, AND IT IS THE ONE THIS REPOSITORY IS IN. A rule can be
// implemented in `packages/rules-engine` -- with a passing `RE-U-nn`, so the
// ruled cross-check is satisfied -- and be UNREACHABLE FROM THE FUNCTION CI-03
// FOLDS. ADR-048 speaks of "the engine" as one thing. M01 section 1.3 exports
// six functions, and `runFixture` calls none of them: it calls `evaluate`, the
// scaffold's placeholder, which returns the state it was given and emits
// nothing. The declared rules live in `advanceDay`, `applySettlement` and
// `evaluatePayout`.
//
// SO THE DECLARATION CAN BE TRUE OF THE PACKAGE AND FALSE OF THE FOLD, and
// every fixture would then flip to `direct` and fail with a field diff that
// says nothing about its subject. That is ADR-048 case 1 thirty times over: a
// loud failure, but loud in a way that names the wrong cause.
//
// THIS IS THE CHECK THAT NAMES THE RIGHT ONE, and it is the retired probe's
// warning promoted from a comment to a mechanism, because the case it named
// stopped being hypothetical. It consults no fixture, exactly as ADR-048 says a
// declaration check should.

/** The scaffold-shaped probe the retired `engineIsIdentityStub` used. */
interface FoldProbe {
  /** `true` when the folded state came back by reference and nothing was emitted. */
  readonly foldIsIdentity: boolean;
  /** How many rule ids the engine declares it implements. */
  readonly declaredRules: number;
}

export interface DeclarationCheck {
  readonly holds: boolean;
  /** Empty when the declaration and the fold agree about what is implemented. */
  readonly findings: readonly string[];
}

/**
 * Cross-check the declared rule set against what the folded function does.
 *
 * A non-empty declaration paired with a fold that returns its input by
 * reference and emits nothing is a CONTRADICTION, not a stub: the two claims
 * cannot both describe the same code. Reporting it here means one finding
 * naming the cause, rather than one field diff per fixture naming a symptom.
 */
export function checkDeclarationAgainstFold(probe: FoldProbe): DeclarationCheck {
  if (probe.foldIsIdentity && probe.declaredRules > 0) {
    return {
      holds: false,
      findings: [
        `the engine declares ${probe.declaredRules} implemented rule(s) and the function this ` +
          'stage folds returns its input state by reference and emits nothing, so no declared ' +
          'rule is reachable from the fold. Polarity derived from that declaration would flip ' +
          'every citing fixture to `direct` against a fold that computes none of them ' +
          '(ADR-048 case 1, with the cause one level up from the fixture)',
      ],
    };
  }
  return { holds: true, findings: [] };
}
