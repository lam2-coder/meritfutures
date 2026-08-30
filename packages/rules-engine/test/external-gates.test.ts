// =============================================================================
// packages/rules-engine/test/external-gates.test.ts
// =============================================================================
// `resolveExternalGates`, WATCHED. `ADR-260`.
//
// **THIS FILE OWNS WHAT THE RESOLVER DOES WITH A VALUE AND NOT WHERE THE VALUE
// CAME FROM.** The column half is `apps/worker/test/account-day.test.ts` section
// 6, which moves one column at a time and reads one member; a case here that
// asserted a column would be asserting a fact this package cannot see, because
// `tsconfig.json` sets `types: []` and there is no `readFileSync` in scope at
// all. The document-and-migration half is `apps/api/test/external-gates.test.ts`,
// one deployable over, for the same reason (`ADR-254` finding 3).
//
// **THE FIVE ARE VETOES AND THAT IS WHY THE TOTALITY CASES ARE EXHAUSTIVE RATHER
// THAN SAMPLED.** `R-41` conjoins them, so a status the resolver silently
// admitted or a chain shape it silently accepted is a gate that never fires on
// the door where money leaves the firm. Every case below that enumerates a
// vocabulary enumerates all of it.
// =============================================================================

import { describe, expect, test } from 'vitest';

import type { ExternalGateFacts, ExternalGates, KycChainRow } from '../src/index.ts';
import {
  ExternalGatesRefusal,
  PAYOUT_IN_FLIGHT_STATUSES,
  resolveExternalGates,
} from '../src/index.ts';

const ACCOUNT = '0f8fad5b-d9cb-469f-a165-70867728950e';

/** Every leg clear. Each case overrides exactly the one it is about. */
function facts(overrides: Partial<ExternalGateFacts> = {}): ExternalGateFacts {
  return {
    accountId: ACCOUNT,
    accountStatus: 'active',
    identityPayoutsFrozen: false,
    accountPayoutsFrozen: false,
    reconBlocked: false,
    kycChain: [{ id: 'kyc-1', state: 'verified', supersedes: null }],
    payoutRequestStatuses: [],
    ...overrides,
  };
}

const CLEAR: ExternalGates = {
  accountStatus: 'active',
  kycState: 'verified',
  payoutsFrozen: false,
  reconBlocked: false,
  hasPayoutInFlight: false,
};

const refusalOf = (input: ExternalGateFacts): ExternalGatesRefusal => {
  try {
    resolveExternalGates(input);
  } catch (error) {
    if (error instanceof ExternalGatesRefusal) return error;
    throw error;
  }
  throw new Error('the facts resolved where a refusal was required');
};

// -----------------------------------------------------------------------------
// 1. The record
// -----------------------------------------------------------------------------

describe('1. the resolver returns a WHOLE `ExternalGates` and never a partial one', () => {
  test('1.1 the clear facts resolve to every member, compared at once', () => {
    // COMPARED AS A WHOLE VALUE rather than field by field, because a case
    // checking three members is green on a resolver that invented the other two,
    // and an invented member is the veto that never fires.
    expect(resolveExternalGates(facts())).toEqual(CLEAR);
  });

  test('1.2 and it carries FIVE members and no sixth', () => {
    // `types.ts` declares five. A resolver that grew a key would be putting a
    // fact into `rule_states.context_gates` that `SD-06` never declared.
    expect(Object.keys(resolveExternalGates(facts())).sort()).toEqual([
      'accountStatus',
      'hasPayoutInFlight',
      'kycState',
      'payoutsFrozen',
      'reconBlocked',
    ]);
  });
});

// -----------------------------------------------------------------------------
// 2. `accountStatus`: seven declared, six foldable, and the seventh REFUSES
// -----------------------------------------------------------------------------

