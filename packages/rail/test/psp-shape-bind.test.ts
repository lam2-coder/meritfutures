// =============================================================================
// packages/rail/test/psp-shape-bind.test.ts
// =============================================================================
// P5 SECTION 8 SAYS THIS PACKAGE IS BUILT ON `packages/psp`'s SHAPE AND NOT ITS
// TYPE. THIS FILE IS WHAT MAKES THAT A CHECKED CLAIM RATHER THAN A SENTENCE.
//
// It reads `packages/psp/src/port.ts` and `webhook.ts` AS TEXT and asserts three
// things a reader would otherwise have to take on trust:
//
//   1. `PspId` REALLY IS CLOSED AT TWO. The whole reason this package exists
//      rather than calling that one is that there is no honest value to pass.
//      If a third member ever lands, the argument changes and this goes red.
//   2. THE REFUSAL VOCABULARIES AGREE, member for member and in the same order,
//      on the seven this rail shares. Two closed sets that disagree are two
//      receivers reporting different security events for the same thing. The
//      eighth, `replay_detected`, is this rail's own and is asserted as an
//      ADDITION rather than as a divergence.
//   3. THE ORDER IS THE SAME ORDER. Digest, then window, then parse. Three
//      implementations of one ordering is three chances to get it wrong, and
//      `apps/api/test/rise-webhook-bind.test.ts` is the same instrument for the
//      third one.
//
// IT ASSERTS AGREEMENT AND NOT SAMENESS. This port's event identity carries a
// transfer id and the PSP's does not, because API_CONTRACT section 10's own
// table anchors the two rows differently. What must agree is the ORDER and the
// REFUSALS.
//
// AND IT BINDS THE FAKE'S SIGNED-BYTES SHAPE, because `webhook.test.ts`'s
// `signBytes` helper re-computes a MAC and a helper that drifted from the
// implementation would sign bytes nothing verifies while every case still
// passed for the wrong reason.
// =============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { RAIL_WEBHOOK_WINDOW_SECONDS } from '../src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

const PSP_PORT = read('packages', 'psp', 'src', 'port.ts');
const PSP_WEBHOOK = read('packages', 'psp', 'src', 'webhook.ts');
const RAIL_PORT = read('packages', 'rail', 'src', 'port.ts');
const RAIL_WEBHOOK = read('packages', 'rail', 'src', 'webhook.ts');
const RAIL_SANDBOX = read('packages', 'rail', 'src', 'fakes', 'sandbox.ts');
const COMMERCE = read('packages', 'db', 'migrations', '0006_commerce.sql');

/** The members of one exported string-union type, in declaration order. */
function unionMembers(source: string, name: string): readonly string[] {
  const at = source.indexOf(`export type ${name} =`);
  expect(at, `${name} is declared`).toBeGreaterThan(-1);
  const body = source.slice(at, source.indexOf(';', at));
  return [...body.matchAll(/'([a-z_]+)'/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));
}

describe('PspId really is closed at two, which is why this package exists', () => {
  test('the type declares exactly psp_a and psp_b', () => {
    expect(unionMembers(PSP_PORT, 'PspId')).toStrictEqual(['psp_a', 'psp_b']);
  });

  test('the CHECK on purchases.psp is what closes it', () => {
    expect(COMMERCE).toMatch(/psp\s+text\s+NOT NULL\s+CHECK \(psp IN \('psp_a', 'psp_b'\)\)/);
  });

  test('this port brands itself with its OWN provider type and borrows neither', () => {
    expect(RAIL_PORT).toContain('export type RailProviderId =');
    expect(RAIL_PORT).not.toContain("from '@merit/psp'");
    expect(RAIL_WEBHOOK).not.toContain("from '@merit/psp'");
    expect(RAIL_SANDBOX).not.toContain("from '@merit/psp'");
  });
});

describe('the refusal vocabularies agree on the seven, and this rail adds one', () => {
  const psp = unionMembers(PSP_PORT, 'WebhookRefusal');
  const rail = unionMembers(RAIL_PORT, 'RailWebhookRefusal');

  test('the PSP set is the seven it has always been', () => {
    expect(psp).toStrictEqual([
      'signature_header_missing',
      'signature_header_repeated',
      'signature_malformed',
      'signature_mismatch',
      'timestamp_outside_window',
      'payload_not_json_object',
      'event_identity_missing',
    ]);
  });

  test('this rails first seven are those seven, member for member and in order', () => {
    expect(rail.slice(0, psp.length)).toStrictEqual(psp);
  });

  test('the eighth is replay_detected, and it is an ADDITION rather than a divergence', () => {
    expect(rail).toHaveLength(psp.length + 1);
    expect(rail[psp.length]).toBe('replay_detected');
  });

  test('the PSP set has no replay member, so the addition is not a rename of one', () => {
    expect(psp).not.toContain('replay_detected');
  });
});

