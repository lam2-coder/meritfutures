import { describe, expect, test } from 'vitest';

import {
  ADMIN_IDP_AUDIENCE_VAR,
  ADMIN_IDP_ISSUER_VAR,
  ADMIN_IDP_JWKS_URL_VAR,
  ADMIN_IDP_VARS,
  missingAdminIdpVars,
  operatorFromAssertion,
  refusingAssertionVerifier,
  resolveOperatorSession,
  type OperatorAssertion,
  type OperatorRecord,
  type OperatorSessionRecord,
} from '../src/operator-identity.ts';

// =============================================================================
// operator-identity.test.ts
// =============================================================================
// ADR-237. THE DIRECTORY AND THE SEAM, EXERCISED WITHOUT A DATABASE AND WITHOUT
// AN IDENTITY PROVIDER, which is the whole reason the two decision functions
// take rows rather than fetch them.
//
// WHAT THIS SUITE IS FOR, STATED SO IT IS NOT MISREAD. It proves the decisions
// are total and that every refusal is reachable. It proves NOTHING about
// whether an assertion is real, because nothing in this repository can verify
// one; that is the seam, and the assertions below pin it SHUT rather than
// pretending it is open.
// =============================================================================

const ISSUER = 'https://idp.example.invalid/';
const AUDIENCE = 'merit-admin';
const JWKS = 'https://idp.example.invalid/.well-known/jwks.json';

const CONFIGURED = {
  [ADMIN_IDP_ISSUER_VAR]: ISSUER,
  [ADMIN_IDP_AUDIENCE_VAR]: AUDIENCE,
  [ADMIN_IDP_JWKS_URL_VAR]: JWKS,
};

const ASSERTION: OperatorAssertion = {
  issuer: ISSUER,
  subject: 'subject-one',
  assertionId: 'assertion-one',
};

function operator(overrides: Partial<OperatorRecord> = {}): OperatorRecord {
  return {
    actorId: 'ops.one',
    role: 'ops',
    status: 'active',
    idpIssuer: ISSUER,
    idpSubject: 'subject-one',
    ...overrides,
  };
}

function session(overrides: Partial<OperatorSessionRecord> = {}): OperatorSessionRecord {
  return {
    operator: operator(),
    expiresAt: new Date('2026-08-29T12:00:00Z'),
    revokedAt: null,
    idpAssertionId: 'assertion-one',
    ...overrides,
  };
}

const BEFORE_EXPIRY = new Date('2026-08-29T11:59:59Z');

// -----------------------------------------------------------------------------
// The configuration
// -----------------------------------------------------------------------------

