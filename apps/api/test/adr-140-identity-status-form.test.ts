import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { IDENTITY_RESTRICTED as CHECKOUT_IDENTITY_RESTRICTED } from '../src/routes/checkout.ts';
import {
  IDENTITY_RESTRICTED as PAYOUT_IDENTITY_RESTRICTED,
  gateIdentityStatus as payoutGate,
} from '../src/routes/payouts.ts';
import {
  IDENTITY_RESTRICTED as WITHDRAWAL_IDENTITY_RESTRICTED,
  IDENTITY_STATUSES,
  gateIdentityStatus as withdrawalGate,
} from '../src/routes/wallet-withdrawals.ts';

// CI-02, the `unit` project. ADR-140 clause 4, ADR-243.
//
// =============================================================================
// WHAT THIS FILE ASSERTS, AND WHY IT DID NOT EXIST BEFORE
// =============================================================================
// ADR-140 clause 4: "The predicate is `status === 'active'` and NOT an
// enumeration of what is refused, so it covers `closed` as well as `restricted`
// and continues to cover whatever the enum gains next."
//
// THE SECOND HALF OF THAT SENTENCE HAD NO ASSERTION ANYWHERE IN THIS TREE AND
// NO SUITE COULD HAVE CAUGHT IT LOSING. `identity_status` has three members
// (`0001_extensions_and_enums.sql:27`), and every case that drove this door
// drove `restricted` and `closed`, which is the whole of what is refused today.
// A predicate rewritten as `status !== 'restricted' && status !== 'closed'`
// passes every one of them, passes `payouts.test.ts`'s "admits `active` and
// only `active`", and then FAILS OPEN on the first migration that adds a fourth
// member, at four doors that move money.
//
// FOUR FILES SAY IT IN PROSE AND ADR-042 ALREADY RULED THAT PROSE IS NOT A
// CONTROL. `checkout.ts`'s `gateWalletSpend` docblock states it at length --
// "An enumeration of the refused values is one migration away from admitting a
// fourth `identity_status` member to a door that moves value" -- and states it
// in a comment, which cannot fail. This file is that sentence made able to.
//
// WHAT IT DOES NOT ASSERT. Nothing about WHICH values `identity_status` should
// hold; nothing about ORDER, because ADR-140 clause 1's "evaluated BEFORE
// anything about the account is read" is a different claim and
// `payouts.test.ts` holds it; and nothing about the two doors' bodies beyond
// the status predicate itself. It asserts the SHAPE OF THE PREDICATE at every
// money door that reads `identities.status`, and that the set of such doors is
// the set listed here.
// =============================================================================

const ROOT = join(import.meta.dirname, '..', '..', '..');
const ROUTES = join(ROOT, 'apps', 'api', 'src', 'routes');

/**
 * A value `identity_status` does not hold today.
 *
 * IT IS NOT A MEMBER AND THAT IS THE POINT, so it is cast at the call boundary
 * rather than added to the union. The union is the compile-time half of this
 * control and it is not weakened here; what is under test is the RUNTIME
 * predicate, which is what a fourth enum member arrives through.
 */
const FOURTH = 'suspended';

/** A `FastifyReply` shaped just enough for a `Refusal` to render into. */
function recordingReply(): {
  reply: unknown;
  seen: { status?: number; body?: Record<string, unknown> };
} {
  const seen: { status?: number; body?: Record<string, unknown> } = {};
  const reply = {
    code(status: number) {
      seen.status = status;
      return reply;
    },
    type() {
      return reply;
    },
    send(body: Record<string, unknown>) {
      seen.body = body;
      return reply;
    },
  };
  return { reply, seen };
}

// -----------------------------------------------------------------------------
// 0. NON-VACUITY. The enum is three members, so `FOURTH` really is outside it
// -----------------------------------------------------------------------------
// If this leg goes red because a fourth member landed, the rest of the file is
// what says whether the doors survived it. That is the whole design.

