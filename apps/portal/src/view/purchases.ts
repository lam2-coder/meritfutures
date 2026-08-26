// =============================================================================
// apps/portal/src/view/purchases.ts
// =============================================================================
// SC-M4-06, PURCHASE AND RESET. M04 section 3.1's one thing it must get right:
// "The rule diff when versions differ (SD-M4-02)."
//
// -----------------------------------------------------------------------------
// THE READ HALF ONLY, AND THE ABSENCE IS THE FENCE
// -----------------------------------------------------------------------------
// `GET /purchases` is here. `POST /checkout` and `POST /accounts/:accountId/
// reset` are not, and neither is the acknowledgement `SD-M4-02` exists to
// record. The column is `purchases.rule_diff_acknowledged_at` at 0006:173, no
// contract row exposes it, and capturing it is a WRITE on M03's ceremony
// (AS-M3-05). ADR-111 section 5 records the seam and declines to close it: a
// read slice that exposed the timestamp would be building half of somebody
// else's flow, and the half it built would be the half that cannot be tested.
//
// -----------------------------------------------------------------------------
// THE DIFF RENDERS BOTH SIDES AND NEVER A DIFFERENCE, WHICH IS INV-M4-01
// -----------------------------------------------------------------------------
// The natural way to write a rule diff is as a delta: the cap rose by 50,000c,
// the gap fell by two days. EVERY ONE OF THOSE DELTAS IS A MONEY VALUE COMPUTED
// CLIENT SIDE, which INV-M4-01 bans without qualification, and it is banned at
// the one place the subtraction looks harmless, which is where the invariant
// says the danger is ("`floor_distance_cents` ... the server's own subtraction
// ... INV-M4-01 at the one place the subtraction is most obviously harmless").
//
// So a changed rule renders `was` and `now`, each read straight off its own
// `PlanVersionResponse`, and there is no field a difference could be written
// into. It is also the better rendering: "it went up by 500" answers a question
// nobody asked, and "it was 3,000 and it is 3,500" is the fact the
// acknowledgement is about.
//
// -----------------------------------------------------------------------------
// THE WALK IS STRUCTURAL BECAUSE THE PORTAL DOES NOT KNOW THE RULE SCHEMA
// -----------------------------------------------------------------------------
// `PlanRules` is opaque here (../api/types.ts says why at length). A diff over
// a TYPED rule object can only compare the keys the type knows, so the day a
// rule gains a key the diff reports "nothing changed" about a contract that
// changed. An omission that reads as a positive claim is the worst failure
// available on this screen, because the screen exists to be the record of what
// the trader agreed to when they repurchased.
//
// So the walk is over the JSON itself, both directions, and a key present on
// one side and absent on the other is a CHANGE rather than a skip. `added` and
// `removed` are distinct from `changed` for the same reason a three-valued
// GateState exists one file over: collapsing them loses the difference between
// "this rule moved" and "this rule is new".

import type { JsonValue, PlanRules, PlanVersionResponse, PurchaseListItem } from '../api/types.ts';
import { formatCents } from '../format/money.ts';

// -----------------------------------------------------------------------------
// The purchase list
// -----------------------------------------------------------------------------

/** One row of the trader's own purchase history. `GET /purchases`. */
export type PurchaseRowView = {
  readonly purchase_id: string;
  readonly created_at: string;

  /** A reset is a repurchase onto a breached or expired account. */
  readonly kind: 'new' | 'reset';
  readonly plan: {
    readonly plan_id: string;
    readonly code: string;
    readonly version: number;
  };
  readonly size: string;
  readonly amount_paid: string;

  /** Rendered whether or not it is zero: a stated zero discount is a fact. */
  readonly discount: string;
  readonly status: PurchaseListItem['status'];

  /**
   * `true` when the money moved and did not come back. Read off the status
   * union and never off an amount, because a refunded purchase still carries
   * the amount that was paid, and reading the number would call it settled.
   */
  readonly settled: boolean;

  /**
   * Null until the purchase provisions an account, which is a real and
   * temporary state rather than a defect: `provisioning_pending` exists on the
   * account status union for the same window.
   */
  readonly account_id: string | null;
};

/** SC-M4-06's history half. */
export type PurchaseHistoryView = {
  readonly rows: readonly PurchaseRowView[];
};

function toPurchaseRow(item: PurchaseListItem): PurchaseRowView {
  return {
    purchase_id: item.purchase_id,
    created_at: item.created_at,
    kind: item.kind,
    plan: { plan_id: item.plan.plan_id, code: item.plan.code, version: item.plan.version },
    size: formatCents(item.size_cents),
    amount_paid: formatCents(item.amount_paid_cents),
    discount: formatCents(item.discount_cents),
    status: item.status,
    settled: item.status === 'paid',
    account_id: item.account_id,
  };
}

/**
 * The trader's purchase history.
 *
 * NO TOTAL IS COMPUTED AND THERE IS NOWHERE TO PUT ONE. Summing
 * `amount_paid_cents` across the list is the obvious next feature and it is
 * arithmetic on a money field, which INV-M4-01 bans. It is also a number the
 * server has never published, so the portal would be the first place a trader
 * could read their lifetime spend, computed by the client, from a page.
 *
 * ORDER IS THE SERVER'S. `GET /purchases` is a cursor list and its order is the
 * cursor's; re-sorting here would produce a page whose second screenful does
 * not follow its first.
 */
