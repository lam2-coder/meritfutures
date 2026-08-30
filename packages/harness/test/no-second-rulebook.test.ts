// =============================================================================
// packages/harness/test/no-second-rulebook.test.ts
// =============================================================================
// `INV-M21-09` AND `INV-M21-10`, ASSERTED MECHANICALLY RATHER THAN REVIEWED.
//
// CLAUDE.md's caution, learned the hard way: the reconciliation session's three
// worst errors "were NOT capability failures. Each was a failure to check a
// claim against the primary source. Escalating the model does not fix that class
// of error; reading the source and ADDING A MECHANICAL ASSERTION does. Prefer a
// new CI gate over a bigger model whenever the error is checkable."
//
// Both of this package's standing claims are checkable:
//
//   INV-M21-09   the harness contains no line that decides a gate, a breach, an
//                eligibility or a payout amount. Reading a plan PARAMETER is the
//                first move any such line has to make, so the parameter reads
//                are confined to `assertions.ts`, where the only thing done with
//                one is compare a bound
//   INV-M21-10   no plan parameter literal, "including as a form default". A
//                money literal in `src/` is that defect exactly, so the bigint
//                literals are an allowlist and every entry has a reason
//
// A REVIEWER CANNOT HOLD THESE ACROSS A YEAR OF SESSIONS AND A GREP CAN. That is
// the whole argument for the file. It is deliberately blunt: it reads text and
// makes no attempt to parse, so it can be wrong in the safe direction (a false
// failure a reader resolves in one line) and not in the other.
// =============================================================================

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { stripComments } from '../../tooling/checks/strip-comments.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const sourceFiles = (): readonly { readonly name: string; readonly text: string }[] =>
  readdirSync(SRC)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, text: readFileSync(join(SRC, name), 'utf8') }));

// COMMENTS ARE STRIPPED BEFORE EVERY CHECK, OTHERWISE THE FILE THAT EXPLAINS THE
// RULE FAILS IT. `types.ts` quotes `150_000n` in the sentence that states
// `INV-M21-10`, and a scan that could not tell a quotation from a constant would
// force the explanation out of the code, which is the opposite of what any of
// this is for.
//
// THE STRIPPER IS IMPORTED AND NOT DECLARED HERE (ADR-279). This file carried
// its own two-replacement copy, which read a block-comment opener inside a line
// comment as a real one and emptied the rest of the file into a phantom block.
// `RI-30` is the leg that stops the copy coming back.

describe('INV-M21-09: nothing here decides a rule', () => {
  it('reads a plan parameter in assertions.ts and nowhere else', () => {
    // `plan.funded.X` and `plan.eval.X` are how a parameter is reached.
    // `plan.eval === null` is NOT one of them and is deliberately still allowed:
    // asking whether the plan HAS an evaluation phase is reading its shape, not
    // its configuration, and `initialState` asks the same question.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (file.name === 'assertions.ts') continue;
      const matches = stripComments(file.text).match(/plan\.(funded|eval)\.\w+/g) ?? [];
      for (const match of matches) offenders.push(`${file.name}: ${match}`);
    }
    expect(offenders).toEqual([]);
  });

  it('leaves the eligibility and the amount to the engine', () => {
    // The trial loop must ASK. A loop that stopped importing these two would
    // have to be answering the questions itself.
    const trial = sourceFiles().find((file) => file.name === 'trial.ts');
    expect(trial).toBeDefined();
    const text = trial?.text ?? '';
    expect(text).toContain("from '@merit/rules-engine'");
    expect(text).toContain('advanceDay');
    expect(text).toContain('evaluatePayout');
  });
});

describe('INV-M21-10: no plan parameter literal', () => {
  it('carries only the four bigint literals that are not money', () => {
    // Each allowed value has one reason and no plan parameter has any of them:
    //
    //   0n        an empty accumulator and an emptiness test
    //   1n        the denominator of an integer as a ratio, and a sign
    //   10n       the base of `format`'s fixed-point scale
    //   10_000n   the basis-point denominator, which CLAUDE.md fixes
    //
    // A cents value cannot hide among these. `20_000n`, `150_000n` or any other
    // plan figure fails here, which is the point: `INV-M21-10` bans the literal
    // "including as a form default", and a default is exactly how one arrives.
    const allowed = new Set(['0n', '1n', '10n', '10_000n']);
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const matches = stripComments(file.text).match(/\b[0-9][0-9_]*n\b/g) ?? [];
      for (const match of matches) {
        if (!allowed.has(match)) offenders.push(`${file.name}: ${match}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the run is reproducible by construction', () => {
  it('reads no clock and draws no unkeyed randomness', () => {
    // A projection whose value depends on when it was rendered cannot be traced
    // to the decision it justified, which is `AS-M21-01`'s subject and the
    // session brief's stated requirement. The engine's own lint rule
    // (`merit/engine-purity`) makes the same check one package over; this is the
    // harness's, phrased over the constructs rather than over the imports.
    const banned = [
      'new Date(',
      'Date.now',
      'Math.random',
      'randomUUID',
      'randomBytes',
      'performance.now',
    ];
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const text = stripComments(file.text);
      for (const construct of banned) {
        if (text.includes(construct)) offenders.push(`${file.name}: ${construct}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('imports nothing outside the two packages it declares and node:crypto', () => {
    // `node:crypto` is `createHash` for the calibration digest and nothing else.
    // Anything wider would be an undeclared dependency, which `.npmrc`'s
    // isolated linking is meant to make impossible and which a relative escape
    // out of `src/` would achieve anyway.
    const allowed = new Set(['@merit/rules-engine', '@merit/rithmic', 'node:crypto']);
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const matches = stripComments(file.text).match(/from '([^']+)'/g) ?? [];
      for (const match of matches) {
        const specifier = match.slice(6, -1);
        if (specifier.startsWith('./')) continue;
        if (!allowed.has(specifier)) offenders.push(`${file.name}: ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the output catalogue', () => {
  it('claims no HO identifier it has not been granted', () => {
    // `OQ-M21-03` proposes `HO-09` to `HO-11` and this session does not claim
    // them: `SIMULATION_HARNESS` section 7.1 is the registry that owns the
    // contract and this session's fence excludes `docs/`. The three carry
    // `proposedRegistryId` and `registryId: null`, and a later session that
    // promoted one without the doc edit would fail here rather than at a review.
    const outputs = readFileSync(join(SRC, 'outputs.ts'), 'utf8');
    const stripped = stripComments(outputs);
    expect(stripped).not.toMatch(/registryId:\s*'HO-/);
    expect(stripped).toMatch(/proposedRegistryId:\s*'HO-09'/);
    expect(stripped).toMatch(/proposedRegistryId:\s*'HO-10'/);
    expect(stripped).toMatch(/proposedRegistryId:\s*'HO-11'/);
  });
});
