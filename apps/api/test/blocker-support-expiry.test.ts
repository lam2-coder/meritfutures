// =============================================================================
// apps/api/test/blocker-support-expiry.test.ts
// =============================================================================
// WHAT `setAdminSessionSource`'s SECOND GROUND ACTUALLY RESTS ON TODAY.
//
// ADR-371 read the recorded blockers in the two registers ADR-370 did not open
// and found ONE expiry. It is not a blocker that stopped being true; it is a
// blocker whose SUPPORT stopped being true while the blocker stood.
//
// -----------------------------------------------------------------------------
// THE FINDING, IN ONE PARAGRAPH, BECAUSE THE CASES BELOW ONLY MAKE SENSE WITH IT
// -----------------------------------------------------------------------------
// `wiring.test.ts`'s `setAdminSessionSource` entry declines the port on three
// grounds. The second is that installing it costs a transaction against two
// tables on every `/admin/*` request including the ones answering 401, and that
// nothing bounds an anonymous prober, and it cites two lines of `start.ts` for
// the claim that `INV-M11-05`'s limit is absent. THOSE TWO LINES CARRIED EXACTLY
// THAT SENTENCE ON BOTH PARENTS OF THE MERGE THAT WROTE THE CITATION, so the
// citation was right when written. A concurrent branch then landed the per-IP
// half of that limit and rewrote the paragraphs, and the pointers now land in an
// unrelated argument about the certificate image source. ADR-358's mechanism,
// across two branches that could not see each other.
//
// THE GROUND ITSELF SURVIVES, AND ON A NARROWER SUPPORT THAN THE ONE IT CITES.
// The limit that landed is scoped to two PUBLIC CERTIFICATE rows. It does not
// reach `/admin/*`, so an anonymous prober is still unbounded there and the
// entry's verdict does not move. THE CITATION NEEDS REPAIR AND THE VERDICT DOES
// NOT, and those are two different edits to two different clauses.
//
// -----------------------------------------------------------------------------
// WHY THESE TWO CASES AND NOT A THIRD ASSERTING THE DEFECT
// -----------------------------------------------------------------------------
// A case that asserted the cited lines DO support the claim would be RED today,
// and a case that asserted they do NOT would pin a defect in place and go red on
// the repair. Neither is a control. What is bound here instead is the pair of
// facts the surviving ground rests on, each of which is TRUE now and each of
// which goes RED on the day it stops being true -- which is the day somebody
// must re-read that entry. `1` runs in the GOOD NEWS direction: it reddens when
// an admin limit lands. `2` runs in the HARM direction: it reddens if the per-IP
// limiter is removed, which would make the retired half true again silently.
//
// THE FILE THIS IS ABOUT IS NOT TOUCHED BY THIS ROW. `apps/api/test/wiring.test.ts`
// is nobody's this wave and `apps/api/src/start.ts` is a sibling's. ADR-371
// section 6 states the repair precisely enough to be picked up.
//
// THE RETIRED SENTENCE IS NAMED HERE AND NEVER REPRODUCED, on ADR-367's measured
// collision: `start.ts` keeps its false clause quoted beside its correction in
// three places, so a reader matching on the prose gets four hits of which three
// are history. This file therefore refers to the clause and does not carry it.
// =============================================================================

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { RATE_LIMITED_ROUTES } from '../src/certificate-rate-limit.ts';

/** Repository root, from this file's own location rather than from `cwd`. */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** `apps/api/src/start.ts`, read as text. It is a sibling's file and only READ. */
const START = readFileSync(`${ROOT}apps/api/src/start.ts`, 'utf8');

describe('what setAdminSessionSource ground 2 rests on (ADR-371)', () => {
  // 1. THE SURVIVING GROUND, DERIVED FROM THE LIMITER'S OWN VALUE SPACE.
  //
  // `RATE_LIMITED_ROUTES` is the whole of what `INV-M11-05`'s built half
  // covers. Neither member is an admin route, and `start.ts` installs no second
  // limiter, so the prober the entry names is still unbounded on `/admin/*`.
  //
  // THIS GOES RED ON GOOD NEWS. The day an admin dimension is added, ground 2
  // stops being a reason to decline the port and the entry needs re-reading.
  test('the built rate limit covers two public certificate rows and no admin route', () => {
    expect([...RATE_LIMITED_ROUTES]).toStrictEqual(['verify', 'certificate_image']);

    const adminRoutes = RATE_LIMITED_ROUTES.filter((route) => /admin/i.test(route));
    expect(adminRoutes).toStrictEqual([]);

    // The installs in `start.ts`, counted rather than read by eye. One limiter.
    const installs = START.match(/^use[A-Za-z]*RateLimiter\(/gm) ?? [];
    expect(installs).toStrictEqual(['useCertificateRateLimiter(']);
  });

  // 2. THE HALF THAT IS DISCHARGED, PINNED SO IT CANNOT DRIFT BACK.
  //
  // The per-IP dimension EXISTS and is installed. That is the half of the cited
  // sentence which is false today, and pinning it is what stops a later reader
  // from restoring the sentence whole off one of the three retired quotations.
  //
  // THE PER-ASN DIMENSION IS NOT ASSERTED HERE IN EITHER DIRECTION. It is still
  // owed, `start.ts` records it owed with its blocker named, and a case pinning
  // an absence that a purchase discharges is a case that reddens on news this
  // suite has no business ruling on.
  test('the per-IP half of INV-M11-05 is built and installed', () => {
    expect(existsSync(`${ROOT}apps/api/src/certificate-rate-limit.ts`)).toBe(true);

    // ANCHORED TO THE START OF A LINE, WHICH SEED 2 IS WHY. `toContain` was
    // satisfied by the install COMMENTED OUT, so the harm seed passed this case
    // and reddened only the one above it. A pin an inert line satisfies is not
    // a pin on the install.
    const installed = /^useCertificateRateLimiter\(environmentCertificateRateLimiter\(\)\);$/m;
    expect(installed.test(START)).toBe(true);
  });
});
