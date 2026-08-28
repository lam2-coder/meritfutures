// =============================================================================
// apps/worker/src/detectors/identity.ts
// =============================================================================
// `P7` SECTION 8's `P7-h`: THE IDENTITY AND PAYMENT DETECTORS. `D-07`, `D-08`,
// `D-09`, `D-10` AND `D-11`, PLUS `D-16`'s v1 HALF AND `D-18`'s DETECTOR.
//
// Written against `./ports.ts` and run by `./runner.ts`, both of which landed
// with `P7-e` and neither of which is touched here. Nothing in this file adds a
// `SqlExecutorReason` member, adds a `SystemReason` member, imports `pg`, or
// casts past a key type (`P7` section 11 rule 10, `ADR-157` section 5).
//
// -----------------------------------------------------------------------------
// 1. `ADR-155` BINDS HERE AND HARDEST, AND IT IS THE TYPE THAT HOLDS IT
// -----------------------------------------------------------------------------
// `P7` section 8 says so of this slice by name: *"the hard link is written at
// the ceiling and the flag opens at `open`, and no slice writes `enforced`"*.
// `ADR-155`'s own consequences section says it again: *"`P7-h` is the slice this
// binds hardest: `D-09`, `D-08` and `D-16`'s v1 half all produce hard-link
// signals and all three write `open`."*
//
// **THREE OF THIS FILE'S SEVEN DETECTORS ARE IN `M07` SECTION 7.9's HARD ROW,
// WHOSE BEHAVIOR CELL READS `Auto-enforce.`** That cell is the temptation `P7`
// names, and this file spends no line resisting it, because there is no line to
// resist with:
//
//   - {@link DetectorFinding} has no `status` field, so `enforced` is not a
//     value this file avoids writing. It is a word with nowhere to go.
//   - {@link DetectorTx} has no addressed write, so a transition has no method.
//   - `DETECTOR_WRITE_TABLES` is `detectorRuns`, `riskFlags`,
//     `correlationGroups`. **`identity_links` IS NOT IN IT**, which is
//     `ports.ts`'s own ruling: `ADR-155` clause 1's *"auto-enforce"* is the EDGE
//     written at the hard-link confidence ceiling, and an edge written by a
//     detector RUN would be a graph edge with a nightly job as its author.
//
// **SO THE HARD LINK IS READ HERE AND NEVER WRITTEN HERE, AND THAT IS STATED
// RATHER THAN LEFT AS AN ABSENCE.** `ADR-155`'s foreclosure runs in both
// directions: a slice *"may not conclude from clause 2 that a hard link is
// merely a soft link, or skip writing the edge at the ceiling"*. `D-16` below
// reads edges at the ceiling and opens the severity-5 flag `M07` section 3.1's
// third tier requires against BOTH identities. **Which component writes the
// edge is the resolver's question and it is not this one**, and no line here
// pretends the edge was written.
//
// -----------------------------------------------------------------------------
// 2. EVERY THRESHOLD COMES FROM `detector_definitions` AND NONE FROM A LITERAL
// -----------------------------------------------------------------------------
// `INV-M7-04`: *"Every flag names the detector AND ITS VERSION AND PARAMETERS AS
// OF THAT RUN ... 'Why did this not fire in March' must be answerable from data,
// and it cannot be if parameters live only in code."* `P7-d`'s seed at
// `packages/db/src/seed/detectors/` is the registry and it is the only source of
// a number in this file.
//
// **SO SEVEN OF SEVEN DETECTORS DECLINE UNDER THE SEED AS IT STANDS TODAY, AND
// THAT IS THE HONEST OUTCOME RATHER THAN A GAP.** Eleven of the eighteen seeded
// rows carry no stated number at all, because `OQ-M7-02` is the founder's and
// the seed writes no value it cannot cite. {@link DetectorDeclined} is the named
// way to say so and the runner records the run `failed`, which
// `detector_runs_unhealthy_idx` and `CRON_INVENTORY`'s dead-man switch both read
// on the day it happens. The alternative -- running anyway on a threshold this
// file invented -- is `FM-M7-01` exactly: *"detection appears healthy and is
// absent."*
//
// **WHAT EACH DETECTOR IS WAITING FOR IS A LIST AND NOT A SHRUG.**
// {@link registryBlockers} returns it, {@link DETECTOR_BLOCKERS} is the summary
// a reader can print, and the moment a value is seeded the detector runs with no
// change to this file. That is what makes the registry the registry.
//
// **SEVERITY IS THE BLOCKER FIVE OF THE SEVEN SHARE AND IT IS A MONEY DECISION
// EVERY TIME.** `M07` section 3.3: *"Moving a detector's output from 3 to 4
// changes who gets held, so it is a **data change with a recorded effective
// date** through `SD-M7-03`, never a deploy"*, because 4 and 5 is the band
// `G-HOLD-REQUIRED` reads to hold a payout for 48 hours under `ADR-040`. A
// severity chosen in this file would be a money decision made by a deploy, which
// is the one thing that sentence forbids. `D-09` and `D-16` are the two rows
// whose severity M07 states, both at 5, both `contextual` with exactly one case.
//
// **AND THE CLOCK THAT BAND NEEDS IS NOT SEEDED EITHER, WHICH IS A FINDING.**
// `risk_flags_high_severity_has_sla` reads `severity < 4 OR sla_due_at IS NOT
// NULL`, so a severity-5 finding needs a duration. `OQ-M7-03` PROPOSES *"4 hours
// to first touch during business hours, 24 hours otherwise"* and is OPEN, and no
// seeded row carries an `sla_hours`. So `D-09` and `D-16` are blocked on a
// parameter the registry does not yet have a row for, and the parameter is NAMED
// here rather than defaulted.
//
// -----------------------------------------------------------------------------
// 3. `D-18` TESTS `footprint_present IS FALSE` AND NEVER `IS NOT TRUE`
// -----------------------------------------------------------------------------
// `M07` section 3.2 calls this *"the one implementation trap, and it is a
// mass-false-positive trap rather than a missed-detection one"*:
//
//   "`footprint_present` and `ported` are nullable ON PURPOSE and the null is
//   not a `false`. Three-valued because the lookup FAILS OPEN: `null` means 'we
//   did not find out', `false` means 'the vendor looked and there is none'. **A
//   detector written against `IS NOT TRUE` scores every vendor timeout as a
//   fleet member**, which converts a supplier outage into a flood of flags
//   against real customers on the day Merit can least afford it."
//
// The predicate is spelled ONCE, in {@link hasNoFootprint}, and it is spelled as
// an equality on `false` because that is what `IS FALSE` is -- which is also why
// `ADR-157`'s refusal of an `isNotNull` term costs this detector nothing.
//
// **IT IS TESTED TWICE BECAUSE IT RUNS TWICE, AND THE SECOND PLACE IS THE ONE A
// READER WOULD MISS.** The window narrows on `footprintPresent: false` at the
// accessor, so a vendor-timeout row never crosses. But **the canary rows are
// merged into the stream AFTER the read and never travel through `rowsWhere` at
// all** (`runner.ts`, and `P7-e`'s own landmine 1), so a battery row bypasses
// the accessor's predicate entirely. Every leg is therefore re-tested in
// {@link fleetSignatureRows} over the merged rows, and that is the copy a
// mutation to `!== true` goes red on.
//
// -----------------------------------------------------------------------------
// 4. WHAT THE WINDOWS COST, MEASURED RATHER THAN WAVED AT (`ADR-157` SECTION 5)
// -----------------------------------------------------------------------------
// That entry refused the aggregate `P7` asked for and granted this instead: *"a
// detector can pull its window through `rowsWhere` and do the join in the
// runner. What that costs is real and is named rather than waved at: THE ROWS
// CROSSING THE BOUNDARY ARE THE WINDOW'S RATHER THAN THE MATCH'S."* Identity and
// payment detectors want wide windows, so the cost is stated per detector:
//
//   D-07  every account with `closed_on IS NULL`, and EVERY `identities` ROW.
//         The second is the expensive half and it is not droppable:
//         `identities.max_accounts_override` is a cap the founder granted on
//         purpose, and a detector that could not see it would flag exactly the
//         customers who were given an exception. There is no `IN` term, so the
//         set cannot be narrowed to the identities the first window named.
//   D-08  `identity_signals` of one kind, narrowed by `last_seen_at` with
//         `atLeast`. The one window in this file that is genuinely bounded, and
//         the bound is `window_days`, which is unstated.
//   D-09  every `payout_transfers` row and every live `identity_links` row.
//         Unbounded: no window parameter is seeded and none is invented.
//   D-10  live attributions and live links. Bounded by `voided = false` only.
//   D-11  one trading day of `rule_states`, and `daily_marks` from the sibling
//         window's start. **ONE-SIDED, AND THAT IS AN ACCESSOR LIMIT RATHER
//         THAN A CHOICE**: a filter is one value per column ANDed, so
//         `atLeast(a)` and `atMost(b)` ON THE SAME COLUMN cannot both appear in
//         one call, and the upper bound is applied in memory. Reported in the
//         pull-request body, because `ports.ts` reads `ADR-157` as granting a
//         two-sided window and a two-sided window on one column is not
//         expressible through this filter.
//   D-16  every live `identity_links` row.
//   D-18  `identity_phones` narrowed on FOUR equalities and two null terms,
//         which is the narrowest window in the file and is the same predicate
//         the detector is about.
//
// **NO DETECTOR HERE ASKS FOR A JOINED READ**, so no entry against
// `packages/db/src/scoped-db.ts` is owed by this slice. What IS owed is one
// missing member of `DETECTOR_READ_TABLES`, and it belongs to `ports.ts`'s
// fence rather than to this one; section 5 is the measurement.
//
// -----------------------------------------------------------------------------
// 5. `D-09` HAS NO INPUT, WHICH IS `DEP-M7-04` ARRIVING EXACTLY WHERE IT SAID
// -----------------------------------------------------------------------------
// `M07`'s dependency table: **`DEP-M7-04`, "M5 supplies `destination_ref` reuse
// across identities", consequence "D-09, the strongest mule detector, has no
// input."** `P7-d`'s seed records it on the row itself, as
// `blocked_on_dependency: DEP-M7-04`.
//
// **IT IS UNMET AND THE MEASUREMENT IS ONE COLUMN.** `payout_transfers` carries
// NO identity column at all: `packages/db/src/scope.ts` classes it `derived via
// payoutRequests` and says so in terms -- *"THE TABLE CARRIES NO IDENTITY COLUMN
// AT ALL and reaches one only through the request it is executing"*. So *"more
// than one unrelated identity"* needs `payout_requests.identity_id`, and
// `payoutRequests` is not a member of `DETECTOR_READ_TABLES`.
//
// **THE REMEDY IS ONE MEMBER IN A FILE THIS SLICE DOES NOT HOLD, SO IT IS
// REPORTED AND NOT REACHED FOR** (`P7` section 11 rule 5). It is not a JOIN
// argument and not an accessor widening: `payout_requests` is already a
// `TableKey` and already `owned`, and a detector reading both tables and joining
// in the runner is exactly the shape `ADR-157` section 5 granted. What it needs
// is admission to the read union, which is `ports.ts`.
//
// {@link sharedDestinations} is written and tested anyway, against the row shape
// that join produces, so the day the member lands the logic exists and is
// proven. **A SECOND FINDING SITS BESIDE IT**: `canary.ts`'s `sharedDestination`
// already mints `identityId` onto a `payoutTransfers` row, and that column does
// not exist on that table -- the battery was written for the join the read union
// does not yet allow.
//
// -----------------------------------------------------------------------------
// 6. `D-18`'s OTHER TWO LEGS HAVE NO INPUT EITHER, AND ALL FOUR ARE REQUIRED
// -----------------------------------------------------------------------------
// `M07` section 3.2: *"VoIP plus a fresh email plus a datacenter IP plus no
// digital footprint. **Four legs, all four required.**"* Two of them --
// `D-15`'s footprint age and `D-15`'s IP reputation -- come from *"checkout
// enrichment"*, a `SEON`-class vendor adapter that does not exist in this
// workspace and whose signal kind (`identity_signals.kind = 'footprint_enrichment'`,
// `U-04`) is not a member of `DETECTOR_READ_TABLES`'s reach in the shape D-18
// needs.
//
// **SO `D-18` DECLINES RATHER THAN SCORING TWO LEGS OUT OF FOUR**, and the
// reason that is the only safe disposition is the composite's own logic: a
// two-leg composite is `line_type = 'voip' AND footprint_present = false`, which
// is a population `M07` names in the same paragraph as *"a legitimate customer's
// only number, in several markets and for most people who moved country"* and
// *"a young person, or somebody who is simply not online"*. Firing on two legs
// is the mass-false-positive outcome that section warns about, arrived at from
// the other side.
//
// -----------------------------------------------------------------------------
// 7. NO EVIDENCE OBJECT CARRIES A THRESHOLD, AND `INV-M7-04` IS WHY IT COSTS
//    NOTHING
// -----------------------------------------------------------------------------
// Every `evidence` object below carries the OBSERVED numbers -- the count, the
// correlation, the confidence, the day -- and never the registry value they were
// compared against.
//
// **`INV-M7-10` IS ENFORCED SEVERAL SLICES AWAY AND THIS IS THE HALF THAT DOES
// NOT DEPEND ON IT.** *"Detector parameters never appear in a trader-audience
// evidence pack"*, and `P7-j` computes the `trader` strip list from
// `detector_definitions.is_sensitive`, which is `true` for all seven of these
// rows. So the pack strips them. **A copy of a threshold inside `risk_flags.evidence`
// makes that stripping load-bearing in a second place**, and `AS-M6-01` is the
// scenario where it is wrong once.
//
// **AND THE INVESTIGATOR LOSES NOTHING**, because `INV-M7-04` already built the
// chain that reconstructs it: `risk_flags.detector_run_id ->
// detector_runs.(detector, detector_version) -> detector_definitions.parameters`
// answers *"what was it compared against"* from data, which is the whole reason
// that chain exists. Copying the number into the flag would be a second source
// for a fact the registry already holds, and a second source is a source that
// drifts.
//
// -----------------------------------------------------------------------------
// 8. WHAT IS REAL AND WHAT IS NOT
// -----------------------------------------------------------------------------
// **WHAT IS REAL** is seven detectors' predicates, windows and batteries, each
// predicate a pure exported function with a positive fixture AND a near-miss
// fixture (`M07` section 8, `P7` rule 12). **WHAT IS NOT** is a single flag,
// because the registry states no threshold for five of them, no severity for
// five of them, no SLA clock for either of the two whose severity it does state,
// and no input at all for two. That difference is visible in
// {@link DETECTOR_BLOCKERS} rather than left to a reader, which is
// `runNightlyBatch`'s standard, the provisioning saga's, the expiry sweep's and
// the runner's, applied unchanged.
// =============================================================================

