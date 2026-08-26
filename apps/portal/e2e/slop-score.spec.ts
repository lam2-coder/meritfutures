// =============================================================================
// apps/portal/e2e/slop-score.spec.ts
// =============================================================================
// `M4-F-01` OVER THE TRADER PORTAL, which is the plan that names the identifier:
// M04 section 8 rows it as "Appendix F slop score", every commit, blocking
// merge. Same shape as the site's spec and for the same reason: this file names
// what is rendered, and the eight checks are the root's.
// =============================================================================

import { fileURLToPath } from 'node:url';
import { describeSlopScore, type Surface } from '../../../e2e/pass.ts';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const SURFACES: readonly Surface[] = [
  {
    name: 'funded dashboard',
    path: fixture('dashboard.compliant.html'),
    kind: 'compliant',
  },
  {
    // The seeded direction. Do not repair it into compliance.
    name: 'funded dashboard, seeded',
    path: fixture('dashboard.seeded.html'),
    kind: 'seeded',
  },
];

describeSlopScore('portal', SURFACES);
