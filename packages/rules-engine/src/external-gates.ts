// =============================================================================
// packages/rules-engine/src/external-gates.ts
// =============================================================================
// `ExternalGates`, RESOLVED FROM COLUMN VALUES. THE FIVE FACTS `R-41` CONJOINS
// AS VETOES ON THE DOOR WHERE MONEY LEAVES THE FIRM.
//
// This file computes NO RULE. `evaluatePayout` is where `R-40` and `R-41` live
// and this function does not touch them: it takes the raw values four tables
// hold, narrows them into the two unions `types.ts` declares, and either
// returns a whole `ExternalGates` or REFUSES BY LEG. Nothing here defaults.
//
// -----------------------------------------------------------------------------
// 1. WHY IT IS HERE AND NOT IN THE DEPLOYABLE THAT READS THE ROWS
// -----------------------------------------------------------------------------
// `gates-codec.ts` settled this question one field over and the argument is the
// same one unchanged. TWO deployables need this one predicate: the worker builds
// an `AccountDay.external` for the nightly fold (`apps/worker/src/batch/ports.ts`)
// and the API builds a `PayoutSubject.gates` for the payout route
// (`apps/api/src/routes/payouts.ts`). `apps/api` cannot import `apps/worker`, and
// this package declares NO workspace dependency at all, so it is the only place
// both arrows already point. A resolver in each would be `FM-16` by name: two
// statements of one predicate with nothing comparing them.
//
// AND THE ESTATE ALREADY HOLDS THAT DEFECT ONE LEG DOWN, WHICH IS THE EVIDENCE
// RATHER THAN THE ANALOGY. `currentKycState` is written out TWICE in
// `apps/api/src/routes/` -- once in `accounts.ts` and once in
// `wallet-withdrawals.ts` -- because a route module importing another route
// module is an edge that directory has decided it will not have. A third copy
// here would be the shape this file exists to stop.
//
// THIS PACKAGE PERFORMS NO I/O AND THIS FILE DOES NOT CHANGE THAT. `tsconfig.json`
// sets `types: []`, so `readFileSync`, `fetch` and `process` do not exist in this
// package at all. Every value below arrives as an argument. The CALLER reads the
// rows, which is what `types.ts` has always said of this record -- "Every field
// is resolved by the CALLER" -- and what this file gives the caller is the
// narrowing rather than the read.
//
// -----------------------------------------------------------------------------
// 2. THE FIVE FACTS AND THEIR COLUMNS
// -----------------------------------------------------------------------------
// | member              | column                                                |
// |---------------------|-------------------------------------------------------|
// | `payoutsFrozen`     | `identities.payouts_frozen` OR `accounts.payouts_frozen`|
// | `reconBlocked`      | `accounts.recon_blocked`, no identity half             |
// | `kycState`          | head of the supersession chain over `kyc_verifications`|
// | `accountStatus`     | `accounts.status`                                     |
// | `hasPayoutInFlight` | `payout_requests.status` for THIS ACCOUNT (ADR-254)   |
//
// -----------------------------------------------------------------------------
// 3. THERE IS NO PERMISSIVE DEFAULT ON ANY LEG, AND THAT IS THE WHOLE FILE
// -----------------------------------------------------------------------------
// `R-41` conjoins all five, so EVERY ONE OF THEM IS A VETO. A fact defaulted to
// the permissive value is a veto that never fires: `payoutsFrozen: false` on a
// row nobody could read pays a trader an investigation had frozen, and
// `hasPayoutInFlight: false` on an unreadable status pays a second time. So a
// value this function cannot derive is a REFUSAL and never a `false`.
//
// THE REFUSING DEFAULT IS NOT SAFE EITHER AND `ADR-248` SECTION 8 SAID SO FIRST:
// it "would deny every eligible trader while reading as a working gate". That is
// why the failure here is a THROW rather than a conservative value. A refusal is
// visible; a conservative value is a silent denial with a plausible shape.
//
// -----------------------------------------------------------------------------
// 4. THE TRAP: `account_status` DECLARES SEVEN AND `AccountStatus` TAKES SIX
// -----------------------------------------------------------------------------
// `0001_extensions_and_enums.sql` declares `account_status` with SEVEN members
// and `AccountStatus` in `types.ts` takes SIX. The difference is
// `provisioning_pending`, in that direction only, and `M01:203` carries the same
// six, SO THE ENGINE TRANSCRIBED ITS SOURCE CORRECTLY AND THE GAP IS THE
// CORPUS'S.
//
// **THE UNION IS NOT WIDENED TO MAKE THIS MAP TOTAL.** Widening it would amend a
// frozen plan through a type, and it would do so by deciding -- in a narrowing
// function nobody reads twice -- what a half-provisioned account is worth to
// `R-40`'s first gate. An account still being provisioned is not an account
// whose payout verdict is meaningful, and this file says so out loud instead.
//
// `IdentityStatus` in `apps/api/src/routes/payouts.ts` is the same shape decided
// the same way: the predicate there is `= 'active'` "precisely so that a fourth
// arriving later fails CLOSED on this door rather than open".
//
// -----------------------------------------------------------------------------
// 5. THE THREE CLOSED VOCABULARIES ARE DECLARED ONCE AND COMPARED BY THE SUITE
// -----------------------------------------------------------------------------
// `ADR-254` section 8 finding 4 named the cost: the in-flight status set is
// written out in five places and "nothing pins the resolver that does not exist
// yet", with the cheapest control being that it import a constant rather than a
// literal. `PAYOUT_IN_FLIGHT_STATUSES` is that constant. It is a SIXTH copy of
// the set and it is the first one with a comparator: `apps/api/test/`
// external-gates-resolver reads `payout_requests_no_in_flight_uq`'s predicate
// out of `0031` and compares it to this array, in order.
//
// The comparison lives in a suite one deployable over and not here for the
// reason `ADR-254` finding 3 established: every claim of that kind is read out
// of a FILE, this package has no `readFileSync`, and the boundary is right.
// =============================================================================