describe('2. the seven-versus-six gap is a REFUSAL and never a widened union', () => {
  const SIX = ['active', 'breached', 'expired', 'closed_admin', 'closed_chargeback', 'graduated'];

  test('2.1 every one of the engine`s six is admitted and carried through', () => {
    for (const status of SIX)
      expect(
        resolveExternalGates(facts({ accountStatus: status })).accountStatus,
        `\`${status}\` is a member of \`AccountStatus\` and did not resolve`,
      ).toBe(status);
  });

  test('2.2 `provisioning_pending` REFUSES, naming the leg and the account', () => {
    // **THE TRAP.** `account_status` declares it and `AccountStatus` does not,
    // and `M01:203` carries the same six, so the engine transcribed its source
    // correctly. Widening the union to make this map total would amend a frozen
    // plan through a type; the resolver says so out loud instead.
    const refusal = refusalOf(facts({ accountStatus: 'provisioning_pending' }));

    expect(refusal.legs).toEqual(['accountStatus']);
    expect(refusal.accountId).toBe(ACCOUNT);
    expect(refusal.message).toContain('provisioning_pending');
    expect(refusal.message).toContain('AccountStatus');
  });

  test('2.3 and the refusal is not a value, which is the half a caller could get wrong', () => {
    // A resolver that answered `closed_admin` for a provisioning account would
    // deny a trader with a plausible-looking gate; one that answered `active`
    // would pay one. Neither is reachable, because nothing is returned at all.
    expect(() => resolveExternalGates(facts({ accountStatus: 'provisioning_pending' }))).toThrow(
      ExternalGatesRefusal,
    );
  });

  test('2.4 a member outside the SEVEN refuses too, and says the enum grew', () => {
    // The two findings are different and the messages differ. This one says
    // nobody swept this resolver; 2.2 says one known account is not foldable.
    const refusal = refusalOf(facts({ accountStatus: 'suspended' }));

    expect(refusal.legs).toEqual(['accountStatus']);
    expect(refusal.message).toContain('outside the seven members');
  });
});

// -----------------------------------------------------------------------------
// 3. `payoutsFrozen`: the OR, as a truth table
// -----------------------------------------------------------------------------