import type { CanaryMint, CanarySubject } from './canary.ts';
import { DetectorDeclined, SLA_REQUIRED_AT_SEVERITY } from './ports.ts';
import type {
  Detector,
  DetectorDefinition,
  DetectorFinding,
  DetectorOutcome,
  DetectorRow,
  DetectorScanInput,
  DetectorScanRequest,
  DetectorStream,
} from './ports.ts';

// -----------------------------------------------------------------------------
// The seven, and the vocabulary they may write
// -----------------------------------------------------------------------------

/** `P7-h`'s detectors, in `M07` section 3.2's order. */
export const IDENTITY_DETECTOR_IDS = [
  'D-07',
  'D-08',
  'D-09',
  'D-10',
  'D-11',
  'D-16',
  'D-18',
] as const;

/** One of {@link IDENTITY_DETECTOR_IDS}. */
export type IdentityDetectorId = (typeof IDENTITY_DETECTOR_IDS)[number];

/**
 * `risk_flags.flag_type`'s vocabulary, transcribed from
 * `docs/architecture/data-model/risk_flags.md` and from `0008_risk.sql:119`.
 *
 * **A COMMENT AND A DOC ROW RATHER THAN A `CHECK`**, so any text is insertable
 * and an invented value would compile, ship, and become the vocabulary by having
 * been written. The suite parses the data-model row and asserts
 * {@link FLAG_TYPE_BY_DETECTOR}'s values are members of it.
 */
export const DOCUMENTED_FLAG_TYPES = [
  'inverse_pair',
  'copy_cluster',
  'news_window',
  'martingale',
  'velocity',
  'entity_cap',
  'payment_velocity',
  'name_mismatch',
  'reset_velocity',
  'affiliate_self_deal',
] as const;

/**
 * The documented `flag_type` for each of this file's detectors, WHERE ONE
 * EXISTS.
 *
 * **FOUR OF THE SEVEN HAVE NO DOCUMENTED VALUE AND NONE IS INVENTED FOR THEM.**
 * The vocabulary predates `D-16` and `D-18` (both added at the batch 1 gate) and
 * never carried a destination-concentration or a dilution-timing member. So
 * `D-09`, `D-11`, `D-16` and `D-18` read `flag_type` from their registry row and
 * {@link flagTypeOf} declines when it is absent, which keeps the vocabulary a
 * data decision with an effective date rather than a string somebody typed.
 */
export const FLAG_TYPE_BY_DETECTOR: Readonly<Partial<Record<IdentityDetectorId, string>>> = {
  'D-07': 'entity_cap',
  'D-08': 'payment_velocity',
  'D-10': 'affiliate_self_deal',
};

/**
 * The magnitude every count-threshold battery is minted at.
 *
 * A canary must exceed the threshold the run is executing under, and
 * `Detector.canaries(mint)` is handed the MINT and not the definition, so a
 * battery cannot be tuned to a registry row. Six of the seven detectors here are
 * threshold-INDEPENDENT by construction -- `D-07`'s canary carries its own
 * `max_accounts_override` of one, `D-16`'s edge sits at `confidence_bp` 10000,
 * `D-11`'s manufactured day is one cent -- and `D-08` is the exception, because
 * a count threshold has no per-subject override to lean on.
 *
 * **SO A `D-08` THRESHOLD AT OR ABOVE THIS NUMBER MAKES THE RUN `degraded`, AND
 * THAT IS THE CORRECT ALARM RATHER THAN A DEFECT.** A battery below the
 * threshold it is meant to trip is a battery that proves nothing, and
 * `synthetic_found < synthetic_expected` is how `SD-M7-01` says so.
 */
export const CANARY_MAGNITUDE = 12;

// -----------------------------------------------------------------------------
// The registry, read rather than guessed
// -----------------------------------------------------------------------------

/**
 * One `detector_definitions.parameters` entry, in `P7-d`'s seed shape.
 *
 * `{state, value, unit, cite, quote}` rather than a bare number, so a reader can
 * tell an absent threshold from a zero. `contextual` carries `cases` instead of
 * a value, because `M07` section 3.3 scores severity by situation rather than by
 * detector.
 */
export interface RegistryParameter {
  readonly state: string;
  readonly value?: unknown;
  readonly cases?: readonly { readonly value?: unknown }[];
}

/** The named parameter, or `undefined` when the registry row does not carry it. */
export function registryParameter(
  definition: DetectorDefinition,
  name: string,
): RegistryParameter | undefined {
  const raw = definition.parameters[name];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const state = record['state'];
  if (typeof state !== 'string') {
    return undefined;
  }
  const cases = record['cases'];
  return {
    state,
    value: record['value'],
    ...(Array.isArray(cases) ? { cases: cases as readonly { readonly value?: unknown }[] } : {}),
  };
}

/**
 * The parameter's value when the registry states one, and `undefined` otherwise.
 *
 * **A `contextual` PARAMETER RESOLVES ONLY WHEN IT CARRIES EXACTLY ONE CASE.**
 * `M07` section 3.3's severity table is a scale with one example per band, and
 * the seed transcribes the example that names the detector: `D-09`'s severity is
 * `contextual` with a single case at 5, cited to *"D-09 destination
 * concentration"* in the severity-5 row. Two cases would mean the registry
 * expects the detector to CHOOSE, and choosing a severity is the money decision
 * `M07` puts on a dated data change; a detector that picked one would be making
 * it by running.
 */
export function statedValue(param: RegistryParameter | undefined): unknown {
  if (param === undefined) {
    return undefined;
  }
  if (param.state === 'stated') {
    return param.value;
  }
  if (param.state === 'contextual' && param.cases?.length === 1) {
    return param.cases[0]?.value;
  }
  return undefined;
}

