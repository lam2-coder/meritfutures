// =============================================================================
// apps/api/src/admin-source/evidence.ts
// =============================================================================
// `AdminReadSource.exportEvidence`. P7 section 8's `P7-j`, the SECOND DONE-GATE,
// and the gate PASSES WHEN A DOCUMENT OMITS SOMETHING rather than when it
// contains something.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE DECIDES, AND WHY IT IS THE ONE WITH THE ADVERSARY IN IT
// -----------------------------------------------------------------------------
// `AS-M6-01`: the evidence pack is a DETECTOR-DISCLOSURE CHANNEL. A ring member
// triggers a flag deliberately, contests it, receives a pack, and has bought the
// detection thresholds of the whole firm for the price of one burned evaluation.
// `EC-071` prices it and the dossier says these groups coordinate, so the
// disclosure does not stay with one person.
//
// `SD-M6-04` is the counter and it is in the DDL rather than in a handler:
// `evidence_packs` makes `audience`, `redaction_profile` and
// `includes_detector_detail` all `NOT NULL`, and
// `evidence_packs_trader_gets_no_detector_detail` makes ONE COMBINATION
// UNREPRESENTABLE -- `audience = 'trader' AND includes_detector_detail = true`.
// This file never composes that row and the database refuses it if it ever does.
//
// -----------------------------------------------------------------------------
// THE REDACTION PROFILE IS A CLOSED VOCABULARY OF TWO (`ADR-179`)
// -----------------------------------------------------------------------------
// `full-detail` and `trader-facts-only`, declared as a union rather than derived
// from the audience map, because a derived vocabulary CANNOT REFUSE A MEMBER: it
// is whatever its map says. `EvidenceRedactionProfile` carries what each member
// promises, per member, and the suite reads this file for the member list the
// way `packages/db/test/scoped-db.test.ts` reads `SystemReason`.
//
// THE CLOSURE HOLDS AT THE LAYER THAT COMPOSES THE VALUE AND NOT AT THE LAYER
// THAT STORES IT, which `ADR-179` clause 5 states rather than leaves to be found.
// `0008_risk.sql` puts NO `CHECK` on `redaction_profile` and `schema.ts` types it
// as `text`, so a writer that does not come through this file can still store a
// name nothing in the tree performs. The entry carries the DDL for the migration
// that closes it and takes no migration number: `packages/db/migrations` is
// another session's this wave and a merged migration is never edited.
//
// -----------------------------------------------------------------------------
// THE STRIP LIST IS A QUERY OVER `detector_definitions` AND NEVER A LIST HERE
// -----------------------------------------------------------------------------
// `INV-M7-10`, whose own source column reads "using SD-M7-03's registry as the
// strip list", and `FM-M7-06`, which calls it "a cross-module control and
// neither half works alone".
//
// A HAND-WRITTEN STRIP LIST IS A LIST THAT DRIFTS FROM THE THING IT MIRRORS.
// `P7-d` seeded eighteen `detector_definitions` rows and THE SEED IS THE
// REGISTRY; a nineteenth detector added there and forgotten here would leak on
// the first export after it shipped, and nothing in this tree would say so. So
// `sensitiveParameterNames` READS the registry rows this export ran against and
// the answer changes when the registry changes, which is the only version of
// this control that survives a session that never opens this file.
//
// THE COLUMN IS UNIFORMLY `true` TODAY AND THAT IS WHY THE MECHANISM IS ASSERTED
// AND NOT ONLY THE OUTCOME. `P7-d` recorded the consequence in its own session
// entry: while every row is sensitive, a pack that COMPUTES the list and a pack
// that strips every detector UNCONDITIONALLY produce byte-identical output, so
// `GS-112` passes either way. The suite therefore drives this function with a
// registry carrying an `is_sensitive: false` row and asserts the two answers
// DIFFER, which is a property of the function rather than of the seed.
//
// -----------------------------------------------------------------------------
// THREE CONTROLS, AND EACH ONE FAILS DIFFERENTLY
// -----------------------------------------------------------------------------
//   1. THE PROJECTION IS AN ALLOWLIST. `M06` section 4 says a `trader` pack
//      carries "the account's own facts in full ... and the fact that a flag
//      exists with its type and its ToS clause". A flag's `evidence` bag is the
//      thing `AS-M6-01` is about, so the trader projection names the fields that
//      cross rather than the fields that do not.
//   2. THE STRIP SWEEP RUNS OVER WHAT SURVIVED, computed from the registry, and
//      REMOVES a key whose name is a sensitive detector's parameter.
//   3. THE REFUSAL RUNS LAST. `assertTraderPackIsClean` re-derives the same
//      answers over the finished document and THROWS rather than shipping.
//
// A strip that silently produced an empty document would pass a test that only
// counted what was missing, so control 3 is separate from control 2 and the
// suite asserts both directions: every fill, mark, rule state, gate result and
// the plan's rule text ARE present, and the negatives are asserted one at a
// time rather than as a single "is redacted" boolean.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE DOES NOT DO
// -----------------------------------------------------------------------------
// IT TAKES NO HANDLE OFF THE ACCESSOR. `src/db.ts` is the one file in this
// deployable that may, it declares `scoped` and `firm` and NO `system(reason)`
// door, and `ADR-171` refused to open one after measuring that it unblocks none
// of the five admin ports. `test/db.test.ts` pins that map. So the rows arrive
// through `EvidenceReadPort` and the row is written through
// `EvidencePackWriter`, and the slice that opens the operator door supplies
// both.
//
// IT EMITS NO `evidence.pack_exported` EVENT. `M06` section 6 says that event
// now carries `audience` and `redaction_profile`, and the event catalogue is not
// in this fence. The AUDIT is not lost by the omission: `0008_risk.sql` says
// "Export is ITSELF AN AUDITED ACT" about the ROW, and `INV-M6-05` is satisfied
// by the row this file writes. The event is reported as owed rather than built.
//
// IT NAMES NO ADMIN HOST. `ADR-012`: `ADMIN_ORIGIN` is a placeholder and the
// real admin domain is never written into this repository. The signed URL is the
// store's and this file only carries it.
// =============================================================================

import { createHash } from 'node:crypto';

import { AdminReadError } from '../routes/admin-reads.ts';
import type {
  AdminPrincipal,
  EvidenceExportRequest,
  EvidencePackAudience,
  EvidencePackResponse,
} from '../routes/admin-reads.ts';

// -----------------------------------------------------------------------------
// The refusals
// -----------------------------------------------------------------------------

/** The generator was asked for something it must not guess about. */
export class EvidenceExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceExportError';
  }
}

/**
 * A finished pack would have disclosed something its audience may not receive.
 *
 * A DISTINCT CLASS BECAUSE THE TWO FAILURES ARE NOT THE SAME EVENT. A missing
 * account is an ordinary request that answers 404; a `trader` document that
 * still carries a detector parameter is `AS-M6-01` arriving, and it must be
 * possible for a caller, a suite and an alarm to tell them apart without reading
 * a message.
 */
export class EvidenceRedactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceRedactionError';
  }
}

// -----------------------------------------------------------------------------
// The profile vocabulary. `ADR-179`: A CLOSED SET OF TWO, AND WHAT EACH PROMISES
// -----------------------------------------------------------------------------

/**
 * `evidence_packs.redaction_profile`. TWO MEMBERS, AND JOINING THEM IS A DIFF ON
 * THIS LINE WITH AN ARGUMENT ATTACHED.
 *
 * `ADR-179` clause 1. `SystemReason` and `SqlExecutorReason` are the precedent
 * and the shape is theirs: a union declared in one place, a source-reading case
 * in the suite that says how many members it has, and a widening that is
 * therefore an edit to a test that says why the set is closed.
 *
 * DECLARED RATHER THAN DERIVED, WHICH IS THE WHOLE OF CLAUSE 2. This type used to
 * read `(typeof EVIDENCE_REDACTION_PROFILES)[keyof typeof EVIDENCE_REDACTION_PROFILES]`,
 * so the vocabulary was a SHADOW OF THE MAP: whatever the map said, the type
 * became, and NOTHING IN THE TREE DECLARED THAT TWO WAS THE NUMBER. That is open
 * at exactly one line rather than at a call site, and the line it is open at is
 * the line a vocabulary change is made on. `OQ-F4-03` is the live candidate to
 * make it: a later ruling that gives `regulator` its own profile is a MAPPING
 * change, and under a derived type it grew the VOCABULARY as a side effect
 * nobody argued for.
 *
 * ------------------------------------------------------------------------
 * `trader-facts-only`
 * ------------------------------------------------------------------------
 * IT CARRIES the account's own facts whole: the `accounts` and `identities`
 * rows, every fill, every mark, every rule state (`engine_gates` and
 * `context_gates` are what a "gate result" IS after `SD-06` split it), the
 * pinned plan version and its `rule_text`, and per flag the FACT that it exists
 * -- `flag_id`, `flag_type`, `status`, `first_detected_on`, `tos_clause` -- and
 * nothing else about the flag.
 *
 * IT STRIPS FOUR THINGS BY FOUR DIFFERENT MECHANISMS, which is why the promise
 * is written per member rather than as one word:
 *   1. every TOP-LEVEL parameter name of every `is_sensitive` registry row,
 *      swept recursively, computed and never listed (`INV-M7-10`);
 *   2. the flag's `evidence` bag, `severity`, `detector` and `detector_version`,
 *      by the allowlist, which names what crosses rather than what does not;
 *   3. the `detectors` section, which is ABSENT rather than empty;
 *   4. any identifier belonging to another subject, anywhere inside any value,
 *      INCLUDING inside free text.
 *
 * AND THE CORPUS STATES FOUR NEGATIVES WHILE `GS-112`'s OWN LINE STATES THREE.
 * `M06` section 4, `EC-071` and the wave 3 batch 1 gate closure all add "no
 * comparison against a population"; `GS-112` does not. The promise is the UNION
 * of the three statements, so: no detector parameter is mechanism 1 and 3, no
 * threshold is mechanism 1 (a threshold is named rather than valued), no other
 * identity is mechanism 4, and no population comparison is mechanism 2, because
 * a population comparison can only reach a pack through the `evidence` bag or a
 * `detectors` section and the allowlist admits neither.
 *
 * ITS ONE UNCLOSED CHANNEL IS FREE TEXT AND IT IS NAMED RATHER THAN CLAIMED.
 * `tos_clause` is prose an operator writes, `GS-112` REQUIRES the pack to carry
 * it, and mechanism 4 reaches it because a uuid has a shape a runner can match.
 * A population comparison in prose has NO such shape. `ADR-179` clause 7 reports
 * that rather than pretending the sweep covers it.
 *
 * `includes_detector_detail` is `false` under this profile, always.
 *
 * ------------------------------------------------------------------------
 * `full-detail`
 * ------------------------------------------------------------------------
 * IT CARRIES everything `trader-facts-only` carries, plus the whole flag record
 * (`identity_id`, `account_id`, `severity`, `detector`, `detector_version`,
 * `evidence`) and a `detectors` section holding every registry row with its
 * parameters and its `is_sensitive`.
 *
 * IT STRIPS NOTHING, and the name is `M06` section 4's own phrase for that.
 *
 * IT DOES NOT PROMISE EVERYTHING THE FIRM HOLDS, and the distinction is the one
 * a reader of the name is most likely to get wrong. The subject is ONE ACCOUNT:
 * `readSubject` takes an account id and `exportEvidence` refuses a subject whose
 * `account_id` is not the one requested. `full-detail` bounds the DETAIL and
 * never the SCOPE.
 *
 * `includes_detector_detail` is `true` under this profile, always.
 */