describe('the ordering is the same ordering, in the same three steps', () => {
  /** The body of one `export function name(...)`, as written. */
  function functionBody(source: string, name: string): string {
    const at = source.indexOf(`export function ${name}(`);
    expect(at, `${name} is declared`).toBeGreaterThan(-1);
    // The next `export ` at column zero ends it. Every verifier in this tree is
    // followed by one.
    const rest = source.slice(at);
    const end = rest.indexOf('\nexport ', 1);
    return end === -1 ? rest : rest.slice(0, end);
  }

  const pspBody = functionBody(PSP_WEBHOOK, 'verifyHmacWebhook');
  const railBody = functionBody(RAIL_WEBHOOK, 'verifyRailWebhook');

  /**
   * Where each step happens in a body, by an expression only that step uses.
   *
   * THE WINDOW NEEDLE IS THE COMPARISON AND NOT THE VARIABLE. Both files resolve
   * `windowSeconds` from their arguments at the top of the function, so a needle
   * of the NAME reports the resolution rather than the check and both orderings
   * read as window-before-digest. This was watched happening.
   */
  const steps = (body: string): { digest: number; window: number; parse: number } => ({
    digest: body.indexOf("createHmac('sha256'"),
    window: body.indexOf('skew > windowSeconds'),
    parse: body.indexOf('JSON.parse'),
  });

  test('the PSP verifier digests, then windows, then parses', () => {
    const at = steps(pspBody);
    expect(at.digest).toBeGreaterThan(-1);
    expect(at.window).toBeGreaterThan(at.digest);
    expect(at.parse).toBeGreaterThan(at.window);
  });

  test('this verifier does the same three in the same order', () => {
    const at = steps(railBody);
    expect(at.digest).toBeGreaterThan(-1);
    expect(at.window).toBeGreaterThan(at.digest);
    expect(at.parse).toBeGreaterThan(at.window);
  });

  test('both compare in constant time and both check the length first', () => {
    for (const [what, body] of [
      ['psp', pspBody],
      ['rail', railBody],
    ] as const) {
      expect(body, what).toContain('timingSafeEqual');
      expect(body, what).toContain('.length !== expected.length');
    }
  });

  test('both check the window in BOTH directions, which Math.abs is', () => {
    expect(pspBody).toContain('Math.abs(');
    expect(railBody).toContain('Math.abs(');
  });

  test('both decode UTF-8 with fatal: true, so a malformed body cannot become parseable', () => {
    expect(pspBody).toContain("new TextDecoder('utf-8', { fatal: true })");
    expect(railBody).toContain("new TextDecoder('utf-8', { fatal: true })");
  });

  test('both carry API_CONTRACT section 10s five-minute window as the same number', () => {
    expect(PSP_WEBHOOK).toContain('export const WEBHOOK_WINDOW_SECONDS = 300;');
    expect(RAIL_WEBHOOK_WINDOW_SECONDS).toBe(300);
  });
});

describe('the fakes signed-bytes shape, bound so the suites helper cannot drift', () => {
  test('the sandbox signs timestamp, newline, nonce, newline, then the body', () => {
    expect(RAIL_SANDBOX).toContain(
      'return railConcatBytes(railUtf8(`${timestamp}\\n${nonce}\\n`), raw);',
    );
  });

  test('the three header names are the ones the suite presents', () => {
    expect(RAIL_SANDBOX).toContain("export const RAIL_TIMESTAMP_HEADER = 'rail-timestamp';");
    expect(RAIL_SANDBOX).toContain("export const RAIL_NONCE_HEADER = 'rail-nonce';");
    expect(RAIL_SANDBOX).toContain("export const RAIL_SIGNATURE_HEADER = 'rail-signature';");
  });

  test('the helper in webhook.test.ts builds the same prefix', () => {
    const suite = read('packages', 'rail', 'test', 'webhook.test.ts');
    expect(suite).toContain('new TextEncoder().encode(`${timestamp}\\n${nonce}\\n`)');
  });
});

describe('this package declares nothing, which is what keeps RI-08 satisfiable', () => {
  const manifest: Record<string, unknown> = JSON.parse(
    read('packages', 'rail', 'package.json'),
  ) as Record<string, unknown>;

  test('no dependencies field of any kind names a workspace package', () => {
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      const declared = (manifest[field] ?? {}) as Record<string, string>;
      for (const [name, spec] of Object.entries(declared)) {
        expect(spec, `${field}.${name}`).not.toContain('workspace:');
        expect(name, `${field}.${name}`).not.toMatch(/^@merit\//);
      }
    }
  });

  test('there is no runtime dependencies field at all', () => {
    expect(manifest['dependencies']).toBeUndefined();
  });

  test('every devDependency is a catalog entry, so VG-12 is asked to admit nothing', () => {
    const dev = manifest['devDependencies'] as Record<string, string>;
    expect(Object.keys(dev).sort()).toStrictEqual(['@types/node', 'typescript', 'vitest']);
    for (const spec of Object.values(dev)) expect(spec).toBe('catalog:');
  });

  test('the only node import anywhere in this package is node:crypto', () => {
    for (const name of [
      ['port.ts'],
      ['webhook.ts'],
      ['replay.ts'],
      ['settlement.ts'],
      ['index.ts'],
      ['fakes', 'sandbox.ts'],
    ]) {
      const source = read('packages', 'rail', 'src', ...name);
      const builtins = [...source.matchAll(/from '(node:[a-z/]+)'/g)].flatMap((m) =>
        m[1] === undefined ? [] : [m[1]],
      );
      for (const builtin of builtins) expect(builtin, name.join('/')).toBe('node:crypto');
    }
  });
});