export function toPurchaseHistory(items: readonly PurchaseListItem[]): PurchaseHistoryView {
  return { rows: items.map(toPurchaseRow) };
}

// -----------------------------------------------------------------------------
// The rule diff (SD-M4-02, AS-M3-05)
// -----------------------------------------------------------------------------

/** What happened to one rule path between two versions. */
export type RuleChangeKind = 'changed' | 'added' | 'removed';

/**
 * One rule path that differs, with BOTH SIDES and no difference.
 *
 * The values are rendered as JSON text rather than as typed values, because the
 * portal does not know the rule schema and a renderer that guessed which leaves
 * were money would eventually guess wrong. A `_cents` leaf reaches the screen as
 * the integer the contract stores, which is the number a dispute is settled
 * against.
 */
export type RuleChangeView = {
  /** Dotted path into `plan_versions.rules`, for example `phase_funded.buffer_bp`. */
  readonly rule_path: string;
  readonly kind: RuleChangeKind;

  /** The pinned version's value, as JSON text. Null when the path is `added`. */
  readonly was: string | null;

  /** The new version's value, as JSON text. Null when the path is `removed`. */
  readonly now: string | null;
};

/**
 * SC-M4-06's differentiator: what changed between the contract the trader holds
 * and the one a reset would put them on.
 *
 * `differs` IS A FIELD RATHER THAN AN EMPTY-ARRAY CHECK. AS-M3-05 requires a
 * reset onto a CHANGED plan version to be explicitly acknowledged, so "the
 * versions are identical" and "the diff has not been computed" must not render
 * the same, exactly as the calendar panel refuses to let an uncovered week and
 * a quiet week produce one empty list.
 */
export type RuleDiffView = {
  readonly from: { readonly plan_version_id: string; readonly version: number };
  readonly to: { readonly plan_version_id: string; readonly version: number };

  /** True when the two versions are not the same version. */
  readonly versions_differ: boolean;

  /** True when any rule path differs. `versions_differ` can be true and this false. */
  readonly differs: boolean;

  /** Ordered by rule path, so two renders of one pair agree. */
  readonly changes: readonly RuleChangeView[];
};

function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every leaf path of a rule object, dotted.
 *
 * AN ARRAY IS A LEAF AND IS NOT WALKED INTO. `payout_cap_schedule` is "an array
 * from day one even though v1 has one step" (DATA_MODEL section 11), so its
 * meaning is positional: reporting `payout_cap_schedule.0.cap_bp` as a changed
 * path would be true and useless, because an inserted step renumbers every
 * later index and the diff would claim the whole schedule moved. The schedule
 * is one rule and it changed or it did not.
 *
 * AN EMPTY OBJECT IS ALSO A LEAF, so a rule block emptied between versions is
 * reported as a change to that block rather than vanishing from both sides.
 */
function leaves(value: JsonValue, prefix: string, out: Map<string, JsonValue>): void {
  if (isJsonObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > 0) {
      for (const key of keys) leaves(value[key]!, prefix === '' ? key : `${prefix}.${key}`, out);
      return;
    }
  }
  out.set(prefix, value);
}

function rulePaths(rules: PlanRules): Map<string, JsonValue> {
  const out = new Map<string, JsonValue>();
  leaves(rules as JsonValue, '', out);
  return out;
}

/**
 * The rule diff between the pinned version and the one a reset would buy.
 *
 * COMPARISON IS ON THE JSON TEXT OF EACH LEAF AND NOT ON THE VALUES. Two leaves
 * are equal when they serialise identically, which makes `5` and `5.0` unequal.
 * That is deliberate and it is `OI-29b`'s finding read from the other side: the
 * corpus already records that `jsonb::text` is not canonical over numbers, so
 * treating them as equal here would be the portal asserting a canonicalisation
 * the database does not perform. On a rule diff the safe direction is to
 * over-report: a spurious row is a question a trader asks, and a missed row is
 * a term they were never shown.
 *
 * IT DOES NOT REQUIRE THE TWO VERSIONS TO BE THE SAME PLAN. A reset onto a
 * different plan is a different contract in every respect, and refusing to diff
 * it would leave the screen with nothing to render at exactly the moment the
 * trader most needs the comparison.
 */
export function toRuleDiff(from: PlanVersionResponse, to: PlanVersionResponse): RuleDiffView {
  const before = rulePaths(from.rules);
  const after = rulePaths(to.rules);

  const changes: RuleChangeView[] = [];
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const had = before.has(path);
    const has = after.has(path);
    const was = had ? JSON.stringify(before.get(path)!) : null;
    const now = has ? JSON.stringify(after.get(path)!) : null;

    if (had && has) {
      if (was !== now) changes.push({ rule_path: path, kind: 'changed', was, now });
    } else if (has) {
      changes.push({ rule_path: path, kind: 'added', was: null, now });
    } else {
      changes.push({ rule_path: path, kind: 'removed', was, now: null });
    }
  }

  return {
    from: { plan_version_id: from.plan_version_id, version: from.version },
    to: { plan_version_id: to.plan_version_id, version: to.version },
    versions_differ: from.plan_version_id !== to.plan_version_id,
    differs: changes.length > 0,
    changes,
  };
}