export type EvidenceRedactionProfile = 'full-detail' | 'trader-facts-only';

/**
 * `evidence_packs.redaction_profile`, per audience.
 *
 * THE MAPPING IS A TRANSCRIPTION AND THE VOCABULARY IS A RULING, and `ADR-179`
 * clause 2 keeps them separate so that changing one cannot change the other by
 * accident. `M06` section 4 gives the split in its own words: the `trader`
 * audience gets "the account's own facts in full ... no detector parameters, no
 * thresholds, no other identity, and no comparison against a population", and
 * "`internal`, `counsel`, and `regulator`: full detail including detector
 * internals". `EC-071` says it a second time and the wave 3 batch 1 gate closure
 * a third, in the words "The `regulator` audience follows the internal profile".
 * So three of the four collapsing into one profile is a TRANSCRIPTION.
 *
 * THE ANNOTATION IS THE VOCABULARY AND NOT `string`, AND THAT IS THE LINE THAT
 * REFUSES A THIRD NAME. It read `Readonly<Record<EvidencePackAudience, string>>`,
 * which accepted any string a session cared to write in this object.
 *
 * NO PARALLEL ARRAY OF THE NAMES IS DECLARED, and that is `ADR-092`'s landmine
 * avoided rather than repeated. A `readonly EvidenceRedactionProfile[]` beside
 * the union catches a member the union does not have and NEVER a union member
 * the array is missing, which is exactly how `DDL_NAMES` went one short of
 * `SQL_NAME` with the suite green (`ADR-092` executed that, and `DDL_NAMES` is
 * derived from `SQL_NAME` now). The suite enumerates the union by reading
 * this file, the way `packages/db/test/scoped-db.test.ts` reads `SystemReason`,
 * and asserts the values here are exactly it.
 */
export const EVIDENCE_REDACTION_PROFILES = {
  internal: 'full-detail',
  trader: 'trader-facts-only',
  counsel: 'full-detail',
  regulator: 'full-detail',
} as const satisfies Readonly<Record<EvidencePackAudience, EvidenceRedactionProfile>>;

/** The profile that FOLLOWS FROM the audience. `M06` section 4: never per export. */
export function redactionProfileFor(audience: EvidencePackAudience): EvidenceRedactionProfile {
  return EVIDENCE_REDACTION_PROFILES[audience];
}

/**
 * `evidence_packs.includes_detector_detail`, DERIVED from the profile.
 *
 * NOT A THIRD INDEPENDENT PARAMETER, and `ADR-179` clause 4 pins that. It is
 * `false` exactly when the profile is the trader's, so the combination the
 * merged CHECK calls "the one combination that must be unrepresentable" has no
 * expression here at all: there is no argument a caller could pass to produce
 * it. A boolean chosen beside the profile rather than from it would also make
 * the OTHER lie available -- a `full-detail` pack recorded with detail off,
 * which the DDL permits and which is a row that misdescribes its own bytes.
 */
export function includesDetectorDetail(audience: EvidencePackAudience): boolean {
  return redactionProfileFor(audience) !== 'trader-facts-only';
}

// -----------------------------------------------------------------------------
// The registry, and the strip list computed from it
// -----------------------------------------------------------------------------

/**
 * One `detector_definitions` row, as the export needs it.
 *
 * `parameters` is `unknown` and not a shape: `P7-d`'s rows carry
 * `{state, value, unit, cite, quote}` per parameter and a later version may
 * carry something else. THE STRIP LIST NEEDS THE KEYS AND NEVER THE VALUES, so
 * declaring the value shape here would be this file taking a dependency on a
 * seed format it does not own.
 */
export interface DetectorRegistryRow {
  readonly detector: string;
  readonly version: string;
  readonly parameters: unknown;
  readonly is_sensitive: boolean;
}

/**
 * Bookkeeping the generator writes beside the parameters, and not a parameter.
 *
 * `P7-d`'s rows carry `_meta` holding the detector's name, its `M07` row, and
 * `is_sensitive_reason`. Its SUBKEYS are prose keys (`name`, `input`, `quote`)
 * that collide with ordinary column names, so sweeping them would strip real
 * trader facts and read as a redaction working. The strip list is therefore the
 * TOP-LEVEL parameter names, which is what a threshold is named by.
 */
const REGISTRY_META_KEY = '_meta';

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Readonly<Record<string, unknown>>;
}

/**
 * THE STRIP LIST. `INV-M7-10`, computed and never written down.
 *
 * The union of the top-level parameter names over every registry row whose
 * `is_sensitive` is true. THE UNION IS THE POINT AND IT IS NOT AN
 * IMPLEMENTATION DETAIL: `severity` and `window_trading_days` are parameters of
 * several detectors at once, so a single row flipped to `is_sensitive: false`
 * does NOT release a name another sensitive row still claims. A caller reading
 * this as "per detector" would ship the shared threshold.
 */
export function sensitiveParameterNames(
  registry: readonly DetectorRegistryRow[],
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const row of registry) {
    if (!row.is_sensitive) continue;
    const parameters = asRecord(row.parameters);
    if (parameters === null) continue;
    for (const name of Object.keys(parameters)) if (name !== REGISTRY_META_KEY) names.add(name);
  }
  return names;
}

// -----------------------------------------------------------------------------
// The subject: what the port hands over, in the corpus's own sections
// -----------------------------------------------------------------------------

/** A row, as the accessor returns one. Column names, not camel case. */
export type EvidenceRow = Readonly<Record<string, unknown>>;

/**
 * One `risk_flags` row plus the ToS clause of whatever cited it.
 *
 * `tos_clause` IS NULLABLE AND THAT IS A FINDING RATHER THAN A CONVENIENCE.
 * `risk_flags` carries no clause column. A clause exists on the ENFORCEMENT that
 * cites the flag -- `payout_requests.hold_tos_clause` under
 * `payout_requests_hold_is_complete`, and `identity_restriction_episodes` under
 * `ADR-041` -- so an `open` flag nobody has acted on has no clause to carry and
 * `DEP-M7-05` still owes two of the three clause texts. THE PACK CARRIES `null`
 * AND NEVER INVENTS ONE: a clause written in this file would be the hand-listed
 * drift `INV-M7-10` exists to prevent, one table over.
 */
export interface EvidenceFlagRecord {
  readonly flag_id: string;
  readonly identity_id: string;
  readonly account_id: string | null;
  readonly flag_type: string;
  readonly severity: number;
  readonly status: string;
  readonly first_detected_on: string;
  readonly detector: string | null;
  readonly detector_version: string | null;
  readonly evidence: EvidenceRow;
  readonly tos_clause: string | null;
}

/**
 * Everything the pack is built from, for ONE account.
 *
 * THE SECTION NAMES ARE `GS-112`'s OWN NOUNS: "every fill, mark, rule state,
 * gate result, and the plan's rule text, plus the fact and ToS clause of any
 * flag". Four of the five are tables; the fifth is not.
 *
 * THERE IS NO `gate_results` TABLE IN THIS TREE AND THERE IS NOT MEANT TO BE.
 * `SD-06` split it into `rule_states.engine_gates` and `rule_states.context_gates`
 * (`0015_rule_states.sql`), because freeze, recon, KYC and in-flight were true on
 * the day and may not be true now. So a gate result is TWO COLUMNS ON A RULE
 * STATE, `M06` section 3.2's "from the stored row rather than from a
 * recomputation" applies to both, and the suite asserts them by name rather than
 * asserting a section that would be silently empty.
 */
export interface EvidenceSubject {
  readonly account_id: string;
  readonly identity_id: string;
  readonly account: EvidenceRow;
  readonly identity: EvidenceRow;
  readonly fills: readonly EvidenceRow[];
  readonly marks: readonly EvidenceRow[];
  readonly rule_states: readonly EvidenceRow[];
  /** The pinned `plan_versions` row. `rule_text` is `M06`'s "the plan's rule text". */
  readonly plan_version: EvidenceRow;
  readonly flags: readonly EvidenceFlagRecord[];
}

