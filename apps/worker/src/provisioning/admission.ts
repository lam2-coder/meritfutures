// =============================================================================
// apps/worker/src/provisioning/admission.ts
// =============================================================================
// `INV-M2-13`, AND THE FAIL-CLOSED EXIT IS THE DEFAULT PATH RATHER THAN A
// BRANCH SOMEBODY HAS TO REMEMBER.
//
//   INV-M2-13: "No account trades until its risk settings are confirmed, by
//   acknowledgement artifact or by successful read-back. Fail-closed
//   provisioning, ruled design law at the batch 1 gate. The account is held out
//   of trading entirely; an unconfirmed setpoint is a hard block, never a
//   dashboard marker. Enforced at the provisioning saga's exit."
//
// M02 section 3.2 states the cost and accepts it rather than arguing it away:
// "a provisioning outage is visible, bounded, and recoverable, and an
// unenforced funded account is none of those three."
//
// -----------------------------------------------------------------------------
// WHY THE ADMISSION IS A VALUE WITH ONE PRODUCER RATHER THAN A BOOLEAN
// -----------------------------------------------------------------------------
// A `boolean` has a default and its default is a coin toss: `false` if somebody
// initialised it that way and `true` if the code reads
// `if (blocked) return false; return true`. The failure this invariant exists
// for is a trader holding a live account the firm never confirmed, and no later
// read distinguishes that account from a legitimate one -- so what is needed is
// not a check that refuses, it is a shape in which admission CANNOT BE
// CONSTRUCTED without the evidence.
//
// `SetpointConfirmation` is that shape. It is branded, its only producer is
// `setpointConfirmation` below, and that producer refuses every row that is not
// a `confirmed` `set_risk` naming the account's CURRENT floor. `admitToTrading`
// is a fold whose SEED IS A REFUSAL and whose only writer is a non-null
// evidence value, so every path that is not the one path -- an empty row set,
// an unrecognised status, a row for another account, an operation this module
// has never heard of, a thrown error caught upstream -- arrives at the seed.
//
// **WHERE THE OPEN PATH SURVIVES, STATED RATHER THAN CLAIMED CLOSED.** Two
// places, and neither is inside this file:
//
//   1. **A caller that never asks.** Nothing in this module can force a
//      consumer to call `admitToTrading` before letting an account trade. This
//      file makes the answer unforgeable; it cannot make the question
//      compulsory. The structural half of that is `entitle`, which takes a
//      `SetpointConfirmation` as a REQUIRED ARGUMENT (`saga.ts`), so the one
//      act that puts an account on the platform cannot be reached without one.
//      The residue is any future path that enables trading WITHOUT an
//      entitlement change, and there is none today.
//   2. **The rows themselves.** `admitToTrading` decides on the rows it is
//      handed. A reader that hands it a filtered subset -- the confirmed ones,
//      say -- gets an admission it did not earn. The remedy is that the read is
//      the caller's and the caller is named: `ProvisioningReadPort.rowsFor`
//      (`ports.ts`) is documented as "every row for this account, unfiltered",
//      and **the accessor cannot serve it today**, which is this session's
//      central finding rather than a hole this file opened.
//
// -----------------------------------------------------------------------------
// THE ANCHOR IS THE ACCOUNT'S CURRENT FLOOR, WHICH IS INV-M2-08 COMPOSED WITH
// THIS ONE
// -----------------------------------------------------------------------------
// INV-M2-08: "The risk setting pushed to the vendor equals the account's
// current floor, and a floor change enqueues a push." A confirmation is
// therefore evidence about A FLOOR and not about an account: a `set_risk` row
// confirmed last week names last week's floor, and an account whose floor moved
// since is an account whose current setpoint is unconfirmed. Anchoring on the
// current floor makes that automatic rather than a staleness rule somebody has
// to write, and it disposes of the superseded-row question the same way: an old
// `failed` row naming an old floor is simply not evidence for this one, so it
// neither admits nor blocks forever.

import { isProvisioningOperation, isProvisioningStatus } from './vocabulary.ts';
import type { ProvisioningOperation, ProvisioningStatus } from './vocabulary.ts';

/** The payload field a `set_risk` intent carries the floor in. Integer cents. */
export const RISK_FLOOR_CENTS_FIELD = 'risk_floor_cents';

