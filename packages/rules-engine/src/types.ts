// =============================================================================
// packages/rules-engine/src/types.ts
// =============================================================================
// The engine's public contract, and nothing else. OVERVIEW section 3:
//
//   (planConfigVersion, accountState, dayMarks[]) -> newState + events
//
// THE FIELD SETS BELOW ARE THE SCAFFOLD'S, NOT M01's. Every field named here is
// a column that exists in packages/db/migrations; the rest of each record is
// M01's to add when the engine is built. What the scaffold fixes is the SHAPE,
// because the shape is what stops being fixable once code depends on it.

// -----------------------------------------------------------------------------
// Scalars, branded so a number cannot be passed where a different number is meant
// -----------------------------------------------------------------------------
// "Money is integer cents; thresholds in basis points / integer cents. No
// floats in financial paths." A brand costs one cast at the boundary and buys a
// compile error every time cents are handed to something expecting basis
// points, which is a mistake that reads correctly in a diff.

/** A quantity of money. Integer cents, always. Never a float, never a string. */
export type Cents = number & { readonly __brand: 'Cents' };

/** One hundredth of one percent. The unit every ruled threshold is stated in. */
export type BasisPoints = number & { readonly __brand: 'BasisPoints' };

/**
 * A trading day, as it appears in `daily_marks.trading_day`.
 *
 * THE ENGINE NEVER DERIVES ONE. The trading day follows the exchange session
 * calendar and is maintained as data; deriving it from a clock inside this
 * package is the impurity `merit/engine-purity` exists to reject. It arrives on
 * a `DayMark` and is read from there.
 */
export type TradingDay = string & { readonly __brand: 'TradingDay' };

/** `accounts.id`. */
export type AccountId = string & { readonly __brand: 'AccountId' };

/** `plan_versions.id`. The version pinned to the account, which never changes. */
export type PlanVersionId = string & { readonly __brand: 'PlanVersionId' };

// -----------------------------------------------------------------------------
// TIER 1: FORBIDDEN BY SIGNATURE
// -----------------------------------------------------------------------------
// P1 section 2.3's first tier, and the only one of the three that is
// structural. The rule it implements is absolute and already written:
// "There is no plan parameter anywhere in application code: these are rows in
// `plan_versions.rules` and `plan_version_sizes`" (DATA_MODEL section 12), with
// M01 requiring every downstream surface to read from the account's pinned plan
// version at request time.
//
// The mechanism is that the engine's public type REQUIRES the full pinned
// config. No parameter field is optional, no default exists, and no
// `DEFAULT_CAP_BP` is declarable, because a caller who has not read the
// account's pinned plan version cannot construct this value at all. A missing
// field is a type error rather than a fallback.
//
// `PlanConfigVersionIsClosed` below is that claim made mechanical: it stops
// compiling the moment any field here becomes optional. Adding `cap_bp?: number`
// would otherwise look like a convenience and would silently reintroduce the
// defaulting this tier exists to prevent.

/**
 * The pinned plan configuration an evaluation runs against.
 *
 * M01 defines the parameter set. What is fixed here is that it is a CLOSED
 * record of required fields, carried by identity so an evaluation can always
 * name the version it was performed against.
 */
export interface PlanConfigVersion {
  readonly planVersionId: PlanVersionId;
}

/** `true` when `T` has no optional property, and `false` when it has one. */
type NoOptionalProperties<T> = T extends Required<T> ? true : false;

/**
 * `false` here is a compile error, which is the whole mechanism.
 *
 * It is written `false` rather than `never` on purpose: `never` satisfies every
 * constraint, so an assertion phrased against `never` passes in exactly the
 * case it exists to catch.
 */
type Assert<T extends true> = T;

/**
 * TIER 1, ASSERTED AT COMPILE TIME. If this line stops type-checking, a
 * parameter field was made optional and the defaulting DATA_MODEL section 12
 * forbids has become expressible.
 */
export type PlanConfigVersionIsClosed = Assert<NoOptionalProperties<PlanConfigVersion>>;

// -----------------------------------------------------------------------------
// The inputs
// -----------------------------------------------------------------------------

/**
 * One trading day's measurements for one account, as `daily_marks` records
 * them. Every field here is a column in `0014_marks.sql`.
 */
export interface DayMark {
  readonly tradingDay: TradingDay;
  readonly openingBalanceCents: Cents;
  readonly closingBalanceCents: Cents;
  readonly highBalanceCents: Cents;
  /** The breach comparison input: the day's low against the floor open at its start. */
  readonly lowBalanceCents: Cents;
  /** Signed. A movement, so it may be negative. */
  readonly realizedPnlCents: Cents;
  readonly fillCount: number;
  readonly tradedDay: boolean;
}

/**
 * The account as the engine sees it. Fields are columns on `accounts`.
 *
 * `planVersionId` never changes for the life of the account: it is the
 * retroactive-change protection, enforced by trigger in `0027` rather than by
 * convention, and it is carried here so an evaluation cannot be run against a
 * version the account is not pinned to.
 */
export interface AccountState {
  readonly accountId: AccountId;
  readonly planVersionId: PlanVersionId;
  readonly sizeCents: Cents;
}

// -----------------------------------------------------------------------------
// The outputs
// -----------------------------------------------------------------------------

/**
 * Something the evaluation decided, emitted rather than written.
 *
 * The engine performs no I/O, so it does not persist an event; it returns one
 * and the caller writes it. M01 defines the event set, and `type` is a string
 * here rather than a union for exactly as long as that set is unwritten.
 */
export interface EngineEvent {
  readonly type: string;
  readonly tradingDay: TradingDay;
}

/** The whole of what an evaluation reads. Nothing else is in scope. */
export interface EngineInput {
  readonly planConfigVersion: PlanConfigVersion;
  readonly accountState: AccountState;
  readonly dayMarks: readonly DayMark[];
}

/** The whole of what an evaluation produces. */
export interface EngineResult {
  readonly newState: AccountState;
  readonly events: readonly EngineEvent[];
}
