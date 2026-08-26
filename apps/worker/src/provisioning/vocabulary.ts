// =============================================================================
// apps/worker/src/provisioning/vocabulary.ts
// =============================================================================
// THE TWO CLOSED SETS THE DATABASE ALREADY CLOSES, TRANSCRIBED ONCE AND BOUND
// TO THEIR MIGRATIONS BY THE SUITE RATHER THAN BY A COMMENT.
//
// `provisioning_queue.operation` is bare `text` with a SEVEN-VALUE CHECK and
// `provisioning_queue.status` is the `provisioning_status` ENUM. The asymmetry
// is `0007`'s and `schema.ts:3501` transcribes it as found; it is inherited
// here for the same reason, because a module that "tidied" one of the two into
// the other's shape would be a module disagreeing with the column it writes.
//
// TWO STATEMENTS OF ONE FACT IS THE HAZARD ADR-092 SECTION 5 NAMES, AND IT IS
// CLOSED THE WAY ADR-102 CLOSED ITS OWN: `test/provisioning.test.ts` READS
// `packages/db/migrations/0001_extensions_and_enums.sql` and
// `packages/db/migrations/0007_accounts.sql` and compares both lists member for
// member, in both directions. A member added to a migration and not to this
// file fails there, and so does the reverse. Nothing below is checked by
// reading it.

/**
 * `provisioning_queue.operation`'s CHECK list, in the migration's own order.
 *
 * SEVEN, AND THE COUNT IS THE INTERESTING PART RATHER THAN THE MEMBERS. Only
 * two of the seven are the inverse of another (`disable_account` of
 * `create_account`, `disable_entitlement` of `set_entitlement`), which is what
 * `compensation.ts` is about and is why this module's safety rests on its exit
 * rather than on its compensation.
 */
export const PROVISIONING_OPERATIONS = [
  'create_user',
  'create_account',
  'set_risk',
  'set_entitlement',
  'set_permissions',
  'disable_account',
  'disable_entitlement',
] as const;

export type ProvisioningOperation = (typeof PROVISIONING_OPERATIONS)[number];

/**
 * The `provisioning_status` enum, in `0001`'s declared order.
 *
 * `confirmed` AND `confirmed_inferred` ARE NOT SYNONYMS AND THE WHOLE MODULE
 * TURNS ON IT. M02 section 3.2: an inferred confirmation means we believe the
 * account exists because the vendor reported on it, which is strong for
 * `create_account` and worthless for `set_risk`. `admission.ts` accepts
 * `confirmed` as evidence and NOTHING ELSE, for every operation.
 */
export const PROVISIONING_STATUSES = [
  'queued',
  'written',
  'delivered',
  'confirmed',
  'confirmed_inferred',
  'failed',
] as const;

export type ProvisioningStatus = (typeof PROVISIONING_STATUSES)[number];

/**
 * An operation read out of a row, narrowed.
 *
 * A ROW REACHES THIS MODULE AS `unknown`, because that is what the accessor
 * returns: `SystemTx.rows` is `Promise<unknown[]>`. So the narrowing happens
 * once, at this boundary, and everything downstream is total over the seven
 * members. An unrecognised operation is NOT coerced to anything.
 */
export function isProvisioningOperation(value: unknown): value is ProvisioningOperation {
  return (
    typeof value === 'string' &&
    (PROVISIONING_OPERATIONS as readonly string[]).includes(value)
  );
}

/**
 * A status read out of a row, narrowed.
 *
 * A ROW REACHES THIS MODULE AS `unknown[]`, because that is what the accessor
 * returns (`SystemTx.rows` is `Promise<unknown[]>`). So the narrowing happens
 * once, here, and everything downstream is total over the six members. An
 * unrecognised status is NOT coerced to anything: `admission.ts` refuses it,
 * which is the fail-closed direction.
 */
export function isProvisioningStatus(value: unknown): value is ProvisioningStatus {
  return (
    typeof value === 'string' && (PROVISIONING_STATUSES as readonly string[]).includes(value)
  );
}
