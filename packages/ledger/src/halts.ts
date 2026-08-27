// =============================================================================
// packages/ledger/src/halts.ts
// =============================================================================
// `ledger_halts` IS A ROW THAT SAYS "STOP POSTING FOR THIS PERSON", AND NOTHING
// IN THE DATABASE MAKES IT ONE.
//
// `0016_treasury_controls.sql` creates the table under `ADR-016` and
// `INV-M5-16`: an identity-scoped halt with an escalation clock, because "a
// single identity's position failing a check" is not a stop-the-world event and
// "halting the firm for it is an outage; ignoring it is a leak". The table
// carries a SUBJECT, a START and a DEADLINE, and a partial unique index makes at
// most one halt live per identity.
//
// WHAT IT DOES NOT CARRY IS ANY ENFORCEMENT. There is no trigger on
// `ledger_entries` that consults it, and `grep -n TRIGGER` over `0016` returns
// nothing. A halted identity's accounts can be posted against all day and every
// constraint stays green. THE HALT IS ONLY A HALT IF A CODE PATH READS IT, and
// this file is that code path.
//
// SO THE CHECK IS INSIDE `postTransaction` AND NOT BESIDE IT. A separate
// `assertNotHalted` a caller is asked to remember is exactly the shape ADR-008
// rejects for scoping and ADR-102 rejects for the write path: a control that is
// a convention at each call site. The cost is one extra read per posting: this
// reads every halt row and filters in memory. Live halts are bounded by the
// partial unique index at one per identity and are near zero in a healthy
// estate; released ones are not bounded at all and accumulate forever, which is
// the direction this read gets slower.
//
// -----------------------------------------------------------------------------
// THE ACCESSOR NOW CARRIES THE PREDICATE THIS COST WAS THE PRICE OF, AND THIS
// FILE STILL PAYS IT (ADR-157)
// -----------------------------------------------------------------------------
// The paragraph above used to say the cost was there because "the accessor
// carries no predicate", and ADR-157 admitted a NULL TERM to `scoped-db.ts` for
// this reader by name: `rowsWhere('ledgerHalts', { releasedAt: isNull() })`
// renders `released_at IS NULL` and returns only the rows this function keeps.
//
// WHAT STANDS BETWEEN THAT AND THIS LINE IS `LedgerTx`, WHICH IS NOT THE
// ACCESSOR. `tx.ts` restates the subset of ADR-102's `SystemTx` this package
// writes through, deliberately, because a dependency edge on `@merit/db` would
// give this library the ability to open its own transaction and lose ADR-006's
// central consequence. `LedgerTx` declares `rows` and `insert` and does not
// declare `rowsWhere`, so widening it is a diff on `tx.ts` and on every fake in
// this package's suite.
//
// THAT IS OUTSIDE ADR-157's FENCE AND IS REPORTED RATHER THAN REACHED FOR. The
// cost above is REAL and is unchanged; what is no longer true is the REASON
// this file gave for it. The session that widens `LedgerTx` deletes this
// section while unblocking itself, and `packages/ledger/test/accessor-bind.test.ts`
// is the file that will notice if `rowsWhere` ever stops being there to widen to.
//
// -----------------------------------------------------------------------------
// THE ONE POSTING A HALT MUST NOT BLOCK
// -----------------------------------------------------------------------------
// A halt is released by a human who has established what went wrong, and what
// they establish frequently requires posting a compensating entry: `SD-M5-05`
// rules that a correction is a new transaction and never an update. A halt that
// refused its own remediation would be a halt nobody could clear without
// turning the control off, which is how a control gets turned off.
//
// So there is an override and it is a WORD SOMEBODY WRITES, on `sqlExecutor`'s
// precedent in ADR-102 and `systemDb`'s in ADR-084: a closed one-member
// vocabulary, so that "posted through a live halt" is a diff a reviewer reads
// rather than a boolean nobody looked at. It closes the accidental door and not
// the deliberate one, which is the limit `job-queue.ts` and `VG-4` both state
// about themselves.

import type { IdentityId } from './accounts.ts';
import type { LedgerTx } from './tx.ts';

/** Why a posting is being made against a halted identity. One member, and joining it is a diff. */
export type HaltOverrideReason = 'halt-remediation';

/** One live `ledger_halts` row, in the columns a refusal has to quote back. */
export interface LiveHalt {
  readonly id: string;
  readonly identityId: IdentityId;
  readonly reasonCode: string;
  readonly reasonNote: string;
  readonly escalateAt: string;
}

/** `released_at IS NULL` is what "live" means, and the partial unique index agrees. */
function asLiveHalt(row: unknown, index: number): LiveHalt | undefined {
  if (typeof row !== 'object' || row === null) {
    throw new TypeError(`ledger_halts row ${index} is ${String(row)} and not a row.`);
  }
  const candidate = row as Record<string, unknown>;
  const releasedAt = candidate['releasedAt'] ?? null;
  if (releasedAt !== null) return undefined;

  const id = candidate['id'];
  const identityId = candidate['identityId'];
  if (typeof id !== 'string' || typeof identityId !== 'string') {
    throw new TypeError(
      `ledger_halts row ${index} does not carry id and identityId as strings. ` +
        'identity_id is `uuid NOT NULL` at 0016, so a row without one is not a halt: ' +
        '"a halt with no subject is the global halt and the global halt is not a row".',
    );
  }
  const reasonCode = candidate['reasonCode'];
  const reasonNote = candidate['reasonNote'];
  const escalateAt = candidate['escalateAt'];
  return {
    id,
    identityId,
    reasonCode: typeof reasonCode === 'string' ? reasonCode : '(unreadable)',
    reasonNote: typeof reasonNote === 'string' ? reasonNote : '(unreadable)',
    escalateAt: escalateAt instanceof Date ? escalateAt.toISOString() : String(escalateAt),
  };
}

/** Every halt that has not been released, whoever it is against. */
export async function readLiveHalts(tx: LedgerTx): Promise<readonly LiveHalt[]> {
  const rows = await tx.rows('ledgerHalts');
  const live: LiveHalt[] = [];
  rows.forEach((row, index) => {
    const halt = asLiveHalt(row, index);
    if (halt !== undefined) live.push(halt);
  });
  return live;
}

/**
 * Refuse if any identity this posting touches is halted.
 *
 * A FIRM-ONLY POSTING IS NEVER REFUSED BY THIS, because a halt names a subject
 * and a posting between two firm accounts names none. That is `0016`'s own
 * partition: the firm-wide stop is an INCIDENT and not a row.
 */
export function assertNoLiveHalt(
  live: readonly LiveHalt[],
  identities: readonly IdentityId[],
): void {
  if (identities.length === 0) return;
  const subjects = new Set(identities);
  const blocking = live.filter((halt) => subjects.has(halt.identityId));
  if (blocking.length === 0) return;

  const named = blocking
    .map((halt) => `${halt.identityId} (${halt.reasonCode}: ${halt.reasonNote})`)
    .join('; ');
  throw new Error(
    `a ledger halt is live against ${named}, so this posting is refused. ADR-016 and ` +
      'INV-M5-16 make the halt identity-scoped rather than global precisely so that it ' +
      'can be honoured without an outage, and nothing in the database honours it: there ' +
      'is no trigger on ledger_entries that reads ledger_halts. If this posting IS the ' +
      "remediation, say so: postTransaction's fourth argument takes 'halt-remediation' " +
      'and the word is what makes it reviewable.',
  );
}