import type { AccountStatus, ExternalGates, KycState } from './types.ts';

/**
 * `account_status`, `0001`'s enum, ALL SEVEN MEMBERS.
 *
 * DECLARED IN FULL RATHER THAN AS THE SIX THE ENGINE ACCEPTS, because a status
 * this file did not recognise and a status it recognises and refuses are
 * different findings and the messages have to differ. The first says the
 * database grew a member nobody swept; the second says one known account is
 * not foldable today.
 */
const ACCOUNT_STATUS_COLUMN = [
  'provisioning_pending',
  'active',
  'breached',
  'expired',
  'closed_admin',
  'closed_chargeback',
  'graduated',
] as const;

/**
 * The member `account_status` has and `AccountStatus` does not.
 *
 * SECTION 4. This is the refusal the engine's union owes, named once so the
 * suite can assert it is REFUSED rather than admitted.
 */
const REFUSED_ACCOUNT_STATUS = 'provisioning_pending';

/** `kyc_status`, `0001`'s enum. Identical to `KycState`, and compared by the suite. */
const KYC_STATE_COLUMN = ['kyc_required', 'pending', 'verified', 'rejected', 'expired'] as const;

/**
 * `payout_status`, `0001`'s four plus `0030`'s `held_pending_review`.
 *
 * READ AS A CLOSED SET SO THAT AN UNKNOWN MEMBER REFUSES. A status outside this
 * list means the enum grew and nobody swept the in-flight predicate, and the
 * failure mode of treating it as not-in-flight is the exact shape section 3
 * bans: a new outstanding state would read as `false` and R-38 would stop
 * nobody.
 */
const PAYOUT_REQUEST_STATUSES = [
  'approved',
  'settled',
  'failed',
  'frozen',
  'held_pending_review',
] as const;

/**
 * `payout_requests_no_in_flight_uq`'s PREDICATE, and `R-38` at the ACCOUNT.
 *
 * `ADR-254` ruled the grain: `hasPayoutInFlight` is true when a row in one of
 * these statuses exists FOR THE SUBJECT ACCOUNT, and it is never the identity's.
 * `ADR-019`'s one-in-flight-per-identity rule is the EXTERNAL leg's, its object
 * is `wallet_withdrawals`, and it does not read this field.
 *
 * THE ORDER IS THE INDEX'S ORDER AND THE SUITE COMPARES IT AS A SEQUENCE, not as
 * a set: `ADR-254` section 11 recorded a seeded defect that survived a
 * membership check, and the repair was to compare the predicate clause in order.
 */