// -----------------------------------------------------------------------------
// The document
// -----------------------------------------------------------------------------

/** The bytes' shape, before they are bytes. */
export interface EvidenceDocument {
  readonly pack: {
    readonly account_id: string;
    readonly audience: EvidencePackAudience;
    readonly redaction_profile: EvidenceRedactionProfile;
    readonly includes_detector_detail: boolean;
    readonly reason: string;
    readonly requested_by: string;
  };
  readonly account: EvidenceRow;
  readonly identity: EvidenceRow;
  readonly fills: readonly EvidenceRow[];
  readonly marks: readonly EvidenceRow[];
  readonly rule_states: readonly EvidenceRow[];
  readonly plan_version: EvidenceRow;
  readonly flags: readonly EvidenceRow[];
  /** Present ONLY at `includes_detector_detail`. Absent, not empty, otherwise. */
  readonly detectors?: readonly EvidenceRow[];
}

/**
 * The fields of a flag a `trader` pack carries. AN ALLOWLIST.
 *
 * `M06` section 4: "the fact that a flag exists with its type and its ToS
 * clause". THE FOUR THINGS ABSENT FROM THIS LIST ARE ABSENT ON PURPOSE:
 * `evidence` is the bag `AS-M6-01` is written about, `severity` is the queue
 * ordering that `M07` section 3.3 calls contextual and that `G-HOLD-REQUIRED`
 * reads at 4, and `detector` and `detector_version` name the machinery that
 * found them, which `ADR-022` puts at internal tier always.
 */
const TRADER_FLAG_FIELDS = ['flag_id', 'flag_type', 'status', 'first_detected_on', 'tos_clause'];

/** The whole flag record, for the three full-detail audiences. */
const FULL_FLAG_FIELDS = [
  ...TRADER_FLAG_FIELDS,
  'identity_id',
  'account_id',
  'severity',
  'detector',
  'detector_version',
  'evidence',
];

/**
 * The named fields of a record, and NOTHING ELSE.
 *
 * IT READS THE SOURCE AND FILTERS, rather than reading the field list and
 * indexing, so a field the allowlist names and the row does not carry is simply
 * absent instead of arriving as `undefined`. It takes `object` and not an index
 * signature so no call site needs a cast to reach it.
 */
function pick(source: object, fields: readonly string[]): EvidenceRow {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) if (fields.includes(key)) out[key] = value;
  return out;
}

/** Every key in `row` whose name the strip list claims, removed. Control 2. */
function stripNames(row: EvidenceRow, strip: ReadonlySet<string>): EvidenceRow {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (strip.has(key)) continue;
    const nested = asRecord(value);
    out[key] = nested === null ? value : stripNames(nested, strip);
  }
  return out;
}

/**
 * Build the document. THE ONE FUNCTION THAT DECIDES WHAT LEAVES THE BUILDING.
 *
 * The audience selects the projection; the registry supplies the strip list; and
 * nothing about either is read from the request beyond the audience the operator
 * declared, which is `SD-M6-04`'s whole reason for the column.
 */
export function buildEvidenceDocument(input: {
  readonly subject: EvidenceSubject;
  readonly registry: readonly DetectorRegistryRow[];
  readonly audience: EvidencePackAudience;
  readonly reason: string;
  readonly actor: AdminPrincipal;
}): EvidenceDocument {
  const { subject, registry, audience, reason, actor } = input;
  const profile = redactionProfileFor(audience);
  const detail = includesDetectorDetail(audience);
  const strip = sensitiveParameterNames(registry);

  const pack = {
    account_id: subject.account_id,
    audience,
    redaction_profile: profile,
    includes_detector_detail: detail,
    reason,
    requested_by: actor.actorId,
  } as const;

  // THE ACCOUNT'S OWN FACTS ARE CARRIED WHOLE AT EVERY AUDIENCE, and that is the
  // half `M06` calls the answer that holds up in public: the pack contains
  // everything about their account and every rule that was applied to it.
  const own = {
    account: subject.account,
    identity: subject.identity,
    fills: subject.fills,
    marks: subject.marks,
    rule_states: subject.rule_states,
    plan_version: subject.plan_version,
  };

  if (detail)
    return {
      pack,
      ...own,
      flags: subject.flags.map((flag) => pick(flag, FULL_FLAG_FIELDS)),
      detectors: registry.map((row) => ({
        detector: row.detector,
        version: row.version,
        parameters: row.parameters,
        is_sensitive: row.is_sensitive,
      })),
    };

  return {
    pack,
    ...own,
    flags: subject.flags.map((flag) => stripNames(pick(flag, TRADER_FLAG_FIELDS), strip)),
  };
}

// -----------------------------------------------------------------------------
// The refusal that runs last
// -----------------------------------------------------------------------------

/**
 * A uuid ANYWHERE INSIDE a string, and not a string that IS one.
 *
 * ANCHORING THIS WAS A REAL DEFECT AND THE SUITE FOUND IT. `tos_clause` is free
 * text an operator writes during a dispute, and `GS-112` REQUIRES a `trader`
 * pack to carry it. An investigator who wrote "coordinated with account
 * <uuid>" has put another identity into a trader pack through a field the pack
 * must not drop, and an anchored test sees nothing at all: the string is not a
 * uuid, it CONTAINS one. Every free-text column in a pack has this shape.
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Every uuid-shaped run anywhere in a value, collected. */
function uuidsIn(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(UUID)) into.add(match[0].toLowerCase());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) uuidsIn(item, into);
    return;
  }
  const record = asRecord(value);
  if (record === null) return;
  for (const item of Object.values(record)) uuidsIn(item, into);
}

/** Every object key anywhere in a value, collected. */
function keysIn(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) keysIn(item, into);
    return;
  }
  const record = asRecord(value);
  if (record === null) return;
  for (const [key, item] of Object.entries(record)) {
    into.add(key);
    keysIn(item, into);
  }
}

/**
 * THE IDENTITIES A TRADER PACK MAY NAME, which is one human and one account.
 *
 * Everything else uuid-shaped that reached the subject is FOREIGN: a counterparty
 * named in a flag's evidence bag, the other side of `D-01`'s clustering, the
 * sibling of `D-13`'s mirrored pair. `M06` section 4 says the trader pack carries
 * "no other identity", and this is that sentence made checkable, because the
 * foreign set is derived from the INPUT rather than declared.
 */
export function foreignIdentifiers(subject: EvidenceSubject): ReadonlySet<string> {
  const seen = new Set<string>();
  for (const flag of subject.flags) {
    uuidsIn(flag.identity_id, seen);
    if (flag.account_id !== null) uuidsIn(flag.account_id, seen);
    uuidsIn(flag.evidence, seen);
  }
  seen.delete(subject.account_id.toLowerCase());
  seen.delete(subject.identity_id.toLowerCase());
  return seen;
}

/**
 * Control 3. Re-derived over the FINISHED document and thrown rather than fixed.
 *
 * A REPAIR HERE WOULD BE THE WRONG SHAPE. If a name the registry claims survived
 * both the projection and the sweep, the document is not what the projection
 * thinks it is, and quietly deleting the key would ship a pack whose author
 * never learned that. `AS-M6-01` is permanent damage on a single occurrence.
 */
export function assertTraderPackIsClean(
  document: EvidenceDocument,
  registry: readonly DetectorRegistryRow[],
  foreign: ReadonlySet<string>,
): void {
  if (document.pack.audience !== 'trader') return;

  if (document.pack.includes_detector_detail)
    throw new EvidenceRedactionError(
      'a `trader` pack was composed with `includes_detector_detail` true, which is the one ' +
        'combination `evidence_packs_trader_gets_no_detector_detail` makes unrepresentable',
    );
  if (document.detectors !== undefined)
    throw new EvidenceRedactionError(
      'a `trader` pack carries a `detectors` section. The registry IS the parameter set ' +
        '(INV-M7-04), so a section naming it is the disclosure AS-M6-01 describes, whole',
    );

  const strip = sensitiveParameterNames(registry);
  const present = new Set<string>();
  keysIn(document.flags, present);
  const leaked = [...present].filter((key) => strip.has(key)).sort();
  if (leaked.length > 0)
    throw new EvidenceRedactionError(
      `a \`trader\` pack carries ${String(leaked.length)} detector parameter name(s): ` +
        `${leaked.join(', ')}. The strip list is computed from \`detector_definitions.is_sensitive\` ` +
        '(INV-M7-10) and a name it claims may not leave the building',
    );

  const uuids = new Set<string>();
  uuidsIn(document, uuids);
  const others = [...uuids].filter((id) => foreign.has(id)).sort();
  if (others.length > 0)
    throw new EvidenceRedactionError(
      `a \`trader\` pack names ${String(others.length)} identifier(s) belonging to another ` +
        'subject. M06 section 4: a trader pack carries no other identity',
    );
}

/**
 * Money is integer cents and a price is an exact rational, so NO NUMBER IN A
 * PACK IS FRACTIONAL.
 *
 * `0013_ingest.sql` carries a price as `price_numerator` over
 * `price_denominator` for the same reason the ledger carries cents: "a price
 * that rounds is a P&L that disagrees with the vendor's". A pack is the document
 * a dispute is argued from, so a float arriving through a `jsonb` column is
 * refused HERE, where it is still an export that failed rather than an exhibit.
 */
export function assertIntegerAmounts(value: unknown, path = '$'): void {
  if (typeof value === 'number') {
    if (!Number.isInteger(value))
      throw new EvidenceExportError(
        `${path} is ${String(value)}, which is not an integer. Money is integer cents and a ` +
          'price is an exact rational; a pack carrying a float is an exhibit that rounds',
      );
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertIntegerAmounts(item, `${path}[${String(index)}]`);
    });
    return;
  }
  const record = asRecord(value);
  if (record === null) return;
  for (const [key, item] of Object.entries(record)) assertIntegerAmounts(item, `${path}.${key}`);
}

