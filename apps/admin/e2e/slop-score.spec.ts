// =============================================================================
// apps/admin/e2e/slop-score.spec.ts
// =============================================================================
// `M4-F-01` OVER THE OPERATOR CONSOLE, AND IT IS `CI-08`'s THIRD PROJECT.
// `playwright.config.ts:10` named this one missing rather than rounding the row
// up to three, and STRATEGY section 4.1's `CI-08` row said the same thing in
// the same words. `W6-i` is the slice that removes the reason, so both move in
// the commit that carries this file.
//
// SAME SHAPE AS THE OTHER TWO SPECS AND FOR THE SAME REASON: this file names
// WHAT IS RENDERED and nothing else. The eight checks live in
// `e2e/slop-score.ts` at the root, because the slop score is ONE gate over the
// whole UI estate rather than three gates that happen to agree.
//
// -----------------------------------------------------------------------------
// WHY THIS SPEC RENDERS A FIXTURE AND NOT THE ROUTE, WHICH IS A MEASUREMENT
// -----------------------------------------------------------------------------
// `apps/admin` now serves a real page: `W6-d` landed `src/app/page.tsx` and
// `next build` prerenders it. So the obvious shape is to point Playwright at
// the running server, and it is refused here on two grounds that are facts
// about this tree rather than preferences.
//
// FIRST, `e2e/pass.ts:76` GOES TO A `file:` URL BUILT FROM `Surface.path`, and
// `e2e/pass.ts` is not in this slice's fence. A spec that needed a served URL
// would need that harness to grow a second mode, which is a repository-wide
// change made to serve one surface.
//
// SECOND, AND THIS IS THE ONE THAT WOULD HAVE COST A SESSION: importing the
// route into this directory imports a `.tsx`, and `e2e/tsconfig.json` sets no
// `jsx` key. TypeScript follows an import into the file it names and compiles
// it under the IMPORTING project's options, so a `.ts` spec here that reached
// for `page.tsx` would fail `tsc -p e2e` on a file it does not own. That is the
// same class of failure ADR-182 section 8 item 4 sends this slice to repair one
// directory over, arriving from the opposite direction.
//
// WHAT THE FIXTURES THEREFORE ARE, STATED PLAINLY. The compliant one carries
// the DOM the route actually serves, lifted from
// `apps/admin/.next/server/app/index.html` after a real build, plus a
// stylesheet this session wrote, because `src/app/layout.tsx` ships none and
// SS-01 to SS-08 read COMPUTED STYLE. So this pass asserts that the console's
// MARKUP is compliant when the design system is applied to it, and it does not
// assert that the shipped page applies one. That gap is real, it is reported in
// the session log, and it belongs to the slice that gives this app a
// stylesheet.
// =============================================================================

import { fileURLToPath } from 'node:url';
import { describeSlopScore, type Surface } from '../../../e2e/pass.ts';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const SURFACES: readonly Surface[] = [
  {
    name: 'liability home',
    path: fixture('liability-home.compliant.html'),
    kind: 'compliant',
  },
  {
    // The seeded direction. Do not repair it into compliance.
    name: 'liability home, seeded',
    path: fixture('liability-home.seeded.html'),
    kind: 'seeded',
  },
];

describeSlopScore('admin', SURFACES);