export const PAYOUT_IN_FLIGHT_STATUSES = ['approved', 'frozen', 'held_pending_review'] as const;

/** One `kyc_verifications` row, as the chain head needs to see it. `SD-M19-01`. */
export interface KycChainRow {
  readonly id: string;
  /** `kyc_verifications.state`, RAW. This file narrows it; the caller does not. */
  readonly state: string;
  /** `NULL` on an initial verification, the superseded row's id on a re-verification. */
  readonly supersedes: string | null;
}

/**
 * The column values an `ExternalGates` is resolved from.
 *
 * **EVERY MEMBER IS THE RAW COLUMN AND NOT A NARROWED ONE.** A caller that
 * narrowed `accounts.status` before this call would be the second place the
 * seven-versus-six question is answered, which is the defect this file exists to
 * hold in one place. The reads are the caller's; the readings are this file's.
 */
export interface ExternalGateFacts {
  /** The subject account, carried so a refusal locates itself. */
  readonly accountId: string;
  /** `accounts.status`, RAW. Seven members are possible and six are foldable. */
  readonly accountStatus: string;
  /** `identities.payouts_frozen`, the OWNER's flag. */
  readonly identityPayoutsFrozen: boolean;
  /** `accounts.payouts_frozen`, the ACCOUNT's flag. Both exist and both veto. */
  readonly accountPayoutsFrozen: boolean;
  /** `accounts.recon_blocked`. There is no identity half of this one. */
  readonly reconBlocked: boolean;
  /** EVERY `kyc_verifications` row of the OWNING IDENTITY, superseded ones included. */
  readonly kycChain: readonly KycChainRow[];
  /** The `status` of EVERY `payout_requests` row of the SUBJECT ACCOUNT. */
  readonly payoutRequestStatuses: readonly string[];
}

/**
 * A fact `R-41` conjoins as a veto could not be derived, so no gates were built.
 *
 * IT CARRIES THE LEGS RATHER THAN A SENTENCE, because the caller meeting this is
 * an operator holding an account id who needs to know which of five columns to
 * look at, and because a suite asserting the refusal should not have to match
 * prose.
 */
export class ExternalGatesRefusal extends Error {
  /** The members of `ExternalGates` that could not be derived. */
  readonly legs: readonly string[];

  /** The account the facts were read for. */
  readonly accountId: string;

  // ASSIGNED RATHER THAN DECLARED IN THE PARAMETER LIST, on `EngineGatesCodecError`'s
  // own reason: ADR-083 runs every deployable under `node --experimental-strip-types`,
  // and a TypeScript parameter property is `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at
  // load time while `tsc --noEmit` accepts it, so the failure is invisible to CI-01.
  constructor(accountId: string, legs: readonly string[], why: readonly string[]) {
    super(
      `ExternalGates cannot be resolved for account ${accountId}: ${why.join('; ')}. ` +
        `R-41 conjoins all five as VETOES, so ${legs.length === 1 ? 'this leg' : 'these legs'} ` +
        'cannot take a default: a permissive value is a veto that never fires and a refusing ' +
        'value denies an eligible trader while reading as a working gate. The refusal is ' +
        'visible and neither default is',
    );
    this.name = 'ExternalGatesRefusal';
    this.legs = legs;
    this.accountId = accountId;
  }
}

/** Whether `value` is one of `allowed`, as a type guard over a literal tuple. */
function oneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

/**
 * One leg, read or refused.
 *
 * **DISCRIMINATED ON A TAG AND NOT ON `typeof`**, which is a correctness point
 * rather than a style one here: `AccountStatus` and `KycState` are both strings
 * and so is a refusal message, so a union of the two would be told apart by
 * asking whether the message happened to be a vocabulary member. That is a
 * comparison that answers correctly today for a reason no type checker holds.
 */
type Leg<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: string };

const read = <T>(value: T): Leg<T> => ({ ok: true, value });
const refuse = <T>(why: string): Leg<T> => ({ ok: false, why });

/**
 * `R-40`'s first gate's input: `accounts.status`, narrowed to the engine's six.
 *
 * SECTION 4 IS THIS FUNCTION. `provisioning_pending` is REFUSED BY NAME and the
 * union is not widened to admit it.
 */