// -----------------------------------------------------------------------------
// The bytes
// -----------------------------------------------------------------------------

/**
 * JSON with every object key sorted, recursively.
 *
 * `admin-writes.ts`'s reasoning, one table over: a digest over `JSON.stringify`
 * of an unsorted object is a digest over KEY ORDER. `content_sha256` is what
 * makes an exported pack the pack that was exported, and `admin-reads.ts` refuses
 * a response whose digest is not a SHA-256, so it may not turn on key order.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = asRecord(value);
  if (record === null) return JSON.stringify(value ?? null);
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/** The bytes a pack IS, and the digest over exactly those bytes. */
export function renderEvidencePack(document: EvidenceDocument): {
  readonly bytes: Uint8Array;
  readonly contentSha256Hex: string;
  readonly contentSha256Bytes: Uint8Array;
} {
  const bytes = new Uint8Array(Buffer.from(canonicalJson(document), 'utf8'));
  const digest = createHash('sha256').update(bytes).digest();
  return {
    bytes,
    contentSha256Hex: digest.toString('hex'),
    // `evidence_packs.content_sha256` is `bytea` and the response field is hex
    // (`admin-reads.ts`'s `SHA256_HEX`). BOTH ARE THE SAME DIGEST and this is
    // the one place that is true by construction rather than by convention.
    contentSha256Bytes: new Uint8Array(digest),
  };
}

// -----------------------------------------------------------------------------
// The ports
// -----------------------------------------------------------------------------

/** Where the subject's rows come from. */
export interface EvidenceReadPort {
  /** `null` when no such account exists, which the route answers 404. */
  readSubject(accountId: string): Promise<EvidenceSubject | null>;
  /** `detector_definitions`, as of this export. THE STRIP LIST'S SOURCE. */
  readDetectorRegistry(): Promise<readonly DetectorRegistryRow[]>;
}

/** Private object storage, signed URL only. `0008_risk.sql`: never a public path. */
export interface EvidencePackStore {
  put(input: {
    readonly accountId: string;
    readonly audience: EvidencePackAudience;
    readonly bytes: Uint8Array;
  }): Promise<{
    readonly storage_ref: string;
    readonly download_url: string;
    readonly expires_at: string;
  }>;
}

/** The `evidence_packs` row, with all three `SD-M6-04` columns. */
export interface EvidencePackRow {
  readonly account_id: string;
  readonly requested_by: string;
  readonly reason: string;
  readonly content_sha256: Uint8Array;
  readonly storage_ref: string;
  readonly audience: EvidencePackAudience;
  readonly redaction_profile: EvidenceRedactionProfile;
  readonly includes_detector_detail: boolean;
}

/** Whoever holds the operator door writes the row and returns what it got. */
export interface EvidencePackWriter {
  writePack(row: EvidencePackRow): Promise<{
    readonly evidence_pack_id: string;
    readonly generated_at: string;
  }>;
}

/** What the composition hands the exporter. */
export interface EvidenceExporterDeps {
  readonly reads: EvidenceReadPort;
  readonly store: EvidencePackStore;
  readonly writer: EvidencePackWriter;
}

// -----------------------------------------------------------------------------
// The generator
// -----------------------------------------------------------------------------

/**
 * `AdminReadSource.exportEvidence`.
 *
 * THE ORDER OF THE LAST THREE STEPS IS LOAD BEARING. The document is refused
 * BEFORE it is rendered, rendered before it is stored, and stored before the row
 * is written, because `storage_ref` and `content_sha256` are both `NOT NULL` and
 * a row written first would have to name bytes that do not exist yet. The failure
 * this ordering leaves is an object in storage with no row, which is a pack
 * nobody can reach; the failure the other ordering leaves is a row pointing at
 * nothing, which is a pack somebody cites.
 */
export function createEvidenceExporter(deps: EvidenceExporterDeps): {
  exportEvidence(request: EvidenceExportRequest): Promise<EvidencePackResponse | null>;
} {
  return {
    async exportEvidence(request: EvidenceExportRequest): Promise<EvidencePackResponse | null> {
      const subject = await deps.reads.readSubject(request.accountId);
      if (subject === null) return null;
      if (subject.account_id !== request.accountId)
        throw new EvidenceExportError(
          `the read port returned account \`${subject.account_id}\` for a request naming ` +
            `\`${request.accountId}\`. A pack built about the wrong account is the disclosure ` +
            'AS-M6-01 describes with the subject also wrong',
        );

      const registry = await deps.reads.readDetectorRegistry();
      if (registry.length === 0)
        throw new EvidenceExportError(
          'the detector registry is empty, so the strip list computed from ' +
            '`detector_definitions.is_sensitive` is empty and a `trader` pack would strip ' +
            'nothing. INV-M7-10 is a query over that table and an empty answer is a broken ' +
            'read rather than a registry with no sensitive parameters',
        );

      const document = buildEvidenceDocument({
        subject,
        registry,
        audience: request.audience,
        reason: request.reason,
        actor: request.actor,
      });

      assertTraderPackIsClean(document, registry, foreignIdentifiers(subject));
      assertIntegerAmounts(document);

      const rendered = renderEvidencePack(document);
      const stored = await deps.store.put({
        accountId: subject.account_id,
        audience: request.audience,
        bytes: rendered.bytes,
      });

      const written = await deps.writer.writePack({
        account_id: subject.account_id,
        requested_by: request.actor.actorId,
        reason: request.reason,
        content_sha256: rendered.contentSha256Bytes,
        storage_ref: stored.storage_ref,
        audience: request.audience,
        redaction_profile: document.pack.redaction_profile,
        includes_detector_detail: document.pack.includes_detector_detail,
      });

      return {
        evidence_pack_id: written.evidence_pack_id,
        download_url: stored.download_url,
        content_sha256: rendered.contentSha256Hex,
        expires_at: stored.expires_at,
        generated_at: written.generated_at,
        // ECHOED FROM THE REQUEST AND NOT FROM THE ROW, and `projectEvidencePack`
        // compares the two: a pack built for one audience against a request for
        // another is refused rather than relabelled (ADR-166 clause 2).
        audience: request.audience,
      };
    },
  };
}