/** The stated value as a finite integer, or `undefined`. */
export function statedInteger(param: RegistryParameter | undefined): number | undefined {
  const value = statedValue(param);
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/**
 * One thing the registry owes a detector before it can run.
 *
 * `parameter` names the `detector_definitions.parameters` key; `why` is the
 * sentence a reader gets in the {@link DetectorDeclined} message.
 */
export interface RegistryBlocker {
  readonly parameter: string;
  readonly why: string;
}

/**
 * The parameters a detector needs and the registry does not state, plus any
 * blocker that is STRUCTURAL rather than a missing number.
 *
 * A structural blocker carries the parameter name `input`, because no seeded
 * value can clear it: `D-09` needs `payout_requests` admitted to
 * `DETECTOR_READ_TABLES` and `D-18` needs `D-15`'s enrichment to exist.
 */
export function registryBlockers(
  detector: IdentityDetectorId,
  definition: DetectorDefinition,
): readonly RegistryBlocker[] {
  const blockers: RegistryBlocker[] = [];
  const needs = (parameter: string, why: string): void => {
    if (statedValue(registryParameter(definition, parameter)) === undefined) {
      blockers.push({ parameter, why });
    }
  };

  if (detector === 'D-07') {
    needs(
      'max_accounts_per_entity',
      'the plan maximum a resolved entity may hold. M07 section 3.2 names it and states no number ' +
        '(OQ-M7-02), and identities.max_accounts_override only overrides a cap that exists.',
    );
  }
  if (detector === 'D-08') {
    needs(
      'max_distinct_cards_or_bins_per_identity',
      'the count of distinct payment fingerprints one identity may hold inside the window.',
    );
    needs(
      'max_identities_per_payment_fingerprint',
      'the count of identities one payment fingerprint may reach inside the window.',
    );
    needs(
      'window_days',
      'the window both counts are taken over. Without it the detector has no window at all, so ' +
        'streams() reads nothing rather than reading identity_signals unbounded every night.',
    );
  }
  if (detector === 'D-09') {
    blockers.push({
      parameter: 'input',
      why:
        'DEP-M7-04 is unmet. payout_transfers carries no identity column (packages/db/src/scope.ts ' +
        "classes it derived via payoutRequests: 'THE TABLE CARRIES NO IDENTITY COLUMN AT ALL'), so " +
        "'more than one unrelated identity' needs payout_requests.identity_id, and payoutRequests " +
        'is not a member of DETECTOR_READ_TABLES. The remedy is one member in apps/worker/src/' +
        'detectors/ports.ts, which belongs to P7-e and not to this slice.',
    });
  }
  if (detector === 'D-11') {
    needs(
      'max_daily_profit_cents',
      'the ceiling that makes a positive day SMALL. M07 section 3.2 says "small positive days" and ' +
        'states no number.',
    );
    needs(
      'sibling_correlation_floor_bp',
      'the correlation at or below which a sibling counts as inverse-correlated, in basis points.',
    );
    needs(
      'sibling_window_days',
      'the number of trading days the sibling correlation is taken over. M07 section 3.2 gives ' +
        'D-02 a 20 day window and D-13 a 5 day window and gives D-11 none, and the registry row ' +
        'carries no key for it either, so it is named here rather than borrowed from a sibling row.',
    );
  }
  if (detector === 'D-16') {
    needs(
      'hard_link_confidence_ceiling_bp',
      'the hard-link confidence ceiling, in basis points. INV-M7-01 makes the ceiling the ' +
        'discriminator ("only a biometric dedupe hit or an explicit admin merge may exceed a ' +
        'configured ceiling"), so reading hardness off link_kind instead would substitute a ' +
        'vocabulary this file chose for the one the invariant names.',
    );
  }
  if (detector === 'D-18') {
    blockers.push({
      parameter: 'input',
      why:
        "two of the four required legs have no input. M07 section 3.2: 'VoIP plus a fresh email " +
        "plus a datacenter IP plus no digital footprint. Four legs, all four required.' The fresh " +
        "email is D-15's footprint age and the datacenter IP is D-15's IP reputation, and D-15's " +
        'checkout enrichment adapter does not exist in this workspace. Firing on the two legs that ' +
        'DO have input is line_type = voip AND footprint_present = false, which M07 describes in ' +
        "the same paragraph as a legitimate customer's only number and a young person, or " +
        'somebody who is simply not online.',
    });
  }

  const severity = statedInteger(registryParameter(definition, 'severity'));
  if (severity === undefined) {
    blockers.push({
      parameter: 'severity',
      why:
        'severity is a MONEY decision. M07 section 3.3: moving a detector from 3 to 4 changes who ' +
        'gets held, because 4 and 5 is the band G-HOLD-REQUIRED reads to hold a payout for 48 ' +
        'hours under ADR-040, so it is "a data change with a recorded effective date through ' +
        'SD-M7-03, never a deploy". A severity chosen in this file would be that decision made by ' +
        'a deploy.',
    });
  } else if (
    severity >= SLA_REQUIRED_AT_SEVERITY &&
    statedInteger(registryParameter(definition, 'sla_hours')) === undefined
  ) {
    blockers.push({
      parameter: 'sla_hours',
      why:
        'risk_flags_high_severity_has_sla reads "severity < 4 OR sla_due_at IS NOT NULL", so a ' +
        'severity ' +
        String(severity) +
        ' finding needs a duration to compute the clock from. OQ-M7-03 PROPOSES "4 hours to first ' +
        'touch during business hours, 24 hours otherwise" and is OPEN, and no seeded row carries ' +
        'an sla_hours. The parameter is named rather than defaulted.',
    });
  }

  return blockers;
}

/** Raises {@link DetectorDeclined} when the registry owes this detector anything. */
function refuseUnlessComplete(detector: IdentityDetectorId, definition: DetectorDefinition): void {
  const blockers = registryBlockers(detector, definition);
  if (blockers.length === 0) {
    return;
  }
  throw new DetectorDeclined(
    detector,
    blockers.map((blocker) => `${blocker.parameter}: ${blocker.why}`).join(' | '),
  );
}

/**
 * `risk_flags.flag_type`, from the registry when it states one and from
 * {@link FLAG_TYPE_BY_DETECTOR} otherwise.
 *
 * The registry wins because a vocabulary value is a data decision with an
 * effective date, which is the same reason a threshold is.
 */
export function flagTypeOf(detector: IdentityDetectorId, definition: DetectorDefinition): string {
  const stated = statedValue(registryParameter(definition, 'flag_type'));
  if (typeof stated === 'string' && stated.length > 0) {
    return stated;
  }
  const documented = FLAG_TYPE_BY_DETECTOR[detector];
  if (documented !== undefined) {
    return documented;
  }
  throw new DetectorDeclined(
    detector,
    'no risk_flags.flag_type. The vocabulary in docs/architecture/data-model/risk_flags.md and ' +
      '0008_risk.sql:119 carries no member for this detector, the column has no CHECK so any ' +
      'string would insert, and inventing one would settle a vocabulary by having written it. The ' +
      'registry row is where a new member is claimed, under a flag_type parameter.',
  );
}

/** The severity the registry states, having already been proved present. */
function severityOf(detector: IdentityDetectorId, definition: DetectorDefinition): number {
  const severity = statedInteger(registryParameter(definition, 'severity'));
  if (severity === undefined) {
    throw new DetectorDeclined(detector, 'severity is unstated');
  }
  return severity;
}

/**
 * `risk_flags.sla_due_at`, or `undefined` below the band that requires one.
 *
 * The run's own instant is the only clock (`DetectorScanRequest.now`), so a
 * fixture pins the whole run and the database never supplies one.
 */
function slaDueAtFor(
  detector: IdentityDetectorId,
  definition: DetectorDefinition,
  severity: number,
  now: Date,
): Date | undefined {
  if (severity < SLA_REQUIRED_AT_SEVERITY) {
    return undefined;
  }
  const hours = statedInteger(registryParameter(definition, 'sla_hours'));
  if (hours === undefined) {
    throw new DetectorDeclined(detector, 'sla_hours is unstated');
  }
  return new Date(now.getTime() + hours * 3600000);
}

/** A summary of what every detector in this file is waiting for. */
export function detectorBlockerSummary(
  definitions: Readonly<Partial<Record<IdentityDetectorId, DetectorDefinition>>>,
): Readonly<Record<string, readonly string[]>> {
  const out: Record<string, readonly string[]> = {};
  for (const id of IDENTITY_DETECTOR_IDS) {
    const definition = definitions[id];
    out[id] =
      definition === undefined
        ? ['no current detector_definitions row']
        : registryBlockers(id, definition).map((blocker) => blocker.parameter);
  }
  return out;
}

/**
 * The blockers that no seeded value can clear, keyed by detector.
 *
 * Section 5 and section 6 of this file's header are the arguments; this is the
 * list a reader can print.
 */
export const DETECTOR_BLOCKERS: Readonly<Partial<Record<IdentityDetectorId, string>>> = {
  'D-09':
    'DEP-M7-04: payout_transfers reaches an identity only through payoutRequests, which is ' +
    'not a DETECTOR_READ_TABLE.',
  'D-18': "D-15's checkout enrichment supplies two of the four required legs and does not exist.",
};

// -----------------------------------------------------------------------------
// Shared reading helpers. NOTHING HERE COERCES A MISSING VALUE INTO A PRESENT ONE
// -----------------------------------------------------------------------------

function text(row: DetectorRow, column: string): string | undefined {
  const value = row[column];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function integer(row: DetectorRow, column: string): number | undefined {
  const value = row[column];
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/**
 * A `bigint` cents column as an exact `number`.
 *
 * **REFUSED RATHER THAN ROUNDED ABOVE `Number.MAX_SAFE_INTEGER`.** `ADR-157`
 * section 5 finding 8 is the reason and it is a money one: `pg` hands a wide
 * integer back in a form whose naive `Number()` is lossy above 2^53, and a float
 * in a financial path with every type in the workspace green is the failure that
 * finding refused to take in passing.
 */
export class CentsRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CentsRangeError';
  }
}

export function cents(value: unknown): number | undefined {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new CentsRangeError(
        `a cents value of ${value.toString()} exceeds Number.MAX_SAFE_INTEGER and is refused ` +
          'rather than rounded. ADR-157 section 5 finding 8: the naive Number() on a wide integer ' +
          'is lossy, and a float in a financial path is the defect no type in this workspace ' +
          'would go red on.',
      );
    }
    return Number(value);
  }
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/** `YYYY-MM-DD`, shifted by whole days in UTC. */
function shiftDay(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Accumulate `member` into the set at `key`, creating it on first sight. */
function addTo(into: Map<string, Set<string>>, key: string, member: string): void {
  const existing = into.get(key);
  if (existing === undefined) {
    into.set(key, new Set([member]));
    return;
  }
  existing.add(member);
}

/** An unordered edge key, so `identity_links_canonical_order` is not relied on. */
function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * The live edges, as an unordered adjacency set.
 *
 * **`suppressed` IS READ AND NOT IGNORED**, which is `SD-M7-04` and `INV-M7-09`:
 * *"a suppressed edge stays visible as history and stops contributing to
 * enforcement"*. A detector that treated a suppressed edge as live would make a
 * trader's successful dispute invisible to the next night's run.
 */
export type IdentityGraph = ReadonlyMap<string, ReadonlySet<string>>;

export function liveEdges(rows: readonly DetectorRow[]): IdentityGraph {
  const graph = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row['suppressed'] === true) {
      continue;
    }
    const a = text(row, 'identityA');
    const b = text(row, 'identityB');
    if (a === undefined || b === undefined) {
      continue;
    }
    // BOTH DIRECTIONS, so `identity_links_canonical_order` is a storage fact
    // rather than something a reader has to remember at every call site.
    addTo(graph, a, b);
    addTo(graph, b, a);
  }
  return graph;
}

