// =============================================================================
// playwright.config.ts
// =============================================================================
// `CI-08`'s runner. STRATEGY section 4.1 gives that stage "Playwright, three
// projects", and the projects below are the SURFACES rather than the browsers,
// which is the same decision `vitest.config.ts` takes one stage over: its
// projects map to CI stages rather than to packages, so that a stage can be run
// alone and blocked on separately.
//
// THREE PROJECTS, AND THE THIRD ARRIVED BY ITS STATED REASON EXPIRING RATHER
// THAN BY THE ROW BEING ROUNDED UP. This comment read "TWO PROJECTS AND NOT
// THREE" and gave two grounds: `apps/admin` was in no P4 slice, and ADR-095
// declined to rule its framework for that reason. ADR-182 section 8 item 6
// recorded the second half expiring on the commit that ruled the framework and
// the first half surviving it. `W6-d` then landed `apps/admin/src/app/page.tsx`
// and `next build` prerenders it, so the console has a document and a fixture
// for it is a transcription rather than a session choosing scope.
//
// `CI-08` IS THEREFORE AT THREE OF THREE AND STRATEGY SECTION 4.1's ROW MOVES
// IN THIS COMMIT. `CI-06/gate-inventory` never asks whether a `Contents` cell
// is TRUE (ADR-073's own second limit, the one `CI-02` already exercises by
// promising the `PT-nn` suites against a tree that has neither), so nothing
// mechanical would have reported the row still saying two. A register that
// undercounts is a register that is false in the direction which looks like
// success, which is the direction nobody goes looking.
//
// ONE BROWSER, AND IT IS CHROMIUM. STRATEGY section 2 chose Playwright over
// Cypress specifically because ADR-012 puts the admin console on a separate
// apex domain and cross-origin is therefore a requirement rather than an edge
// case; it did not choose a browser matrix, and SS-01 to SS-08 read COMPUTED
// STYLE, which is the part of a rendering engine that agrees across engines.
// A three-browser matrix here would triple the bill of a merge blocker to
// re-assert the same twenty color values.
//
// NO `webServer` BLOCK, AND THE ORIGINAL REASON HAS EXPIRED WHILE THE DECISION
// HAS NOT. This paragraph read that `apps/site/src/app/` and
// `apps/portal/src/app/` did not exist and that `next build` exited 1 in either
// directory. All three UI apps render routes now, so that sentence is false in
// fact and is replaced rather than kept.
//
// WHAT HOLDS INSTEAD IS A PROPERTY OF THE PASS AND NOT OF THE TREE. `webServer`
// is a TOP-LEVEL key: one list for every project, started for every run, so
// pointing one project at a served URL costs three `next dev` processes on a
// merge blocker whose eight checks read COMPUTED STYLE from a static document.
// `e2e/pass.ts:76` navigates to a `file:` URL built from `Surface.path`, and
// what SS-01 to SS-08 need is a DOM with a stylesheet applied, which a served
// page and a fixture supply identically. So the fixtures stay, and the day a
// check needs something only a server can produce (a redirect, a cookie, a
// cross-origin request, which is the reason STRATEGY section 2 chose Playwright
// at all) this block is where that lands. ADR-116 section 6.
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
    // The operator console. ADR-182 rules its framework, `W6-d` rendered its
    // first document and `W6-i` is this entry. `apps/admin/package.json` takes
    // NO `@playwright/test` line and this slice did not ask for one: `e2e/
    // pass.ts:17` is the only file in this repository that imports the package
    // and no spec under `apps/*/e2e` names it, so the other two UI manifests'
    // declaration is not what makes the pass resolve.
    { name: 'admin', testDir: './apps/admin/e2e' },
  ],
});
