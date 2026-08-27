// =============================================================================
// packages/enrichment/src/contract.ts
// =============================================================================
// WHAT MERIT IS ALLOWED TO SEND THE VENDOR, AS A ROW RATHER THAN AS CODE.
//
// `integration_contracts` is `SD-M10-01` and its own DDL states the failure it
// exists to prevent, in the direction that matters: "WITHOUT A DECLARED
// PER-VENDOR FIELD ALLOWLIST, the payload sent to a vendor is whatever the
// event happened to contain on the day it was serialized, WHICH MEANS A SCHEMA
// ADDITION SILENTLY BECOMES A DISCLOSURE ... nobody decides to leak the new
// column. Someone adds a column to an event payload for an unrelated reason,
// and the vendor starts receiving it that afternoon."
//
// M03 SECTION 7.9.1 IS WHY THE ROW IS KEYED THE WAY IT IS. One vendor, two
// moments, and "not a second sub-processor": the registration lookup is "its
// own `integration_contracts` row under M10's `SD-M10-01` field allowlist". So
// `integration` names the ROLE the vendor plays and `event_name` names the
// MOMENT, and `integration_contracts_live_uq` is `UNIQUE (integration,
// event_name) WHERE enabled`, which is exactly one live contract per moment.
//
// -----------------------------------------------------------------------------
// THE ROW IS INSTALLED DISABLED AND A PERSON ENABLES IT
// -----------------------------------------------------------------------------
// `enabled boolean NOT NULL DEFAULT false`, and the transcription's own comment
// says why: "A contract that arrived enabled would be a disclosure that began
// the moment the row was inserted." `approved_by text NOT NULL` and
// `approved_at timestamptz NOT NULL` are the other half of the same control, so
// `enrichmentContractValues` TAKES both and defaults neither. There is no
// approver this file could invent that would be true.
//
// NO ENABLED ROW MEANS NO CALL AT ALL, which is this file's strongest property
// and it is also non-blocking: no contract, no disclosure, no vendor call, no
// signal, and a checkout that commits exactly as it would have.
//
// -----------------------------------------------------------------------------
// THE ROW IS READ THROUGH A `firm` HANDLE AND NOT THROUGH CHECKOUT'S
// TRANSACTION
// -----------------------------------------------------------------------------
// `integration_contracts` is `firm` in the registry: "the SAME contract governs
// every dispatch to that vendor for every identity". `ScopedTableKey` excludes
// every firm table, so checkout's own `ScopedTx` cannot name it and the read is
// `TS2345` rather than a leak. ADR-102 clause 3's `firmDb()` is the door, and
// this package declares the narrow shape of it rather than importing it, for
// `tx.ts`'s reason.
//
// THE CONTRACT IS FIRM CONFIGURATION AND IS NOT PART OF CHECKOUT'S ATOMIC UNIT.
// Reading it outside the purchase's transaction is correct rather than a
// compromise: a contract that changed mid-flight changes the NEXT checkout, and
// there is no row in the purchase whose consistency depends on it.

import { ENRICHMENT_FACETS, type EnrichmentFacet, type EnrichmentSubject } from './port.ts';
import type { WriteValues } from './tx.ts';

/**
 * The role the vendor plays, written to `integration_contracts.integration` and
 * to `integration_dispatches.integration`.
 *
 * THE ROLE AND NOT THE VENDOR. ADR-023 rules the adapter vendor-agnostic
 * because "the vendor will be re-evaluated", and a re-evaluation that renamed
 * every historical dispatch row would make the breach query
 * (`GET /admin/identities/:identityId/disclosures`) answer a different question
 * before and after the switch.
 */
export const ENRICHMENT_INTEGRATION = 'enrichment';

/**
 * The moment, written to `integration_contracts.event_name`.
 *
 * `registration.phone_lookup` IS THE OTHER ONE AND IS NOT THIS SESSION'S. M03
 * section 7.9.1 rules it a separate row on the same vendor, because what
 * crosses the boundary differs ("the telephone number, which never left Merit
 * before") and a stranger registering is owed nothing yet.
 */
export const ENRICHMENT_EVENT_NAME = 'checkout.enrichment';

/** The contract's version. `integration_contracts_version_uq` is `(integration, event_name, version)`. */
export const ENRICHMENT_CONTRACT_VERSION = 1;