/** Whether two identities are joined by ONE live edge. */
export function related(graph: IdentityGraph, a: string, b: string): boolean {
  return a === b || graph.get(a)?.has(b) === true;
}

/**
 * Whether two identities are joined by ANY path of live edges.
 *
 * **THE PATH AND NOT THE EDGE, AND THE THIRD PARTY IS WHY.** Two identities
 * linked only through a third are one entity for `D-09`'s purpose even when that
 * third holds no payout destination at all, and a detector that walked only the
 * identities at the destination would call a household of three two unrelated
 * parties because the person who owns the card did not withdraw this week.
 */
export function connected(graph: IdentityGraph, a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const seen = new Set<string>([a]);
  const queue = [a];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) {
      continue;
    }
    for (const next of graph.get(current) ?? []) {
      if (next === b) {
        return true;
      }
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/**
 * The trading day a row carries, which is NOT re-checked against the run's day.
 *
 * **AND THAT ABSENCE IS DELIBERATE, BECAUSE `Detector.canaries` IS HANDED THE
 * MINT AND NOT THE REQUEST.** A synthetic subject cannot know which trading day
 * the run is for, so a predicate that filtered on `request.tradingDay` would
 * drop every canary row it was handed and report `degraded` on a working
 * detector. The narrowing to the run's day belongs in `streams()`, where it
 * reaches the real rows and never reaches the battery, and the predicates below
 * compute over the rows they are given.
 */
function dayOf(row: DetectorRow): string | undefined {
  return text(row, 'tradingDay');
}

/**
 * Pearson correlation over paired series, in BASIS POINTS as an integer.
 *
 * **THE CENTS STAY `bigint` AND ONLY THE DIMENSIONLESS RATIO BECOMES A
 * `number`.** A correlation coefficient is a STATISTIC and not money, which is
 * `0008_risk.sql:213`'s own distinction for `correlation_groups.statistic`:
 * *"numeric rather than bigint because these are STATISTICS, not money ...
 * rounding it to cents would be the actual error."* {@link cents} refuses any
 * input wide enough for the conversion to be lossy, so the float here is taken
 * over values proved exact rather than over values assumed to be.
 *
 * `undefined` when either series is constant, because a correlation with a zero
 * denominator is undefined rather than zero, and a zero would read as
 * "uncorrelated" and quietly clear an inverse-correlation floor.
 */
export function pearsonBp(a: readonly number[], b: readonly number[]): number | undefined {
  if (a.length !== b.length || a.length < 2) {
    return undefined;
  }
  const n = a.length;
  const meanA = a.reduce((sum, value) => sum + value, 0) / n;
  const meanB = b.reduce((sum, value) => sum + value, 0) / n;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = (a[i] ?? 0) - meanA;
    const db = (b[i] ?? 0) - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  if (varianceA === 0 || varianceB === 0) {
    return undefined;
  }
  return Math.round((covariance / Math.sqrt(varianceA * varianceB)) * 10000);
}

/**
 * The fewest paired days a correlation may be computed over.
 *
 * **ARITHMETIC RATHER THAN POLICY, AND THE DIFFERENCE IS WHY IT IS A CONSTANT
 * HERE AND NOT A REGISTRY PARAMETER.** A Pearson correlation over two points is
 * exactly `+1` or `-1` for any two distinct values, so a two-day window clears
 * any inverse-correlation floor by construction and measures nothing. The
 * DETECTION window is `sibling_window_days` and comes from the registry; this is
 * the floor below which the statistic does not exist.
 */
export const MIN_CORRELATION_DAYS = 3;

// =============================================================================
// D-07  ENTITY CAP AGGREGATION
// =============================================================================

/** One resolved entity holding more accounts than its cap allows. */
export interface OverCapEntity {
  readonly identityId: string;
  readonly accountIds: readonly string[];
  readonly maxAccounts: number;
  readonly capSource: 'override' | 'plan_maximum';
}

/**
 * `M07` `D-07`: *"Resolved entity holding more accounts than the plan maximum
 * after a merge."*
 *
 * **`identities.max_accounts_override` WINS WHERE IT IS SET, AND READING IT IS
 * THE WHOLE REASON THE `identities` WINDOW IS PAID FOR.** It is a cap somebody
 * granted on purpose, so a detector blind to it flags exactly the customers who
 * were given an exception, every night, forever.
 *
 * **THE GRANDFATHERING IS `INV-M7-06`'s AND IS NOT APPLIED HERE**, because it is
 * an ENFORCEMENT rule and not a detection one: *"over-cap after a merge is
 * grandfathered and NEW PURCHASES ARE BLOCKED"*, which is `M03`'s checkout gate
 * (`DEP-M3-04`, `INV-M7-05`) acting at purchase time. A detector that suppressed
 * the finding would leave the over-cap entity invisible to the queue while the
 * cap it broke still binds every future purchase.
 */
export function overCapEntities(
  accounts: readonly DetectorRow[],
  identities: readonly DetectorRow[],
  planMaximum: number,
): readonly OverCapEntity[] {
  const overrides = new Map<string, number>();
  for (const row of identities) {
    const id = text(row, 'id');
    const override = integer(row, 'maxAccountsOverride');
    if (id !== undefined && override !== undefined) {
      overrides.set(id, override);
    }
  }

  const held = new Map<string, string[]>();
  for (const row of accounts) {
    const identityId = text(row, 'identityId');
    const accountId = text(row, 'id');
    if (identityId === undefined || accountId === undefined) {
      continue;
    }
    if (row['closedOn'] !== null && row['closedOn'] !== undefined) {
      continue;
    }
    const list = held.get(identityId) ?? [];
    list.push(accountId);
    held.set(identityId, list);
  }

  const out: OverCapEntity[] = [];
  for (const [identityId, accountIds] of [...held.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const override = overrides.get(identityId);
    const maxAccounts = override ?? planMaximum;
    if (accountIds.length > maxAccounts) {
      out.push({
        identityId,
        accountIds: [...accountIds].sort(),
        maxAccounts,
        capSource: override === undefined ? 'plan_maximum' : 'override',
      });
    }
  }
  return out;
}

/** `D-07`. `M07` section 3.2, input `identities` and `accounts`. */
export const D07_ENTITY_CAP: Detector = {
  id: 'D-07',
  streams: (request: DetectorScanRequest): readonly DetectorStream[] => [
    // `closed_on IS NULL` is what "holding" means: a closed account is not held.
    { name: 'accounts', table: 'accounts', where: { closedOn: request.terms.isNull() } },
    // EVERY identity row, and the cost is section 4 of this file's header. The
    // narrowing is the run's own instant rather than a status, because a
    // RESTRICTED identity's override is still the cap that binds its accounts
    // and narrowing it away would flag the entity the override exists for.
    {
      name: 'identities',
      table: 'identities',
      where: { createdAt: request.terms.atMost(request.now) },
    },
  ],
  canaries: (mint: CanaryMint): readonly CanarySubject[] => [entityCapCanary(mint, 0)],
  scan: ({ request, rows }: DetectorScanInput): DetectorOutcome => {
    refuseUnlessComplete('D-07', request.definition);
    const planMaximum = statedInteger(
      registryParameter(request.definition, 'max_accounts_per_entity'),
    );
    if (planMaximum === undefined) {
      throw new DetectorDeclined('D-07', 'max_accounts_per_entity is unstated');
    }
    const severity = severityOf('D-07', request.definition);
    const flagType = flagTypeOf('D-07', request.definition);
    const slaDueAt = slaDueAtFor('D-07', request.definition, severity, request.now);

    const findings: DetectorFinding[] = [];
    for (const entity of overCapEntities(
      rows['accounts'] ?? [],
      rows['identities'] ?? [],
      planMaximum,
    )) {
      findings.push({
        subjects: [entity.identityId],
        identityId: entity.identityId,
        flagType,
        severity,
        evidence: {
          live_account_count: entity.accountIds.length,
          cap_source: entity.capSource,
          account_ids: entity.accountIds,
        },
        ...(slaDueAt === undefined ? {} : { slaDueAt }),
      });
    }
    return { findings };
  },
};

function entityCapCanary(mint: CanaryMint, ordinal: number): CanarySubject {
  const subject = mint.subject('D-07', ordinal);
  const identity = subject.actor('i-entity');
  return {
    id: subject.id,
    detector: 'D-07',
    nonce: mint.nonce,
    // THE NEAREST OF `CANARY_SHAPES`' FOUR AND NOT AN EXACT ONE. That union is
    // `P7-e`'s and holds no identity-side shape; several accounts converging on
    // one identity is the same figure as several identities converging on one
    // destination. Reported rather than widened, because `canary.ts` is outside
    // this slice's fence.
    shape: 'shared-destination',
    actors: [identity, subject.actor('a-0'), subject.actor('a-1')],
    rows: {
      // THE OVERRIDE IS THE BATTERY'S WHOLE TRICK AND IT IS WHY THIS CANARY IS
      // THRESHOLD-INDEPENDENT: a cap of one is exceeded by two accounts under
      // any `max_accounts_per_entity` the registry ever states.
      identities: [{ id: identity, maxAccountsOverride: 1 }],
      accounts: [
        { id: subject.actor('a-0'), identityId: identity, closedOn: null },
        { id: subject.actor('a-1'), identityId: identity, closedOn: null },
      ],
    },
  };
}

// =============================================================================
// D-08  PAYMENT VELOCITY
// =============================================================================

/** One payment-velocity breach, in one of the two directions M07 names. */
export interface PaymentVelocityBreach {
  readonly statistic: 'cards_per_identity' | 'identities_per_fingerprint';
  readonly subject: string;
  readonly identityIds: readonly string[];
  readonly fingerprints: readonly string[];
  readonly observed: number;
  readonly maximum: number;
}

/** `identity_signals.value_hash` as a stable key. Hashed, never raw (`INV-M7-08`). */
function fingerprintKey(row: DetectorRow): string | undefined {
  const value = row['valueHash'];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('hex');
  }
  return undefined;
}

/**
 * `M07` `D-08`: *"Distinct cards or BINs per identity, AND identities per
 * payment fingerprint, over a window."*
 *
 * Two statistics and not one, because they catch opposite shapes: one identity
 * cycling stolen cards, and one card spread across minted identities.
 */
export function paymentVelocityBreaches(
  signals: readonly DetectorRow[],
  maxCardsPerIdentity: number,
  maxIdentitiesPerFingerprint: number,
): readonly PaymentVelocityBreach[] {
  const cardsByIdentity = new Map<string, Set<string>>();
  const identitiesByFingerprint = new Map<string, Set<string>>();
  for (const row of signals) {
    const identityId = text(row, 'identityId');
    const fingerprint = fingerprintKey(row);
    if (identityId === undefined || fingerprint === undefined) {
      continue;
    }
    addTo(cardsByIdentity, identityId, fingerprint);
    addTo(identitiesByFingerprint, fingerprint, identityId);
  }

  const out: PaymentVelocityBreach[] = [];
  for (const [identityId, fingerprints] of [...cardsByIdentity].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    if (fingerprints.size > maxCardsPerIdentity) {
      out.push({
        statistic: 'cards_per_identity',
        subject: identityId,
        identityIds: [identityId],
        fingerprints: [...fingerprints].sort(),
        observed: fingerprints.size,
        maximum: maxCardsPerIdentity,
      });
    }
  }
  for (const [fingerprint, identityIds] of [...identitiesByFingerprint].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    if (identityIds.size > maxIdentitiesPerFingerprint) {
      out.push({
        statistic: 'identities_per_fingerprint',
        subject: fingerprint,
        identityIds: [...identityIds].sort(),
        fingerprints: [fingerprint],
        observed: identityIds.size,
        maximum: maxIdentitiesPerFingerprint,
      });
    }
  }
  return out;
}

/** `D-08`. `M07` section 3.2, input `identity_signals`. */
export const D08_PAYMENT_VELOCITY: Detector = {
  id: 'D-08',
  streams: (request: DetectorScanRequest): readonly DetectorStream[] => {
    const windowDays = statedInteger(registryParameter(request.definition, 'window_days'));
    if (windowDays === undefined) {
      // NO WINDOW PARAMETER, NO WINDOW, AND NO READ. The alternative is an
      // unbounded scan of `identity_signals` every night for a detector that is
      // about to decline anyway, which is `ADR-157` section 5's named cost paid
      // for nothing.
      return [];
    }
    const from = new Date(request.now.getTime() - windowDays * 86400000);
    return [
      {
        name: 'signals',
        table: 'identitySignals',
        // `last_seen_at` and not `first_seen_at`: a fingerprint first seen in
        // March and used again last night is inside last night's window, and
        // `identity_signals_identity_kind_value_uq` means the row is updated
        // rather than duplicated.
        where: { kind: 'payment', lastSeenAt: request.terms.atLeast(from) },
      },
    ];
  },
  canaries: (mint: CanaryMint): readonly CanarySubject[] => [
    cardsPerIdentityCanary(mint, 0),
    identitiesPerFingerprintCanary(mint, 1),
  ],
  scan: ({ request, rows }: DetectorScanInput): DetectorOutcome => {
    refuseUnlessComplete('D-08', request.definition);
    const maxCards = statedInteger(
      registryParameter(request.definition, 'max_distinct_cards_or_bins_per_identity'),
    );
    const maxIdentities = statedInteger(
      registryParameter(request.definition, 'max_identities_per_payment_fingerprint'),
    );
    if (maxCards === undefined || maxIdentities === undefined) {
      throw new DetectorDeclined('D-08', 'a payment-velocity count is unstated');
    }
    const severity = severityOf('D-08', request.definition);
    const flagType = flagTypeOf('D-08', request.definition);
    const slaDueAt = slaDueAtFor('D-08', request.definition, severity, request.now);

    const findings: DetectorFinding[] = [];
    for (const breach of paymentVelocityBreaches(rows['signals'] ?? [], maxCards, maxIdentities)) {
      for (const identityId of breach.identityIds) {
        findings.push({
          subjects: [breach.subject, ...breach.identityIds],
          identityId,
          flagType,
          severity,
          evidence: {
            statistic: breach.statistic,
            observed: breach.observed,
            identity_count: breach.identityIds.length,
            fingerprint_count: breach.fingerprints.length,
          },
          ...(slaDueAt === undefined ? {} : { slaDueAt }),
        });
      }
    }
    return { findings };
  },
};

function cardsPerIdentityCanary(mint: CanaryMint, ordinal: number): CanarySubject {
  const subject = mint.subject('D-08', ordinal);
  const identity = subject.actor('i-carder');
  return {
    id: subject.id,
    detector: 'D-08',
    nonce: mint.nonce,
    shape: 'shared-destination',
    actors: [identity],
    rows: {
      signals: Array.from({ length: CANARY_MAGNITUDE }, (_unused, n) => ({
        id: subject.row(n),
        identityId: identity,
        kind: 'payment',
        valueHash: `${subject.id}#card-${String(n)}`,
      })),
    },
  };
}

function identitiesPerFingerprintCanary(mint: CanaryMint, ordinal: number): CanarySubject {
  const subject = mint.subject('D-08', ordinal);
  const fingerprint = `${subject.id}#fingerprint`;
  const identities = Array.from({ length: CANARY_MAGNITUDE }, (_unused, n) =>
    subject.actor(`i-${String(n)}`),
  );
  return {
    id: subject.id,
    detector: 'D-08',
    nonce: mint.nonce,
    shape: 'shared-destination',
    actors: identities,
    rows: {
      signals: identities.map((identityId, n) => ({
        id: subject.row(n),
        identityId,
        kind: 'payment',
        valueHash: fingerprint,
      })),
    },
  };
}

// =============================================================================
// D-09  DESTINATION CONCENTRATION -- AND ITS INPUT DOES NOT EXIST
// =============================================================================

/** One `destination_ref` receiving payouts from more than one unrelated identity. */
export interface SharedDestination {
  readonly destinationRef: string;
  readonly identityIds: readonly string[];
  readonly transferIds: readonly string[];
  readonly unrelatedGroups: number;
}

/**
 * `M07` `D-09`: *"One `destination_ref` receiving payouts from more than one
 * UNRELATED identity."* The strongest mule detector available (`M05 AS-M5-02`),
 * and a query rather than an inference.
 *
 * **"UNRELATED" IS THE WORD THAT DOES THE WORK AND IT IS READ OFF THE GRAPH.**
 * Two identities already joined by a live `identity_links` edge are ONE entity
 * for this purpose: a married couple settling to a joint account is `AS-M7-04`'s
 * population, not a mule ring, and counting them as two would make the strongest
 * detector in the module also its loudest false positive. So the identities at a
 * destination are collapsed into connected components over the live edges and it
 * is the COMPONENT count that is compared.
 *
 * **THIS FUNCTION HAS NO CALLER IN PRODUCTION AND THAT IS `DEP-M7-04`.** Section
 * 5 of this file's header is the measurement: the row shape below is what
 * `payout_transfers` joined to `payout_requests` produces, and `payoutRequests`
 * is not a member of `DETECTOR_READ_TABLES`. It is written and tested against
 * that shape so the logic exists and is proven the day the member lands.
 */
export function sharedDestinations(
  transfers: readonly DetectorRow[],
  graph: IdentityGraph,
  maxUnrelatedIdentities: number,
): readonly SharedDestination[] {
  const byDestination = new Map<string, { identities: Set<string>; transfers: Set<string> }>();
  for (const row of transfers) {
    const destination = text(row, 'destinationRef');
    const identityId = text(row, 'identityId');
    const transferId = text(row, 'id');
    if (destination === undefined || identityId === undefined) {
      continue;
    }
    let bucket = byDestination.get(destination);
    if (bucket === undefined) {
      bucket = { identities: new Set(), transfers: new Set() };
      byDestination.set(destination, bucket);
    }
    bucket.identities.add(identityId);
    if (transferId !== undefined) {
      bucket.transfers.add(transferId);
    }
  }

  const out: SharedDestination[] = [];
  for (const [destinationRef, bucket] of [...byDestination].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const identityIds = [...bucket.identities].sort();
    const groups = relatedComponents(identityIds, graph);
    if (groups > maxUnrelatedIdentities) {
      out.push({
        destinationRef,
        identityIds,
        transferIds: [...bucket.transfers].sort(),
        unrelatedGroups: groups,
      });
    }
  }
  return out;
}

/** How many mutually-unrelated groups a set of identities falls into. */
export function relatedComponents(identityIds: readonly string[], graph: IdentityGraph): number {
  const seen = new Set<string>();
  let groups = 0;
  for (const start of identityIds) {
    if (seen.has(start)) {
      continue;
    }
    groups += 1;
    for (const other of identityIds) {
      if (!seen.has(other) && connected(graph, start, other)) {
        seen.add(other);
      }
    }
  }
  return groups;
}

/** `D-09`. `M07` section 3.2, input `payout_transfers`. BLOCKED on `DEP-M7-04`. */
export const D09_DESTINATION_CONCENTRATION: Detector = {
  id: 'D-09',
  streams: (request: DetectorScanRequest): readonly DetectorStream[] => [
    {
      name: 'transfers',
      table: 'payoutTransfers',
      where: { createdAt: request.terms.atMost(request.now) },
    },
    {
      name: 'links',
      table: 'identityLinks',
      where: { createdAt: request.terms.atMost(request.now) },
    },
  ],
  canaries: (mint: CanaryMint): readonly CanarySubject[] => [
    // `canary.ts`'s own shape, and section 5's second finding: it already mints
    // `identityId` onto a `payoutTransfers` row and that column does not exist
    // on that table. The battery was written for the join the read union does
    // not yet allow, which is the same gap from the other side.
    mint.sharedDestination('D-09', 0, { stream: 'transfers' }),
  ],
  scan: ({ request, rows }: DetectorScanInput): DetectorOutcome => {
    refuseUnlessComplete('D-09', request.definition);
    const maximum = statedInteger(
      registryParameter(request.definition, 'unrelated_identities_per_destination_greater_than'),
    );
    if (maximum === undefined) {
      throw new DetectorDeclined(
        'D-09',
        'unrelated_identities_per_destination_greater_than is unstated',
      );
    }
    const severity = severityOf('D-09', request.definition);
    const flagType = flagTypeOf('D-09', request.definition);
    const slaDueAt = slaDueAtFor('D-09', request.definition, severity, request.now);

    const edges = liveEdges(rows['links'] ?? []);
    const findings: DetectorFinding[] = [];
    for (const hit of sharedDestinations(rows['transfers'] ?? [], edges, maximum)) {
      for (const identityId of hit.identityIds) {
        findings.push({
          subjects: [...hit.identityIds],
          identityId,
          flagType,
          severity,
          evidence: {
            unrelated_identity_groups: hit.unrelatedGroups,
            identity_count: hit.identityIds.length,
            transfer_count: hit.transferIds.length,
          },
          ...(slaDueAt === undefined ? {} : { slaDueAt }),
        });
      }
    }
    return { findings };
  },
};

// =============================================================================
// D-10  AFFILIATE SELF-DEAL
// =============================================================================

/** One purchase attributed to a code whose affiliate is the buyer, or linked to them. */
export interface SelfDealAttribution {
  readonly attributionId: string;
  readonly buyerIdentityId: string;
  readonly affiliateIdentityId: string;
  readonly relation: 'same_identity' | 'linked';
}

/**
 * `M07` `D-10`: *"Purchase attributed to a code whose affiliate identity is
 * linked to the buyer."* `B4 #16`, voids attribution and flags.
 *
 * **THE ONLY DETECTOR IN THIS FILE WITH NO NUMBER AT ALL, AND THE SEED SAYS SO
 * POSITIVELY**: its `numeric_thresholds` parameter is `not_applicable` rather
 * than `unstated`, *"because `unstated` would say M07 named one and withheld it,
 * which would send a later session hunting for a number that was never there"*.
 * An edge exists between the affiliate identity and the buyer, or it does not.
 *
 * **A SUPPRESSED EDGE DOES NOT COUNT**, on `SD-M7-04`: *"a suppressed edge stays
 * visible as history and stops contributing to enforcement"*. Voiding a
 * trader's commission on an edge they successfully disputed is enforcement on a
 * withdrawn accusation.
 */
export function selfDealAttributions(
  attributions: readonly DetectorRow[],
  graph: IdentityGraph,
): readonly SelfDealAttribution[] {
  const out: SelfDealAttribution[] = [];
  for (const row of attributions) {
    if (row['voided'] === true) {
      continue;
    }
    const attributionId = text(row, 'id');
    const buyer = text(row, 'buyerIdentityId');
    const affiliate = text(row, 'affiliateIdentityId');
    if (attributionId === undefined || buyer === undefined || affiliate === undefined) {
      continue;
    }
    if (buyer === affiliate) {
      out.push({
        attributionId,
        buyerIdentityId: buyer,
        affiliateIdentityId: affiliate,
        relation: 'same_identity',
      });
      continue;
    }
    if (related(graph, buyer, affiliate)) {
      out.push({
        attributionId,
        buyerIdentityId: buyer,
        affiliateIdentityId: affiliate,
        relation: 'linked',
      });
    }
  }
  return out.sort((a, b) => (a.attributionId < b.attributionId ? -1 : 1));
}

/** `D-10`. `M07` section 3.2, input `attributions`. */
export const D10_AFFILIATE_SELF_DEAL: Detector = {
  id: 'D-10',
  streams: (request: DetectorScanRequest): readonly DetectorStream[] => [
    // An already-voided attribution has had B4 #16 applied to it. Re-flagging it
    // every night would grow the queue by one row per night per past finding.
    { name: 'attributions', table: 'attributions', where: { voided: false } },
    {
      name: 'links',
      table: 'identityLinks',
      where: { createdAt: request.terms.atMost(request.now) },
    },
  ],
  canaries: (mint: CanaryMint): readonly CanarySubject[] => [selfDealCanary(mint, 0)],
  scan: ({ request, rows }: DetectorScanInput): DetectorOutcome => {
    refuseUnlessComplete('D-10', request.definition);
    const severity = severityOf('D-10', request.definition);
    const flagType = flagTypeOf('D-10', request.definition);
    const slaDueAt = slaDueAtFor('D-10', request.definition, severity, request.now);

    const edges = liveEdges(rows['links'] ?? []);
    const findings: DetectorFinding[] = [];
    for (const hit of selfDealAttributions(rows['attributions'] ?? [], edges)) {
      findings.push({
        subjects: [hit.buyerIdentityId, hit.affiliateIdentityId],
        identityId: hit.affiliateIdentityId,
        flagType,
        severity,
        evidence: {
          attribution_id: hit.attributionId,
          relation: hit.relation,
          buyer_identity_id: hit.buyerIdentityId,
          affiliate_identity_id: hit.affiliateIdentityId,
        },
        ...(slaDueAt === undefined ? {} : { slaDueAt }),
      });
    }
    return { findings };
  },
};

function selfDealCanary(mint: CanaryMint, ordinal: number): CanarySubject {
  const subject = mint.subject('D-10', ordinal);
  const buyer = subject.actor('i-buyer');
  const affiliate = subject.actor('i-affiliate');
  const [a, b] = buyer < affiliate ? [buyer, affiliate] : [affiliate, buyer];
  return {
    id: subject.id,
    detector: 'D-10',
    nonce: mint.nonce,
    shape: 'shared-destination',
    actors: [buyer, affiliate],
    rows: {
      attributions: [
        {
          id: subject.row(0),
          buyerIdentityId: buyer,
          affiliateIdentityId: affiliate,
          voided: false,
        },
      ],
      links: [
        {
          id: subject.row(1),
          identityA: a,
          identityB: b,
          linkKind: 'shared_payment',
          confidenceBp: 7000,
          suppressed: false,
        },
      ],
    },
  };
}

// =============================================================================
// D-11  DILUTION TIMING
// =============================================================================

/** One manufactured small positive day, with the sibling that pays for it. */
export interface DilutionCandidate {
  readonly accountId: string;
  readonly tradingDay: string;
  readonly realizedPnlCents: number;
  readonly failingGates: readonly string[];
  readonly siblingAccountId: string;
  readonly correlationBp: number;
  readonly pairedDays: number;
}

/** Every gate group in an `engine_gates` object that is FAILING and not skipped. */
export function failingGates(engineGates: unknown): readonly string[] {
  if (typeof engineGates !== 'object' || engineGates === null || Array.isArray(engineGates)) {
    return [];
  }
  const out: string[] = [];
  for (const [name, gate] of Object.entries(engineGates as Record<string, unknown>)) {
    if (typeof gate !== 'object' || gate === null || Array.isArray(gate)) {
      continue;
    }
    const record = gate as Record<string, unknown>;
    if (record['pass'] === false && record['skipped'] !== true) {
      out.push(name);
    }
  }
  return out.sort();
}

/** The gate group `D-11` is about, spelled once. `ENGINE_GATE_LEAVES` is its source. */
export const CONSISTENCY_GATE = 'consistency';

/**
 * `M07` `D-11`: *"Small positive days appearing precisely while consistency is
 * the ONLY failing gate, with an inverse-correlated sibling."*
 *
 * **ALL THREE CONDITIONS, AND `M01 AS-02` IS WHY THE THIRD IS NOT OPTIONAL.**
 * A small positive day while consistency is the only failing gate is what an
 * honest trader grinding out a consistency requirement looks like; what makes it
 * MANUFACTURED dilution is that somebody else took the other side. Dropping the
 * sibling turns this detector into a flag against every disciplined trader in
 * the book.
 *
 * `M07` records the trade openly: `profit_needed_to_dilute_cents` is published
 * to the trader by design, *"and it is the number that makes their pattern
 * arithmetic to detect"*.
 */
export function dilutionCandidates(
  ruleStates: readonly DetectorRow[],
  marks: readonly DetectorRow[],
  options: {
    readonly maxDailyProfitCents: number;
    readonly siblingCorrelationFloorBp: number;
    readonly siblingWindowDays: number;
  },
): readonly DilutionCandidate[] {
  const seriesByAccount = new Map<string, Map<string, number>>();
  for (const row of marks) {
    const accountId = text(row, 'accountId');
    const day = dayOf(row);
    const pnl = cents(row['realizedPnlCents']);
    if (accountId === undefined || day === undefined || pnl === undefined) {
      continue;
    }
    const series = seriesByAccount.get(accountId) ?? new Map<string, number>();
    series.set(day, pnl);
    seriesByAccount.set(accountId, series);
  }

  const out: DilutionCandidate[] = [];
  for (const state of ruleStates) {
    const accountId = text(state, 'accountId');
    const day = dayOf(state);
    if (accountId === undefined || day === undefined) {
      continue;
    }
    const failing = failingGates(state['engineGates']);
    if (failing.length !== 1 || failing[0] !== CONSISTENCY_GATE) {
      continue;
    }
    const own = seriesByAccount.get(accountId);
    const pnl = own?.get(day);
    if (own === undefined || pnl === undefined || pnl <= 0 || pnl > options.maxDailyProfitCents) {
      continue;
    }

    const from = shiftDay(day, -(options.siblingWindowDays - 1));
    const days = [...own.keys()].filter((each) => each >= from && each <= day).sort();
    if (days.length < MIN_CORRELATION_DAYS) {
      continue;
    }
    const mine = days.map((each) => own.get(each) ?? 0);

    let best: { accountId: string; correlationBp: number } | undefined;
    for (const [siblingId, siblingSeries] of [...seriesByAccount].sort(([a], [b]) =>
      a < b ? -1 : 1,
    )) {
      if (siblingId === accountId) {
        continue;
      }
      if (!days.every((each) => siblingSeries.has(each))) {
        continue;
      }
      const theirs = days.map((each) => siblingSeries.get(each) ?? 0);
      const correlationBp = pearsonBp(mine, theirs);
      if (correlationBp === undefined || correlationBp > options.siblingCorrelationFloorBp) {
        continue;
      }
      if (best === undefined || correlationBp < best.correlationBp) {
        best = { accountId: siblingId, correlationBp };
      }
    }
    if (best === undefined) {
      continue;
    }
    out.push({
      accountId,
      tradingDay: day,
      realizedPnlCents: pnl,
      failingGates: failing,
      siblingAccountId: best.accountId,
      correlationBp: best.correlationBp,
      pairedDays: days.length,
    });
  }
  return out.sort((a, b) => (a.accountId < b.accountId ? -1 : 1));
}

/** `accounts.id` -> `accounts.identity_id`, which is the only path from a mark to a human. */
export function accountOwners(accounts: readonly DetectorRow[]): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const row of accounts) {
    const id = text(row, 'id');
    const identityId = text(row, 'identityId');
    if (id !== undefined && identityId !== undefined) {
      out.set(id, identityId);
    }
  }
  return out;
}

