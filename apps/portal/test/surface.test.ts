import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { stripComments } from '../../../packages/tooling/checks/strip-comments.mjs';

import * as portal from '../src/index.ts';

// =============================================================================
// The module's public surface, and the absences that are this session's fence
// =============================================================================

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('every read surface is reachable from the package entry point', () => {
  // `exports` in package.json is `"." : "./src/index.ts"`, so a builder reaches
  // this app through one module. A view model exported from a file and not
  // re-exported here is a surface that exists and cannot be found.
  for (const name of [
    'toAccountCard',
    'toAccountList',
    'toAccountDetail',
    'toEligibilityView',
    'toEquitySeries',
    'toTimelineView',
    'toEconomicCalendarPanel',
    'toShellView',
    'toImpersonationBanner',
    'toPortalErrorKind',
    'copyBlock',
    'formatCents',
    'formatBasisPoints',

    // P4-h, SC-M4-05 to SC-M4-09.
    'toRulesView',
    'toPurchaseHistory',
    'toRuleDiff',
    'toKycStatusView',
    'toCertificateView',
    'toReferralPanel',
    'disclosureBlock',

    // SC-M4-10 and SC-M4-11, the two screens section 3.1 named and this
    // application did not serve until this session.
    'toWalletView',
    'walletFraming',
    'toSecurityView',
    'factorLabel',
    'isRevocable',

    // SC-M4-01, the last row of section 3.1 with no route until this session.
    // It reads nothing: every endpoint behind it is a POST and this screen calls
    // none of them, so the view model is a pure function of a MEASUREMENT of
    // what a deployment can serve. The transport gained a `post` in ADR-219,
    // which wires no page.
    'toSignInView',
    'SIGN_IN_FACTORS',
  ]) {
    expect(portal, `${name} is exported`).toHaveProperty(name);
  }
});

test('the deployable still starts and still names its Railway service', () => {
  expect(portal.SERVICE).toBe('portal');
  expect(() => portal.main()).not.toThrow();
});

test('nothing that changes a trader account exists in this app', () => {
  // THE FENCE, ASSERTED RATHER THAN PROMISED. C-27's three sensitive actions
  // (payout destination change, contact change of either kind, external
  // withdrawal) plus the payout request are money path and belong to their own
  // ADR-003 sessions with their own fresh context. This test is what stops a
  // later read-surface session drifting one function into that territory
  // without noticing, and its failure is the prompt to open the right session
  // rather than to delete the assertion.
  //
  // `purchase` WAS AN ENTRY AND IS NARROWED RATHER THAN DELETED, WHICH IS THE
  // WHOLE OF THE AMENDMENT. Session 158 named this file's list as the fence
  // three money-path slices must each amend, and said what a bad amendment
  // looks like: "a session that deletes an entry instead of narrowing it has
  // removed the control while appearing to satisfy it."
  //
  // `GET /purchases` is a READ and SC-M4-06 renders it, so `toPurchaseHistory`
  // is on the right side of the line and the old entry banned it. What the
  // entry was actually protecting is the WRITE half of API_CONTRACT section 5:
  // `POST /checkout` and `POST /accounts/:accountId/reset`. So `purchase`
  // becomes `checkout` and `reset`, which name those two routes, plus
  // `acknowledg` for SD-M4-02's `rule_diff_acknowledged_at`: the rule diff is
  // rendered here and the acknowledgement that settles a dispute later is
  // M03's ceremony and a write.
  //
  // THE NARROWED LIST IS STRICTLY STRONGER ON THE WRITE PATH THAN THE OLD ONE.
  // `purchase` would not have caught a function called `submitCheckout`.
  const exported = Object.keys(portal);
  const forbidden = [
    'payout',
    'withdraw',
    'destination',
    'elevat',
    'otp',
    'passkey',
    'login',
    'logout',
    'session_token',
    'checkout',
    'reset',
    'acknowledg',
    'kycSubmit',
  ];

  for (const name of exported) {
    for (const fragment of forbidden) {
      expect(
        name.toLowerCase().includes(fragment.toLowerCase()),
        `${name} looks like ${fragment}, which is money path and not this session`,
      ).toBe(false);
    }
  }
});