// =============================================================================
// THE ADAPTER, AND WHY IT IS A THIRD OF `exportEvidence` RATHER THAN ALL OF IT
// =============================================================================
// Everything above this line is a GENERATOR over three injected ports. What
// follows is the one of those three this directory may hold: {@link
// EvidenceReadPort}, over ADR-112's keyed accessor, in `flags.ts`'s, `graph.ts`'s,
// `events.ts`'s and `account.ts`'s module shape unaltered -- a closed tuple of
// tables, a `Tx` keyed by it that `SystemTx` satisfies structurally, a cost
// object beside the answer, and no `@merit/db` import under this directory.
//
// -----------------------------------------------------------------------------
// THE OTHER TWO PORTS ARE NOT BLOCKED ON A TABLE AND NEITHER IS THIS DIRECTORY'S
// -----------------------------------------------------------------------------
// Every table this adapter names is already a `TableKey` and none needed
// registering, which is the first thing checked and is the opposite of what
// sessions 349 and 353 found for `events`. So `exportEvidence` STILL does not
// join `IMPLEMENTED_ADMIN_READS`, and the reason is not a read:
//
//   `EvidencePackStore` IS OBJECT STORAGE AND NOTHING IN THIS TREE IS. It hands
//   back a `storage_ref`, a signed `download_url` and an `expires_at`;
//   `evidence_packs.storage_ref` is `text NOT NULL` carrying "Private object
//   storage, signed URL only. Never a public path" in the DDL's own comment
//   (`packages/db/src/schema.ts`, `0008_risk.sql`). A grep across `apps/` and
//   `packages/` for a store finds this interface and its suite's fixture and
//   NOTHING ELSE. No table registration reaches it, because it is not a table.
//
//   `EvidencePackWriter` IS AN INSERT, AND ITS HOME ALREADY EXISTS ONE DIRECTORY
//   OVER. `routes/admin-writes.ts` names `evidencePacks` in `ADMIN_WRITE_TABLES`
//   and `AdminWriteTx` carries `insert`. **This directory's stated property is
//   that it holds a handle it CANNOT WRITE THROUGH** (`FlagsTx`'s docblock:
//   `insert`, `updateAt`, `deleteAt` and `sqlExecutor` are "ABSENT rather than
//   unused"), and `admin-source/index.ts` says `AdminSourceTx` is read-only
//   "because every arm of the intersection is read-only". Minting a write arm
//   here to serve one method would trade that property, directory-wide, for a
//   row a file that already may write it can write. **So the writer is reported
//   as the write side's and this adapter does not reach for it.**
//
// **THAT IS WHY `composeImplementedAdminReads` IS NOT TOUCHED AND
// `IMPLEMENTED_ADMIN_READS` DOES NOT MOVE.** That function takes ONE parameter,
// an `AdminSourceBackend`, and no door onto this database can produce a signed
// URL. A key added there would have to invent a store, and a `download_url`
// invented in this file is a pack an operator cites and nobody can open.
//
// -----------------------------------------------------------------------------
// THE ADAPTER'S PROJECTION IS THE TRADER PACK'S ALLOWLIST FOR SIX OF ITS EIGHT
// SECTIONS, WHICH IS THE REASON IT IS A COLUMN MAP AND NOT A SPREAD
// -----------------------------------------------------------------------------
// `buildEvidenceDocument` filters `flags` through `TRADER_FLAG_FIELDS` and
// carries `account`, `identity`, `fills`, `marks`, `rule_states` and
// `plan_version` THROUGH WHOLE, at every audience. So whatever this adapter puts
// in those six is what reaches a trader, and a column added to `accounts` next
// year would reach one the day it landed if this file read rows with a spread.
// {@link EVIDENCE_COLUMNS} names every column instead, and the suite asserts
// each map against `packages/db/src/schema.ts`'s own declaration IN BOTH
// DIRECTIONS -- a column the map has and the table does not is a typo, and a
// column the table has and the map does not is a decision somebody has to make
// rather than a default. **A new column is a red suite, not a disclosure.**
//
// -----------------------------------------------------------------------------
// THREE VALUES THE ACCESSOR RETURNS THAT `canonicalJson` CANNOT RENDER, AND ONLY
// ONE OF THEM FAILS LOUDLY
// -----------------------------------------------------------------------------
// The pack IS `canonicalJson(document)` and `content_sha256` is the digest over
// exactly those bytes, so a value that renders wrongly is an exhibit that is
// wrong AND self-consistent about it. `pg` and Drizzle return three shapes that
// do:
//
//   1. `bigint`. Every surrogate key and every cents column on these tables is
//      `bigint`, and `JSON.stringify` THROWS on one. That is the loud failure.
//   2. `Date`. `timestamptz` arrives as one, and `canonicalJson` reaches it
//      through `asRecord`, which accepts any non-array object; `Object.keys(new
//      Date())` is EMPTY, so every instant in the pack would render as `{}`.
//      **Silently. Under a digest that makes it official.**
//   3. `Uint8Array`. `bytea` arrives as one, and it renders as an object keyed
//      by byte index: `{"0":31,"1":139,...}`.
//
// So the kinds below are not decoration. Each names what the column IS, and the
// reader for it is the conversion that makes the bytes right: an instant becomes
// an ISO string, a digest becomes lowercase hex on `renderEvidencePack`'s own
// precedent, and a `bigint` becomes either a decimal STRING or a NUMBER
// depending on which of the two things it is.
//
// **AN IDENTIFIER IS TEXT AND A QUANTITY IS A NUMBER, AND THE SPLIT IS
// `events.ts`'s RULING REUSED RATHER THAN A PREFERENCE.** API_CONTRACT section 8
// carries `events.id` as a string because "a JSON number loses that ordering
// past 2^53", and `fills.id`, `daily_marks.id` and `rule_states.id` are the same
// `bigint GENERATED ALWAYS AS IDENTITY` column: `'bigid'` carries them as
// digits. Money is the other direction and `assertIntegerAmounts` is why: it
// walks the finished document and refuses a fractional NUMBER, and a cents
// column carried as a string would walk straight past that control. `'int'`
// therefore carries cents as a number AND REFUSES ANYTHING OUTSIDE THE SAFE
// INTEGER RANGE, so the precision this file will not lose silently is the
// precision it fails on.
//
// -----------------------------------------------------------------------------
// "THE PLAN'S RULE TEXT" IS `copy_blocks` AND THERE IS NO `rule_text` COLUMN
// -----------------------------------------------------------------------------
// `GS-112` requires the pack to carry it and `plan_versions` has no such column.
// `0028_supersede_plan_version_immutability.sql` names the one that holds it, in
// its own words: "`copy_blocks` (the published rule TEXT)". `INV-M4-08` says the
// same thing from the reading end: "Every rule sentence on any screen comes from
// `copy_blocks` on the account's pinned plan version". So the map carries
// `copy_blocks` whole and INVENTS NO `rule_text` KEY. The existing suite's
// `plan_version` fixture uses one; that is a fixture's shape, and this adapter
// answers to the schema.
//
// -----------------------------------------------------------------------------
// THE ToS CLAUSE IS TWO KEYED READS AND A REFUSAL, NEVER A MAP
// -----------------------------------------------------------------------------
// {@link EvidenceFlagRecord}'s docblock and STATE's finding B: `risk_flags`
// carries no clause column, a clause lives on the ENFORCEMENT that cites the
// flag -- `payout_requests.hold_tos_clause` under
// `payout_requests_hold_is_complete`, and `identity_restriction_episodes.
// tos_clause` under ADR-041 -- and `DEP-M7-05` still owes two of the three
// texts. Both are reachable by equality, so both are read and neither is
// guessed.
//
// **WHERE THE TWO ENFORCEMENTS CITE ONE FLAG UNDER DIFFERENT CLAUSES, THIS
// REFUSES.** `EvidenceFlagRecord.tos_clause` is ONE string, a pack is the
// document a dispute is argued from, and an exhibit that states one clause while
// the firm's own record holds two is the pack citing a rule the firm did not
// cite. It is `EvidenceExportError` and not `AdminReadError` because it is this
// file's own sentence: "the generator was asked for something it must not guess
// about". **A ruling that makes the field a list would retire this refusal, and
// it is reported as owed rather than pre-empted here.**
//
// -----------------------------------------------------------------------------
// WHAT THIS ADAPTER DOES NOT DO
// -----------------------------------------------------------------------------
// IT WITHHOLDS NOTHING AND IT MUST NOT START. ADR-184 ruling 3 puts the
// withholding "on the RESPONSE and not in the renderer", `account.ts` and
// `events.ts` both say so about their own rows, and session 359 landed the
// account drill-down's projection where that ruling puts it. **This adapter's
// audience-facing redaction is `buildEvidenceDocument`'s, which is a DIFFERENT
// rule from `INV-M6-10`'s scope withholding and runs at a different layer**;
// adding a second gate here would be a third place either rule could be slightly
// different.
//
// IT DOES NOT BOUND WHAT IT READS. "Every fill, every mark, every rule state" is
// `GS-112`'s ask and `account.ts` already priced the same shape: the port hands
// back a subject and not an `AdminPage`, so there is nowhere to put a cursor.
// {@link EvidenceSubjectCost} reports what one read cost rather than leaving it
// to be discovered, and a cap the corpus does not state is a ruling rather than
// a default.
// =============================================================================

// -----------------------------------------------------------------------------
// The port onto the database
// -----------------------------------------------------------------------------

/**
 * The tables this module reads, and no others.
 *
 * ELEVEN, AND EVERY ONE OF THEM WAS ALREADY A `TableKey`. `routes/admin-writes.ts`'s
 * `ADMIN_WRITE_TABLES` idiom, for its reason: a typo is a compile error here, and
 * the suite asserts every member is a real key of `packages/db`, which is the
 * half this module cannot make about itself because it holds no import of that
 * package.
 *
 * THE LAST THREE SERVE ONE FIELD EACH AND NONE OF THEIR ROWS ENTERS A PACK.
 * `detectorRuns` supplies a flag's `detector` and `detector_version` (which
 * `risk_flags` does not carry), and `payoutRequests` and
 * `identityRestrictionEpisodes` supply its `tos_clause`. Only those three
 * strings cross; the rows are read and dropped, which is what keeps a payout's
 * `eligibility_snapshot` and a restoration's evidence out of a document nobody
 * asked to put them in.
 */
export const EVIDENCE_READ_TABLES = [
  'accounts',
  'dailyMarks',
  'detectorDefinitions',
  'detectorRuns',
  'fills',
  'identities',
  'identityRestrictionEpisodes',
  'payoutRequests',
  'planVersions',
  'riskFlags',
  'ruleStates',
] as const;

/** One of {@link EVIDENCE_READ_TABLES}. */
export type EvidenceReadTable = (typeof EVIDENCE_READ_TABLES)[number];

/** A filter or an address, by Drizzle property name. ADR-112's shape. */
export type EvidenceRowFilter = Readonly<Record<string, unknown>>;

/**
 * ADR-112's keyed accessor, READ HALF ONLY, over this module's eleven tables.
 *
 * `FlagsTx`'s shape and `FlagsTx`'s reason. `insert`, `updateAt`, `deleteAt` and
 * `sqlExecutor` are ABSENT rather than unused, and `SystemTx` satisfies this
 * structurally. **On this module that absence is the whole of the section above
 * this one**: `evidence_packs` is the row `exportEvidence` writes, and a handle
 * shaped like this cannot write it, which is why the writer is a port the
 * deployment supplies rather than a function beside this one.
 */
export interface EvidenceTx {
  rows(key: EvidenceReadTable): Promise<unknown[]>;
  rowsWhere(key: EvidenceReadTable, where: EvidenceRowFilter): Promise<unknown[]>;
  rowAt(key: EvidenceReadTable, at: EvidenceRowFilter): Promise<unknown>;
}

// -----------------------------------------------------------------------------
// The columns, and what each one IS
// -----------------------------------------------------------------------------

/**
 * How a column is carried into a pack. See the header for why `bigid` and `int`
 * are two kinds over one Postgres type.
 */
export type EvidenceColumnKind =
  | 'text'
  | 'text?'
  | 'bigid'
  | 'bigid?'
  | 'int'
  | 'int?'
  | 'bool'
  | 'day'
  | 'day?'
  | 'instant'
  | 'instant?'
  | 'json'
  | 'digest';

/**
 * One table's columns: Drizzle property name to `[column name, kind]`.
 *
 * BOTH NAMES ARE CARRIED because both are asserted. The property name is what
 * the accessor hands back and the column name is what the pack carries, and the
 * suite reads `schema.ts` for both rather than trusting either.
 */
export type EvidenceColumnMap = Readonly<Record<string, readonly [string, EvidenceColumnKind]>>;

/**
 * Every column of the six tables whose rows reach a pack WHOLE.
 *
 * SIX MAPS AND NOT ELEVEN. `riskFlags` is projected into
 * {@link EvidenceFlagRecord} field by field and `detectorDefinitions` into
 * {@link DetectorRegistryRow}; the other three contribute one string each and no
 * row. See the header: these six ARE the trader allowlist for the sections
 * `buildEvidenceDocument` carries through.
 */