describe('what a deployment must supply, named and never valued', () => {
  // THE LIST IS DERIVED FROM THE THREE CONSTANTS AND THIS ASSERTS THE
  // DERIVATION. A fourth name added to one and not the other would be a
  // requirement no refusal reports, which is a control that goes quiet rather
  // than red.
  test('every named variable is in the list a refusal reports', () => {
    expect([...ADMIN_IDP_VARS].sort()).toEqual(
      [ADMIN_IDP_ISSUER_VAR, ADMIN_IDP_AUDIENCE_VAR, ADMIN_IDP_JWKS_URL_VAR].sort(),
    );
  });

  // ADR-012. THE NAMES ARE HERE AND NO VALUE IS, on `MERIT_TURNSTILE_SECRET`'s
  // precedent. The `.invalid` TLD above is reserved by RFC 2606 and is a
  // fixture rather than a hostname anybody deploys.
  test('every name is a MERIT_ variable and none of them is a value', () => {
    for (const name of ADMIN_IDP_VARS) expect(name).toMatch(/^MERIT_ADMIN_IDP_[A-Z_]+$/);
  });

  test('an empty environment is missing all three', () => {
    expect(missingAdminIdpVars({})).toEqual([...ADMIN_IDP_VARS]);
  });

  // A BLANK IS ABSENT, and this is the case that separates this check from a
  // key test: a platform writes an empty string when a secret was declared and
  // never filled in, and reading that as configured points the control at
  // nothing while reporting that it is armed.
  test('a blank or whitespace value is missing, not configured', () => {
    expect(missingAdminIdpVars({ ...CONFIGURED, [ADMIN_IDP_ISSUER_VAR]: '' })).toEqual([
      ADMIN_IDP_ISSUER_VAR,
    ]);
    expect(missingAdminIdpVars({ ...CONFIGURED, [ADMIN_IDP_JWKS_URL_VAR]: '   ' })).toEqual([
      ADMIN_IDP_JWKS_URL_VAR,
    ]);
  });

  test('a fully configured environment is missing nothing', () => {
    expect(missingAdminIdpVars(CONFIGURED)).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// The seam, pinned shut
// -----------------------------------------------------------------------------

describe('the assertion verifier refuses in both arms and passes in neither', () => {
  test('an unconfigured deployment is `unconfigured` and names what is missing', async () => {
    const outcome = await refusingAssertionVerifier({}).verify('anything at all');
    expect(outcome.outcome).toBe('unconfigured');
    if (outcome.outcome !== 'unconfigured') throw new Error('unreachable');
    for (const name of ADMIN_IDP_VARS) expect(outcome.detail).toContain(name);
  });

  // THE ASSERTION THAT MAKES THIS A SEAM RATHER THAN A HOLE. Setting the three
  // variables is necessary and is NOT sufficient, because the verifier that
  // would use them is unwritten. A deployment that configures its way to a pass
  // would be a door opened by an environment file.
  test('a fully configured deployment is `unavailable` and still not a pass', async () => {
    const outcome = await refusingAssertionVerifier(CONFIGURED).verify('anything at all');
    expect(outcome.outcome).toBe('unavailable');
  });

  // TOTALITY OVER EVERY SUBSET OF THE CONFIGURATION. Eight environments, and
  // `verified` appears in none of them. A future edit that makes one arm admit
  // turns this red without anybody having to think of the case.
  test('no subset of the configuration produces a verified outcome', async () => {
    for (let mask = 0; mask < 8; mask += 1) {
      const env: Record<string, string> = {};
      ADMIN_IDP_VARS.forEach((name, index) => {
        if ((mask & (1 << index)) !== 0) env[name] = CONFIGURED[name] ?? '';
      });
      const outcome = await refusingAssertionVerifier(env).verify('anything at all');
      expect(outcome.outcome, `mask ${String(mask)}`).not.toBe('verified');
    }
  });

  // A PRESENTED VALUE CHANGES NOTHING, which is the property that says no
  // secret this deployable holds can mint an operator. There is no string a
  // caller can send that this function treats as proof.
  test('no presented value is ever treated as proof', async () => {
    const verifier = refusingAssertionVerifier(CONFIGURED);
    for (const presented of ['', 'admin', ISSUER, JSON.stringify(ASSERTION)]) {
      const outcome = await verifier.verify(presented);
      expect(outcome.outcome).toBe('unavailable');
    }
  });
});

// -----------------------------------------------------------------------------
// The directory join
// -----------------------------------------------------------------------------

describe('a verified assertion becomes an operator, or it does not and the reason is named', () => {
  test('a matched, active operator with a known role resolves', () => {
    const resolution = operatorFromAssertion(ASSERTION, operator());
    expect(resolution.kind).toBe('operator');
    if (resolution.kind !== 'operator') throw new Error('unreachable');
    expect(resolution.principal).toEqual({ actorId: 'ops.one', role: 'ops' });
  });

  // THE ROLE COMES OFF THE ROW AND NEVER OFF THE ASSERTION, which is ADR-237's
  // ruling and not an implementation detail. There is no field on
  // `OperatorAssertion` a provider could set to change this, and the type is
  // where that is enforced; this asserts the consequence: the same assertion
  // against two rows yields two roles.
  test('the role is the directory row', () => {
    for (const role of ['owner', 'ops', 'readonly']) {
      const resolution = operatorFromAssertion(ASSERTION, operator({ role }));
      if (resolution.kind !== 'operator') throw new Error(`${role} did not resolve`);
      expect(resolution.principal.role).toBe(role);
    }
  });

  // PROVISIONING IS NOT SOMETHING AN ASSERTION PERFORMS. A first sign-in that
  // creates its own operator row is the login this slice exists to refuse.
  test('a subject in no row is refused and nothing is created', () => {
    expect(operatorFromAssertion(ASSERTION, null).kind).toBe('no-such-operator');
  });

  // THE ONE ARM THAT CAN ONLY BE REACHED BY A DEFECT IN THE CALLER'S QUERY. A
  // subject claim is unique only within its issuer, so a query matching the
  // subject alone resolves a second provider's subject to the first
  // provider's operator.
  test('a row matched on the subject alone is refused as mismatched', () => {
    const otherProvider = operator({ idpIssuer: 'https://other.example.invalid/' });
    expect(operatorFromAssertion(ASSERTION, otherProvider).kind).toBe('mismatched');
    const otherSubject = operator({ idpSubject: 'subject-two' });
    expect(operatorFromAssertion(ASSERTION, otherSubject).kind).toBe('mismatched');
  });

  // `0073` USES NULL FOR AN OPERATOR WHO CANNOT SIGN IN, and equality never
  // matches NULL, so a row carrying one arrived through a query that did
  // something other than equality. It is refused rather than admitted.
  test('an operator with no provider pair is unreachable rather than admitted', () => {
    expect(
      operatorFromAssertion(ASSERTION, operator({ idpIssuer: null, idpSubject: null })).kind,
    ).toBe('mismatched');
    expect(operatorFromAssertion(ASSERTION, operator({ idpSubject: null })).kind).toBe(
      'mismatched',
    );
    expect(operatorFromAssertion(ASSERTION, operator({ idpIssuer: null })).kind).toBe('mismatched');
  });

  // REFUSING ON THE STATUS IS THE OFFBOARDING. The row can never be deleted,
  // because `admin_actions_actor_is_an_operator` is ON DELETE RESTRICT and an
  // operator who has acted is named in an append-only audit trail.
  test('a suspended operator is refused', () => {
    expect(operatorFromAssertion(ASSERTION, operator({ status: 'suspended' })).kind).toBe(
      'suspended',
    );
  });

  // NEVER DEFAULTED. A role string outside the closed set refuses, which is the
  // whole value of closing the set: a typo that quietly became `readonly` would
  // be a session granted by a misspelling.
  test('a role outside the closed set is refused and never defaulted', () => {
    for (const role of ['admin', 'Owner', 'OPS', '', 'superuser']) {
      const resolution = operatorFromAssertion(ASSERTION, operator({ role }));
      expect(resolution.kind, role).toBe('unusable-role');
    }
  });
});

// -----------------------------------------------------------------------------
// The session read
// -----------------------------------------------------------------------------

describe('what a presented admin cookie resolves to', () => {
  test('a live session belonging to an active operator is an operator', () => {
    const lookup = resolveOperatorSession(session(), BEFORE_EXPIRY);
    expect(lookup.kind).toBe('operator');
    if (lookup.kind !== 'operator') throw new Error('unreachable');
    expect(lookup.principal).toEqual({ actorId: 'ops.one', role: 'ops' });
  });

  // A TOKEN NOBODY RECOGNISES IS 401 AND NOT 403, on `admin-reads.ts`'s stated
  // order: 403 to an anonymous caller would tell them the endpoint exists and
  // that the only thing missing is a factor.
  test('no row is unknown', () => {
    expect(resolveOperatorSession(null, BEFORE_EXPIRY).kind).toBe('unknown');
  });

  // EXPIRY IS EXCLUSIVE AND THE BOUNDARY IS THE ASSERTION. A session at exactly
  // its expiry is over, which is the direction that refuses; taking the other
  // direction would extend every session by one clock tick and would be
  // invisible in any test that did not name the instant.
  test('expiry is exclusive at the boundary instant', () => {
    const row = session();
    expect(resolveOperatorSession(row, new Date(row.expiresAt.getTime() - 1)).kind).toBe(
      'operator',
    );
    expect(resolveOperatorSession(row, row.expiresAt).kind).toBe('unknown');
    expect(resolveOperatorSession(row, new Date(row.expiresAt.getTime() + 1)).kind).toBe('unknown');
  });

  // A REVOKED SESSION IS `unknown` AND NOT `not-an-operator`, even while it is
  // still inside its expiry. Reporting it as a role problem would tell a caller
  // whose session was revoked mid-incident that the door exists and their role
  // is wrong, which is a different and false statement.
  test('a revoked session is unknown even before its expiry', () => {
    const revoked = session({ revokedAt: new Date('2026-08-29T11:00:00Z') });
    expect(resolveOperatorSession(revoked, BEFORE_EXPIRY).kind).toBe('unknown');
  });

  // 403 AND NOT 401, which is `AdminSessionLookup`'s third arm and the reason it
  // has three: a live session belonging to somebody who may not act is
  // authenticated and not permitted.
  test('a live session for a suspended operator is not-an-operator', () => {
    const suspended = session({ operator: operator({ status: 'suspended' }) });
    expect(resolveOperatorSession(suspended, BEFORE_EXPIRY).kind).toBe('not-an-operator');
  });

  test('a live session carrying a role outside the closed set is not-an-operator', () => {
    const bad = session({ operator: operator({ role: 'superuser' }) });
    expect(resolveOperatorSession(bad, BEFORE_EXPIRY).kind).toBe('not-an-operator');
  });

  // TOTALITY. Every combination of the three inputs that decide the answer, and
  // the one that admits is the single all-good row. A later edit that admits a
  // revoked session or a suspended operator turns this red on the exact cell.
  test('exactly one of the eight input combinations admits', () => {
    const admitted: string[] = [];
    for (const revoked of [null, new Date('2026-08-29T11:00:00Z')])
      for (const status of ['active', 'suspended'])
        for (const role of ['ops', 'superuser']) {
          const row = session({ revokedAt: revoked, operator: operator({ status, role }) });
          const lookup = resolveOperatorSession(row, BEFORE_EXPIRY);
          if (lookup.kind === 'operator') admitted.push(`${String(revoked)}/${status}/${role}`);
        }
    expect(admitted).toEqual(['null/active/ops']);
  });
});

// -----------------------------------------------------------------------------
// The rule this whole file exists to keep
// -----------------------------------------------------------------------------

// NO CREDENTIAL IS DECLARED OR COMPARED IN THIS MODULE. `0002:280` states the
// rule for the schema and `packages/db/test/operator-role-vocabulary.test.ts`
// asserts it over the DDL; this is the same assertion over the code that would
// consume one. It reads the source rather than the exports, because a
// credential comparison is a statement inside a function and not a name in the
// export list.
test('the module declares no password, secret or local credential', async () => {
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '..', 'src', 'operator-identity.ts'), 'utf8');
  const statements = source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
    .join('\n');
  expect(statements.length).toBeGreaterThan(500);
  for (const banned of ['password', 'passphrase', 'apiKey', 'sharedKey', 'timingSafeEqual'])
    expect(statements, `the module names \`${banned}\``).not.toContain(banned);
});
