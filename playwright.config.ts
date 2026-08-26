// =============================================================================
// playwright.config.ts
// =============================================================================
// `CI-08`'s runner. STRATEGY section 4.1 gives that stage "Playwright, three
// projects", and the projects below are the SURFACES rather than the browsers,
// which is the same decision `vitest.config.ts` takes one stage over: its
// projects map to CI stages rather than to packages, so that a stage can be run
// alone and blocked on separately.
//
// TWO PROJECTS AND NOT THREE, AND THE MISSING ONE IS NAMED RATHER THAN ROUNDED
// UP. `apps/admin` is the third UI surface and it has no fixture here: it is in
// no P4 slice at all, ADR-095 declined to rule its framework for that reason,
// and inventing a fixture for it in this fence would be this session choosing
// scope. `CI-06/gate-inventory` never asks whether a `Contents` cell is TRUE
// (ADR-073's own second limit, the one `CI-02` already exercises by promising
// the `PT-nn` suites against a tree that has neither), so the row is
// implemented at two of three and the row says exactly that.
//
// ONE BROWSER, AND IT IS CHROMIUM. STRATEGY section 2 chose Playwright over
// Cypress specifically because ADR-012 puts the admin console on a separate
// apex domain and cross-origin is therefore a requirement rather than an edge
// case; it did not choose a browser matrix, and SS-01 to SS-08 read COMPUTED
// STYLE, which is the part of a rendering engine that agrees across engines.
// A three-browser matrix here would triple the bill of a merge blocker to
// re-assert the same twenty color values.
//
// NO `webServer` BLOCK, AND THE REASON IS MEASURED. A `webServer` would start
// `next dev` in each app; `apps/site/src/app/` and `apps/portal/src/app/` do
// not exist at this commit, `next build` in either directory exits 1 on
// "Couldn't find any `pages` or `app` directory", and `CI-07` is still waiting
// on the first `page`, `layout` or `route` file under those paths. The pass
// renders fixtures over `file:` for exactly as long as that is true. ADR-116
// section 6.
// =============================================================================

import { defineConfig } from '@playwright/test';

export default defineConfig({
  // A LONGER TIMEOUT THAN A UNIT TEST AND A SHORTER ONE THAN THE DEFAULT JOB.
  // Each test renders one document and reads it once; the failure this guards
  // is a browser that never launches, and `ci.yml`'s CI-05 comment states the
  // rule it follows: a blocking gate that hangs is worse than one that fails.
  timeout: 30_000,
  expect: { timeout: 5_000 },

  fullyParallel: true,

  // `test.only` LEFT IN A COMMIT IS A PASS THAT SILENTLY STOPPED COVERING THE
  // REST, which is the same shape as `--passWithNoTests` on CI-02's line and is
  // refused for the same reason.
  forbidOnly: !!process.env['CI'],

  // NO RETRIES, ANYWHERE. STRATEGY section 6's TR-04 warning is about a suite
  // that produces a stream of expected failures; a retry count is how a suite
  // stops producing them without anybody fixing anything. These tests read a
  // static document in a headless browser and have nothing to be flaky about.
  retries: 0,

  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],

  use: {
    browserName: 'chromium',
    // The fixtures are `file:` URLs resolved by each spec, so there is no
    // `baseURL` to state. When the first real page lands, it lands here.
    trace: 'retain-on-failure',
  },

  projects: [
    { name: 'site', testDir: './apps/site/e2e' },
    { name: 'portal', testDir: './apps/portal/e2e' },
  ],
});
