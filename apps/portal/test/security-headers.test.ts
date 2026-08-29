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
// ASSERTED. A snapshot of the string would survive the app growing a `<form>`,
// which is the one change that makes `form-action 'none'` wrong. The form
// census below is read out of `src/` on every run for exactly that reason.
//
// IT DOES NOT BUILD THE APP. `next build` is CI-07's and takes seconds this
// suite does not have; ADR-223 section 6 records the browser run instead, which
// loaded twelve documents of this app under this policy, eleven of them
// server-rendered on demand, and recorded zero violations. What this file can
// assert without a build, it asserts.

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

/** Files that render a `<style>` element, which is what forces `style-src`. */
function styleFiles(): string[] {
  return sources(join(APP_ROOT, 'src')).filter((f) => {
    const s = readFileSync(f, 'utf8');
    return /<style[\s>]/.test(s) || /createElement\(\s*'style'/.test(s);
  });
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

test('the policy is the eleven directives ADR-223 rules for a public surface', async () => {
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
  // an injected script on this origin can reach no other origin, the admin's
  // included, and no hostname had to be written down to say so.
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

test('form-action is none, and this app contains no form element', async () => {
  // THE DERIVATION, NOT A SNAPSHOT. The day a form lands in this app this
  // directive is wrong, and this is the line that says so.
  expect(formFiles()).toEqual([]);
  expect(directives((await config()).CONTENT_SECURITY_POLICY).get('form-action')).toEqual([
    "'none'",
  ]);
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

test("style-src carries 'unsafe-inline', and on this app it is forced twice over", async () => {
  // `_not-found`, `_global-error`, `pages/404` and `pages/500` each ship one
  // `<style>` element and four to seven `style=` attributes that Next writes
  // itself, in all three UI deployables. THIS APP ADDS ITS OWN, which is why
  // the census below is read rather than described: the calendar segment and
  // the referrals screen each render a `<style>` element carrying the segment
  // stylesheet, and a hash would have to move with that string on every edit.
  const d = directives((await config()).CONTENT_SECURITY_POLICY);
  expect(d.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
  expect(styleFiles().length).toBeGreaterThan(0);
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