/** `D-11`. `M07` section 3.2, input `rule_states.engine_gates`. */
export const D11_DILUTION_TIMING: Detector = {
  id: 'D-11',
  streams: (request: DetectorScanRequest): readonly DetectorStream[] => {
    const windowDays = statedInteger(registryParameter(request.definition, 'sibling_window_days'));
    const from =
      windowDays === undefined ? undefined : shiftDay(request.tradingDay, -(windowDays - 1));
    return [
      { name: 'states', table: 'ruleStates', where: { tradingDay: request.tradingDay } },
      // WHO OWNS THE ACCOUNT, AND IT IS NOT OPTIONAL. `rule_states` names an
      // ACCOUNT and `risk_flags.identity_id` is `NOT NULL` because "flags attach
      // to HUMANS, not to accounts" (`0008_risk.sql:107`). Every closed account
      // is read too, because a manufactured day sits in the past and the account
      // that traded it may have closed since.
      {
        name: 'owners',
        table: 'accounts',
        where: { createdAt: request.terms.atMost(request.now) },
      },
      ...(from === undefined
        ? []
        : [
            {
              name: 'marks',
              table: 'dailyMarks' as const,
              // ONE-SIDED, AND SECTION 4 OF THIS FILE'S HEADER IS WHY. A filter
              // is one value per column ANDed, so `atLeast(from)` and
              // `atMost(day)` cannot both narrow `trading_day` in one call. The
              // upper bound is applied in `dilutionCandidates`.
              where: { tradingDay: request.terms.atLeast(from) },
            },
          ]),
    ];
  },
  canaries: (mint: CanaryMint): readonly CanarySubject[] => [dilutionCanary(mint, 0)],
  scan: ({ request, rows }: DetectorScanInput): DetectorOutcome => {
    refuseUnlessComplete('D-11', request.definition);
    const maxDailyProfitCents = statedInteger(
      registryParameter(request.definition, 'max_daily_profit_cents'),
    );
    const siblingCorrelationFloorBp = statedInteger(
      registryParameter(request.definition, 'sibling_correlation_floor_bp'),
    );
    const siblingWindowDays = statedInteger(
      registryParameter(request.definition, 'sibling_window_days'),
    );
    if (
      maxDailyProfitCents === undefined ||
      siblingCorrelationFloorBp === undefined ||
      siblingWindowDays === undefined
    ) {
      throw new DetectorDeclined('D-11', 'a dilution-timing parameter is unstated');
    }
    const severity = severityOf('D-11', request.definition);
    const flagType = flagTypeOf('D-11', request.definition);
    const slaDueAt = slaDueAtFor('D-11', request.definition, severity, request.now);

    const owners = accountOwners(rows['owners'] ?? []);
    const findings: DetectorFinding[] = [];
    for (const hit of dilutionCandidates(rows['states'] ?? [], rows['marks'] ?? [], {
      maxDailyProfitCents,
      siblingCorrelationFloorBp,
      siblingWindowDays,
    })) {
      const identityId = owners.get(hit.accountId);
      if (identityId === undefined) {
        // AN UNOWNED ACCOUNT IS A REFUSAL AND NOT A SKIP. `accounts.identity_id`
        // is `NOT NULL`, so an account with no owner in the window means the
        // window did not return the row, and inventing an identity from the
        // account id would write an account into `risk_flags.identity_id`.
        throw new DetectorDeclined(
          'D-11',
          `account ${hit.accountId} matched and its owning identity was not in the owners window, ` +
            'so the flag would have nobody to attach to. accounts.identity_id is NOT NULL, so this ' +
            'is a short read rather than an unowned account.',
        );
      }
      findings.push({
        // THE CANDIDATE AND NOT THE PAIR, AND TWO SEPARATE REASONS AGREE.
        //
        // The first is the battery. `D-11` is the one detector in this file
        // whose join crosses ROWS rather than reading one, and the runner merges
        // the synthetic subjects into the same stream, so a finding naming both
        // ends can name a canary at one end and a real account at the other.
        // `DetectorCanaryLeak` refuses that and fails the whole run, and it is
        // right to: counting it real accuses a person on evidence Merit
        // manufactured. Naming only the candidate makes the straddle
        // unreachable rather than unlikely.
        //
        // The second is the evidence pack. `GS-112` asserts a `trader` pack
        // carries "no detector parameter, no threshold and NO OTHER IDENTITY",
        // and a sibling account id inside this trader's flag is another
        // identity's account travelling in this trader's row.
        subjects: [hit.accountId],
        identityId,
        accountId: hit.accountId,
        flagType,
        severity,
        evidence: {
          trading_day: hit.tradingDay,
          realized_pnl_cents: hit.realizedPnlCents,
          failing_gates: hit.failingGates,
          sibling_correlation_bp: hit.correlationBp,
          paired_days: hit.pairedDays,
        },
        ...(slaDueAt === undefined ? {} : { slaDueAt }),
      });
    }
    return { findings };
  },
};

