import { expect, test } from 'vitest';

import * as admin from '../src/index.js';
import { SERVICE, main } from '../src/index.js';

// CI-02, the `unit` project.
test('admin deploys as its own Railway service', () => {
  expect(SERVICE).toBe('admin');
});

test('the deployable starts', () => {
  expect(() => main()).not.toThrow();
});

// =============================================================================
// THE READ-ONLY CLAIM, ASSERTED RATHER THAN STATED
// =============================================================================
// This session's regime is non-money BECAUSE the surface is read-only. Every
// mutating admin route writes an `admin_actions` row (INV-M6-01) and several are
// dual controlled (INV-M6-08), so the moment one appears the regime changes and
// the review changes with it.
//
// "There is no write path in this package" is exactly the kind of claim that
// stays true until someone adds a helper on a Friday. So it is a test: the
// public entry point may export no name that reads as an action. A route that
// arrives later fails this and the failure is the reminder that its session
// needed a different regime, an audit row and an RBAC matrix.
//
// IT MATCHES ON THE NAME AND THAT IS A REAL LIMIT. A mutation exported as
// `applyLiabilityView` would pass. The check is a tripwire on the ordinary
// spelling of the thing, not a proof of purity, and saying so is the difference
// between a control and a thing that reads like one.
// =============================================================================

const MUTATING_VERBS = [
  'create',
  'update',
  'delete',
  'insert',
  'write',
  'save',
  'post',
  'patch',
  'put',
  'approve',
  'freeze',
  'unfreeze',
  'restrict',
  'restore',
  'suppress',
  'override',
  'close',
  'enforce',
  'export',
  'grant',
  'revoke',
];

test('the public entry point exports nothing that reads as a mutation', () => {
  const offenders = Object.keys(admin).filter((name) =>
    MUTATING_VERBS.some((verb) => name.toLowerCase().startsWith(verb)),
  );
  expect(offenders).toEqual([]);
});

test('it does export the read surface the liability home page is built from', () => {
  for (const name of ['buildLiabilityHome', 'theThreeNumbers', 'assessDataTrust', 'render']) {
    expect(Object.hasOwn(admin, name)).toBe(true);
  }
});