// -----------------------------------------------------------------------------
// TRANSPORT: NARROWED FROM "NONE" TO "ONE NAMED FILE PER NEEDLE"
// -----------------------------------------------------------------------------
// THIS FILE'S OWN HEADER RECORDS THE RULE FOR EXACTLY THIS SITUATION, written by
// session 158 about a different list one test up: "a session that deletes an
// entry instead of narrowing it has removed the control while appearing to
// satisfy it."
//
// The old assertion was that NO `.ts` file under `src/` contains `fetch(`,
// `XMLHttpRequest`, `WebSocket` or `EventSource`, and its stated reason was that
// "the fetch layer arrives with the framework. Asserting it now means THE FIRST
// `fetch` WRITTEN HERE IS A DECISION SOMEBODY MAKES ON PURPOSE rather than one
// that appears in a diff." ADR-162 is that decision and this is its narrowing.
//
// IT IS PER NEEDLE AND NOT PER FILE, WHICH IS STRICTLY STRONGER THAN A SINGLE
// ALLOWLISTED FILE WOULD BE. `fetch(` moves from "no file" to "one file".
// `XMLHttpRequest`, `WebSocket` and `EventSource` DO NOT MOVE: they are still
// permitted in no file at all, so three of the four needles hold at exactly the
// strength session 111 landed them at. A client file that reached for
// `EventSource` would fail this test, which a bare "src/http/client.ts may do
// transport" allowlist would not have caught.
//
// `P6-h` IS THE SLICE THAT MOVES `WebSocket`, and P6 section 8 gives it
// `apps/portal/src/live/client.ts` by name. When it lands it adds ONE entry to
// ONE row below and this comment is why it does not need to widen anything else.
const TRANSPORT: readonly { readonly needle: string; readonly permitted: readonly string[] }[] = [
  // ADR-162. The HTTP client, and the five decisions its header argues.
  { needle: 'fetch(', permitted: [join('http', 'client.ts')] },

  // No admitted use in this application. `fetch` covers every read this app
  // makes and both of these predate it by a decade.
  { needle: 'XMLHttpRequest', permitted: [] },
  { needle: 'EventSource', permitted: [] },

  // P6-h's, and not yet taken. ADR-020's tier 2 is server-initiated delivery
  // and no file in this application subscribes to anything today.
  { needle: 'WebSocket', permitted: [] },
];

/** Every `.ts` file under `src/`, repo-relative to `apps/portal/src`. */
function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts')) files.push(path);
    }
  };
  walk(SRC);
  return files;
}

/**
 * Source with comments removed, so a needle named in prose is not a finding.
 *
 * THE STRIPPING IS THE SHARED HOME'S (ADR-279) AND WAS TWO REPLACEMENTS HERE.
 * That idiom read a block-comment OPENER written inside a LINE comment as a real
 * one and ran a phantom block to the next real closer: seven of the 66 files
 * this walk parses stripped shorter under it, `app/sign-in/page.ts` to 180
 * characters of 5,221. Every case below is an ABSENCE assertion, which is the
 * direction that goes vacuously GREEN over an emptied file rather than red.
 */
function code(file: string): string {
  return stripComments(readFileSync(file, 'utf8'));
}

test('transport exists in one named file and nowhere else', () => {
  const files = sourceFiles();
  expect(files.length, 'source files walked').toBeGreaterThan(5);

  const offences: string[] = [];
  for (const file of files) {
    const rel = relative(SRC, file);
    const body = code(file);
    for (const { needle, permitted } of TRANSPORT) {
      if (!body.includes(needle)) continue;
      if (permitted.includes(rel)) continue;
      offences.push(`${rel}: ${needle}`);
    }
  }
  expect(offences).toEqual([]);
});

test('every file the transport list permits exists and uses what it was permitted', () => {
  // AN ALLOWLIST ENTRY FOR A FILE THAT DOES NOT EXIST, OR THAT NO LONGER
  // PERFORMS THE CALL, IS THE ASSERTION QUIETLY BACK AT "NONE" WHILE LOOKING
  // NARROWED. It is also how a renamed client stops being watched: the entry
  // keeps pointing at the old path and the new one is nobody's exception,
  // which fails loudly, and the stale entry fails here.
  const walked = new Set(sourceFiles().map((file) => relative(SRC, file)));

  for (const { needle, permitted } of TRANSPORT) {
    for (const rel of permitted) {
      expect(walked.has(rel), `${rel} is permitted ${needle} and is walked by this test`).toBe(
        true,
      );
      expect(code(join(SRC, rel)).includes(needle), `${rel} still performs ${needle}`).toBe(true);
    }
  }
});

test('the narrowing fires on the second file that gains a transport call', () => {
  // RI-06's argument, and this file's own: the narrowing is watched failing on
  // the thing it exists to catch rather than only in its passing state. The
  // seed is a STRING rather than a file, so nothing is written to `src/`.
  const seeded = (rel: string, body: string): string[] => {
    const offences: string[] = [];
    for (const { needle, permitted } of TRANSPORT) {
      if (body.includes(needle) && !permitted.includes(rel)) offences.push(`${rel}: ${needle}`);
    }
    return offences;
  };

  // A second segment reaching for its own transport.
  expect(seeded(join('app', 'accounts', 'source.ts'), 'const r = await fetch(url);')).toEqual([
    `${join('app', 'accounts', 'source.ts')}: fetch(`,
  ]);

  // The permitted file, doing the permitted thing.
  expect(seeded(join('http', 'client.ts'), 'const r = await fetch(url, init);')).toEqual([]);

  // And the three needles that did NOT move, in the file that did.
  expect(seeded(join('http', 'client.ts'), 'new WebSocket(url);')).toEqual([
    `${join('http', 'client.ts')}: WebSocket`,
  ]);
});