function accountStatusOf(raw: string): Leg<AccountStatus> {
  if (raw === REFUSED_ACCOUNT_STATUS)
    return refuse(
      `\`accounts.status\` is \`${REFUSED_ACCOUNT_STATUS}\`, which \`account_status\` declares ` +
        "and `AccountStatus` does not. The engine's six are M01 section 2.1's own, so the union " +
        'is NOT widened here to make this map total: an account still being provisioned is not ' +
        'an account whose payout verdict is meaningful, and deciding what it is worth to R-40 ' +
        'is an amendment to a frozen plan rather than a line in a resolver',
    );
  if (!oneOf(raw, ACCOUNT_STATUS_COLUMN))
    return refuse(
      `\`accounts.status\` is \`${raw}\`, which is outside the seven members ` +
        '`account_status` declares. The enum grew and nothing swept this resolver',
    );
  // EVERY MEMBER OF THE COLUMN EXCEPT THE ONE ABOVE IS A MEMBER OF THE UNION,
  // which is the whole content of "seven versus six", and the suite derives both
  // sides out of their own sources rather than trusting this line.
  return read(raw as AccountStatus);
}

/**
 * The identity's current verification state: the chain row NOTHING SUPERSEDES.
 *
 * **A RE-VERIFICATION IS A NEW ROW AND NOT A RE-READ** (`SD-M19-01`,
 * `INV-M19-06`), so the caller hands over the whole chain and the head is a
 * property of the rows rather than of an ordering.
 *
 * **NO ROW AT ALL IS `kyc_required`, WHICH IS A READING AND NOT A DEFAULT.** It
 * is the enum's own word for an identity that has never been verified, and it
 * is the answer both existing readers give.
 *
 * **A CHAIN WHOSE HEAD CANNOT BE NAMED REFUSES, AND THIS IS WHERE THIS FILE
 * DIVERGES FROM THE TWO ROUTE READERS ON PURPOSE.** `currentKycState` in
 * `routes/accounts.ts` and in `routes/wallet-withdrawals.ts` both answer
 * `kyc_required` when the live set is not a singleton, and on those doors that
 * is right: the value is being DISPLAYED to a person who can act on it, and
 * "you need to verify" is a true thing to tell somebody whose chain is
 * ambiguous. Here the value is folded into a stored row and a payout verdict,
 * where `kyc_required` is indistinguishable from `we could not tell`. So this
 * leg refuses, on `ADR-258` section 6's precedent for the settlement-lag key:
 * the honest half of an unreadable input is a stop with the reason in it.
 */
function kycStateOf(chain: readonly KycChainRow[]): Leg<KycState> {
  if (chain.length === 0) return read('kyc_required');

  const ids = new Set(chain.map((row) => row.id));
  if (ids.size !== chain.length)
    return refuse(
      `the ${String(chain.length)} \`kyc_verifications\` rows carry ` +
        `${String(ids.size)} distinct ids, so a superseded row cannot be told from a live one`,
    );

  const superseded = new Set(
    chain.map((row) => row.supersedes).filter((id): id is string => id !== null),
  );
  const live = chain.filter((row) => !superseded.has(row.id));
  if (live.length !== 1)
    return refuse(
      `${String(live.length)} of ${String(chain.length)} \`kyc_verifications\` rows are ` +
        'superseded by nothing, and SD-M19-01 makes the head the row NOTHING supersedes. A head ' +
        'chosen from more than one would be an ordering this table does not declare, and zero ' +
        'is a cycle. Reporting somebody verified on either basis is the door where that means ' +
        'paying them',
    );

  const head = live[0];
  if (head === undefined || !oneOf(head.state, KYC_STATE_COLUMN))
    return refuse(
      `the head of the chain carries state \`${head?.state ?? ''}\`, which is outside the five ` +
        'members `kyc_status` declares',
    );
  return read(head.state);
}

/**
 * `R-38` AT THE ACCOUNT (`ADR-254`), read off the statuses of the account's own rows.
 *
 * **AN UNKNOWN STATUS REFUSES RATHER THAN READING AS NOT-IN-FLIGHT.** The
 * vocabulary has already moved twice on this table (`ADR-028` retired
 * `transferring`, `ADR-040` added `held_pending_review`), so a sixth member
 * arriving is the likely future rather than the paranoid one, and the quiet
 * failure is the expensive direction: a new outstanding state would read `false`
 * and R-38 would stop nobody.
 *
 * **MORE THAN ONE IN-FLIGHT ROW IS `true` AND NOT A REFUSAL.**
 * `payout_requests_no_in_flight_uq` is UNIQUE and makes the second row
 * unwritable, so meeting two means the index is gone; but the ANSWER is still
 * correct, because a payout is in flight either way. The index defect is not
 * this gate's to report and refusing here would deny a trader for a schema fault
 * that already vetoes them.
 */
