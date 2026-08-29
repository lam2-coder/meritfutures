import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

// CI-02, the `unit` project.
//
// WHAT THIS SUITE IS FOR. The constitution's Appendix D section D2 rules
// "strict CSP/HSTS/frame-deny" among the binding application controls, and
// until ADR-223 nothing in this repository set any of the three on any surface.
// The audit that measured that gap found the other half of it too: NO TEST
// ANYWHERE ASSERTED ANY SECURITY HEADER, so none of it would have failed if it
// had been added and later removed. This file is that half for this deployable.
//
// THE POLICY IS DERIVED FROM WHAT THIS APP EMITS, SO THE DERIVATION IS WHAT IS
// ASSERTED. A snapshot of the string would survive this console losing its one
// `<form>`, which is the change that makes `form-action 'self'` wider than it
// needs to be, and it would survive a form landing on the portal, which is the
// change that makes the PUBLIC surfaces' `'none'` wrong. Both censuses are read
// out of `src/` on every run for exactly that reason.
//
// AND THIS FILE CARRIES `INV-M6-02`, WHICH IS WHY IT READS THE TWO SIBLING
// CONFIGS. `M06:46` rules that "the admin origin shares no cookie, no CORS
// policy, and no CSP with any public surface" and `INFRA:71` concludes from it
// that "an XSS on the portal cannot reach the admin surface even in principle".
// That was a claim about a header nothing in this repository set. It is now a
// claim about three headers, and the two assertions that discharge it are that
// this console's policy is not either public one, and that NO policy of the
// three names a host, so none of them can span two origins.
//
// THE SIBLINGS ARE READ AS TEXT AND NEVER IMPORTED. `RI-04` refuses one
// deployable depending on another, and a cross-app import in a test is that
// dependency wearing a test's costume. ADR-221 set the precedent from the other
// direction, reading `routes/auth.ts`'s cookie templates out of
// `apps/api/test/csrf.test.ts` for an argument whose leg lived in another file.
//
// IT DOES NOT BUILD THE APP. `next build` is CI-07's and takes seconds this
// suite does not have; ADR-223 section 6 records the browser run instead, which
// loaded five documents of this console under this policy, submitted its one
// form under it, and recorded zero violations. What this file can assert
// without a build, it asserts.

const APP_ROOT = join(import.meta.dirname, '..');

/** The shape `next.config.mjs` exports beyond its default. */
interface HeaderRule {
  readonly source: string;
  readonly headers: readonly { readonly key: string; readonly value: string }[];
}
interface ConfigModule {
  readonly default: { readonly headers: () => Promise<readonly HeaderRule[]> };
  readonly CONTENT_SECURITY_POLICY: string;
  readonly STRICT_TRANSPORT_SECURITY: string;
  readonly CONTENT_TYPE_OPTIONS: string;
  readonly SECURITY_HEADERS: readonly { readonly key: string; readonly value: string }[];
}

/**
 * Load this app's config the way Next loads it, which is by EXECUTING it.
 *
 * The specifier is a value rather than a literal because `next.config.mjs` is
 * outside this package's `tsconfig` `include`, so a literal import would be a
 * type error about a file the runtime resolves perfectly well.
 */
async function config(): Promise<ConfigModule> {
  const url = new URL(`file://${join(APP_ROOT, 'next.config.mjs')}`).href;
  return (await import(/* @vite-ignore */ url)) as ConfigModule;
}

/** The policy as a map, which is how a browser reads it. */
function directives(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const clause of policy.split(';')) {
    const parts = clause.trim().split(/\s+/).filter(Boolean);
    const name = parts.shift();
    if (name !== undefined) out.set(name, parts);
  }
  return out;
}

/** Every source file under `src/`, so a census reads the app rather than a list. */
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const child = join(dir, entry);
    if (statSync(child).isDirectory()) sources(child, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(child);
  }
  return out;
}