function dilutionCanary(mint: CanaryMint, ordinal: number): CanarySubject {
  const subject = mint.subject('D-11', ordinal);
  const account = subject.actor('a-diluter');
  const sibling = subject.actor('a-sibling');
  const from = '2026-01-05';
  // THE LAST DAY IS ONE CENT, WHICH IS BELOW ANY `max_daily_profit_cents` THE
  // REGISTRY COULD EVER STATE, and the series is perfectly inverse, which is
  // below any floor. That is what makes this battery threshold-independent.
  const series = [40000, -25000, 90000, -60000, 1];
  const marks: DetectorRow[] = [];
  series.forEach((pnl, day) => {
    marks.push({
      id: subject.row(marks.length),
      accountId: account,
      tradingDay: shiftDay(from, day),
      realizedPnlCents: BigInt(pnl),
    });
    marks.push({
      id: subject.row(marks.length),
      accountId: sibling,
      tradingDay: shiftDay(from, day),
      realizedPnlCents: BigInt(-pnl),
    });
  });
  return {
    id: subject.id,
    detector: 'D-11',
    nonce: mint.nonce,
    shape: 'hedged-pair',
    actors: [account, sibling, subject.actor('i-diluter'), subject.actor('i-sibling')],
    rows: {
      owners: [
        { id: account, identityId: subject.actor('i-diluter') },
        { id: sibling, identityId: subject.actor('i-sibling') },
      ],
      states: [
        {
          id: subject.row(marks.length),
          accountId: account,
          tradingDay: shiftDay(from, series.length - 1),
          engineGates: {
            tradedDays: { pass: true },
            winDays: { pass: true },
            buffer: { pass: true },
            consistency: { pass: false },
            cadenceGap: { pass: true },
            minimumAmount: { pass: true },
          },
        },
      ],
      marks,
    },
  };
}