/**
 * One `provisioning_queue` row, narrowed.
 *
 * `payload` IS `Record<string, unknown>` AND NOT `ProvisioningPayload`, because
 * this is a row that came OUT of `jsonb` rather than an intent going in.
 * `renderPayload` sends a `bigint` to `jsonb` as a decimal string, so what
 * comes back is a string, and `readFloorCents` below is the one place that
 * conversion is reversed.
 */
export interface ProvisioningRow {
  readonly accountId: string;
  readonly operation: ProvisioningOperation;
  readonly status: ProvisioningStatus;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly confirmedAt: Date | null;
}

/**
 * A row as the accessor hands it over, narrowed or refused.
 *
 * IT RETURNS `null` RATHER THAN THROWING and the direction is the point: a row
 * this module cannot read is a row that contributes NO evidence, which under a
 * refusal-seeded fold is the safe outcome. A throw here would abort the fold
 * and lose the refusals the other rows had already established, which is the
 * same answer arrived at less legibly.
 */
export function readProvisioningRow(row: unknown): ProvisioningRow | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;
  const accountId = r['account_id'] ?? r['accountId'];
  const operation = r['operation'];
  const status = r['status'];
  const payload = r['payload'];
  const confirmedAt = r['confirmed_at'] ?? r['confirmedAt'] ?? null;
  if (typeof accountId !== 'string' || accountId.length === 0) return null;
  if (!isProvisioningOperation(operation)) return null;
  if (!isProvisioningStatus(status)) return null;
  if (typeof payload !== 'object' || payload === null) return null;
  if (confirmedAt !== null && !(confirmedAt instanceof Date)) return null;
  return {
    accountId,
    operation,
    status,
    payload: payload as Readonly<Record<string, unknown>>,
    confirmedAt,
  };
}

/**
 * The brand's key.
 *
 * A REAL `const` RATHER THAN A `declare const`, AND THE SUITE IS WHY THIS LINE
 * READS THE WAY IT DOES. `declare const SETPOINT_CONFIRMATION: unique symbol`
 * type-checks, satisfies every use below, and ERASES: under
 * `node --experimental-strip-types` the computed key in `setpointConfirmation`
 * is then a reference to a binding that does not exist, and the only producer
 * of an admission throws `ReferenceError` at runtime. `tsc --noEmit` reports
 * nothing, because the declaration is a promise that something else supplies
 * the value and nothing else does.
 *
 * It is NOT exported and cannot be reached from outside this module, so the
 * property is unspellable in an object literal anywhere else. That is the whole
 * of the brand; a cast still forges one, which is true of every brand in this
 * repository and is the point rather than a gap -- a cast is a diff a reviewer
 * reads.
 */
const SETPOINT_CONFIRMATION: unique symbol = Symbol('merit.setpoint-confirmation');

/**
 * Evidence that ONE account's CURRENT risk floor was confirmed by the platform.
 *
 * THE BRAND IS `unique symbol` AND NOT A STRING LITERAL, so it cannot be
 * written by an object literal at all: there is no spelling of
 * `{ [SETPOINT_CONFIRMATION]: true, ... }` available outside this module,
 * because the symbol is module-local and is never exported. A cast still
 * forges one, which is true of every brand in this repository and is stated
 * here rather than left implied -- a cast is a diff a reviewer reads, and that
 * is the whole of what a brand buys.
 */
export interface SetpointConfirmation {
  readonly [SETPOINT_CONFIRMATION]: true;
  readonly accountId: string;
  readonly floorCents: bigint;
  readonly confirmedAt: Date;
}

/** What the exit is asked about. The floor is the ACCOUNT's, read, never derived. */
export interface AdmissionSubject {
  readonly accountId: string;
  /** `rule_states.floor_cents` for this account, as of now. Integer cents. */
  readonly currentFloorCents: bigint;
}

/**
 * `payload.risk_floor_cents`, back from `jsonb`.
 *
 * IT ACCEPTS A DECIMAL STRING AND A `bigint` AND REFUSES A `number`. The string
 * is what `renderPayload` writes and what `jsonb` gives back; the `bigint` is
 * for a caller holding an intent it has not stored yet. A `number` is refused
 * because a floor above 2^53 cents has already lost digits by the time it is
 * one, and there is no way to tell from here whether it did.
 */
function readFloorCents(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value !== 'string') return null;
  if (!/^-?(0|[1-9][0-9]*)$/.test(value)) return null;
  return BigInt(value);
}