export const EVIDENCE_COLUMNS: Readonly<Record<string, EvidenceColumnMap>> = {
  accounts: {
    id: ['id', 'text'],
    identityId: ['identity_id', 'text'],
    userId: ['user_id', 'text'],
    purchaseId: ['purchase_id', 'text'],
    planVersionId: ['plan_version_id', 'text'],
    sizeCents: ['size_cents', 'int'],
    phase: ['phase', 'text'],
    status: ['status', 'text'],
    platform: ['platform', 'text'],
    platformAccountRef: ['platform_account_ref', 'text?'],
    feed: ['feed', 'text?'],
    frontEndPermissions: ['front_end_permissions', 'json'],
    openedOn: ['opened_on', 'day'],
    fundedOn: ['funded_on', 'day?'],
    closedOn: ['closed_on', 'day?'],
    closeReason: ['close_reason', 'text?'],
    payoutsFrozen: ['payouts_frozen', 'bool'],
    reconBlocked: ['recon_blocked', 'bool'],
    expiresOn: ['expires_on', 'day?'],
    graduatedAt: ['graduated_at', 'instant?'],
    graduationPath: ['graduation_path', 'text?'],
    terminalSettlementId: ['terminal_settlement_id', 'text?'],
    graduationEligible: ['graduation_eligible', 'bool'],
    createdAt: ['created_at', 'instant'],
    updatedAt: ['updated_at', 'instant'],
  },
  identities: {
    id: ['id', 'text'],
    displayName: ['display_name', 'text?'],
    leaderboardOptIn: ['leaderboard_opt_in', 'bool'],
    status: ['status', 'text'],
    statusReason: ['status_reason', 'text?'],
    maxAccountsOverride: ['max_accounts_override', 'int?'],
    payoutsFrozen: ['payouts_frozen', 'bool'],
    frozenReason: ['frozen_reason', 'text?'],
    frozenAt: ['frozen_at', 'instant?'],
    supportContactRef: ['support_contact_ref', 'text?'],
    firstSeenAt: ['first_seen_at', 'instant'],
    createdAt: ['created_at', 'instant'],
    updatedAt: ['updated_at', 'instant'],
  },
  fills: {
    id: ['id', 'bigid'],
    accountId: ['account_id', 'text'],
    platform: ['platform', 'text'],
    platformFillId: ['platform_fill_id', 'text'],
    orderId: ['order_id', 'text?'],
    venue: ['venue', 'text?'],
    symbol: ['symbol', 'text'],
    side: ['side', 'text'],
    quantity: ['quantity', 'int'],
    // AN EXACT RATIONAL AND NEVER A QUOTIENT. `0013_ingest.sql`: "a price that
    // rounds is a P&L that disagrees with the vendor's". Both legs cross whole.
    priceNumerator: ['price_numerator', 'int'],
    priceDenominator: ['price_denominator', 'int'],
    executedAt: ['executed_at', 'instant'],
    tradingDay: ['trading_day', 'day'],
    correctionOf: ['correction_of', 'bigid?'],
    isCorrected: ['is_corrected', 'bool'],
    ingestFileId: ['ingest_file_id', 'text'],
    rawRowId: ['raw_row_id', 'bigid'],
    recordedAt: ['recorded_at', 'instant'],
    tradingDayVendor: ['trading_day_vendor', 'day?'],
    tradingDaySource: ['trading_day_source', 'text'],
    createdAt: ['created_at', 'instant'],
  },
  dailyMarks: {
    id: ['id', 'bigid'],
    accountId: ['account_id', 'text'],
    tradingDay: ['trading_day', 'day'],
    openingBalanceCents: ['opening_balance_cents', 'int'],
    closingBalanceCents: ['closing_balance_cents', 'int'],
    highBalanceCents: ['high_balance_cents', 'int'],
    lowBalanceCents: ['low_balance_cents', 'int'],
    realizedPnlCents: ['realized_pnl_cents', 'int'],
    fillCount: ['fill_count', 'int'],
    tradedDay: ['traded_day', 'bool'],
    winDay: ['win_day', 'bool'],
    adjustmentCents: ['adjustment_cents', 'int'],
    sourceHash: ['source_hash', 'digest'],
    source: ['source', 'text'],
    ingestFileId: ['ingest_file_id', 'text?'],
    supersededBy: ['superseded_by', 'bigid?'],
    computedAt: ['computed_at', 'instant'],
    createdAt: ['created_at', 'instant'],
  },
  ruleStates: {
    id: ['id', 'bigid'],
    accountId: ['account_id', 'text'],
    tradingDay: ['trading_day', 'day'],
    phase: ['phase', 'text'],
    floorCents: ['floor_cents', 'int'],
    floorLocked: ['floor_locked', 'bool'],
    floorOpenCents: ['floor_open_cents', 'int'],
    highWaterBalanceCents: ['high_water_balance_cents', 'int'],
    balanceCents: ['balance_cents', 'int'],
    withdrawableCents: ['withdrawable_cents', 'int'],
    tradedDaysCount: ['traded_days_count', 'int'],
    winDaysCount: ['win_days_count', 'int'],
    consistencyBestDayCents: ['consistency_best_day_cents', 'int'],
    consistencyPeriodProfitCents: ['consistency_period_profit_cents', 'int'],
    consistencyPeriodStartDay: ['consistency_period_start_day', 'day?'],
    payoutsSettledCount: ['payouts_settled_count', 'int'],
    payoutAnchorDay: ['payout_anchor_day', 'day?'],
    cadenceAnchorDay: ['cadence_anchor_day', 'day?'],
    engineEligible: ['engine_eligible', 'bool'],
    // THE GATE RESULT, AND IT IS TWO COLUMNS. `SD-06` split it and there is no
    // `gate_results` table; see {@link EvidenceSubject}.
    engineGates: ['engine_gates', 'json'],
    contextGates: ['context_gates', 'json'],
    stateHash: ['state_hash', 'digest'],
    engineVersion: ['engine_version', 'text'],
    computedAt: ['computed_at', 'instant'],
    createdAt: ['created_at', 'instant'],
    calendarRevisionId: ['calendar_revision_id', 'bigid?'],
  },
  planVersions: {
    id: ['id', 'text'],
    planId: ['plan_id', 'text'],
    version: ['version', 'int'],
    status: ['status', 'text'],
    rules: ['rules', 'json'],
    // `GS-112`'s "the plan's rule text". See the header: there is no
    // `rule_text` column and this is the one that holds it.
    copyBlocks: ['copy_blocks', 'json'],
    publicSlug: ['public_slug', 'text'],
    publicVisible: ['public_visible', 'bool'],
    publishedAt: ['published_at', 'instant?'],
    retiredAt: ['retired_at', 'instant?'],
    createdBy: ['created_by', 'text'],
    createdAt: ['created_at', 'instant'],
    feeBackRepeats: ['fee_back_repeats', 'bool'],
    decidedOnSimulationRunId: ['decided_on_simulation_run_id', 'text?'],
    simulationWaiverReason: ['simulation_waiver_reason', 'text?'],
  },
};

// -----------------------------------------------------------------------------
// The readers, one per kind, all defensive
// -----------------------------------------------------------------------------

function cellOf(row: unknown, property: string, at: string): unknown {
  if (typeof row !== 'object' || row === null)
    throw new AdminReadError(
      `the accessor returned a ${typeof row} where ${at} was expected. An evidence pack built ` +
        'out of that is the document a dispute is argued from, describing something else',
    );
  return (row as Record<string, unknown>)[property];
}

function nonEmptyText(value: unknown, column: string, at: string): string {
  if (typeof value !== 'string' || value === '')
    throw new AdminReadError(
      `${at} carries no \`${column}\`, and the column is \`NOT NULL\` in the schema. That is the ` +
        'transcription disagreeing with the database rather than a row to export',
    );
  return value;
}

/**
 * A `bigint` surrogate key as digits.
 *
 * See the header: `events.ts` carries `events.id` as a string on API_CONTRACT
 * section 8's reason, and `fills.id`, `daily_marks.id` and `rule_states.id` are
 * the same column type. A `number` accepted here would be a row somebody built
 * by hand, so it is converted and re-checked rather than trusted.
 */
function bigId(value: unknown, column: string, at: string): string {
  const digits =
    typeof value === 'bigint' || typeof value === 'number' ? String(value) : (value as unknown);
  if (typeof digits !== 'string' || !/^\d+$/.test(digits))
    throw new AdminReadError(
      `${at} carries \`${column}\` as ${JSON.stringify(String(value))}, which is not the ` +
        '`bigint GENERATED ALWAYS AS IDENTITY` the schema declares. An identifier is carried as ' +
        'text because a JSON number loses the ordering past 2^53',
    );
  return digits;
}

/**
 * An exact integer as a JSON number.
 *
 * THE SAFE-INTEGER REFUSAL IS THE POINT. `assertIntegerAmounts` walks the
 * finished document and refuses a fractional number, and it cannot see a
 * `bigint` that lost its last digits on the way in. Money is integer cents, so
 * the precision this file will not lose silently is the precision it fails on.
 */
function exactInteger(value: unknown, column: string, at: string): number {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER))
      throw new AdminReadError(
        `${at} carries \`${column}\` as ${String(value)}, which is outside the range a JSON ` +
          'number holds exactly. Money is integer cents and a pack is an exhibit, so this is a ' +
          'refusal rather than a rounding',
      );
    return Number(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  throw new AdminReadError(
    `${at} carries \`${column}\` as ${JSON.stringify(String(value))}, which is not an exact ` +
      'integer. Money is integer cents and a price is an exact rational; a pack carrying ' +
      'anything else is an exhibit that rounds',
  );
}