/** Files that render a form element, by either spelling this workspace uses. */
function formFiles(): string[] {
  return sources(join(APP_ROOT, 'src')).filter((f) => {
    const s = readFileSync(f, 'utf8');
    return /<form[\s>]/.test(s) || /createElement\(\s*'form'/.test(s);
  });
}

test('headers() returns one rule covering every path, carrying the three headers', async () => {
  const mod = await config();
  const rules = await mod.default.headers();
  expect(rules).toEqual([{ source: '/:path*', headers: mod.SECURITY_HEADERS }]);
  expect(mod.SECURITY_HEADERS.map((h) => h.key)).toEqual([
    'Content-Security-Policy',
    'Strict-Transport-Security',
    'X-Content-Type-Options',
  ]);
  expect(mod.SECURITY_HEADERS.map((h) => h.value)).toEqual([
    mod.CONTENT_SECURITY_POLICY,
    mod.STRICT_TRANSPORT_SECURITY,
    mod.CONTENT_TYPE_OPTIONS,
  ]);
});

test('the policy is the eleven directives ADR-223 rules for the admin console', async () => {
  const d = directives((await config()).CONTENT_SECURITY_POLICY);
  expect([...d.keys()]).toEqual([
    'default-src',
    'base-uri',
    'object-src',
    'frame-src',
    'frame-ancestors',
    'form-action',
    'script-src',
    'style-src',
    'img-src',
    'font-src',
    'connect-src',
  ]);
  expect(d.get('default-src')).toEqual(["'self'"]);
  // No CSP level falls these three back to `default-src`, so a policy that
  // omits one permits it. `frame-ancestors 'none'` is D2's `frame-deny`.
  expect(d.get('frame-ancestors')).toEqual(["'none'"]);
  expect(d.get('base-uri')).toEqual(["'none'"]);
  expect(d.get('object-src')).toEqual(["'none'"]);
  // `connect-src 'self'` is the directive `INV-M6-02` rests on from this side:
  // an injected script on this origin can reach no other origin, and no
  // hostname had to be written down to say so.
  expect(d.get('connect-src')).toEqual(["'self'"]);
  expect(d.get('img-src')).toEqual(["'self'"]);
  expect(d.get('font-src')).toEqual(["'self'"]);
  // No page in the three UI deployables renders an `<iframe>`, so this one is
  // tighter than the `default-src` it would otherwise fall back to.
  expect(d.get('frame-src')).toEqual(["'none'"]);
});

test('no source expression names a host or a scheme', async () => {
  // ADR-012 keeps every real hostname out of this repository, and `INV-M6-02`
  // needs a policy that cannot span two origins. Both hold by construction when
  // every source expression is a quoted keyword, so THAT is asserted rather
  // than the absence of one particular hostname, which a rename would defeat.
  for (const [name, srcs] of directives((await config()).CONTENT_SECURITY_POLICY)) {
    for (const source of srcs) {
      expect(source, `${name} carries a non-keyword source`).toMatch(/^'[a-z-]+'$/);
    }
  }
});

test('form-action is self, and this console renders exactly one form', async () => {
  // THE DERIVATION, NOT A SNAPSHOT. `src/app/search/account-search.tsx` renders
  // the only `<form>` element in the three UI deployables, a `GET` to
  // `/search`, and `form-action` governs a `GET` submission as much as a `POST`
  // one. The day this console loses that form, `'self'` is wider than it needs
  // to be and this line says so.
  const forms = formFiles().map((f) => f.slice(APP_ROOT.length + 1));
  expect(forms).toEqual(['src/app/search/account-search.tsx']);
  expect(directives((await config()).CONTENT_SECURITY_POLICY).get('form-action')).toEqual([
    "'self'",
  ]);
});

// -----------------------------------------------------------------------------
// `INV-M6-02`, MADE MECHANICAL
// -----------------------------------------------------------------------------

/** A sibling deployable's policy, read as TEXT. Never imported, see the header. */
function siblingPolicy(app: 'portal' | 'site'): string {
  const path = join(APP_ROOT, '..', app, 'next.config.mjs');
  const source = readFileSync(path, 'utf8');
  const match = /export const CONTENT_SECURITY_POLICY\s*=\s*"([^"]*)"/.exec(source);
  if (match?.[1] === undefined)
    throw new Error(`${app}/next.config.mjs declares no CONTENT_SECURITY_POLICY`);
  return match[1];
}

test("INV-M6-02: this console's policy is neither public surface's", async () => {
  const admin = (await config()).CONTENT_SECURITY_POLICY;
  expect(admin).not.toBe(siblingPolicy('portal'));
  expect(admin).not.toBe(siblingPolicy('site'));
});

