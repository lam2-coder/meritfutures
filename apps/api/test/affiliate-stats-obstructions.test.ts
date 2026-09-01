// =============================================================================
// apps/api/test/affiliate-stats-obstructions.test.ts -- CI-02, `unit`.
// =============================================================================
// ADR-304 SECTION 8, EXECUTED. THE REFUSAL `GET /affiliate/stats` SERVES WAS
// WRONG IN TWO PLACES AND A REFUSAL IS THE ONE PLACE A LATER SESSION READS TO
// FIND OUT WHAT TO BUILD.
//
// It told that session the table is `a seventh class away`, which ADR-304 rules
// it is not, and it named ONE obstruction where the method has two. The first
// error sends a session to `packages/db` to write a scope class; the second
// lets it think the endpoint is served once that class exists. Both are the
// shape ADR-253 section 5 repaired for `affiliate_statements` one method over.
//
// THE ASSERTION IS OVER WHAT A CALLER IS SERVED AND NOT OVER THE FILE, which is
// ADR-253 section 5's choice and its reason: an assertion over source text would
// forbid the docblock that QUOTES what was corrected, and could be satisfied by
// deleting the record instead of the defect. So every method of the shipped
// default is CALLED and its message read. A seventh site of a retired sentence
// fails this file rather than hiding behind the one that was repaired.
//
// AND THE FACTS BEHIND THE MESSAGE ARE ASSERTED SEPARATELY, in
// `packages/db/test/affiliate-commissions-is-a-column-away.test.ts`, which reads
// the migrations. Nothing here claims a scope class or a column exists; this
// file asserts only what the port TELLS a caller, which is the thing that was
// wrong.

import { describe, expect, test } from 'vitest';

import {
  AffiliateBackendUnwired,
  UNWIRED_AFFILIATE_BACKEND,
  type AffiliateBackend,
} from '../src/routes/affiliate.ts';

/** Every method of the port, called, with the message it refuses with. */
async function refusals(): Promise<Map<keyof AffiliateBackend, string>> {
  const out = new Map<keyof AffiliateBackend, string>();
  const methods = Object.keys(UNWIRED_AFFILIATE_BACKEND) as (keyof AffiliateBackend)[];
  for (const method of methods) {
    // The default rejects on every method and takes no useful argument, so the
    // call is made with none and the rejection is the whole of what is read.
    const called = (UNWIRED_AFFILIATE_BACKEND[method] as () => Promise<never>)();
    await expect(called).rejects.toBeInstanceOf(AffiliateBackendUnwired);
    out.set(
      method,
      await called.then(
        () => '',
        (error: unknown) => (error as Error).message,
      ),
    );
  }
  return out;
}

describe('every method refuses, and the six are the contract of this port', () => {
  test('all six methods reject with `AffiliateBackendUnwired`', async () => {
    const served = await refusals();
    expect([...served.keys()].sort()).toEqual([
      'affiliate',
      'issueLink',
      'requiredDisclosure',
      'statements',
      'stats',
      'submitCreative',
    ]);
    for (const [method, message] of served) {
      expect(message, method).toMatch(new RegExp(`AffiliateBackend\\.${method} is not wired`));
    }
  });
});

describe('the retired sentence is gone from every message a caller can reach', () => {
  // THE FIRST ERROR. The claim that the table is a seventh scope class away is
  // ADR-304's subject and its ruling is the opposite, so no message may still
  // carry it. Asserted over ALL SIX rather than over `stats`, because the site
  // that mattered last time was the one nobody had looked at.
  test('no served message says the table is a class away', async () => {
    for (const [method, message] of await refusals()) {
      expect(message, method).not.toMatch(/seventh class away/i);
      expect(message, method).not.toMatch(/declines to write one/i);
    }
  });

  // AND THE SENTENCE ADR-253 RETIRED IS STILL GONE, asserted here as well as in
  // its own file, because this file calls all six and that one calls all six
  // for a different claim. A message acquiring it again fails both.
  test('no served message says `affiliate_statements` is absent from the schema', async () => {
    for (const [method, message] of await refusals()) {
      expect(message, method).not.toMatch(/not in `?packages\/db\/src\/schema\.ts`? at all/i);
    }
  });
});

describe('the `stats` refusal names BOTH obstructions and the work each one is', () => {
  // THE SECOND ERROR, AND IT IS THE FINDING THIS ENTRY ADDS. A message naming
  // only `affiliate_commissions` tells a session the endpoint is served once
  // that table is registered, and it is not: `conversions_30d` is counted over
  // a `pair` relation that no scope class reaches.
  test('it names the commissions obstruction and what closes it', async () => {
    const message = (await refusals()).get('stats') as string;
    expect(message).toMatch(/affiliate_commissions/);
    expect(message).toMatch(/UNREGISTERED/);
    expect(message).toMatch(/one COLUMN away/);
    expect(message).toMatch(/affiliate_id uuid NOT NULL REFERENCES affiliates\(id\)/);
    expect(message).toMatch(/0078/);
    expect(message).toMatch(/NOT WRITTEN/);
  });

  test('it names the conversions obstruction and says no class reaches it', async () => {
    const message = (await refusals()).get('stats') as string;
    expect(message).toMatch(/conversions_30d/);
    expect(message).toMatch(/attributions/);
    expect(message).toMatch(/pair/);
    expect(message).toMatch(/NO scope class fixes that/);
    expect(message).toMatch(/NAMED DOOR/);
  });

  // AND IT SAYS `firm` IS FALSE, which is the sentence ADR-253 put here and the
  // one this entry deliberately does not re-argue. A repair that dropped it
  // would leave the available mistake unnamed at the only site a session
  // reaching for it would read.
  test('it still says `firm` is available, passes every check, and is false', async () => {
    const message = (await refusals()).get('stats') as string;
    expect(message).toMatch(/`firm` is available/);
    expect(message).toMatch(/is FALSE/);
    expect(message).toMatch(/what Merit owes a named affiliate/);
  });
});

describe('the other five messages are unchanged in what they say a caller must build', () => {
  // THE REPAIR IS BOUNDED, ASSERTED RATHER THAN INTENDED. Four methods wait on
  // an adapter and one waits on an adapter and a base URL, and ADR-304 moves
  // none of them. A message drifting into naming DDL would send a session to
  // `packages/db` for work that is not owed.
  test('four methods say a door exists and an adapter does not', async () => {
    const served = await refusals();
    for (const method of ['affiliate', 'requiredDisclosure', 'submitCreative', 'statements']) {
      const message = served.get(method as keyof AffiliateBackend) as string;
      expect(message, method).toMatch(/has a door and no adapter has been written for it yet/);
    }
  });

  test('`issueLink` still waits on an adapter and a base URL rather than on DDL', async () => {
    const message = (await refusals()).get('issueLink') as string;
    expect(message).toMatch(/ADAPTER AND A BASE URL rather than DDL/);
    expect(message).toMatch(/ADR-253 rules that none is owed/);
  });
});