/** A `date` column, as the `YYYY-MM-DD` text the trading day IS. */
function tradingDayText(value: unknown, column: string, at: string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  throw new AdminReadError(
    `${at} carries \`${column}\` as ${JSON.stringify(String(value))}, which is not a trading ` +
      'day. The trading day follows the exchange session calendar and is stored as a `date`, so ' +
      'a value derived from an instant here would be off by one for the hours CT and UTC disagree',
  );
}

/**
 * A `timestamptz` as an ISO instant.
 *
 * NOT AS THE `Date` THE ACCESSOR HANDS BACK. See the header: `canonicalJson`
 * reaches a `Date` through `asRecord`, finds no own keys, and renders every
 * instant in the pack as `{}` under a digest that makes it official.
 */
function isoInstant(value: unknown, column: string, at: string): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value;
  throw new AdminReadError(
    `${at} carries \`${column}\` as ${JSON.stringify(String(value))}, which is not an instant. ` +
      'Storage is UTC and a pack carries the instant, not a rendering of it',
  );
}

/**
 * A `bytea` as lowercase hex.
 *
 * `renderEvidencePack`'s own choice one field over: `evidence_packs.content_sha256`
 * is `bytea` and the response field is hex, and both are the same digest. A
 * `Uint8Array` left alone renders as an object keyed by byte index.
 */
function hexDigest(value: unknown, column: string, at: string): string {
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (typeof value === 'string' && /^[0-9a-f]*$/i.test(value)) return value.toLowerCase();
  throw new AdminReadError(
    `${at} carries \`${column}\` as ${JSON.stringify(String(value))}, which is not the \`bytea\` ` +
      'the schema declares. A digest is what makes a superseded row provable, so it is carried ' +
      'as hex rather than as whatever an accessor happened to return',
  );
}

/**
 * A record whose prototype is `Object`'s, WHICH IS NOT WHAT {@link asRecord}
 * ANSWERS.
 *
 * **THIS FUNCTION EXISTS BECAUSE THE FIRST VERSION OF {@link jsonSafe} REUSED
 * `asRecord` AND THE SUITE CAUGHT IT.** `asRecord` accepts any non-array object,
 * which is the exact blind spot that renders a `Date` as `{}` -- a guard against
 * that spelled in terms of the predicate that has it is not a guard. `asRecord`
 * is correct where it is used, over documents this file composed itself; here
 * the input is whatever the accessor handed back.
 */
function plainRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  return value as Readonly<Record<string, unknown>>;
}

/**
 * A `jsonb` value, checked for what `canonicalJson` can actually render.
 *
 * `pg` parses JSON into plain values, so this should never fire. It is here
 * because when it does not fire the alternative is `canonicalJson` throwing
 * three layers away from the row, or worse, rendering `{}` and hashing it.
 */
function jsonSafe(value: unknown, column: string, at: string, path: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new AdminReadError(
        `${at} carries ${path} inside \`${column}\` as ${String(value)}, which JSON has no ` +
          'representation for',
      );
    return value;
  }
  if (Array.isArray(value))
    return value.map((item, index) => jsonSafe(item, column, at, `${path}[${String(index)}]`));
  const record = plainRecord(value);
  if (record === null)
    throw new AdminReadError(
      `${at} carries ${path} inside \`${column}\` as a ${typeof value}, which \`canonicalJson\` ` +
        'cannot render. The pack IS those bytes and `content_sha256` is the digest over exactly ' +
        'them, so a value that renders wrongly is an exhibit that is wrong and self-consistent',
    );
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record))
    out[key] = jsonSafe(item, column, at, `${path}.${key}`);
  return out;
}

