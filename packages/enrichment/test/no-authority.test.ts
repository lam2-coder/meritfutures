// =============================================================================
// packages/enrichment/test/no-authority.test.ts
// =============================================================================
// THE SCORER HAS NO AUTHORITY, ASSERTED MECHANICALLY RATHER THAN PROMISED.
//
// `observe.test.ts` watches the three failure directions leave the checkout
// committed, which is the approval line. This file asserts the property that
// makes those three cases exhaustive rather than merely sampled: THERE IS
// NOTHING IN THIS PACKAGE THAT COULD REFUSE A CHECKOUT, so there is no fourth
// direction to have missed.
//
// It is a source-reading suite for the reason `packages/ledger`'s accessor bind
// is one and for the reason `repo-invariants.mjs` exists at all: a property
// about what the code DOES NOT CONTAIN cannot be asserted by calling it.
// ADR-042's finding applies in the other direction too, and it is the whole
// argument for this file: a comment saying "this decides nothing" is not a
// control, and a scorer that silently gains authority is the failure ADR-023's
// graduated rollout exists to foreclose.
//
// WHAT WOULD MAKE THESE ASSERTIONS FIRE. A `declineIf`, a threshold constant, a
// mapping to `risk_flags.severity`, a `boolean` returned from anything exported,
// a `Promise<ObserveOutcome>` on `observeEnrichment` instead of `Promise<void>`,
// or a third table in the write union. Each of those is a real design a future
// session could reach for in good faith, and each of them is step 3 arriving
// inside step 1's slice.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

import { stripComments } from '../../tooling/checks/strip-comments.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

/** Every `.ts` file under `src`, recursively, so a new subdirectory is covered by default. */
function sourceFiles(dir: string = SRC): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found.sort();
}

/**
 * The code, with comments removed.
 *
 * THE COMMENTS ARE WHERE THE FORBIDDEN WORDS BELONG. This package's headers
 * explain at length why there is no severity mapping and no threshold, and a
 * grep that could not tell an explanation from an implementation would force
 * those explanations out of the file to keep a test green. So the strip runs
 * first and every assertion below reads the code.
 */
function code(path: string): string {
  return stripComments(readFileSync(path, 'utf8'));
}

const FILES = sourceFiles();
const named = (path: string): string => relative(SRC, path);

describe('the package is not empty and this suite is reading it', () => {
  test('it covers every source file, including the fakes', () => {
    expect(FILES.map(named)).toEqual([
      'contract.ts',
      'fakes/vendors.ts',
      'index.ts',
      'observe.ts',
      'port.ts',
      'score.ts',
      'tx.ts',
    ]);
  });
});

describe('control 1: there is nothing for a call site to branch on', () => {
  test('`observeEnrichment` is declared to return `Promise<void>`', () => {
    expect(code(join(SRC, 'observe.ts'))).toMatch(
      /export async function observeEnrichment\(\s*tx: EnrichmentTx,\s*deps: ObserveDeps,?\s*\): Promise<void>/,
    );
  });

  test('nothing exported from this package returns a `boolean`', () => {
    for (const file of FILES) {
      expect(code(file)).not.toMatch(/export (async )?function [^)]*\)\s*:\s*(Promise<)?boolean/);
    }
  });

  test('no exported NAME carries a decision word', () => {
    // `allow(?!list)` RATHER THAN `allow`, and the exception is the point. An
    // ALLOWLIST is the disclosure control this package is built around; a name
    // that merely permitted something would be a decision. The two words share
    // five letters and nothing else.
    const forbidden =
      /decline|refuse|reject|block|deny|allow(?!list)|approve|verdict|severity|threshold/i;
    const barrel = code(join(SRC, 'index.ts'));
    const names = [...barrel.matchAll(/^\s*(?:type\s+)?([A-Za-z_][A-Za-z0-9_]*),?$/gm)].map(
      (m) => m[1] ?? '',
    );
    expect(names.length).toBeGreaterThan(20);
    for (const name of names) expect(name).not.toMatch(forbidden);
  });
});

