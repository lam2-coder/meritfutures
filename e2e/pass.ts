// =============================================================================
// e2e/pass.ts
// =============================================================================
// THE HARNESS EVERY SURFACE'S SPEC CALLS, so that a surface contributes its
// FIXTURES and nothing else. A spec that also carried the matrix would be a
// second place the phrase "375px and 1280px, in light and dark" is written, and
// the two would eventually disagree about what "the pass" means.
//
// THE MATRIX IS DESIGN_SYSTEM SECTION 8's, VERBATIM: "It renders each page at
// 375px and 1280px, in light and dark." Four renderings per surface, each its
// own `test`, so a failure names the width and the theme it happened at rather
// than reporting that something somewhere is wrong. DG-06 and DG-03 are
// theme-dependent by construction, and a pass that folded the four into one
// assertion would report a dark-mode-only defect against a light-mode surface.
// =============================================================================

import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { extractPageReport, type PageReport } from './extract.ts';
import { formatFindings, runSlopChecks, SS_IDS, type SlopCheckId } from './slop-score.ts';

/**
 * One thing the pass renders.
 *
 * `compliant` fixtures must produce NO finding. `seeded` fixtures must produce
 * at least one finding for EVERY check, which is the direction that proves the
 * eight are alive. A pass carrying only the first kind reports green when a
 * check has silently stopped reading anything, which is the failure P1 section
 * 6 exists to refuse and which two of the eleven corpus gates once had.
 */
export interface Surface {
  readonly name: string;
  /** Absolute path to the fixture this surface renders. */
  readonly path: string;
  readonly kind: 'compliant' | 'seeded';
}

/** DESIGN_SYSTEM section 8: 375px and 1280px. */
const VIEWPORTS = [
  { label: '375px', width: 375, height: 812 },
  { label: '1280px', width: 1280, height: 900 },
] as const;

/** DESIGN_SYSTEM section 8: light and dark. OQ-DS-03 rules which is DEFAULT per
 *  surface and leaves both supported, so both are rendered on both surfaces. */
const THEMES = ['light', 'dark'] as const;

/**
 * Declares the whole pass for one deployable's surfaces.
 *
 * @param app   The deployable, used only to name the tests.
 * @param surfaces What that deployable renders, compliant and seeded.
 */
export function describeSlopScore(app: string, surfaces: readonly Surface[]): void {
  // RULE 2 ON THE HARNESS ITSELF, and it is the one `repo-invariants.mjs`
  // states: a check that cannot run is not a check that passed. A spec whose
  // fixture list came back empty from a bad glob would report green having
  // rendered nothing, which is exactly how `CI-06s`'s class of defect hides.
  if (surfaces.length === 0) {
    throw new Error(`${app}: the slop-score pass was given no surfaces, so it asserts nothing`);
  }
  if (!surfaces.some((s) => s.kind === 'seeded')) {
    throw new Error(
      `${app}: the slop-score pass was given no seeded surface, so nothing proves the eight ` +
        'checks still fire. P1 section 6 requires the seeded direction',
    );
  }

  for (const surface of surfaces) {
    test.describe(`${app} ${surface.name} (${surface.kind})`, () => {
      for (const viewport of VIEWPORTS) {
        for (const theme of THEMES) {
          test(`SS-01 to SS-08 at ${viewport.label} in ${theme}`, async ({ page }) => {
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            await page.emulateMedia({ colorScheme: theme });
            await page.goto(pathToFileURL(surface.path).href);

            const report: PageReport = await page.evaluate(extractPageReport);

            // A report with no elements is a fixture that did not load, and a
            // pass that read nothing must not report that nothing is wrong.
            expect(
              report.elements.length,
              `${surface.path} produced no elements, so the pass rendered nothing`,
            ).toBeGreaterThan(0);

            const findings = runSlopChecks(report);

            if (surface.kind === 'compliant') {
              expect(
                findings,
                `${surface.name} at ${viewport.label} in ${theme} is not compliant:\n` +
                  formatFindings(findings),
              ).toEqual([]);
              return;
            }

            const fired = new Set<SlopCheckId>(findings.map((f) => f.check));
            const silent = SS_IDS.filter((id) => !fired.has(id));
            expect(
              silent,
              `${surface.name} seeds a violation of every check and ${silent.join(', ')} did ` +
                `not fire at ${viewport.label} in ${theme}. A check that reports nothing ` +
                'against a fixture built to break it has stopped reading. What DID fire:\n' +
                formatFindings(findings),
            ).toEqual([]);
          });
        }
      }
    });
  }
}