/** One row, as its map names it and in the map's own order. */
function projectRow(row: unknown, columns: EvidenceColumnMap, at: string): EvidenceRow {
  const out: Record<string, unknown> = {};
  for (const [property, spec] of Object.entries(columns)) {
    const [column, kind] = spec;
    const value = cellOf(row, property, at);
    const optional = kind.endsWith('?');
    if (optional && (value === null || value === undefined)) {
      out[column] = null;
      continue;
    }
    switch (kind) {
      case 'text':
      case 'text?':
        out[column] = nonEmptyText(value, column, at);
        break;
      case 'bigid':
      case 'bigid?':
        out[column] = bigId(value, column, at);
        break;
      case 'int':
      case 'int?':
        out[column] = exactInteger(value, column, at);
        break;
      case 'bool':
        if (typeof value !== 'boolean')
          throw new AdminReadError(
            `${at} carries \`${column}\` as ${JSON.stringify(String(value))} and the column is ` +
              '`boolean NOT NULL`. A gate rendered from a value that is neither is a gate an ' +
              'exhibit states wrongly',
          );
        out[column] = value;
        break;
      case 'day':
      case 'day?':
        out[column] = tradingDayText(value, column, at);
        break;
      case 'instant':
      case 'instant?':
        out[column] = isoInstant(value, column, at);
        break;
      case 'json':
        out[column] = jsonSafe(value, column, at, '$');
        break;
      case 'digest':
        out[column] = hexDigest(value, column, at);
        break;
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// The ordering
// -----------------------------------------------------------------------------

/**
 * Oldest first, ties broken on the row's own surrogate key.
 *
 * `account.ts`'s `chronologically` and its reason: the drill-down and the pack
 * are both read FORWARDS, because a dispute about a specific day is worked from
 * before it to after it. The tie-break is a `bigid`, so it is compared as a
 * number: `"10"` sorts before `"9"` as text.
 */
function oldestFirst(
  rows: readonly EvidenceRow[],
  instantColumn: string,
  idColumn: string,
): readonly EvidenceRow[] {
  return [...rows].sort((left, right) => {
    const a = String(left[instantColumn] ?? '');
    const b = String(right[instantColumn] ?? '');
    if (a !== b) return a < b ? -1 : 1;
    const leftId = String(left[idColumn] ?? '0');
    const rightId = String(right[idColumn] ?? '0');
    if (leftId === rightId) return 0;
    return BigInt(leftId) < BigInt(rightId) ? -1 : 1;
  });
}

// -----------------------------------------------------------------------------
// The read
// -----------------------------------------------------------------------------

/**
 * What one subject read cost.
 *
 * `flags.ts`'s, `graph.ts`'s, `events.ts`'s and `account.ts`'s choice: the port's
 * signature is the contract's and has nowhere to carry it, and a measurement the
 * suite asserts on is worth more than one only a log carries.
 *
 * `identityFlags` AND `flags` ARE BOTH REPORTED because the difference is what
 * the account narrowing removed, and `clauseSources` is what the two enforcement
 * reads found -- both are the prices of rulings this module inherits rather than
 * makes, so both are visible.
 */
export interface EvidenceSubjectCost {
  readonly fills: number;
  readonly marks: number;
  readonly ruleStates: number;
  readonly identityFlags: number;
  readonly flags: number;
  readonly payoutRequests: number;
  readonly restrictionEpisodes: number;
  readonly clauseSources: number;
  readonly detectorRuns: number;
}

/** {@link readEvidenceSubject}'s subject, plus what it cost. */
export interface EvidenceSubjectResult {
  readonly subject: EvidenceSubject;
  readonly cost: EvidenceSubjectCost;
}

/**
 * Every ToS clause each flag is cited under, by flag id.
 *
 * TWO KEYED READS AND NO MAP FROM `flag_type`. See the header. The payout leg is
 * account-scoped because a hold is a decision about one account's payout; the
 * restriction leg is identity-scoped because ADR-041's episode is about the
 * person. Neither read's ROWS enter the pack.
 */
function clausesByFlag(
  payouts: readonly unknown[],
  episodes: readonly unknown[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const clauses = new Map<string, Set<string>>();
  const add = (flagId: string, clause: string): void => {
    const existing = clauses.get(flagId);
    if (existing === undefined) clauses.set(flagId, new Set([clause]));
    else existing.add(clause);
  };

  for (const row of payouts) {
    const at = 'a payout_requests row';
    const flagId = cellOf(row, 'holdFlagId', at);
    const clause = cellOf(row, 'holdTosClause', at);
    // BOTH OR NEITHER, WHICH IS `payout_requests_hold_is_complete` ITSELF: a
    // hold carries a cited flag AND a clause AND a reason, and a row that is
    // not held carries none of them.
    if (flagId === null || flagId === undefined) continue;
    add(nonEmptyText(flagId, 'hold_flag_id', at), nonEmptyText(clause, 'hold_tos_clause', at));
  }

  for (const row of episodes) {
    const at = 'an identity_restriction_episodes row';
    // BOTH `NOT NULL` on this table (0031), so a missing one is a refusal
    // rather than a skip.
    add(
      nonEmptyText(cellOf(row, 'flagId', at), 'flag_id', at),
      nonEmptyText(cellOf(row, 'tosClause', at), 'tos_clause', at),
    );
  }

  return clauses;
}

/** The one clause a flag is cited under, or `null`, and never a guess. */
function clauseFor(
  flagId: string,
  clauses: ReadonlyMap<string, ReadonlySet<string>>,
): string | null {
  const found = [...(clauses.get(flagId) ?? [])].sort();
  if (found.length === 0) return null;
  if (found.length === 1) return found[0] ?? null;
  throw new EvidenceExportError(
    `flag \`${flagId}\` is cited under ${String(found.length)} different ToS clauses by the ` +
      'enforcements that reference it, and `EvidenceFlagRecord.tos_clause` is one string. A pack ' +
      'stating one of them would cite a rule the firm did not cite for the other enforcement, ' +
      'and GS-112 requires the clause rather than a choice between clauses',
  );
}

/**
 * `detector_definitions`, whole. THE STRIP LIST'S SOURCE.
 *
 * `rows` AND NOT A FILTER. `INV-M7-10`'s list is the UNION over every
 * `is_sensitive` row, so a read narrowed to the detectors that flagged THIS
 * account would compute a strip list missing every name only another detector
 * claims -- and `sensitiveParameterNames` says why that matters: `severity` and
 * `window_trading_days` belong to several detectors at once.
 */
export async function readEvidenceDetectorRegistry(
  tx: EvidenceTx,
): Promise<readonly DetectorRegistryRow[]> {
  return (await tx.rows('detectorDefinitions')).map((row) => {
    const at = 'a detector_definitions row';
    const isSensitive = cellOf(row, 'isSensitive', at);
    if (typeof isSensitive !== 'boolean')
      throw new AdminReadError(
        `${at} carries \`is_sensitive\` as ${JSON.stringify(String(isSensitive))} and the column ` +
          'is `boolean NOT NULL DEFAULT true`. INV-M7-10 computes the strip list from exactly ' +
          'that column, so a row it cannot read is a name that would not be stripped',
      );
    return {
      detector: nonEmptyText(cellOf(row, 'detector', at), 'detector', at),
      version: nonEmptyText(cellOf(row, 'version', at), 'version', at),
      parameters: jsonSafe(cellOf(row, 'parameters', at), 'parameters', at, '$'),
      is_sensitive: isSensitive,
    };
  });
}

/**
 * Everything one pack is built from, for ONE account, with the cost attached.
 *
 * `null` WHEN THE ACCOUNT IS NOT THERE, which the route answers 404. An account
 * that has never traded is NOT that case: it is a subject whose list sections
 * are empty, and a pack that refused it would tell an operator that an account
 * opened this morning does not exist.
 *
 * **THE FLAG SET IS THE ACCOUNT'S PLUS THE PERSON'S, WHICH IS `account.ts`'s
 * NARROWING AND IS ADOPTED RATHER THAN REINVENTED.** `risk_flags.account_id` is
 * nullable, `IS NULL` is not a term this directory can mint, so the read is a
 * keyed read on the identity plus one predicate in memory. `full-detail`'s own
 * docblock rules the boundary: "the subject is ONE ACCOUNT ... `full-detail`
 * bounds the DETAIL and never the SCOPE".
 */
export async function readEvidenceSubject(
  tx: EvidenceTx,
  accountId: string,
): Promise<EvidenceSubjectResult | null> {
  const accountRow = await tx.rowAt('accounts', { id: accountId });
  if (accountRow === undefined || accountRow === null) return null;

  const account = projectRow(
    accountRow,
    EVIDENCE_COLUMNS['accounts'] ?? {},
    `account \`${accountId}\``,
  );
  const identityId = String(account['identity_id']);
  const planVersionId = String(account['plan_version_id']);

  const identityRow = await tx.rowAt('identities', { id: identityId });
  // AN ACCOUNT WHOSE PERSON IS NOT THERE IS A REFUSAL AND NOT AN EMPTY SECTION.
  // `accounts.identity_id` REFERENCES `identities(id)`, so this cannot happen
  // while the constraint holds, and a pack whose subject section is blank is an
  // exhibit that says the firm does not know who this is.
  if (identityRow === undefined || identityRow === null)
    throw new AdminReadError(
      `account \`${accountId}\` names identity \`${identityId}\`, which has no \`identities\` ` +
        'row. `accounts.identity_id` references that table, so the estate and the database ' +
        'disagree and this pack cannot be built',
    );

  const planVersionRow = await tx.rowAt('planVersions', { id: planVersionId });
  // `GS-112` REQUIRES THE PLAN'S RULE TEXT, so a missing pinned version is a
  // pack that cannot make the claim it exists to make, rather than a section to
  // leave out. `accounts.plan_version_id` is `uuid NOT NULL`.
  if (planVersionRow === undefined || planVersionRow === null)
    throw new AdminReadError(
      `account \`${accountId}\` pins plan version \`${planVersionId}\`, which has no ` +
        "`plan_versions` row. GS-112 requires the pack to carry the plan's rule text, and a " +
        'pack that omits the rule it is arguing about proves nothing',
    );

  const fills = (await tx.rowsWhere('fills', { accountId })).map((row) =>
    projectRow(row, EVIDENCE_COLUMNS['fills'] ?? {}, `a fills row of account \`${accountId}\``),
  );
  const marks = (await tx.rowsWhere('dailyMarks', { accountId })).map((row) =>
    projectRow(
      row,
      EVIDENCE_COLUMNS['dailyMarks'] ?? {},
      `a daily_marks row of account \`${accountId}\``,
    ),
  );
  const ruleStates = (await tx.rowsWhere('ruleStates', { accountId })).map((row) =>
    projectRow(
      row,
      EVIDENCE_COLUMNS['ruleStates'] ?? {},
      `a rule_states row of account \`${accountId}\``,
    ),
  );

  const payouts = await tx.rowsWhere('payoutRequests', { accountId });
  const episodes = await tx.rowsWhere('identityRestrictionEpisodes', { identityId });
  const clauses = clausesByFlag(payouts, episodes);

  const identityFlagRows = await tx.rowsWhere('riskFlags', { identityId });

  // THE DETECTOR AND ITS VERSION LIVE ON THE RUN AND NOT ON THE FLAG.
  // `risk_flags` carries `detector_run_id` and `detector_runs` carries both
  // names, which is `flags.ts`'s reading of the same two tables. The runs are
  // fetched ONE PER DISTINCT id rather than by reading the table: that table is
  // one row per detector per night over the whole population.
  const runIds = new Set<string>();
  for (const row of identityFlagRows) {
    const runId = cellOf(row, 'detectorRunId', 'a risk_flags row');
    if (runId !== null && runId !== undefined)
      runIds.add(nonEmptyText(runId, 'detector_run_id', 'a risk_flags row'));
  }
  const detectorByRun = new Map<string, { detector: string; version: string }>();
  for (const runId of [...runIds].sort()) {
    const run = await tx.rowAt('detectorRuns', { id: runId });
    if (run === undefined || run === null) continue;
    const at = `detector run \`${runId}\``;
    detectorByRun.set(runId, {
      detector: nonEmptyText(cellOf(run, 'detector', at), 'detector', at),
      version: nonEmptyText(cellOf(run, 'detectorVersion', at), 'detector_version', at),
    });
  }

  const identityFlags: readonly EvidenceFlagRecord[] = identityFlagRows.map((row) => {
    const flagId = nonEmptyText(cellOf(row, 'id', 'a risk_flags row'), 'id', 'a risk_flags row');
    const at = `flag \`${flagId}\``;
    const on = cellOf(row, 'accountId', at);
    const runId = cellOf(row, 'detectorRunId', at);
    const run =
      runId === null || runId === undefined ? undefined : detectorByRun.get(String(runId));
    return {
      flag_id: flagId,
      identity_id: nonEmptyText(cellOf(row, 'identityId', at), 'identity_id', at),
      account_id: on === null || on === undefined ? null : nonEmptyText(on, 'account_id', at),
      flag_type: nonEmptyText(cellOf(row, 'flagType', at), 'flag_type', at),
      severity: exactInteger(cellOf(row, 'severity', at), 'severity', at),
      status: nonEmptyText(cellOf(row, 'status', at), 'status', at),
      first_detected_on: tradingDayText(
        cellOf(row, 'firstDetectedOn', at),
        'first_detected_on',
        at,
      ),
      // `null` AND NOT A SENTINEL. `flags.ts` renders an unattributed flag as
      // `UNATTRIBUTED_DETECTOR` because its queue column is a string; this field
      // is nullable, so the two answers are a value and no value.
      detector: run?.detector ?? null,
      detector_version: run?.version ?? null,
      evidence: jsonSafe(cellOf(row, 'evidence', at), 'evidence', at, '$') as EvidenceRow,
      tos_clause: clauseFor(flagId, clauses),
    };
  });

  const flags = identityFlags.filter(
    (flag) => flag.account_id === null || flag.account_id === accountId,
  );

  return {
    subject: {
      account_id: accountId,
      identity_id: identityId,
      account,
      identity: projectRow(
        identityRow,
        EVIDENCE_COLUMNS['identities'] ?? {},
        `identity \`${identityId}\``,
      ),
      fills: oldestFirst(fills, 'executed_at', 'id'),
      marks: oldestFirst(marks, 'trading_day', 'id'),
      rule_states: oldestFirst(ruleStates, 'trading_day', 'id'),
      plan_version: projectRow(
        planVersionRow,
        EVIDENCE_COLUMNS['planVersions'] ?? {},
        `plan version \`${planVersionId}\``,
      ),
      flags: [...flags].sort((left, right) =>
        left.flag_id === right.flag_id ? 0 : left.flag_id < right.flag_id ? -1 : 1,
      ),
    },
    cost: {
      fills: fills.length,
      marks: marks.length,
      ruleStates: ruleStates.length,
      identityFlags: identityFlags.length,
      flags: flags.length,
      payoutRequests: payouts.length,
      restrictionEpisodes: episodes.length,
      clauseSources: clauses.size,
      detectorRuns: detectorByRun.size,
    },
  };
}

/**
 * {@link EvidenceReadPort} over one unit of work.
 *
 * THE COST IS MEASURED AND DROPPED HERE, which is `composeImplementedAdminReads`'s
 * choice for the other four reads and is made for its reason: the port's
 * signatures are the generator's and have nowhere to carry it.
 *
 * **THIS IS TWO OF THE THREE PORTS SHORT OF A COMPOSABLE `exportEvidence` AND
 * THE SECTION HEADER SAYS WHICH TWO.** A deployment holding a store and a writer
 * hands this in as `EvidenceExporterDeps.reads`; nothing in this tree holds
 * either, so nothing in this tree calls this function outside its suite.
 */
export function evidenceReadPort(tx: EvidenceTx): EvidenceReadPort {
  return {
    readSubject: async (accountId) => (await readEvidenceSubject(tx, accountId))?.subject ?? null,
    readDetectorRegistry: async () => await readEvidenceDetectorRegistry(tx),
  };
}
