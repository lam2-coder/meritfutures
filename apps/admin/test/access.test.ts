import { describe, expect, test } from 'vitest';

import {
  ADMIN_ORIGIN_VAR,
  OriginError,
  PUBLIC_ORIGIN_VARS,
  resolveAdminOrigin,
} from '../src/origin.ts';
import { ADMIN_ROLES, RoleError, mayReadLiabilityHome, requireAdminRole } from '../src/roles.ts';

// =============================================================================
// M6-A: who may open the page, and what it is served from
// =============================================================================
// EVERY HOSTNAME BELOW IS A RESERVED TEST DOMAIN. ADR-012 keeps the real origin
// out of the tree, and a fixture is part of the tree.
// =============================================================================

describe('M6-A-16: the role set is closed and nothing defaults', () => {
  test.each([...ADMIN_ROLES])('%s resolves and may read the liability home page', (role) => {
    expect(requireAdminRole(role)).toBe(role);
    expect(mayReadLiabilityHome(requireAdminRole(role))).toBe(true);
  });

  test('the set is exactly API_CONTRACT section 8 three', () => {
    expect([...ADMIN_ROLES]).toEqual(['owner', 'ops', 'readonly']);
  });

  test.each(['admin', 'support', 'OWNER', '', 'read-only'])(
    '%s is refused rather than defaulted to readonly',
    (value) => {
      expect(() => requireAdminRole(value)).toThrow(RoleError);
    },
  );
});

describe('M6-A-17: ADR-012, the origin comes from the environment and is never in the tree', () => {
  test('an unset variable is a deploy that has not been configured', () => {
    expect(() => resolveAdminOrigin({})).toThrow(OriginError);
    expect(() => resolveAdminOrigin({ [ADMIN_ORIGIN_VAR]: '   ' })).toThrow(OriginError);
  });

  test('a well-formed origin resolves', () => {
    const resolved = resolveAdminOrigin({ [ADMIN_ORIGIN_VAR]: 'https://ops.example.test' });
    expect(resolved.origin).toBe('https://ops.example.test');
    expect(resolved.host).toBe('ops.example.test');
  });

  test('cleartext is refused: the allowlist and the hardware key do not survive it', () => {
    expect(() => resolveAdminOrigin({ [ADMIN_ORIGIN_VAR]: 'http://ops.example.test' })).toThrow(
      OriginError,
    );
  });

  test('a path is the route-group scaffold spelled as configuration', () => {
    expect(() =>
      resolveAdminOrigin({ [ADMIN_ORIGIN_VAR]: 'https://app.example.test/admin' }),
    ).toThrow(OriginError);
  });

  test('a value that is not a URL is refused', () => {
    expect(() => resolveAdminOrigin({ [ADMIN_ORIGIN_VAR]: 'ops.example.test' })).toThrow(
      OriginError,
    );
  });
});

describe('M6-A-18: INV-M6-02, the admin host shares no cookie domain with a public surface', () => {
  test('a subdomain of the product is refused', () => {
    expect(() =>
      resolveAdminOrigin({
        [ADMIN_ORIGIN_VAR]: 'https://admin.example.test',
        SITE_ORIGIN: 'https://example.test',
      }),
    ).toThrow(OriginError);
  });

  test('containment is refused in the other direction too', () => {
    expect(() =>
      resolveAdminOrigin({
        [ADMIN_ORIGIN_VAR]: 'https://example.test',
        PORTAL_ORIGIN: 'https://app.example.test',
      }),
    ).toThrow(OriginError);
  });

  test('an identical host is refused', () => {
    expect(() =>
      resolveAdminOrigin({
        [ADMIN_ORIGIN_VAR]: 'https://example.test',
        SITE_ORIGIN: 'https://example.test',
      }),
    ).toThrow(OriginError);
  });

  test('a separate apex passes and the check reports what it ran against', () => {
    const resolved = resolveAdminOrigin({
      [ADMIN_ORIGIN_VAR]: 'https://ops.example.invalid',
      SITE_ORIGIN: 'https://example.test',
      PORTAL_ORIGIN: 'https://app.example.test',
    });
    expect(resolved.separation.ran).toBe(true);
    expect(resolved.separation.checkedAgainst).toEqual([...PUBLIC_ORIGIN_VARS]);
  });

  test('with no public origins present the check reports NOT RUN, never passed', () => {
    const resolved = resolveAdminOrigin({ [ADMIN_ORIGIN_VAR]: 'https://ops.example.invalid' });
    expect(resolved.separation.ran).toBe(false);
    expect(resolved.separation.checkedAgainst).toEqual([]);
    expect(resolved.separation.note).toContain('NOT RUN');
  });
});
