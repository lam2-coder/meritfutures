import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import * as portal from '../src/index.js';

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
    'purchase',
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
