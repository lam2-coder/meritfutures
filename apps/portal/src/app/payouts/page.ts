// =============================================================================
// apps/portal/src/app/payouts/page.ts
// =============================================================================
// SC-M4-04's ROUTE. `/payouts`, the payout center, the first rendered document
// in `apps/portal`'s payout segment.
//
// -----------------------------------------------------------------------------
// WHY THIS SEGMENT IS `.ts` AND NOT `.tsx`, WHICH IS A CONTROL DECISION
// -----------------------------------------------------------------------------
// Next's default `pageExtensions` is `tsx, ts, jsx, js`, so a `page.ts` is a
// route exactly as a `page.tsx` is. What differs is what watches the file.
//
// FOUR CONTROLS IN THIS REPOSITORY ARE SCOPED TO `*.ts` AND NONE OF THEM SEES A
// `.tsx` FILE. Each was checked in this session against its own source:
//
//   1. `eslint.config.js`'s `merit/no-raw-db-client` block. VG-4, and its glob
//      is `apps/**` `*.ts`.
//   2. `eslint.config.js`'s `merit/no-calendar-in-expiry-path` block. ADR-042,
//      and its first two globs name `apps/**` payout paths and end `*.ts`. THIS
//      SEGMENT IS INSIDE THAT GLOB, and it is the reason no file here reads a
//      clock or imports a calendar: a hold deadline is a wall-clock instant the
//      server quotes and this app renders the string it was sent.
//   3. `apps/portal/test/inv-m4-01.test.ts`, which walks `src/` for files
//      ending `.ts` and fails on an arithmetic operator beside a `_cents` or
//      `_bp` identifier. It is the standing substitute for INV-M4-01's unwritten
//      lint rule, and this is the screen it exists for.
//   4. `apps/portal/test/surface.test.ts`, which walks the same set and fails
//      on `fetch(`, `XMLHttpRequest`, `WebSocket` and `EventSource`.
//
// A `.tsx` payout screen would drop all four ON THE ONE SCREEN IN THIS
// APPLICATION WHERE MONEY IS RENDERED, silently, by choosing a file extension.
// That is weakening four gates to pass none of them, so this segment is `.ts`
// and the element trees are built with `createElement`.
//
// CONVERTING THIS SEGMENT TO JSX IS A LEGITIMATE LATER CHANGE AND IT IS NOT
// FREE. Whoever does it widens all four globs in the same commit, and
// `apps/portal/test/payouts-segment.test.ts` is written to keep working across
// the change: it walks `.ts` AND `.tsx` under this directory, so the four
// properties stay asserted for this segment either way.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE DOES NOT DO
// -----------------------------------------------------------------------------
// NO ROUTE HANDLER AND NO SERVER ACTION. ADR-083 section 3 and ADR-095 ruling 3:
// nothing in this application may serve `/api/v1` or any operator path. There
// is no `route.ts` in this segment, no `'use server'` directive anywhere in it,
// and `apps/portal/test/payouts-segment.test.ts` asserts both rather than
// leaving them to a reader noticing.
//
// NO LAYOUT AND NO SHELL. `app/layout.tsx`, the root page, `next.config` and
// the impersonation band that ../../shell/app-shell.ts models are session 250's
// and are not in this tree yet. This file exports a page and nothing else, so
// it composes with whatever 250 lands without either session having read the
// other's diff.

import type { ReactElement } from 'react';
import { createElement } from 'react';

import { PayoutCenter, PayoutCenterUnavailable } from './sections.ts';
import { load } from './source.ts';

/**
 * The payout center.
 *
 * THE READY BRANCH IS THE REAL ONE AND IT IS EXERCISED TODAY. `load` returns
 * `unavailable` until a transport exists (see ./source.ts), and
 * `apps/portal/test/payout-center.test.ts` renders the ready branch through
 * `readyFrom` with responses transcribed from API_CONTRACT. Both branches
 * render; only one of them can be reached from a browser right now.
 */
export default async function PayoutsPage(): Promise<ReactElement> {
  const loaded = await load();

  return loaded.kind === 'ready'
    ? createElement(PayoutCenter, { view: loaded.view })
    : createElement(PayoutCenterUnavailable, { missing: loaded.missing });
}
