import { expect, test } from 'vitest';

import {
  API_SURFACES,
  BASE_PATH,
  LIVENESS_PATH,
  OPERATOR_PREFIXES,
  SERVICES,
  SERVICE_BY_SURFACE,
  SURFACE_VAR,
  SurfaceError,
  classifyPath,
  main,
  resolveSurface,
  surfaceServes,
} from '../src/index.ts';

// CI-02, the `unit` project.
//
// WHAT THIS SUITE IS FOR. ADR-083's structural half is that the public
// deployment answers 404 for an operator path by NEVER REGISTERING IT. Nothing
// registers anything yet, so what is assertable today is the partition the
// registration will read, and that is what is asserted. The suite that watches
// a real 404 arrives with the routes.

test('the api deploys as two services, one per surface', () => {
  expect(API_SURFACES).toStrictEqual(['public', 'operator']);
  expect(SERVICE_BY_SURFACE).toStrictEqual({ public: 'api', operator: 'api-admin' });
  expect(new Set(SERVICES).size).toBe(SERVICES.length);
});

test('the base path is API_CONTRACT section 1s, in one place', () => {
  expect(BASE_PATH).toBe('/api/v1');
});

// -----------------------------------------------------------------------------
// The partition. API_CONTRACT sections 8 and 9 are headed "admin origin only".
// -----------------------------------------------------------------------------

test('no operator path is served by the public surface', () => {
  const operator = [
    '/admin/liability',
    '/admin/accounts/:accountId',
    '/admin/accounts/:accountId/freeze',
    '/admin/flags',
    '/admin/plans/versions/:versionId/publish',
    '/internal/batch/run',
    '/internal/recon/status',
    '/internal/jobs',
    '/internal/health/deep',
  ];
  for (const path of operator) {
    expect(classifyPath(path), path).toBe('operator');
    expect(surfaceServes('public', path), path).toBe(false);
    expect(surfaceServes('operator', path), path).toBe(true);
  }
});

test('the public contract is served by the public surface and by nothing else', () => {
  const publicPaths = [
    '/auth/otp',
    '/auth/verify',
    '/plans',
    '/plans/:planId/versions/:version',
    '/checkout',
    '/accounts/:accountId/eligibility',
    '/accounts/:accountId/payout',
    '/kyc/session',
    '/affiliate/stats',
    '/webhooks/psp/:provider',
    '/webhooks/rise',
    '/webhooks/kyc/:provider',
  ];
  for (const path of publicPaths) {
    expect(classifyPath(path), path).toBe('public');
    expect(surfaceServes('public', path), path).toBe(true);
    expect(surfaceServes('operator', path), path).toBe(false);
  }
});

// THE ROW A PARTITION BY SECTION NUMBER GETS WRONG. API_CONTRACT section 9 is
// headed "admin origin only" and its first row is `GET /health`, marked Public.
// Reading the heading puts the liveness probe on the admin origin and leaves
// the public deployment with nothing for the platform to poll.
test('liveness is on both surfaces and the deep health check is not', () => {
  expect(classifyPath(LIVENESS_PATH)).toBe('liveness');
  expect(surfaceServes('public', LIVENESS_PATH)).toBe(true);
  expect(surfaceServes('operator', LIVENESS_PATH)).toBe(true);

  expect(classifyPath('/internal/health/deep')).toBe('operator');
  expect(surfaceServes('public', '/internal/health/deep')).toBe(false);
});

// A bare `startsWith` matches `/administration` and `/internally`, and a rule
// that admits either has stopped being a prefix rule.
test('the prefix rule is a path-segment rule', () => {
  for (const prefix of OPERATOR_PREFIXES) {
    expect(classifyPath(prefix)).toBe('operator');
    expect(classifyPath(`${prefix}/x`)).toBe('operator');
    expect(classifyPath(`${prefix}istration`)).toBe('public');
  }
});

// THE ASSERTION THAT WOULD HAVE CAUGHT THE FOOTGUN. `/api/v1/internal/jobs`
// passes a leading-slash test and then matches neither operator prefix, so a
// classifier that only checked the slash would call an operator route public
// and report nothing. It is refused at the shape check instead.
test('a path carrying the base path is refused rather than silently classified', () => {
  expect(() => classifyPath(`${BASE_PATH}/internal/jobs`)).toThrow(SurfaceError);
  expect(() => classifyPath(BASE_PATH)).toThrow(SurfaceError);
  expect(() => classifyPath('internal/jobs')).toThrow(SurfaceError);
  // `/apiary` is not the base path and must survive, or the guard has become a
  // substring match of the kind the prefix rule above already refuses.
  expect(classifyPath('/apiary')).toBe('public');
});

// -----------------------------------------------------------------------------
// The surface is resolved and never guessed.
// -----------------------------------------------------------------------------

test('an unset surface is a refusal and not a default', () => {
  expect(() => resolveSurface({})).toThrow(SurfaceError);
  expect(() => resolveSurface({ [SURFACE_VAR]: '   ' })).toThrow(SurfaceError);
});

test('the surface set is closed', () => {
  expect(() => resolveSurface({ [SURFACE_VAR]: 'admin' })).toThrow(SurfaceError);
  expect(resolveSurface({ [SURFACE_VAR]: 'public' })).toBe('public');
  expect(resolveSurface({ [SURFACE_VAR]: ' operator ' })).toBe('operator');
});

// AMENDED BY SESSION 209, AND THE HALF THAT WAS DELETED IS SAID RATHER THAN
// QUIETLY DROPPED. When this test was written `main` resolved the surface and
// logged; it now discovers modules, composes them and LISTENS, so calling it
// with a valid surface binds a socket, which is not a thing a unit test may do
// on a fixed port. The positive half moved to a real process: `pnpm start` under
// `MERIT_API_SURFACE=public` is run in session 209's log with the status codes
// it answered, which is stronger evidence than this assertion ever was.
//
// THE HALF THAT STAYS IS THE ONE THAT MATTERS: the refusal happens BEFORE
// anything is read off disk and before anything listens, so a deployment that
// has not been configured never reaches a port at all.
test('an unconfigured deployable refuses before it discovers or listens', async () => {
  await expect(main({})).rejects.toThrow(SurfaceError);
  await expect(main({ [SURFACE_VAR]: 'admin' })).rejects.toThrow(SurfaceError);
});