function hasPayoutInFlightOf(statuses: readonly string[]): Leg<boolean> {
  const unknown = statuses.filter((status) => !oneOf(status, PAYOUT_REQUEST_STATUSES));
  if (unknown.length > 0)
    return refuse(
      `\`payout_requests.status\` carries ` +
        `${[...new Set(unknown)].map((one) => `\`${one}\``).join(', ')} for this account, which ` +
        `is outside {${PAYOUT_REQUEST_STATUSES.join(', ')}}. A status this resolver does not know ` +
        'cannot be classified in flight or not, and treating it as not would be R-38 stopping ' +
        'nobody',
    );
  return read(statuses.some((status) => oneOf(status, PAYOUT_IN_FLIGHT_STATUSES)));
}

/**
 * The five facts, resolved, or a refusal naming every leg that could not be.
 *
 * **EVERY LEG IS EVALUATED BEFORE ANY OF THEM REFUSES, AND THE ORDER IS THE
 * CLAIM.** A function that threw on the first bad column would send an operator
 * back four times for four columns of one account; `R-41` conjoins all five, so
 * the useful report is the whole set at once. That is `ADR-258` section 5's
 * shape applied one level down: the refusal is a MEASUREMENT of what resolved
 * rather than a claim about what did not.
 *
 * **IT COMPUTES NO RULE.** `evaluatePayout` owns `R-40` and `R-41`; nothing here
 * decides whether a gate passes. What this returns is the record that function
 * takes, and the reason it is a function rather than a literal at each call site
 * is that a literal must carry every member and an invented member is a veto
 * that never fires.
 */
export function resolveExternalGates(facts: ExternalGateFacts): ExternalGates {
  const accountStatus = accountStatusOf(facts.accountStatus);
  const kycState = kycStateOf(facts.kycChain);
  const hasPayoutInFlight = hasPayoutInFlightOf(facts.payoutRequestStatuses);

  // THE GUARD IS ONE `if` OVER THREE LEGS RATHER THAN THREE SEPARATE ONES, and
  // that is what makes the three `.value` reads below type-check without a cast:
  // after this block every leg is narrowed to its `ok` arm by the compiler, so a
  // fourth leg added later cannot be read past a refusal it forgot to join.
  if (!accountStatus.ok || !kycState.ok || !hasPayoutInFlight.ok) {
    const legs: string[] = [];
    const why: string[] = [];
    if (!accountStatus.ok) {
      legs.push('accountStatus');
      why.push(`accountStatus: ${accountStatus.why}`);
    }
    if (!kycState.ok) {
      legs.push('kycState');
      why.push(`kycState: ${kycState.why}`);
    }
    if (!hasPayoutInFlight.ok) {
      legs.push('hasPayoutInFlight');
      why.push(`hasPayoutInFlight: ${hasPayoutInFlight.why}`);
    }
    throw new ExternalGatesRefusal(facts.accountId, legs, why);
  }

  // THE TWO BOOLEAN LEGS CANNOT REFUSE HERE AND THAT IS THE COLUMNS' DOING
  // RATHER THAN AN OVERSIGHT: both are `boolean NOT NULL DEFAULT false`, so a row
  // that exists carries one, and a row that does not exist never reaches this
  // function because the caller's read refuses first.
  //
  // `payoutsFrozen` IS THE ACCOUNT'S OR THE IDENTITY'S AND THE OR IS THE WHOLE
  // FACT. `types.ts` calls the member "account level OR identity level, already
  // resolved", and an account rendered `false` while its owner is frozen would
  // be a gate saying this account can be paid when the investigation says it
  // cannot.
  return {
    accountStatus: accountStatus.value,
    kycState: kycState.value,
    payoutsFrozen: facts.identityPayoutsFrozen || facts.accountPayoutsFrozen,
    reconBlocked: facts.reconBlocked,
    hasPayoutInFlight: hasPayoutInFlight.value,
  };
}
