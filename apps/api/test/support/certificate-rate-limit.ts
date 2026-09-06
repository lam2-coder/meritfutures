// =============================================================================
// apps/api/test/support/certificate-rate-limit.ts
// =============================================================================
// THE STUB THE SUITES THAT ARE NOT ABOUT THE LIMIT INSTALL.
//
// ADR-347 put a fail-closed limiter ahead of both public certificate rows, so a
// process holding `UNWIRED_CERTIFICATE_RATE_LIMITER` answers `503` on every one
// of them. That is the control working, and it is the correct default: a route
// that served unmetered because nobody installed a counter is the failure the
// port exists to prevent. It also means six existing suites, none of which is
// about rate limiting, now have to say what limiter they run under.
//
// THEY SAY `ADMIT_EVERY_REQUEST`, AND THAT IS A DECLARATION RATHER THAN A
// CONVENIENCE. The alternative is a real limiter configured with large numbers,
// and it is worse in the way that matters here: a suite would then carry a
// hidden per-file request budget, and the case that eventually crossed it would
// fail somewhere else entirely, for a reason having nothing to do with what it
// asserts. A stub that admits has no budget to cross.
//
// IT IS IN THE TEST TREE AND NOT EXPORTED FROM `src/`. A permissive limiter
// shipped beside the control would be a bypass with a name, importable by
// anything, and the one thing a rate limiter must not have is a documented way
// past it. `vitest.config.ts` includes `test/**/*.test.ts`, so this file is
// collected by no project and runs as nothing; `packages/golden-loader/test/
// harness/environment.ts` is the precedent for a helper living here.
//
// WHAT ASSERTS THE REFUSAL INSTEAD is `test/certificate-rate-limit.test.ts`,
// which installs the real limiter, drives it over its threshold, stays under it,
// and removes the configuration. A suite that installs this stub is asserting
// something else and says so by installing it.
// =============================================================================

import {
  useCertificateRateLimiter,
  type CertificateRateLimiter,
} from '../../src/certificate-rate-limit.ts';

/** A limiter that counts nothing and admits everything. */
export const ADMIT_EVERY_REQUEST: CertificateRateLimiter = {
  check: () => ({ allowed: true }),
};

/** Install {@link ADMIT_EVERY_REQUEST}. Pair with `resetCertificateRateLimiter`. */
export function admitEveryRequest(): void {
  useCertificateRateLimiter(ADMIT_EVERY_REQUEST);
}
