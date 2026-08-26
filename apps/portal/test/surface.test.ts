import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

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

test('no source file in this app performs a network call', () => {
  // A read surface with no transport is deliberate: these are pure functions
  // from a wire shape to a render-ready shape, and the fetch layer arrives with
  // the framework. Asserting it now means the first `fetch` written here is a
  // decision somebody makes on purpose rather than one that appears in a diff.
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts')) files.push(path);
    }
  };
  walk(SRC);

  expect(files.length, 'source files walked').toBeGreaterThan(5);

  const offences: string[] = [];
  for (const file of files) {
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');
    for (const call of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
      if (code.includes(call)) offences.push(`${file}: ${call}`);
    }
  }
  expect(offences).toEqual([]);
});