// =============================================================================
// D-16  LINK-CONFIDENCE SCORE, v1 HALF
// =============================================================================

/** One edge standing at or above the hard-link confidence ceiling. */
export interface HardLinkEdge {
  readonly identityA: string;
  readonly identityB: string;
  readonly linkKind: string;
  readonly confidenceBp: number;
}

/**
 * `M07` `D-16`'s v1 half. `ADR-022`'s v1 tier is *"hard links plus KYC dedupe"*
 * and `P7`'s row says v1 tier ONLY, twice.
 *
 * **THE CEILING IS THE DISCRIMINATOR AND `link_kind` IS NOT.** `INV-M7-01`: *"an
 * identity link is a SIGNAL WITH A CONFIDENCE, never a proof ... only a
 * biometric dedupe hit or an explicit admin merge may exceed a configured
 * ceiling"*. Reading hardness off `link_kind` instead would substitute a
 * vocabulary this file picked for the one the invariant names, and
 * `identity_links.link_kind` has no `CHECK`, so that vocabulary is whatever
 * anybody has ever written into the column.
 *
 * **WHAT THIS PRODUCES IS A FLAG AGAINST BOTH IDENTITIES AND NOTHING ELSE**,
 * which is `M07` section 3.1's third tier read literally: *"An edge written at
 * the hard-link confidence ceiling. Caps do NOT aggregate and NO STATE CHANGES
 * AUTOMATICALLY. A severity-5 flag opens against both identities."* `ADR-155`
 * clause 1 is the ruling that makes the edge itself somebody else's write and
 * clause 2 is the ruling that keeps this one at `open`.
 */
export function hardLinkEdges(
  links: readonly DetectorRow[],
  ceilingBp: number,
): readonly HardLinkEdge[] {
  const out: HardLinkEdge[] = [];
  for (const row of links) {
    if (row['suppressed'] === true) {
      continue;
    }
    const identityA = text(row, 'identityA');
    const identityB = text(row, 'identityB');
    const confidenceBp = integer(row, 'confidenceBp');
    const linkKind = text(row, 'linkKind');
    if (identityA === undefined || identityB === undefined || confidenceBp === undefined) {
      continue;
    }
    if (confidenceBp < ceilingBp) {
      continue;
    }
    out.push({ identityA, identityB, linkKind: linkKind ?? 'unknown', confidenceBp });
  }
  return out.sort((a, b) =>
    edgeKey(a.identityA, a.identityB) < edgeKey(b.identityA, b.identityB) ? -1 : 1,
  );
}