test('`identity_status` holds exactly the three members the doors were written against', () => {
  const ddl = readFileSync(
    join(ROOT, 'packages', 'db', 'migrations', '0001_extensions_and_enums.sql'),
    'utf8',
  );
  const declared = /CREATE TYPE identity_status AS ENUM \(([^)]*)\)/.exec(ddl);
  expect(declared, '0001 no longer declares `identity_status`').not.toBeNull();
  const members = [...(declared?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  expect(members).toEqual(['active', 'restricted', 'closed']);
  expect([...IDENTITY_STATUSES]).toEqual(members);
  expect(members).not.toContain(FOURTH);
});

// -----------------------------------------------------------------------------
// 1. THE BEHAVIOURAL LEG, at the two gates that are exported
// -----------------------------------------------------------------------------
// This is the assertion that goes RED under the enumerate-the-refused form and
// GREEN under `=== 'active'`. Nothing else in this tree distinguishes them.

describe('a status outside todays enum is REFUSED and not admitted', () => {
  const gates = [
    {
      door: 'POST /accounts/:accountId/payout',
      gate: payoutGate as (status: string) => unknown,
      code: PAYOUT_IDENTITY_RESTRICTED,
    },
    {
      door: 'POST /wallet/withdrawals',
      gate: withdrawalGate as (status: string) => unknown,
      code: WITHDRAWAL_IDENTITY_RESTRICTED,
    },
  ] as const;

  for (const { door, gate, code } of gates) {
    test(`${door} refuses \`${FOURTH}\`, which no case in this tree has ever driven`, () => {
      const refusal = gate(FOURTH);
      // NULL IS THE ONLY WAY PAST EITHER GATE. A gate that enumerated the
      // refused values returns `null` here and the door opens.
      expect(refusal, `${door} admitted an identity status it has never seen`).not.toBeNull();

      // AND IT IS THE SAME REFUSAL, RENDERED RATHER THAN ASSUMED. A gate that
      // threw, or answered some other code, would satisfy `not.toBeNull()` and
      // would not be ADR-140's ruling.
      const { reply, seen } = recordingReply();
      (refusal as { send: (r: unknown, id: string) => unknown }).send(reply, 'req-adr-140');
      expect(seen.status).toBe(422);
      expect(seen.body?.['code']).toBe(code);
    });
  }

  test('`active` is still the one value that passes, so the leg above is not vacuous', () => {
    expect(payoutGate('active')).toBeNull();
    expect(withdrawalGate('active')).toBeNull();
    for (const status of IDENTITY_STATUSES) {
      if (status === 'active') continue;
      expect((payoutGate as (s: string) => unknown)(status), status).not.toBeNull();
      expect(withdrawalGate(status), status).not.toBeNull();
    }
  });
});

// -----------------------------------------------------------------------------
// 2. THE STRUCTURAL LEG, for the doors whose gate is module-private
// -----------------------------------------------------------------------------
// `checkout.ts`'s `gateIdentity` and `gateWalletSpend` are not exported, and
// this file does not export them to make an assertion convenient: ADR-243's
// fence forbids editing shipped source, and widening a module's surface to make
// it testable is the same move as widening a fence to finish. So the predicate
// is read where it is written.

interface Site {
  readonly file: string;
  readonly fn: string;
  /** The exact expression the predicate compares. Written out so no OTHER `status` matches. */
  readonly expr: string;
}

// FIVE SITES AND NOT FOUR. Section 3's sweep found `decideApproval` on its
// first run against a table this file was written with four rows in it. That
// door is ADR-232's approval edge, which is money leaving the firm at an
// operator's hand, and it carries ADR-140's form already. The table is
// corrected UPWARD rather than the sweep narrowed, which is the only direction
// a correction here is allowed to go.
const SITES: readonly Site[] = [
  { file: 'payouts.ts', fn: 'gateIdentityStatus', expr: 'status' },
  { file: 'wallet-withdrawals.ts', fn: 'gateIdentityStatus', expr: 'status' },
  { file: 'wallet-withdrawals.ts', fn: 'decideApproval', expr: 'identity.status' },
  { file: 'checkout.ts', fn: 'gateIdentity', expr: 'cap.identityStatus' },
  { file: 'checkout.ts', fn: 'gateWalletSpend', expr: 'identityStatus' },
];

/** A literal expression, escaped for use inside a `RegExp`. */
function literal(expr: string): string {
  return expr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One function declaration's source, brace balanced from `function` to its own closing `}`.
 *
 * IT COUNTS BRACES RATHER THAN LOOKING FOR A `}` AT A LINE START, and the
 * difference is not cosmetic: `decideApproval` takes a multi-line object type,
 * so `}): ApprovalDecision {` sits at column zero INSIDE the declaration and
 * the cheap reading stopped there, returning a body with no predicate in it.
 * The cheap reading was written first and section 3's sweep is what caught it.
 */
function bodyOf(source: string, fn: string): string {
  const at = source.search(new RegExp(`^(?:export )?function ${fn}\\(`, 'm'));
  expect(at, `\`${fn}\` is no longer declared as a function here`).toBeGreaterThan(-1);
  const rest = source.slice(at);
  // THE PARAMETER LIST IS SKIPPED FIRST, because a multi-line object type
  // balances its own braces before the body ever opens one.
  let parens = 0;
  let afterParams = -1;
  for (let i = rest.indexOf('('); i < rest.length; i += 1) {
    const ch = rest[i];
    if (ch === '(') parens += 1;
    else if (ch === ')') {
      parens -= 1;
      if (parens === 0) {
        afterParams = i + 1;
        break;
      }
    }
  }
  expect(afterParams, `\`${fn}\` has an unbalanced parameter list`).toBeGreaterThan(-1);
  let depth = 0;
  let opened = false;
  for (let i = afterParams; i < rest.length; i += 1) {
    const ch = rest[i];
    if (ch === '{') {
      depth += 1;
      opened = true;
    } else if (ch === '}') {
      depth -= 1;
      if (opened && depth === 0) return rest.slice(afterParams, i + 1);
    }
  }
  expect.fail(`\`${fn}\` never closes the brace it opened`);
}

describe('every identity-status predicate on a money door compares against `active`', () => {
  for (const site of SITES) {
    test(`${site.file} \`${site.fn}\` names the ADMITTED value and no refused one`, () => {
      const body = bodyOf(readFileSync(join(ROUTES, site.file), 'utf8'), site.fn);
      const comparisons = [
        ...body.matchAll(new RegExp(`${literal(site.expr)}\\s*(?:===|!==)\\s*'([a-z_]+)'`, 'g')),
      ];
      expect(comparisons.length, `${site.fn} compares \`${site.expr}\` against nothing`).toBe(1);
      expect(comparisons[0]?.[1], `${site.fn} enumerates a refused value`).toBe('active');
      // THE COUNTERFACTUAL, and it is what the match above cannot say on its
      // own: an enumerate-the-refused form would still satisfy it if somebody
      // left a comparison against `active` beside a new one, so no refused
      // member may be compared against this expression at all.
      for (const refused of IDENTITY_STATUSES) {
        if (refused === 'active') continue;
        expect(body, `${site.fn} names \`${refused}\` in its predicate`).not.toMatch(
          new RegExp(`${literal(site.expr)}\\s*(?:===|!==)\\s*'${refused}'`),
        );
      }
    });
  }
});

// -----------------------------------------------------------------------------
// 3. THE COVERAGE LEG. A fifth door added tomorrow is caught here
// -----------------------------------------------------------------------------
// Section 2 asserts a property of four named sites, and four sites each
// behaving well is not the surface holding the property. ADR-192 clause 5's
// shape, applied one ruling over: the sweep finds every place in
// `apps/api/src/routes` that compares an identity status against a literal, and
// every one of them must be a row above.

test('no route compares an identity status anywhere but at a site named above', () => {
  const found: string[] = [];
  const gateDeclarations: string[] = [];
  let swept = 0;
  for (const file of readdirSync(ROUTES).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(join(ROUTES, file), 'utf8');
    swept += 1;
    if (/^(?:export )?function gateIdentityStatus\(/m.test(source)) gateDeclarations.push(file);
    for (const hit of source.matchAll(
      /(?:identityStatus|identity\.status)\s*(?:===|!==)\s*'[a-z_]+'/g,
    )) {
      const line = source.slice(0, hit.index).split('\n').length;
      const inSite = SITES.some(
        (s) => s.file === file && bodyOf(source, s.fn).includes(hit[0] ?? ' '),
      );
      if (!inSite) found.push(`${file}:${String(line)} ${hit[0] ?? ''}`);
    }
  }
  // NON-VACUITY FIRST. A sweep that read no source would report nothing.
  expect(swept).toBeGreaterThan(10);
  expect(SITES.length).toBe(5);
  expect(found, 'an identity-status comparison lives outside the sites this file governs').toEqual(
    [],
  );
  // THE OTHER SPELLING. The two standalone gates compare a bare `status`, which
  // is too common a word to sweep for, so they are found by NAME instead: a
  // third module growing a `gateIdentityStatus` is a sixth door and is red here
  // until it has a row above.
  expect(gateDeclarations.sort()).toEqual(['payouts.ts', 'wallet-withdrawals.ts']);
});

// -----------------------------------------------------------------------------
// 4. THE CODE IS ONE CODE, across the three modules that answer it
// -----------------------------------------------------------------------------
// ADR-140 support 4: section 2's table is CLOSED and "inventing a sixth
// spelling is a ruling nobody took". Three modules declare the constant
// separately, which is how a spelling drifts.

test('the three modules that refuse a non-active identity spell the code identically', () => {
  expect(PAYOUT_IDENTITY_RESTRICTED).toBe('identity_restricted');
  expect(WITHDRAWAL_IDENTITY_RESTRICTED).toBe(PAYOUT_IDENTITY_RESTRICTED);
  expect(CHECKOUT_IDENTITY_RESTRICTED).toBe(PAYOUT_IDENTITY_RESTRICTED);
});