describe('control 2: nothing here can reach the money-adjacent table', () => {
  test('`risk_flags` is never named as a registry key anywhere in the source', () => {
    for (const file of FILES) {
      expect(code(file)).not.toMatch(/['"]riskFlags['"]/);
    }
  });

  test('the write union is exactly the two `owned` tables this slice records into', () => {
    expect(code(join(SRC, 'tx.ts'))).toMatch(
      /export type EnrichmentWriteKey = 'identitySignals' \| 'integrationDispatches';/,
    );
  });

  test('there is no `deleteAt` on the restated handle, so an append-only table stays one', () => {
    expect(code(join(SRC, 'tx.ts'))).not.toMatch(/deleteAt/);
  });

  test('no function converts a score into a severity band', () => {
    for (const file of FILES) {
      // A `smallint CHECK (severity BETWEEN 1 AND 5)` is the shape a conversion
      // would produce, and the two numbers live one implicit conversion apart.
      expect(code(file)).not.toMatch(/RiskBp[^\n]*=>[^\n]*\b[1-5]\b/);
      expect(code(file)).not.toMatch(/severity/i);
    }
  });
});

describe('control 3: no threshold, because there is no beta data to have tuned one on', () => {
  test('the score is never compared against a constant in this package', () => {
    for (const file of FILES) {
      expect(code(file)).not.toMatch(/riskBp\s*(>=|<=|>|<|===|!==)/);
    }
  });

  test('the only exported numbers are the scale, the budget and the contract version', () => {
    const constants = new Set<string>();
    for (const file of FILES) {
      for (const match of code(file).matchAll(/export const ([A-Z][A-Z0-9_]*)\s*=\s*[-0-9]/g)) {
        constants.add(match[1] ?? '');
      }
    }
    expect([...constants].sort()).toEqual([
      'ENRICHMENT_CONTRACT_VERSION',
      'ENRICHMENT_TIMEOUT_MS',
      'SCORE_SCALE_BP',
    ]);
  });
});

describe('no floats, because this runs inside a money path even though it holds no money', () => {
  test('there is no decimal literal in the source', () => {
    for (const file of FILES) {
      const decimals = [...code(file).matchAll(/(?<![\w.])\d+\.\d+/g)].map((m) => m[0]);
      expect({ file: named(file), decimals }).toEqual({ file: named(file), decimals: [] });
    }
  });

  test('there is no `toFixed`, `parseFloat` or `Math.round` anywhere', () => {
    for (const file of FILES) {
      expect(code(file)).not.toMatch(/toFixed|parseFloat|Math\.round|Number\.parseFloat/);
    }
  });
});

describe('the package reaches nothing on its own', () => {
  const manifest: Record<string, unknown> = JSON.parse(
    readFileSync(join(HERE, '..', 'package.json'), 'utf8'),
  ) as Record<string, unknown>;

  test('it declares NO runtime dependency and no workspace dependency', () => {
    expect(manifest['dependencies']).toBeUndefined();
    expect(Object.keys(manifest['devDependencies'] as Record<string, string>).sort()).toEqual([
      '@types/node',
      'typescript',
      'vitest',
    ]);
  });

  test('it imports no database client and no HTTP client', () => {
    for (const file of FILES) {
      expect(code(file)).not.toMatch(/from '(pg|drizzle-orm|@merit\/db|node:https?|undici)'/);
    }
  });

  test('the only Node builtin it reaches is the digest, which is INV-M7-08', () => {
    const builtins = new Set<string>();
    for (const file of FILES) {
      for (const match of code(file).matchAll(/from '(node:[a-z/]+)'/g))
        builtins.add(match[1] ?? '');
    }
    expect([...builtins]).toEqual(['node:crypto']);
  });
});
