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
 * THE ECONOMIC-CALENDAR AND IMPERSONATION TYPES WERE DELIBERATELY ABSENT AND
 * ARE NOW IN. Neither had a contract row, and this list said so: "asserting
 * them against the contract would assert against an absence and pass for the
 * wrong reason." ADR-111 wrote both rows (API_CONTRACT section 6.1 and section
 * 3.2), so the assertion now has something to assert against and the exemption
 * has expired. That is the direction an exemption is supposed to move.
 *
 * `PlanRules` IS ABSENT AND STAYS ABSENT, on the opposite reasoning. The
 * contract declares it as opaque JSON ("exact JSON from DATA_MODEL §11") and
 * the portal type is `Readonly<Record<string, JsonValue>>` with no field names
 * of its own, so there is nothing to check and no absence being papered over.
 */
const TRANSCRIBED = [
  'AccountListItem',
  'AccountDetail',
  'MarkListItem',
  'TimelineItem',
  'EligibilityGates',
  'EligibilityResponse',

  // ADR-111's rows.
  'EconomicCalendarOccurrence',
  'EconomicCalendarFreshness',
  'EconomicCalendarPanelResponse',
  'ImpersonationSession',

  // P4-h's five screens.
  'PlanSize',
  'PlanVersionResponse',
  'PurchaseListItem',
  'CertificateResponse',
  'KycStatus',
  'AffiliateStats',
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
  //
  // THE FLOOR RISES WITH THE TRANSCRIPTION AND THAT IS THE POINT OF RAISING IT.
  // It read 40 against six types and 113 fields; P4-h adds ten more types, so a
  // floor left at 40 would keep passing after the regex stopped matching two
  // thirds of the file. Session 158 named this list as a slice-collision site
  // for exactly this reason: "the `checked > 40` floor that must rise as types
  // are added."
  expect(checked, 'wire fields found to check').toBeGreaterThan(150);
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