describe('3. `payoutsFrozen` is the identity`s OR the account`s, all four rows', () => {
  test('3.1 the truth table, exhaustively', () => {
    // FOUR ROWS AND NOT TWO. A resolver reading only one column passes any test
    // that varies the other one in isolation while the first stays false.
    const table: readonly (readonly [boolean, boolean, boolean])[] = [
      [false, false, false],
      [true, false, true],
      [false, true, true],
      [true, true, true],
    ];
    for (const [identity, account, expected] of table)
      expect(
        resolveExternalGates(
          facts({ identityPayoutsFrozen: identity, accountPayoutsFrozen: account }),
        ).payoutsFrozen,
        `identity=${String(identity)} account=${String(account)}`,
      ).toBe(expected);
  });

  test('3.2 `reconBlocked` is carried straight through and has no second source', () => {
    expect(resolveExternalGates(facts({ reconBlocked: true })).reconBlocked).toBe(true);
    expect(resolveExternalGates(facts({ reconBlocked: false })).reconBlocked).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// 4. `kycState`: the head of the chain, or a refusal
// -----------------------------------------------------------------------------

describe('4. the KYC leg reads the head SD-M19-01 declares and refuses when there is none', () => {
  const row = (id: string, state: string, supersedes: string | null = null): KycChainRow => ({
    id,
    state,
    supersedes,
  });

  test('4.1 a one-row chain is its own head', () => {
    expect(resolveExternalGates(facts({ kycChain: [row('a', 'pending')] })).kycState).toBe(
      'pending',
    );
  });

  test('4.2 the head is the row NOTHING supersedes, whatever the array order', () => {
    // **ORDER IS NOT THE PREDICATE AND THIS IS THE CASE THAT SAYS SO.** The same
    // two rows are handed over in both orders and the answer does not move,
    // because `kyc_verifications` declares no ordering and a reader that took
    // the last element would be inventing one.
    const initial = row('a', 'verified');
    const live = row('b', 'expired', 'a');

    expect(resolveExternalGates(facts({ kycChain: [initial, live] })).kycState).toBe('expired');
    expect(resolveExternalGates(facts({ kycChain: [live, initial] })).kycState).toBe('expired');
  });

  test('4.3 a chain three long resolves to the row at the end of it', () => {
    const chain = [row('a', 'verified'), row('b', 'expired', 'a'), row('c', 'verified', 'b')];

    expect(resolveExternalGates(facts({ kycChain: chain })).kycState).toBe('verified');
  });

  test('4.4 an EMPTY chain is `kyc_required`, which is a reading and not a default', () => {
    // The enum's own word for an identity that has never been verified, and the
    // answer both route readers give. It fails R-40's second gate, so it is the
    // refusing direction, and it is a fact about the rows rather than a value
    // chosen because they could not be read.
    expect(resolveExternalGates(facts({ kycChain: [] })).kycState).toBe('kyc_required');
  });

  test('4.5 TWO heads REFUSE rather than failing closed, and the message says why', () => {
    // **THE DIVERGENCE FROM `currentKycState`, DELIBERATE AND STATED.** Those two
    // readers answer `kyc_required` here, and on a door that DISPLAYS the value
    // to somebody who can act on it that is right. This value is folded into a
    // stored row, where `kyc_required` is indistinguishable from "we could not
    // tell", so the honest answer is a stop.
    const refusal = refusalOf(facts({ kycChain: [row('a', 'verified'), row('b', 'verified')] }));

    expect(refusal.legs).toEqual(['kycState']);
    expect(refusal.message).toContain('SD-M19-01');
    expect(refusal.message).not.toContain('kyc_required,');
  });

  test('4.6 ZERO heads, which is a cycle, refuses on the same leg', () => {
    const refusal = refusalOf(
      facts({ kycChain: [row('a', 'verified', 'b'), row('b', 'verified', 'a')] }),
    );

    expect(refusal.legs).toEqual(['kycState']);
  });

  test('4.7 duplicate ids refuse, because a live row cannot be told from a superseded one', () => {
    const refusal = refusalOf(
      facts({ kycChain: [row('a', 'verified'), row('a', 'expired', 'a')] }),
    );

    expect(refusal.legs).toEqual(['kycState']);
    expect(refusal.message).toContain('distinct ids');
  });

  test('4.8 every one of `kyc_status`s five members resolves, and a sixth refuses', () => {
    for (const state of ['kyc_required', 'pending', 'verified', 'rejected', 'expired'])
      expect(resolveExternalGates(facts({ kycChain: [row('a', state)] })).kycState).toBe(state);

    expect(refusalOf(facts({ kycChain: [row('a', 'in_review')] })).legs).toEqual(['kycState']);
  });
});

// -----------------------------------------------------------------------------
// 5. `hasPayoutInFlight`: R-38 at the ACCOUNT (ADR-254)
// -----------------------------------------------------------------------------

describe('5. the in-flight leg is the index predicate and refuses an unknown status', () => {
  test('5.1 no rows at all is false, which is the only leg where false is a reading', () => {
    expect(resolveExternalGates(facts({ payoutRequestStatuses: [] })).hasPayoutInFlight).toBe(
      false,
    );
  });

  test('5.2 each of the THREE statuses the index names is true, one at a time', () => {
    // ONE AT A TIME, because a set membership check green on two of three is a
    // veto that fires two thirds of the time.
    for (const status of PAYOUT_IN_FLIGHT_STATUSES)
      expect(
        resolveExternalGates(facts({ payoutRequestStatuses: [status] })).hasPayoutInFlight,
        `\`${status}\` is in the predicate and did not read as in flight`,
      ).toBe(true);
  });

  test('5.3 and each of the TWO it does not name is false', () => {
    for (const status of ['settled', 'failed'])
      expect(
        resolveExternalGates(facts({ payoutRequestStatuses: [status] })).hasPayoutInFlight,
        `\`${status}\` is outside the predicate and read as in flight`,
      ).toBe(false);
  });

  test('5.4 the predicate is the index`s three, in the index`s order', () => {
    // ASSERTED AS A SEQUENCE AND NOT AS A SET. `ADR-254` section 11 recorded a
    // seeded defect that survived a membership check, and the repair was to
    // compare the clause in order. The comparison against `0031` itself is one
    // deployable over, because this package cannot read a file.
    expect([...PAYOUT_IN_FLIGHT_STATUSES]).toEqual(['approved', 'frozen', 'held_pending_review']);
  });

  test('5.5 one in-flight row among many settled ones is still true', () => {
    const statuses = ['settled', 'settled', 'held_pending_review', 'failed'];

    expect(resolveExternalGates(facts({ payoutRequestStatuses: statuses })).hasPayoutInFlight).toBe(
      true,
    );
  });

  test('5.6 an unknown status REFUSES rather than reading as not-in-flight', () => {
    // **THE SECOND TRAP AND THE SAME SHAPE AS THE FIRST.** `transferring` is the
    // retired member `ADR-028` moved to `wallet_withdrawals`, and it stands in
    // here for the sixth member `payout_status` will one day gain. Treating an
    // unknown status as not-in-flight is R-38 stopping nobody.
    const refusal = refusalOf(facts({ payoutRequestStatuses: ['transferring'] }));

    expect(refusal.legs).toEqual(['hasPayoutInFlight']);
    expect(refusal.message).toContain('transferring');
  });

  test('5.7 more than one in-flight row is TRUE and not a refusal', () => {
    // `payout_requests_no_in_flight_uq` is UNIQUE and makes the second row
    // unwritable, so meeting two means the index is gone. The ANSWER is still
    // correct -- a payout is in flight either way -- and refusing would deny a
    // trader for a schema fault that already vetoes them.
    const statuses = ['approved', 'frozen'];

    expect(resolveExternalGates(facts({ payoutRequestStatuses: statuses })).hasPayoutInFlight).toBe(
      true,
    );
  });
});

// -----------------------------------------------------------------------------
// 6. No permissive default on any leg, and every failing leg at once
// -----------------------------------------------------------------------------

describe('6. R-41 conjoins five vetoes, so nothing here defaults', () => {
  test('6.1 three failing legs are reported together and in declaration order', () => {
    const refusal = refusalOf(
      facts({
        accountStatus: 'provisioning_pending',
        kycChain: [
          { id: 'a', state: 'verified', supersedes: null },
          { id: 'b', state: 'verified', supersedes: null },
        ],
        payoutRequestStatuses: ['transferring'],
      }),
    );

    expect(refusal.legs).toEqual(['accountStatus', 'kycState', 'hasPayoutInFlight']);
  });

  test('6.2 the refusal says why a default is not available, in the message', () => {
    // The message is what an operator meets, and the one thing they must not
    // conclude is that a conservative value would have been safer. `ADR-248`
    // section 8 ruled both directions unsafe and the message carries it.
    const refusal = refusalOf(facts({ accountStatus: 'provisioning_pending' }));

    expect(refusal.message).toContain('VETOES');
    expect(refusal.message).toContain('never fires');
    expect(refusal.message).toContain('while reading as a working gate');
  });

  test('6.3 a refusal on ONE leg does not return the other four', () => {
    // A partial record is not a smaller record: `ExternalGates` must carry every
    // member, so a resolver that returned four resolved legs and one invented
    // one would be strictly worse than this throw.
    expect(() => resolveExternalGates(facts({ payoutRequestStatuses: ['transferring'] }))).toThrow(
      ExternalGatesRefusal,
    );
  });

  test('6.4 the refusal is named, so a caller can catch it apart from a row error', () => {
    const refusal = refusalOf(facts({ accountStatus: 'provisioning_pending' }));

    expect(refusal.name).toBe('ExternalGatesRefusal');
    expect(refusal).toBeInstanceOf(Error);
  });
});