/**
 * The declared allowlist: ADR-023's purchased scope and not one field more.
 *
 * IT IS AN ALLOWLIST AND NOT A DENYLIST, "because a denylist defaults to
 * sending" (`SD-M10-01`). A facet absent from the row installed in the database
 * is never sent, whatever this constant says, because `redactToAllowlist` reads
 * the ROW.
 */
export const ENRICHMENT_FIELD_ALLOWLIST: readonly EnrichmentFacet[] = ENRICHMENT_FACETS;

/** One `integration_contracts` row, in the columns this package reads. */
export interface ContractRow {
  readonly integration: string;
  readonly eventName: string;
  readonly fieldAllowlist: readonly string[];
  readonly enabled: boolean;
  readonly version: number;
}

/**
 * A `firm` reader, as this package sees one.
 *
 * STRUCTURALLY SATISFIED BY ADR-102's `FirmDb` AND BY `FirmTx`, and named
 * separately for `tx.ts`'s reason. Both declare
 * `rows<K extends FirmTableKey>(key: K): Promise<unknown[]>`, and a handle that
 * accepts every firm key satisfies one that accepts a single literal.
 */
export interface ContractSource {
  rows(key: 'integrationContracts'): Promise<unknown[]>;
}

/**
 * Narrow one row of `unknown` from the accessor, or say exactly what arrived.
 *
 * ADR-102's `rows()` returns `Promise<unknown[]>`, so this is where the shape is
 * ESTABLISHED rather than assumed, which is `packages/ledger/src/chart.ts`'s
 * `asChartRow` and its argument: a reader that silently dropped the rows it
 * could not read would resolve to "no contract" further down, and "no contract"
 * is a decision to disclose nothing that would then have been taken by a
 * parsing bug rather than by a person.
 */
function asContractRow(row: unknown, index: number): ContractRow {
  if (typeof row !== 'object' || row === null) {
    throw new TypeError(`integration_contracts row ${index} is ${String(row)} and not a row.`);
  }
  const candidate = row as Record<string, unknown>;
  const { integration, eventName, fieldAllowlist, enabled, version } = candidate;
  if (typeof integration !== 'string' || typeof eventName !== 'string') {
    throw new TypeError(
      `integration_contracts row ${index} does not carry integration and eventName as strings: ` +
        `${JSON.stringify(Object.keys(candidate))}. The accessor returns unknown[] and this ` +
        'package establishes the shape rather than assuming it.',
    );
  }
  if (typeof enabled !== 'boolean' || typeof version !== 'number') {
    throw new TypeError(
      `integration_contracts row ${index} does not carry enabled as a boolean and version as a ` +
        'number, which are the two columns that decide whether it governs anything.',
    );
  }
  if (!Array.isArray(fieldAllowlist) || fieldAllowlist.some((f) => typeof f !== 'string')) {
    throw new TypeError(
      `integration_contracts row ${index} does not carry fieldAllowlist as an array of strings. ` +
        'It is `text[] NOT NULL` in 0018_integrations.sql and holds field NAMES.',
    );
  }
  return { integration, eventName, fieldAllowlist, enabled, version };
}

/**
 * The ONE live contract governing this integration and this event, or
 * `undefined`.
 *
 * IT THROWS ON TWO RATHER THAN TAKING THE FIRST, which is ADR-112's `oneOrNone`
 * argument applied to a table this package reads without an addressed read.
 * `integration_contracts_live_uq` is `UNIQUE (integration, event_name) WHERE
 * enabled` and makes two impossible in the database; two arriving here means
 * that index is gone, and picking one of them would mean disclosing under a
 * contract nobody could name afterwards.
 */
export function liveContractFrom(rows: readonly unknown[]): ContractRow | undefined {
  const live = rows
    .map(asContractRow)
    .filter(
      (row) =>
        row.enabled &&
        row.integration === ENRICHMENT_INTEGRATION &&
        row.eventName === ENRICHMENT_EVENT_NAME,
    );
  if (live.length > 1) {
    throw new Error(
      `${live.length} enabled integration_contracts rows govern ` +
        `(${ENRICHMENT_INTEGRATION}, ${ENRICHMENT_EVENT_NAME}). ` +
        'integration_contracts_live_uq makes that impossible in the database, so the index is ' +
        'gone and a disclosure would happen under a contract nobody could name afterwards.',
    );
  }
  return live[0];
}