test('INV-M6-02: the difference is form-action and nothing else, and it is derived', async () => {
  // A difference that is merely PRESENT would be satisfied by a stray space.
  // This names WHICH directive differs, so a future edit that makes the three
  // policies diverge somewhere unconsidered turns it red rather than passing on
  // a technicality.
  const admin = directives((await config()).CONTENT_SECURITY_POLICY);
  for (const app of ['portal', 'site'] as const) {
    const other = directives(siblingPolicy(app));
    expect([...other.keys()], app).toEqual([...admin.keys()]);
    const differing = [...admin.keys()].filter(
      (k) => admin.get(k)?.join(' ') !== other.get(k)?.join(' '),
    );
    expect(differing, app).toEqual(['form-action']);
    expect(other.get('form-action'), app).toEqual(["'none'"]);
  }
  expect(admin.get('form-action')).toEqual(["'self'"]);
});

test('INV-M6-02: no policy of the three names a host, so none can span two origins', async () => {
  // THIS IS THE ASSERTION THAT DISCHARGES "EVEN IN PRINCIPLE", and it is
  // stronger than comparing the three strings. A policy whose every source
  // expression is a quoted keyword grants no origin but the one that served it,
  // whatever that origin turns out to be, so the separation survives a rename
  // and needs no hostname in this repository (ADR-012).
  const policies = [
    (await config()).CONTENT_SECURITY_POLICY,
    siblingPolicy('portal'),
    siblingPolicy('site'),
  ];
  for (const policy of policies) {
    for (const [name, srcs] of directives(policy)) {
      for (const source of srcs) {
        expect(source, `${name} in ${policy}`).toMatch(/^'[a-z-]+'$/);
      }
    }
  }
});

test("script-src carries 'unsafe-inline' and carries no nonce and no strict-dynamic", async () => {
  const d = directives((await config()).CONTENT_SECURITY_POLICY);
  // ADR-223 section 4. `next@16.3.2` writes the Flight payload into every
  // document as two inline `<script>` elements, and every document this app
  // serves is prerendered, so no nonce can be injected into one.
  expect(d.get('script-src')).toEqual(["'self'", "'unsafe-inline'"]);
  // AND THIS IS THE GUARD THAT MATTERS MORE THAN THE LINE ABOVE. A `nonce-`
  // token in a static header makes a browser IGNORE `'unsafe-inline'`, and
  // `'strict-dynamic'` makes it ignore `'self'` as well, so either token added
  // here would silently kill every script on every prerendered page. Measured
  // in ADR-223 section 4: eight refusals and a dead document.
  const policy = (await config()).CONTENT_SECURITY_POLICY;
  expect(policy).not.toContain('nonce-');
  expect(policy).not.toContain('strict-dynamic');
  expect(policy).not.toContain('unsafe-eval');
});

test("style-src carries 'unsafe-inline', forced by the framework's own documents", async () => {
  // `_not-found`, `_global-error`, `pages/404` and `pages/500` each ship one
  // `<style>` element and four to seven `style=` attributes that Next writes.
  // This app's own pages emit neither, which is why the directive is the
  // framework's cost rather than Merit's.
  const d = directives((await config()).CONTENT_SECURITY_POLICY);
  expect(d.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
});

test('HSTS is a year, covers subdomains, and does not ask for the preload list', async () => {
  const mod = await config();
  expect(mod.STRICT_TRANSPORT_SECURITY).toBe('max-age=31536000; includeSubDomains');
  // A preload-list entry ships inside browser binaries and binds every
  // subdomain of the apex. ADR-223's approval line puts it to the founder.
  expect(mod.STRICT_TRANSPORT_SECURITY).not.toContain('preload');
  expect(mod.CONTENT_TYPE_OPTIONS).toBe('nosniff');
});

test('X-Frame-Options is deliberately absent, and frame-ancestors is what refuses', async () => {
  const source = readFileSync(join(APP_ROOT, 'next.config.mjs'), 'utf8');
  const mod = await config();
  expect(mod.SECURITY_HEADERS.map((h) => h.key)).not.toContain('X-Frame-Options');
  // The refusal is a ruling rather than an omission, so the file has to say so.
  expect(source).toContain('X-Frame-Options');
  expect(directives(mod.CONTENT_SECURITY_POLICY).get('frame-ancestors')).toEqual(["'none'"]);
});
