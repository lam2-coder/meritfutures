// =============================================================================
// packages/ledger/src/chart.ts
// =============================================================================
// AN `AccountRef` NAMES A CLASS AND A PERSON; `ledger_entries` WANTS A uuid.
// This is the one place the two are joined, and it is separate from the posting
// path because of how it has to read.
//
// -----------------------------------------------------------------------------
// A FINDING, STATED WHERE IT COSTS RATHER THAN ONLY IN THE ENTRY
// -----------------------------------------------------------------------------
// `LedgerTx` offers `rows(key)` and nothing else: there is no read on THIS
// package's handle that carries a caller's predicate. `systemTx.rows(
// 'ledgerAccounts')` renders `SELECT * FROM ledger_accounts` with no `WHERE` at
// all, so resolving one posting's four account references reads THE WHOLE CHART
// OF ACCOUNTS -- four firm rows plus up to three per identity, which grows with
// the trader population and not with the posting.
//
// THIS PARAGRAPH USED TO SAY "ADR-102's ACCESSOR" AND THAT STOPPED BEING TRUE
// WITHOUT THE COST MOVING (ADR-157, and P5 section 5.4 is the instruction).
// ADR-112 landed `rowsWhere(key, filter)` on all three transaction handles and
// ADR-157 gave it a range term and a null term, so the accessor now carries a
// caller's predicate. What does not is `LedgerTx`, which `tx.ts` restates on
// purpose so this library cannot open its own transaction. The limit is this
// package's own boundary rather than `packages/db`'s, and naming the wrong one
// would send the next reader to widen the wrong file.
//
// THIS PACKAGE DOES NOT REACH AROUND IT. A second door -- a raw `SELECT`
// through `sqlExecutor`, a `pg` import, a scoped read cast past its key type --
// is every control ADR-008 and ADR-102 built, routed around by the one library
// that touches every money movement in the system. So the read is made ONCE PER
// CALLER-CHOSEN WINDOW instead of once per posting: `readChart` returns a value
// and `postTransaction` takes it, so the nightly batch reads the chart once and
// posts thousands of transactions against it, and a request handler reads it
// inside the same transaction it is about to write in.
//
// THE REMEDY IS BUILT AND IS NOT REACHABLE FROM HERE. `rowsWhere` exists on
// `ScopedTx`, `SystemTx` and `FirmTx`; the diff that would let THIS file use it
// is on `tx.ts`, not on `packages/db/src/scoped-db.ts`, and `readChart`'s
// caller-chosen window is still the right design either way. What changed is
// only the reason: it is no longer "no such read exists".
//
// -----------------------------------------------------------------------------
// A STALE CHART IS A WRONG POSTING, AND THE WINDOW IS THE CALLER'S TO CHOOSE
// -----------------------------------------------------------------------------
// A chart read before an account existed does not contain it, and
// `postTransaction` REFUSES rather than creating one (see `resolve`). Read it
// inside the transaction you post in and it is consistent with the rows you are
// about to write; read it once for a long batch and a trader onboarded during
// the run is missing from it. That is the caller's decision and it is stated
// here so that it is a decision rather than a discovery.

import { accountKey, type AccountRef } from './accounts.ts';
import type { LedgerTx } from './tx.ts';

/** One `ledger_accounts` row, in the only three columns this package reads. */
interface ChartRow {
  readonly id: string;
  readonly code: string;
  readonly scope: string;
  readonly identityId: string | null;
}

/** The chart of accounts as a lookup, keyed the way the two partial uniques key it. */
export interface Chart {
  readonly byKey: ReadonlyMap<string, string>;
  /** How many rows the read returned. Reported by the suite so the cost above is visible. */
  readonly size: number;
}

/**
 * Narrow one row of `unknown` from the accessor, or say exactly what arrived.
 *
 * ADR-102's `rows()` returns `Promise<unknown[]>`, so this is where the shape
 * is established rather than assumed. It throws instead of skipping: a chart
 * that silently dropped the rows it could not read would resolve to "account
 * missing" further down, and the caller would be told the wrong thing about the
 * wrong table.
 */
function asChartRow(row: unknown, index: number): ChartRow {
  if (typeof row !== 'object' || row === null) {
    throw new TypeError(`ledger_accounts row ${index} is ${String(row)} and not a row.`);
  }
  const candidate = row as Record<string, unknown>;
  const { id, code, scope } = candidate;
  const identityId = candidate['identityId'] ?? null;
  if (typeof id !== 'string' || typeof code !== 'string' || typeof scope !== 'string') {
    throw new TypeError(
      `ledger_accounts row ${index} does not carry id, code and scope as strings: ` +
        `${JSON.stringify(Object.keys(candidate))}. The accessor returns unknown[] and this ` +
        'package establishes the shape rather than assuming it.',
    );
  }
  if (identityId !== null && typeof identityId !== 'string') {
    throw new TypeError(`ledger_accounts row ${index} has a non-string identityId.`);
  }
  return { id, code, scope, identityId };
}

/**
 * Read the chart of accounts through the accessor.
 *
 * IT TAKES THE OPEN TRANSACTION, so the rows are the ones the posting will be
 * consistent with, and so that this package still cannot reach a database on
 * its own.
 */
export async function readChart(tx: LedgerTx): Promise<Chart> {
  const rows = (await tx.rows('ledgerAccounts')).map(asChartRow);
  const byKey = new Map<string, string>();
  for (const row of rows) {
    // THE KEY IS BUILT FROM THE ROW AND NOT FROM THIS PACKAGE'S OPINION OF THE
    // CLASS. `scope` is the column the DDL constrains and ties to `identity_id`;
    // `LEDGER_ACCOUNT_SCOPE` states which class SHOULD be which, and using it
    // here would make a mis-scoped row unfindable instead of visible.
    const key =
      row.scope === 'firm' ? `firm ${row.code}` : `identity ${row.code} ${row.identityId ?? ''}`;
    const existing = byKey.get(key);
    if (existing !== undefined && existing !== row.id) {
      throw new Error(
        `the chart holds two accounts for ${key} (${existing} and ${row.id}). ` +
          'ledger_accounts_firm_code_uq and ledger_accounts_identity_code_uq exist to make ' +
          'that impossible, so this is a database whose indexes are not the ones 0009 declares.',
      );
    }
    byKey.set(key, row.id);
  }
  return { byKey, size: rows.length };
}

/**
 * The `ledger_accounts.id` for one reference, or a refusal naming it.
 *
 * IT DOES NOT CREATE A MISSING ACCOUNT, and that is a foreclosure rather than a
 * gap left open. Minting a `trader_wallet` row for an identity is an act with
 * its own semantics -- it is an `owned` insert, so ADR-102's `scopedTx` serves
 * it under a handle bound to that person, which a posting does not hold -- and
 * `0009`'s own argument is the one that decides it: "a class appearing first in
 * a migration is a class nobody defined". An account appearing first inside a
 * posting is an account nobody opened.
 */
export function resolve(chart: Chart, ref: AccountRef): string {
  const key = accountKey(ref);
  const id = chart.byKey.get(key);
  if (id === undefined) {
    throw new Error(
      `no ledger account for ${key}, over a chart of ${String(chart.size)} row(s). ` +
        'A posting never opens an account: it names one that exists, and the account it ' +
        'names is either not open yet or was opened after this chart was read.',
    );
  }
  return id;
}
