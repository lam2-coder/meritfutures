// =============================================================================
// apps/site/e2e/slop-score.spec.ts
// =============================================================================
// `M4-F-01` OVER THE MARKETING SITE. The surfaces are this deployable's and the
// eight checks are not: they live in `e2e/slop-score.ts` at the root, because
// the slop score is one gate over the whole UI estate rather than two gates
// that happen to agree. This file therefore names WHAT IS RENDERED and nothing
// else, which is the only part that is genuinely per-deployable.
// =============================================================================

import { fileURLToPath } from 'node:url';
import { describeSlopScore, type Surface } from '../../../e2e/pass.ts';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const SURFACES: readonly Surface[] = [
  {
    name: 'plans',
    path: fixture('plans.compliant.html'),
    kind: 'compliant',
  },
  {
    // NOT A SURFACE THE SITE SERVES. It is the seeded violation that proves the
    // eight checks still fire, and it must never be repaired into compliance.
    name: 'plans, seeded',
    path: fixture('plans.seeded.html'),
    kind: 'seeded',
  },
];

describeSlopScore('site', SURFACES);