/** Read the live contract through a `firm` handle. `undefined` means no disclosure is authorised. */
export async function readLiveContract(source: ContractSource): Promise<ContractRow | undefined> {
  return liveContractFrom(await source.rows('integrationContracts'));
}

/** What a redaction produced: the subject that may be sent, and the names that will go with it. */
export interface RedactedSubject {
  /** The subject narrowed to the contract's allowlist. Never wider than the row permits. */
  readonly subject: EnrichmentSubject;
  /**
   * WHAT ACTUALLY GOES, not what the contract permitted.
   *
   * `integration_dispatches.fields_sent` "records what actually went, not what
   * the contract permitted. The two can differ when a field is absent from a
   * particular event, and the breach question is about what left the building
   * rather than about what was allowed to." So a facet the contract permits and
   * checkout does not have is NOT in this list.
   */
  readonly fieldsSent: readonly EnrichmentFacet[];
  /**
   * Names in the row's allowlist that are not facets of this integration.
   *
   * REPORTED RATHER THAN IGNORED AND RATHER THAN THROWN. A person approved that
   * word; it discloses nothing on its own, because nothing here can produce a
   * value for it, but a contract permitting a field the caller cannot send is a
   * drift between the approval and the code, and a drift nobody is told about
   * is the one that survives.
   */
  readonly unknownAllowlistNames: readonly string[];
}

/**
 * Narrow a subject to what the contract row permits.
 *
 * THE ORDER IS THE ALLOWLIST'S CLOSED VOCABULARY AND NOT THE CALLER'S KEY
 * ORDER, so `fields_sent` renders the same array whatever order the subject was
 * built in, and two dispatch rows for the same disclosure compare equal.
 */
export function redactToAllowlist(row: ContractRow, subject: EnrichmentSubject): RedactedSubject {
  const permitted = new Set(row.fieldAllowlist);
  const facets = new Set<string>(ENRICHMENT_FACETS);
  const narrowed: Partial<Record<EnrichmentFacet, string>> = {};
  const fieldsSent: EnrichmentFacet[] = [];

  for (const facet of ENRICHMENT_FACETS) {
    if (!permitted.has(facet)) continue;
    const value = subject[facet];
    if (value === undefined) continue;
    narrowed[facet] = value;
    fieldsSent.push(facet);
  }

  return {
    subject: narrowed,
    fieldsSent,
    unknownAllowlistNames: row.fieldAllowlist.filter((name) => !facets.has(name)),
  };
}

/**
 * The `integration_contracts` row this integration needs, as values for an
 * insert through a `firm` transaction.
 *
 * `enabled` IS NOT A PARAMETER AND IS ALWAYS `false`. Installing the row and
 * authorising the disclosure are two acts, and this function performs the first
 * one only. A caller wanting the second writes an addressed update through
 * ADR-112's `updateAt`, which is a diff a reviewer reads.
 *
 * `guardExpression` IS NOT SET, and the absence is a decision. A guard is "an
 * optional predicate that must hold before this event is dispatched at all,
 * evaluated over the allowlisted fields only" (`INV-M10-08`), and in observe
 * mode there is nothing to guard on: every checkout is asked about, which is
 * the whole point of learning the distribution.
 *
 * `approvedBy` and `approvedAt` ARE REQUIRED PARAMETERS. "A contract is
 * APPROVED, by a person, on a date. An enabled contract with no approver is a
 * disclosure nobody authorised."
 */
export function enrichmentContractValues(approvedBy: string, approvedAt: Date): WriteValues {
  if (approvedBy.trim() === '') {
    throw new Error(
      'an integration_contracts row needs an approver. `approved_by text NOT NULL` is 0002s ' +
        'actor idiom and an empty string satisfies the column while naming nobody.',
    );
  }
  return {
    integration: ENRICHMENT_INTEGRATION,
    eventName: ENRICHMENT_EVENT_NAME,
    fieldAllowlist: [...ENRICHMENT_FIELD_ALLOWLIST],
    enabled: false,
    version: ENRICHMENT_CONTRACT_VERSION,
    approvedBy,
    approvedAt,
  };
}
