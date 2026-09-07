// =============================================================================
// apps/api/src/admin-source/pinned-plan.ts
// =============================================================================
// `EligibleFoldIo.resolvePinnedPlan`, SUPPLIED. `B5` TERM 1, AND THIS FILE IS
// THE WHOLE OF WHAT THE TERM TURNED OUT TO BE ONCE ITS DOOR EXISTED.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE IS NOT, WHICH IS THE PART THREE ENTRIES ARGUED ABOUT
// -----------------------------------------------------------------------------
// IT IS NOT A DECODER AND IT IS NOT A MAPPING. `ADR-411` section 10 and the
// dispatches after it refuse a second statement of the engine's
// `PlanVersionSizeRow` in this deployable, because that blob fixes every cents
// threshold a payout is decided against and two statements of it with nothing
// comparing them is `FM-16` on the money path. `test/admin-source-liability.test.ts`
// holds that census as a run, and this file is written to leave it at one:
// every value below is produced by `payout-backend.ts`'s own composition, which
// `ADR-416` exported and did not copy.
//
// SO THE BODY IS A DELEGATION AND THE FILE IS MOSTLY ITS REASON. That is the
// correct size for it. `ADR-411` priced this term at "one export and one call";
// `ADR-413` measured that false and found the missing piece was a `packages/db`
// door rather than either. **BOTH READINGS WERE RIGHT ABOUT THEIR OWN HALF**:
// once the door exists, the term really is one export and one call, and the
// reason it was not before is that the call had no handle to make it on.
//
// -----------------------------------------------------------------------------
// WHY THE HANDLE IS A PARAMETER AND NOT A DOOR
// -----------------------------------------------------------------------------
// `index.ts`'s ruling and `index.ts`'s reason: `ApiDb` declares no `system` door,
// `ADR-171` clause 1 refused to open one, and this directory names the unit of
// work it needs so that a deployment holding a door hands one in. The supplier
// below takes the transaction its caller is already inside rather than opening
// one of its own, which is the property that matters on a fold: the liability
// read walks the whole funded population, and a resolver that opened a
// transaction per account would be one transaction per account, on a door that
// reaches every row in the estate, to read rows that belong to nobody.
//
// `CatalogReadTx` IS A TYPE-ONLY IMPORT AND BUYS NO CAPABILITY. `test/db.test.ts`
// rules the distinction in its own words: a type-only import is deliberately not
// pinned, because "a type buys no capability ... and a case that failed on one
// would be asserting a house style rather than an authority". This file takes no
// value off `@merit/db`, opens nothing, and holds no reason word. The `elsewhere`
// assertion in that suite is what says so, and it is a run rather than this
// paragraph.
// =============================================================================

import type { CatalogReadTx } from '@merit/db';
import type { Cents, ResolvedPlan } from '@merit/rules-engine';

import { resolvePinnedPlan } from '../payout-backend.ts';
import type { EligibleFoldIo } from './eligible-next-7d.ts';

/**
 * {@link EligibleFoldIo} over one open transaction.
 *
 * THE HANDLE IS CAPTURED RATHER THAN PASSED THROUGH THE PORT, because the port
 * takes no transaction: `resolvePinnedPlan(planVersionId, sizeCents)` is its
 * whole signature, and `eligible-next-7d.ts` states the reason as the fold's
 * own, that the unit of work is the supplier's to hold. A composer inside
 * `AdminSourceBackend.operator` has exactly one to give it.
 *
 * **THE READ IS THE PAYOUT PATH'S OWN AND IS NOT RESTATED HERE.**
 * `resolvePinnedPlan` in `payout-backend.ts` reads `plan_versions` and
 * `plan_version_sizes` through `catalogRowAt`, decodes the blob with the
 * engine's `decodePlanRules`, maps the size row onto the engine's
 * `PlanVersionSizeRow` ONCE, and returns `resolvePlan(rules, sizeRow)`. What
 * this file adds is the handle and nothing else.
 *
 * **THE REFUSALS TRAVEL AND ARE NOT TRANSLATED.** A `plan_version_id` the
 * catalogue does not carry, and a `(version, size)` pair it does not publish,
 * are both `PayoutRowError` from that composition, and both are Merit's records
 * disagreeing with Merit's catalogue rather than a figure to substitute for. A
 * fold that swallowed either would report a liability over a population it
 * silently shrank, so nothing here catches them.
 */
export function pinnedPlanIo(tx: CatalogReadTx): EligibleFoldIo {
  return {
    resolvePinnedPlan: async (planVersionId: string, sizeCents: Cents): Promise<ResolvedPlan> =>
      resolvePinnedPlan(tx, planVersionId, sizeCents),
  };
}
