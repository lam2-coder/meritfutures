import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

// =============================================================================
// M4-R: the transcription is a transcription
// =============================================================================
// M04 section 4: "M4 owns no endpoint. It consumes API_CONTRACT sections 3, 5,
// 6, and 7 VERBATIM, and adds no field to any of them." That sentence is the
// whole defence against FM-M4-01, and until this file existed it was a sentence
// somebody had to keep obeying. The failure it prevents is not a typo: it is
// the portal growing a field the server does not send, discovering the field is
// always `undefined`, and filling it in from something the client knows.
//
// WHAT THIS CHECKS AND WHAT IT DOES NOT. It checks that every field name the
// portal's transcribed wire types declare appears as a field name in
// API_CONTRACT's own code blocks. It does NOT check the types of those fields,
// their nesting, or that the portal reads every field the contract offers. It
// is a containment check in one direction, which is the direction the damage
// runs: an invented field is a fabrication and an unread field is only unread.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * The types in `api/types.ts` that ARE transcriptions of API_CONTRACT.
 *
 * The economic-calendar and impersonation types are deliberately absent:
 * neither has a contract row yet, and the source file says so at the point of
 * declaration. `grep economic_calendar docs/architecture/API_CONTRACT.md`
 * returns nothing, so asserting them against the contract would assert against
 * an absence and pass for the wrong reason.
 */
const TRANSCRIBED = [
  'AccountListItem',
  'AccountDetail',
  'MarkListItem',
  'TimelineItem',
  'EligibilityGates',
  'EligibilityResponse',
];

/** Every `readonly <name>:` in a block, at any nesting depth. */
function fieldNames(block: string): string[] {
  return [...block.matchAll(/readonly\s+([A-Za-z_][A-Za-z0-9_]*)\s*\??\s*:/g)].map((m) => m[1]!);
}

function typeBlock(source: string, name: string): string {
  const start = source.indexOf(`export type ${name} =`);
  expect(start, `apps/portal/src/api/types.ts declares ${name}`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nexport type ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test('every transcribed wire field is a field API_CONTRACT declares', () => {
  const source = readFileSync(join(ROOT, 'apps/portal/src/api/types.ts'), 'utf8');
  const contract = readFileSync(join(ROOT, 'docs/architecture/API_CONTRACT.md'), 'utf8');

  // Only the contract's own code blocks. Its prose names fields too, and a
  // field that appears only in prose is a field with no declared shape.
  const declared = [...contract.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]!).join('\n');

  const invented: string[] = [];
  let checked = 0;
  for (const name of TRANSCRIBED) {
    for (const field of fieldNames(typeBlock(source, name))) {
      checked += 1;
      if (!new RegExp(`(^|[{;,\\s])${field}\\s*\\??\\s*:`, 'm').test(declared)) {
        invented.push(`${name}.${field}`);
      }
    }
  }

  // A CHECK THAT CANNOT RUN IS NOT A CHECK THAT PASSED. If the field regex ever
  // stops matching (a formatter that breaks `readonly` onto its own line would
  // do it), the loop above compares nothing and reports success, which is the
  // one outcome this file must not be able to produce quietly.
  expect(checked, 'wire fields found to check').toBeGreaterThan(40);
  expect(invented, 'fields the portal reads that API_CONTRACT does not declare').toEqual([]);
});

test('the transcription covers every field of the endpoints it claims', () => {
  // The other direction, run over ONE endpoint rather than all of them, because
  // this is where an omission is a defect rather than a choice: the eligibility
  // response is the differentiator (M04 section 3.1, SC-M4-03 "every gate, gate
  // by gate"), and a gate the portal does not know about is a gate it cannot
  // render. INV-M4-05's failure is a gate shown wrong; this one's failure is a
  // gate not shown at all, which is the same lie with better manners.
  const contract = readFileSync(join(ROOT, 'docs/architecture/API_CONTRACT.md'), 'utf8');
  const source = readFileSync(join(ROOT, 'apps/portal/src/api/types.ts'), 'utf8');

  const start = contract.indexOf('type EligibilityResponse = {');
  const gatesStart = contract.indexOf('gates: {', start);
  const gatesEnd = contract.indexOf('\n  };', gatesStart);
  const gates = contract.slice(gatesStart, gatesEnd);

  const contractGates = [...gates.matchAll(/^\s{4}([a-z_]+):\s*\{/gm)].map((m) => m[1]!);
  expect(contractGates.length, 'gates found in API_CONTRACT').toBeGreaterThan(0);

  const portalGates = fieldNames(typeBlock(source, 'EligibilityGates'));
  for (const gate of contractGates) {
    expect(portalGates, `EligibilityGates declares the ${gate} gate`).toContain(gate);
  }
});
