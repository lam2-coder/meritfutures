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
// The profile vocabulary, and the one thing in this file that is CHOSEN
// -----------------------------------------------------------------------------

/**
 * `evidence_packs.redaction_profile`, per audience.
 *
 * TWO PROFILES OVER FOUR AUDIENCES, AND THE STRUCTURE IS RULED WHILE THE NAMES
 * ARE NOT. `M06` section 4 gives the split in its own words: the `trader`
 * audience gets "the account's own facts in full ... no detector parameters, no
 * thresholds, no other identity, and no comparison against a population", and
 * "`internal`, `counsel`, and `regulator`: full detail including detector
 * internals". `EC-071` says the same thing and the batch 1 gate closed it. So
 * three of the four collapsing into one profile is a TRANSCRIPTION.
 *
 * THE TWO STRINGS ARE A NAMING CHOICE AND THEY ARE LABELLED AS ONE, on `P7-d`'s
 * precedent with `version: 'v1'`. `0008_risk.sql` puts no `CHECK` on this column
 * and no approved document spells a profile name, so these are the first two
 * values the column will ever hold and nothing cites them. That is reported as
 * needing a ruling rather than ruled here: this session took no ADR number.
 *
 * WHAT A RULING WOULD FIX is the strings and their `CHECK`, not the mapping.
 * A later entry that renames them supersedes rows by writing the new name, the
 * same way `SD-M7-03` supersedes a threshold, because the profile is recorded ON
 * the pack and a pack is never rewritten.
 */
export const EVIDENCE_REDACTION_PROFILES = {
  internal: 'full-detail',
  trader: 'trader-facts-only',
  counsel: 'full-detail',
  regulator: 'full-detail',
} as const satisfies Readonly<Record<EvidencePackAudience, string>>;

/** One member of {@link EVIDENCE_REDACTION_PROFILES}. */
export type EvidenceRedactionProfile =
  (typeof EVIDENCE_REDACTION_PROFILES)[keyof typeof EVIDENCE_REDACTION_PROFILES];

/** The profile that FOLLOWS FROM the audience. `M06` section 4: never per export. */
export function redactionProfileFor(audience: EvidencePackAudience): EvidenceRedactionProfile {
  return EVIDENCE_REDACTION_PROFILES[audience];
}

/**
 * `evidence_packs.includes_detector_detail`, DERIVED from the profile.
 *
 * NOT A THIRD INDEPENDENT PARAMETER. It is `false` exactly when the profile is
 * the trader's, so the combination the merged CHECK calls "the one combination
 * that must be unrepresentable" has no expression here at all: there is no
 * argument a caller could pass to produce it.
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