/** `D-16`'s v1 half. `M07` sections 3.1 and 7.9, input `identity_links`. */
export const D16_LINK_CONFIDENCE: Detector = {
  id: 'D-16',
  streams: (): readonly DetectorStream[] => [
    { name: 'links', table: 'identityLinks', where: { suppressed: false } },
  ],
  canaries: (mint: CanaryMint): readonly CanarySubject[] => [hardLinkCanary(mint, 0)],
  scan: ({ request, rows }: DetectorScanInput): DetectorOutcome => {
    refuseUnlessComplete('D-16', request.definition);
    const ceilingBp = statedInteger(
      registryParameter(request.definition, 'hard_link_confidence_ceiling_bp'),
    );
    if (ceilingBp === undefined) {
      throw new DetectorDeclined('D-16', 'hard_link_confidence_ceiling_bp is unstated');
    }
    const severity = severityOf('D-16', request.definition);
    const flagType = flagTypeOf('D-16', request.definition);
    const slaDueAt = slaDueAtFor('D-16', request.definition, severity, request.now);

    const findings: DetectorFinding[] = [];
    for (const edge of hardLinkEdges(rows['links'] ?? [], ceilingBp)) {
      // BOTH IDENTITIES, WHICH IS THE TIER'S OWN WORDING AND NOT A CHOICE. One
      // flag would leave the other person unqueued and unreviewed while an edge
      // at the ceiling stands against them.
      for (const identityId of [edge.identityA, edge.identityB]) {
        findings.push({
          subjects: [edge.identityA, edge.identityB],
          identityId,
          flagType,
          severity,
          evidence: {
            counterparty_identity_id:
              identityId === edge.identityA ? edge.identityB : edge.identityA,
            link_kind: edge.linkKind,
            confidence_bp: edge.confidenceBp,
          },
          ...(slaDueAt === undefined ? {} : { slaDueAt }),
        });
      }
    }
    return { findings };
  },
};

function hardLinkCanary(mint: CanaryMint, ordinal: number): CanarySubject {
  const subject = mint.subject('D-16', ordinal);
  const a = subject.actor('i-a');
  const b = subject.actor('i-b');
  const [low, high] = a < b ? [a, b] : [b, a];
  return {
    id: subject.id,
    detector: 'D-16',
    nonce: mint.nonce,
    shape: 'shared-destination',
    actors: [a, b],
    rows: {
      // `confidence_bp` 10000 is `identity_links`' own maximum, so this edge
      // sits at or above ANY ceiling the registry could state. `INV-M7-01`
      // reserves that value for a biometric hit or an admin merge, which is what
      // `link_kind` says it is.
      links: [
        {
          id: subject.row(0),
          identityA: low,
          identityB: high,
          linkKind: 'biometric_match',
          confidenceBp: 10000,
          suppressed: false,
        },
      ],
    },
  };
}

// =============================================================================
// D-18  REGISTRATION PHONE LOOKUP
// =============================================================================

/**
 * `identity_phones.footprint_present IS FALSE`, AND NEVER `IS NOT TRUE`.
 *
 * **THE WHOLE RELIABILITY OF `D-18` IS IN THIS ONE COMPARISON** (`M07` section
 * 3.2, `P7` section 11 rule 12, and `P7-d`'s seed states the test as data:
 * `footprint_present_test: 'IS FALSE'`). The column is three-valued because the
 * lookup FAILS OPEN: `null` means the vendor was not reached and `false` means
 * the vendor looked and found nothing. `value !== true` returns `true` for
 * `null`, so a vendor outage would score every customer looked up during it as a
 * fleet member.
 *
 * **AND IT IS AN EQUALITY, WHICH IS WHY `ADR-157`'s REFUSED `isNotNull` TERM
 * COSTS THIS DETECTOR NOTHING.** `IS FALSE` narrows at the accessor with the
 * equality it has always had.
 */
export function hasNoFootprint(value: unknown): boolean {
  return value === false;
}

/** `identity_phones.line_type = 'voip'`. Scored, never a refusal (`M07` section 3.2). */
export function isVoipLine(value: unknown): boolean {
  return value === 'voip';
}

/** `ADR-039` (a)'s fleet signature: four legs, all four required. */
export const FLEET_SIGNATURE_LEGS = [
  'voip_line_type',
  'fresh_email',
  'datacenter_ip',
  'no_digital_footprint',
] as const;

/** The two legs `identity_phones` can answer on its own. */
export const FLEET_LEGS_WITH_INPUT = ['voip_line_type', 'no_digital_footprint'] as const;

/** One phone row and which of the four legs it satisfies. */
export interface FleetSignatureRow {
  readonly phoneId: string;
  readonly identityId: string;
  readonly legs: Readonly<Record<(typeof FLEET_SIGNATURE_LEGS)[number], boolean>>;
  readonly legsSatisfied: number;
}

/**
 * The rows satisfying the legs `identity_phones` can answer, with the two legs
 * `D-15` owns reported as UNSATISFIED rather than as absent.
 *
 * **`false` AND NOT `undefined` FOR THE MISSING LEGS, AND THE DIFFERENCE IS THE
 * POINT.** `undefined` invites a later reader to treat "we could not check" as
 * "it passed", which is the same three-valued mistake this detector exists to
 * refuse, one level up. A leg with no vendor is a leg that is not satisfied, so
 * `legsSatisfied` can never reach four and the composite can never fire, which
 * is why the detector declines instead of scoring.
 *
 * **THE LEGS ARE RE-TESTED HERE EVEN THOUGH THE WINDOW ALREADY NARROWED ON
 * THEM**, because the canary rows are merged into the stream AFTER the read and
 * never travel through `rowsWhere` at all.
 */
export function fleetSignatureRows(phones: readonly DetectorRow[]): readonly FleetSignatureRow[] {
  const out: FleetSignatureRow[] = [];
  for (const row of phones) {
    const phoneId = text(row, 'id');
    const identityId = text(row, 'identityId');
    if (phoneId === undefined || identityId === undefined) {
      continue;
    }
    const legs = {
      voip_line_type: isVoipLine(row['lineType']),
      fresh_email: false,
      datacenter_ip: false,
      no_digital_footprint: hasNoFootprint(row['footprintPresent']),
    };
    const legsSatisfied = Object.values(legs).filter(Boolean).length;
    if (legs.voip_line_type && legs.no_digital_footprint) {
      out.push({ phoneId, identityId, legs, legsSatisfied });
    }
  }
  return out.sort((a, b) => (a.phoneId < b.phoneId ? -1 : 1));
}

/** `D-18`. `M07` section 3.2, input `identity_phones`. BLOCKED on `D-15`. */
export const D18_REGISTRATION_PHONE: Detector = {
  id: 'D-18',
  streams: (request: DetectorScanRequest): readonly DetectorStream[] => [
    {
      name: 'phones',
      table: 'identityPhones',
      where: {
        // `footprintPresent: false` IS `IS FALSE`. Written as an equality
        // because that is what `IS FALSE` is, and a vendor-timeout row carrying
        // `null` does not match an equality on `false`.
        footprintPresent: false,
        lineType: 'voip',
        // The LIVE number and not the history. `identity_phones` supersedes and
        // releases rather than updating, so a released number stays a row and a
        // detector reading it would score somebody on a number they gave up.
        releasedAt: request.terms.isNull(),
        supersededAt: request.terms.isNull(),
      },
    },
  ],
  canaries: (mint: CanaryMint): readonly CanarySubject[] => [fleetCanary(mint, 0)],
  scan: ({ request, rows }: DetectorScanInput): DetectorOutcome => {
    refuseUnlessComplete('D-18', request.definition);
    const severity = severityOf('D-18', request.definition);
    const flagType = flagTypeOf('D-18', request.definition);
    const slaDueAt = slaDueAtFor('D-18', request.definition, severity, request.now);

    const findings: DetectorFinding[] = [];
    for (const hit of fleetSignatureRows(rows['phones'] ?? [])) {
      if (hit.legsSatisfied < FLEET_SIGNATURE_LEGS.length) {
        continue;
      }
      findings.push({
        subjects: [hit.identityId],
        identityId: hit.identityId,
        flagType,
        severity,
        evidence: {
          phone_id: hit.phoneId,
          legs_satisfied: hit.legsSatisfied,
          legs: hit.legs,
        },
        ...(slaDueAt === undefined ? {} : { slaDueAt }),
      });
    }
    return { findings };
  },
};

function fleetCanary(mint: CanaryMint, ordinal: number): CanarySubject {
  const subject = mint.subject('D-18', ordinal);
  const identity = subject.actor('i-fleet');
  return {
    id: subject.id,
    detector: 'D-18',
    nonce: mint.nonce,
    shape: 'shared-destination',
    actors: [identity],
    rows: {
      phones: [
        {
          id: subject.row(0),
          identityId: identity,
          lineType: 'voip',
          // `false` AND NOT `null`. A battery row carrying `null` would be found
          // by an `IS NOT TRUE` detector and missed by a correct one, which is
          // the canary asserting the defect rather than the behaviour.
          footprintPresent: false,
          releasedAt: null,
          supersededAt: null,
        },
      ],
    },
  };
}

// -----------------------------------------------------------------------------
// The set, as the runner takes it
// -----------------------------------------------------------------------------

/**
 * `P7-h`'s seven, in `M07` section 3.2's order.
 *
 * `runDetectors` takes an array and is agnostic about which module supplied it,
 * which is `ADR-100`'s shape reached by hand because `apps/worker` has no route
 * registry to inherit it from (`P7` section 5.5).
 */
export const IDENTITY_DETECTORS: readonly Detector[] = [
  D07_ENTITY_CAP,
  D08_PAYMENT_VELOCITY,
  D09_DESTINATION_CONCENTRATION,
  D10_AFFILIATE_SELF_DEAL,
  D11_DILUTION_TIMING,
  D16_LINK_CONFIDENCE,
  D18_REGISTRATION_PHONE,
];