/**
 * THE ONLY PRODUCER OF A `SetpointConfirmation`.
 *
 * Every clause is a refusal and the order does not matter, because there is no
 * short circuit that admits. `confirmed_inferred` is refused HERE as well as by
 * `provisioning_queue_set_risk_never_inferred` in the database; M02 section
 * 3.6.2 records that the CHECK names `set_risk` alone and that
 * `disable_account` and `disable_entitlement` may both reach it, so refusing
 * every status but `confirmed` for every operation is the form of the rule that
 * does not have to be extended when that finding is repaired.
 */
export function setpointConfirmation(
  subject: AdmissionSubject,
  row: ProvisioningRow,
): SetpointConfirmation | null {
  if (row.accountId !== subject.accountId) return null;
  if (row.operation !== 'set_risk') return null;
  if (row.status !== 'confirmed') return null;
  if (row.confirmedAt === null) return null;
  const floor = readFloorCents(row.payload[RISK_FLOOR_CENTS_FIELD]);
  if (floor === null) return null;
  if (floor !== subject.currentFloorCents) return null;
  return {
    [SETPOINT_CONFIRMATION]: true,
    accountId: subject.accountId,
    floorCents: floor,
    confirmedAt: row.confirmedAt,
  };
}

/**
 * Why an account is held out of trading. A closed set.
 *
 * THESE ARE DIAGNOSTIC AND THE DECISION DOES NOT REST ON THEM. `admitToTrading`
 * decides by whether evidence was produced; the classification below runs only
 * on the side that has already refused, so a bug in it changes what an operator
 * reads and cannot change whether an account trades.
 */
export const ADMISSION_REFUSALS = [
  /** No `provisioning_queue` row for this account at all. A brand new account. */
  'no_provisioning_row',
  /** Rows exist, none of them a `set_risk` naming the current floor. INV-M2-08's half. */
  'no_set_risk_for_current_floor',
  /** A `set_risk` names the current floor and has not reached `confirmed`. */
  'setpoint_not_confirmed',
] as const;

export type AdmissionRefusal = (typeof ADMISSION_REFUSALS)[number];

export type TradingAdmission =
  | { readonly admitted: true; readonly evidence: SetpointConfirmation }
  | {
      readonly admitted: false;
      readonly refusal: AdmissionRefusal;
      /** The statuses of every `set_risk` row naming the current floor. Possibly empty. */
      readonly observed: readonly ProvisioningStatus[];
    };

/**
 * `INV-M2-13`'s exit.
 *
 * THE SEED IS A REFUSAL AND THE LOOP HAS NO `else`. Read the two lines that
 * decide this function and nothing else does: `admission` starts refused, and
 * the only assignment to it is guarded by `evidence !== null`. Deleting the
 * loop entirely leaves an account out of trading; deleting the guard is a type
 * error, because `evidence` is `SetpointConfirmation | null` and the admitted
 * arm does not accept `null`.
 *
 * `rows` IS EVERY ROW FOR THE ACCOUNT AND THE CALLER OWES THAT. A filtered set
 * cannot make this function admit something it otherwise would not -- evidence
 * is evidence -- but it CAN make the diagnosis wrong, which is why the contract
 * is stated on `ProvisioningReadPort.rowsFor` rather than assumed here.
 */
export function admitToTrading(
  subject: AdmissionSubject,
  rows: readonly unknown[],
): TradingAdmission {
  let admission: TradingAdmission | null = null;
  const observed: ProvisioningStatus[] = [];
  let sawAnyRow = false;

  for (const raw of rows) {
    const row = readProvisioningRow(raw);
    if (row === null) continue;
    if (row.accountId !== subject.accountId) continue;
    sawAnyRow = true;

    if (
      row.operation === 'set_risk' &&
      readFloorCents(row.payload[RISK_FLOOR_CENTS_FIELD]) === subject.currentFloorCents
    ) {
      observed.push(row.status);
    }

    const evidence = setpointConfirmation(subject, row);
    if (evidence !== null) admission = { admitted: true, evidence };
  }

  if (admission !== null) return admission;

  const refusal: AdmissionRefusal = !sawAnyRow
    ? 'no_provisioning_row'
    : observed.length === 0
      ? 'no_set_risk_for_current_floor'
      : 'setpoint_not_confirmed';
  return { admitted: false, refusal, observed };
}
