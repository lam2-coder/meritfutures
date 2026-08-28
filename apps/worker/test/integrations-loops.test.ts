// =============================================================================
// apps/worker/test/integrations-loops.test.ts
// =============================================================================
// `P7-m`. `M10:372` IS THE COVERAGE RULE AND IT IS THE SHAPE OF THIS FILE:
//
//   "Every integration contract has a negative test asserting that a field
//    absent from its allowlist is not transmitted, and THE TEST IS GENERATED
//    FROM THE CONTRACT ROWS rather than hand written. A hand-written egress test
//    covers the fields somebody remembered, which is the same set the reviewer
//    would have remembered, which is why FM-M10-03 happens in the first place."
//
// So section 4 below writes no field name of its own. It iterates the twelve
// shipped rows, and section 5 iterates them again with a DECLARED contract built
// per row from the event's own payload keys, because a generator that only ever
// sees an empty allowlist proves nothing about a full one.
//
// SECTIONS
//   1. THE TWELVE, asserted against `EVENTS` section 11 AS TEXT. Not nine.
//   2. THE CITATIONS RESOLVE, line by line, in the document they name.
//   3. THE CONTRACTS are undeclared, empty, disabled, and carry no approver.
//   4. THE GENERATED NEGATIVE, over the shipped rows: nothing is transmitted.
//   5. THE GENERATED NEGATIVE, over a declared row: only the allowlist crosses.
//   6. THE FORBIDDEN SET outranks an allowlist, and refuses rather than filters.
//   7. THE GUARDS, and every one of them at SEND time.
//   8. THE NUMBERS: two stated and matching the guards, one `unstated`.
//   9. THE BARREL leg, name by name.
//  10. THE DOOR. No `pg`, no `@merit/db`, no `SqlExecutorReason`, no secret.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import {
  DISPATCH_STATUSES,
  FORBIDDEN_FIELDS,
  LOOPS_CONTRACTS,
  LOOPS_DISPATCH_POLICY,
  LOOPS_INTEGRATION,
  LOOPS_TRIGGERS,
  LoopsEgressError,
  contractFor,
  dispatchToLoops,
  evaluateGuard,
  forbiddenFor,
  projectForLoops,
  projectWith,
  triggerFor,
} from '../src/integrations/loops.ts';
import type { LoopsContract, LoopsLiveState, LoopsTrigger } from '../src/integrations/loops.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const EVENTS = readFileSync(join(ROOT, 'docs/architecture/EVENTS.md'), 'utf8');
const M10 = readFileSync(join(ROOT, 'docs/plans/M10-integrations.md'), 'utf8');
const MIGRATION = readFileSync(join(ROOT, 'packages/db/migrations/0018_integrations.sql'), 'utf8');
const LOOPS_SOURCE = readFileSync(join(ROOT, 'apps/worker/src/integrations/loops.ts'), 'utf8');
const BARREL = readFileSync(join(ROOT, 'apps/worker/src/index.ts'), 'utf8');

const EVENTS_LINES = EVENTS.split('\n');

const NOW = new Date('2026-08-28T12:00:00.000Z');
const DAY_MS = 86_400_000;

/** Live state with nothing suppressing, so each guard case moves ONE term. */
const CLEAR: LoopsLiveState = {
  identityRestricted: false,
  maxOpenFlagSeverity: null,
  lastSentAt: null,
  now: NOW,
};

/**
 * `EVENTS` section 11's rows, read out of the document rather than out of the
 * module under test. This is the ONE place the count comes from.
 */
function sectionElevenRows(): readonly string[] {
  const start = EVENTS_LINES.findIndex((line) => line.startsWith('## 11. Event-driven lifecycle'));
  expect(start, 'EVENTS section 11 was not found').toBeGreaterThan(0);
  const end = EVENTS_LINES.findIndex((line, i) => i > start && line.startsWith('## 12.'));
  expect(end, 'EVENTS section 12 was not found').toBeGreaterThan(start);
  return EVENTS_LINES.slice(start, end).filter((line) => /^\| `/.test(line));
}

// =============================================================================
// 1. THE TWELVE, AND `M10` SAYS NINE
// =============================================================================

test('1.1 the trigger set is EVENTS section 11 read as text, and it is twelve', () => {
  const rows = sectionElevenRows();
  const named = rows.map((row) => {
    const match = /^\| `([a-z._]+)`/.exec(row);
    expect(match, `a row of EVENTS section 11 names no event: ${row}`).not.toBeNull();
    return match?.[1] ?? '';
  });

  // THE COUNT IS THE DOCUMENT'S. Writing `toBe(12)` here would be the same
  // hand-maintained cardinal ADR-034 rules against, one file over from the plan
  // that has it wrong.
  expect(LOOPS_TRIGGERS.map((trigger) => trigger.eventName)).toStrictEqual(named);
});

test('1.2 the three M10 does not count are present, and all three are always-send', () => {
  // Session 163 finding (a): "The three M10 does not count are `payout.held`,
  // `payout.hold_released` and `identity.restriction_lifted`, and all three are
  // marked 'always send'". A generated suite over a NINE-row table would be
  // correct and would silently cover neither.
  for (const name of ['payout.held', 'payout.hold_released', 'identity.restriction_lifted']) {
    const trigger = triggerFor(name);
    expect(trigger, `${name} is not in the trigger set`).toBeDefined();
    expect(contractFor(name), `${name} has no contract row`).toBeDefined();
  }
  expect(triggerFor('payout.held')?.guard.kind).toBe('alwaysSend');
  expect(triggerFor('identity.restriction_lifted')?.guard.kind).toBe('alwaysSend');
  // `payout.hold_released` is the one of the three whose Guard cell reads
  // "none", and it is transcribed as `none` rather than promoted to always-send.
  expect(triggerFor('payout.hold_released')?.guard.kind).toBe('none');
});

test('1.3 M10 still says nine, so the transcription is not merely agreeing with it', () => {
  // If this ever fails, M10 was amended and the finding is CLOSED. That is a
  // good failure and the message says what to do with it.
  expect(
    M10.includes('The nine [EVENTS section 11](../architecture/EVENTS.md) triggers'),
    'M10 no longer says nine. Session 163 finding (a) has been ruled on, and this suite and the ' +
      "loops.ts header's section 2 should be re-read against whatever the amendment says",
  ).toBe(true);
});

// =============================================================================
// 2. EVERY CITATION RESOLVES AT THE LINE IT NAMES
// =============================================================================

test('2.1 each trigger cite points at the EVENTS line that carries that event', () => {
  // RI-15's property, applied inside a file RI-15's array does not cover. Its
  // header: "A citation that drifts is WORSE THAN NO CITATION: it reads as
  // verified, so the next reader follows it, finds unrelated prose, and
  // concludes the reason was invented."
  for (const trigger of LOOPS_TRIGGERS) {
    const match = /^EVENTS:(\d+)$/.exec(trigger.cite);
    expect(
      match,
      `${trigger.eventName} carries an unparseable cite ${trigger.cite}`,
    ).not.toBeNull();
    const line = EVENTS_LINES[Number(match?.[1]) - 1] ?? '';
    expect(line, `${trigger.cite} does not name ${trigger.eventName}`).toContain(
      `\`${trigger.eventName}\``,
    );
    expect(line, `${trigger.cite} does not carry ${trigger.eventName}'s message`).toContain(
      trigger.message.split(',')[0] ?? '',
    );
  }
});

test('2.2 the two stated numbers are cited at lines that state them', () => {
  const throttle = LOOPS_DISPATCH_POLICY.throttleDays;
  const severity = LOOPS_DISPATCH_POLICY.suppressAtSeverity;
  expect(EVENTS_LINES[Number(throttle.cite.split(':')[1]) - 1] ?? '').toContain(
    'throttle to once per account per week',
  );
  expect(EVENTS_LINES[Number(severity.cite.split(':')[1]) - 1] ?? '').toContain(
    'open severity 4+ flag',
  );
});

// =============================================================================
// 3. THE CONTRACTS ARE UNDECLARED, AND `0018` CAN HOLD THAT ROW
// =============================================================================

test('3.1 every shipped contract is undeclared, empty and disabled', () => {
  expect(LOOPS_CONTRACTS.length).toBe(LOOPS_TRIGGERS.length);
  for (const contract of LOOPS_CONTRACTS) {
    expect(contract.state, `${contract.eventName} is no longer undeclared`).toBe('undeclared');
    expect(contract.fieldAllowlist, `${contract.eventName} has a field list`).toStrictEqual([]);
    expect(contract.enabled, `${contract.eventName} is enabled`).toBe(false);
    expect(contract.integration).toBe(LOOPS_INTEGRATION);
    expect(contract.guardExpression, `${contract.eventName} took a guard_expression`).toBeNull();
    expect(contract.version).toBe(1);
  }
});

test('3.2 `0018` permits a disabled empty row and forbids an enabled one', () => {
  // The CHECK is what makes "declared as owed, not yet declared" a legal row,
  // and it is quoted from the migration rather than restated.
  expect(MIGRATION).toContain('enabled = false OR array_length(field_allowlist, 1) >= 1');
  // Applied to every shipped row: each satisfies the left arm.
  for (const contract of LOOPS_CONTRACTS)
    expect(
      contract.enabled === false || contract.fieldAllowlist.length >= 1,
      `${contract.eventName} would violate integration_contracts_enabled_has_fields`,
    ).toBe(true);
});

test('3.3 no contract carries an approver, because no person approved one', () => {
  // `0018`: "A contract is APPROVED, by a person, on a date. An enabled contract
  // with no approver is a disclosure nobody authorised."
  expect(MIGRATION).toContain('An enabled contract with');
  for (const contract of LOOPS_CONTRACTS) expect(Object.keys(contract)).not.toContain('approvedBy');
});

test('3.4 the vendor is not chosen here', () => {
  // `OQ-M10-02` is the founder's. The key is the file name P7 section 8 gave
  // this slice and the source says so rather than implying it.
  expect(M10).toContain('OQ-M10-02. Which messaging vendor');
  expect(LOOPS_SOURCE).toContain('A KEY AND NOT A VENDOR SELECTION');
});

// =============================================================================
// 4. THE GENERATED NEGATIVE, OVER THE SHIPPED ROWS
// =============================================================================

/**
 * A payload for one trigger, built from the event's OWN declared payload keys in
 * `EVENTS`, so the generator never invents a field name either.
 *
 * The keys are read out of the document's backticked payload cell where there is
 * one, and fall back to a synthetic pair where the payload is a fenced block.
 * Either way this is the SUPERSET a contract exists to cut down, which is the
 * only thing section 4 needs it to be.
 */
function payloadFor(trigger: LoopsTrigger): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of candidateFields(trigger)) payload[key] = `value-of-${key}`;
  // Every event gets one field NOBODY declared anywhere, which is FM-M10-03's
  // scenario exactly: "An event gains a field and the field ships to every
  // vendor." IT IS NEVER ALLOWLISTED BY ANY CASE BELOW, which is the whole point
  // of it, so it is kept out of {@link candidateFields}.
  payload['a_field_added_next_year'] = 'must never cross';
  return payload;
}

/**
 * The fields the generator may allowlist for one trigger.
 *
 * `EVENTS` states some of the twelve payloads as a FENCED BLOCK rather than as a
 * table cell (`breach.detected` and `payout.approved` among them), and
 * {@link declaredPayloadKeys} reads cells. Those triggers fall back to a
 * SYNTHETIC pair, and the fallback is honest about what it buys: section 5's
 * property is that ONLY the allowlist crosses, and that property does not depend
 * on the field names being real ones. Section 6 is the case that DOES depend on
 * a real field name, and it reads its one field out of the document and asserts
 * it there.
 *
 * The forbidden fields are excluded so the generator cannot allowlist one by
 * accident and turn section 6's refusal into section 5's failure.
 */
function candidateFields(trigger: LoopsTrigger): readonly string[] {
  const declared = declaredPayloadKeys(trigger.eventName).filter(
    (key) => !forbiddenFor(trigger.eventName).includes(key),
  );
  return declared.length >= 2 ? declared : ['synthetic_first_field', 'synthetic_second_field'];
}

/** The payload keys `EVENTS` declares for one event, possibly empty. */
function declaredPayloadKeys(eventName: string): readonly string[] {
  const row = EVENTS_LINES.find(
    (line) => line.startsWith(`| \`${eventName}\``) && line.includes('| `{'),
  );
  if (row === undefined) return [];
  const cell = /\| `\{([^`]*)\}`/.exec(row)?.[1] ?? '';
  return cell
    .split(',')
    .map((part) => part.trim().split(':')[0]?.trim() ?? '')
    .filter((name) => /^[a-z][a-z0-9_]*$/.test(name));
}

test('4.1 GENERATED: no shipped contract transmits any field, for any of the twelve', () => {
  expect(LOOPS_CONTRACTS.length).toBeGreaterThan(0);
  for (const trigger of LOOPS_TRIGGERS) {
    const projection = projectForLoops({
      eventName: trigger.eventName,
      payload: payloadFor(trigger),
    });
    expect(projection.outcome, `${trigger.eventName} projected a body today`).toBe('undeclared');
    expect(projection).not.toHaveProperty('body');
    expect(projection).not.toHaveProperty('fieldsSent');
  }
});

test('4.2 the undeclared outcome names who owes the declaration', () => {
  const projection = projectForLoops({ eventName: 'payout.settled', payload: { a: 1 } });
  expect(projection.outcome).toBe('undeclared');
  if (projection.outcome !== 'undeclared') throw new Error('unreachable');
  expect(projection.owed).toContain('IN-M10-03');
  expect(projection.owed).toContain('MINIMUM PAYLOAD EACH');
});

test('4.3 an event that is not a trigger gets no contract and no dispatch', () => {
  expect(projectForLoops({ eventName: 'ledger.transaction_posted', payload: {} }).outcome).toBe(
    'no_contract',
  );
  expect(dispatchToLoops({ eventName: 'ledger.transaction_posted', payload: {} }, CLEAR)).toEqual({
    outcome: 'not_a_trigger',
    eventName: 'ledger.transaction_posted',
  });
});

// =============================================================================
// 5. THE GENERATED NEGATIVE, OVER A DECLARED ROW
// =============================================================================

/**
 * A declared contract for one trigger, built IN THE SUITE.
 *
 * **THIS IS NOT A DECLARATION AND THE MODULE'S OWN HEADER SAYS SO.** It reaches
 * no table and has no approver; it exists so the mechanism can be exercised
 * against a full allowlist while every shipped row is empty. The allowlist is
 * the FIRST declared payload key and nothing else, so every other key in the
 * payload is a field the negative test is about.
 */
function declaredContract(trigger: LoopsTrigger, allowlist: readonly string[]): LoopsContract {
  return {
    integration: LOOPS_INTEGRATION,
    eventName: trigger.eventName,
    fieldAllowlist: allowlist,
    enabled: true,
    guardExpression: null,
    version: 1,
    state: 'declared',
    cite: 'built in test/integrations-loops.test.ts, approved by nobody',
    quote: 'a declared contract built in a suite is not a declaration',
  };
}

test('5.1 GENERATED: for every trigger, a field outside the allowlist is not transmitted', () => {
  for (const trigger of LOOPS_TRIGGERS) {
    const payload = payloadFor(trigger);
    const keys = candidateFields(trigger);
    expect(
      keys.length,
      `${trigger.eventName} produced no payload key to allowlist`,
    ).toBeGreaterThan(1);
    const permitted = keys[0];
    if (permitted === undefined) continue;

    const projection = projectWith(declaredContract(trigger, [permitted]), {
      eventName: trigger.eventName,
      payload,
    });
    expect(projection.outcome).toBe('projected');
    if (projection.outcome !== 'projected') continue;

    expect(projection.fieldsSent).toStrictEqual([permitted]);
    expect(Object.keys(projection.body)).toStrictEqual([permitted]);
    for (const key of Object.keys(payload).filter((other) => other !== permitted))
      expect(
        Object.prototype.hasOwnProperty.call(projection.body, key),
        `${trigger.eventName}: \`${key}\` is absent from the allowlist and crossed anyway`,
      ).toBe(false);
    // FM-M10-03's own field, named, on every one of the twelve.
    expect(projection.body).not.toHaveProperty('a_field_added_next_year');
  }
});

test('5.2 fields_sent is what WENT, not what the contract permitted', () => {
  // `0018`: "fields_sent records what actually went, not what the contract
  // permitted. The two can differ when a field is absent from a particular
  // event." So an allowlisted field the payload does not carry is not reported
  // as sent, and it is not written as a null either.
  const trigger = triggerFor('payout.settled');
  expect(trigger).toBeDefined();
  if (trigger === undefined) return;
  const projection = projectWith(declaredContract(trigger, ['amount_cents', 'never_in_payload']), {
    eventName: 'payout.settled',
    payload: { amount_cents: 150_000, settled_at: 'ignored' },
  });
  expect(projection.outcome).toBe('projected');
  if (projection.outcome !== 'projected') return;
  expect(projection.fieldsSent).toStrictEqual(['amount_cents']);
  expect(projection.body).toStrictEqual({ amount_cents: 150_000 });
  expect(Object.prototype.hasOwnProperty.call(projection.body, 'never_in_payload')).toBe(false);
});

test('5.3 an inherited key is not an own key, so the prototype is not an egress path', () => {
  const trigger = triggerFor('payout.settled');
  if (trigger === undefined) return;
  const payload = Object.create({ toString: 'inherited' }) as Record<string, unknown>;
  payload['amount_cents'] = 1;
  const projection = projectWith(declaredContract(trigger, ['amount_cents', 'toString']), {
    eventName: 'payout.settled',
    payload,
  });
  expect(projection.outcome).toBe('projected');
  if (projection.outcome !== 'projected') return;
  expect(projection.fieldsSent).toStrictEqual(['amount_cents']);
});

test('5.4 a contract may not be applied to a different event', () => {
  const trigger = triggerFor('payout.settled');
  if (trigger === undefined) return;
  expect(() =>
    projectWith(declaredContract(trigger, ['amount_cents']), {
      eventName: 'payout.approved',
      payload: { amount_cents: 1 },
    }),
  ).toThrow(LoopsEgressError);
});

// =============================================================================
// 6. THE FORBIDDEN SET OUTRANKS AN ALLOWLIST
// =============================================================================

test('6.1 the forbidden entry is sourced at the line it cites', () => {
  expect(Object.keys(FORBIDDEN_FIELDS)).toStrictEqual(['payout.held']);
  const guardCell = EVENTS_LINES[406] ?? '';
  expect(guardCell).toContain('`payout.held`');
  expect(guardCell).toContain('never the evidence and never the detector');
  // And the field named is one this event actually carries, so the refusal is
  // about a real disclosure rather than a name nobody would have written.
  expect(declaredPayloadKeys('payout.held')).toContain('hold_flag_id');
});

test('6.2 SEEDED: an allowlist that adds the forbidden field is REFUSED, not filtered', () => {
  // The seeded defect the fence asks for: somebody adds a field to a contract
  // and the control catches it. A filter would let the contradictory row sit in
  // the table looking approved, so this refuses and names both sides.
  const trigger = triggerFor('payout.held');
  expect(trigger).toBeDefined();
  if (trigger === undefined) return;

  const seeded = declaredContract(trigger, ['tos_clause', 'hold_expires_at', 'hold_flag_id']);
  expect(() =>
    projectWith(seeded, {
      eventName: 'payout.held',
      payload: { tos_clause: '7.2', hold_expires_at: 'x', hold_flag_id: 'the-flag' },
    }),
  ).toThrow(LoopsEgressError);
  expect(() => projectWith(seeded, { eventName: 'payout.held', payload: {} })).toThrow(
    /never the evidence and never the detector/,
  );
});

test('6.3 the same allowlist WITHOUT the forbidden field projects cleanly', () => {
  // The near miss beside the positive, so the refusal is shown to be about the
  // one field rather than about the shape of the contract.
  const trigger = triggerFor('payout.held');
  if (trigger === undefined) return;
  const projection = projectWith(declaredContract(trigger, ['tos_clause', 'hold_expires_at']), {
    eventName: 'payout.held',
    payload: { tos_clause: '7.2', hold_expires_at: 'x', hold_flag_id: 'the-flag' },
  });
  expect(projection.outcome).toBe('projected');
  if (projection.outcome !== 'projected') return;
  expect(projection.fieldsSent).toStrictEqual(['tos_clause', 'hold_expires_at']);
  expect(projection.body).not.toHaveProperty('hold_flag_id');
});

// =============================================================================
// 7. THE GUARDS, AT SEND TIME
// =============================================================================

test('7.1 breach.detected is suppressed when the identity is restricted at SEND time', () => {
  // `AS-M10-03`'s ordering, which is the whole reason INV-M10-08 exists: the
  // breach fires at 00:20 and the restriction is applied at 09:15. The event is
  // unchanged; the live state is not.
  const trigger = triggerFor('breach.detected');
  expect(trigger).toBeDefined();
  if (trigger === undefined) return;

  expect(evaluateGuard(trigger, CLEAR).decision).toBe('send');
  const suppressed = evaluateGuard(trigger, { ...CLEAR, identityRestricted: true });
  expect(suppressed.decision).toBe('suppress');
  if (suppressed.decision !== 'suppress') return;
  expect(suppressed.status).toBe('dropped_by_guard');
  expect(DISPATCH_STATUSES).toContain(suppressed.status);
});

test('7.2 severity 4 suppresses and severity 3 does not, which is the near miss', () => {
  const trigger = triggerFor('breach.detected');
  if (trigger === undefined) return;
  expect(evaluateGuard(trigger, { ...CLEAR, maxOpenFlagSeverity: 3 }).decision).toBe('send');
  expect(evaluateGuard(trigger, { ...CLEAR, maxOpenFlagSeverity: 4 }).decision).toBe('suppress');
  expect(evaluateGuard(trigger, { ...CLEAR, maxOpenFlagSeverity: 5 }).decision).toBe('suppress');
});

test('7.3 the weekly throttle, and its boundary is one week exactly', () => {
  const trigger = triggerFor('phase.pass_deferred_consistency');
  expect(trigger).toBeDefined();
  if (trigger === undefined) return;
  expect(evaluateGuard(trigger, CLEAR).decision).toBe('send');
  const sixDays = new Date(NOW.getTime() - 6 * DAY_MS);
  const sevenDays = new Date(NOW.getTime() - 7 * DAY_MS);
  expect(evaluateGuard(trigger, { ...CLEAR, lastSentAt: sixDays }).decision).toBe('suppress');
  // "once per account per week" is satisfied at exactly a week, not after it.
  expect(evaluateGuard(trigger, { ...CLEAR, lastSentAt: sevenDays }).decision).toBe('send');
});

test('7.4 an always-send trigger is not suppressible by any live state', () => {
  // `EVENTS:406`: "always send; silence is what kills payout trust." A restricted
  // identity with a severity 5 open flag still hears that a transfer failed.
  const hostile: LoopsLiveState = {
    identityRestricted: true,
    maxOpenFlagSeverity: 5,
    lastSentAt: NOW,
    now: NOW,
  };
  for (const name of ['payout.transfer_failed', 'payout.held', 'identity.restriction_lifted']) {
    const trigger = triggerFor(name);
    expect(trigger).toBeDefined();
    if (trigger === undefined) continue;
    expect(evaluateGuard(trigger, hostile).decision, `${name} was suppressed`).toBe('send');
  }
});

test('7.5 the guard runs BEFORE the projection, so a suppressed message has no body', () => {
  const decision = dispatchToLoops(
    { eventName: 'breach.detected', payload: { account_id: 'a', shortfall_cents: 12_000 } },
    { ...CLEAR, identityRestricted: true },
  );
  expect(decision.outcome).toBe('suppressed');
  expect(decision).not.toHaveProperty('body');
  expect(decision).not.toHaveProperty('fieldsSent');
});

test('7.6 there is no enqueue-time signature: live state is required', () => {
  // `FM-M10-02` is a shape rather than a rule here. `dispatchToLoops` is the one
  // entry point and its second parameter is not optional, so a caller that has
  // not re-read live state has no value to pass.
  expect(dispatchToLoops.length).toBe(2);
  const declaration = /export function dispatchToLoops\(([^)]*)\)/.exec(LOOPS_SOURCE)?.[1] ?? '';
  expect(declaration).toContain('live: LoopsLiveState');
  expect(declaration).not.toContain('live?:');
  // And nothing a producer could set to say the guard already passed.
  const shape = /export interface LoopsLiveState \{([\s\S]*?)\n\}/.exec(LOOPS_SOURCE)?.[1] ?? '';
  for (const word of ['guardPassed', 'suppressed', 'alreadyChecked', 'skipGuard'])
    expect(shape, `LoopsLiveState gained a ${word} member`).not.toContain(word);
});

test('7.7 every trigger guard is evaluable and every kind is reached', () => {
  const kinds = new Set(LOOPS_TRIGGERS.map((trigger) => trigger.guard.kind));
  expect([...kinds].sort()).toStrictEqual([
    'alwaysSend',
    'contentRule',
    'none',
    'suppressWhenRestrictedOrFlagged',
    'throttlePerAccount',
  ]);
  for (const trigger of LOOPS_TRIGGERS)
    expect(['send', 'suppress'], trigger.eventName).toContain(
      evaluateGuard(trigger, CLEAR).decision,
    );
});

test('7.8 kyc.rejected sends, and the rule it carries is M16 content and not a guard', () => {
  // `M10:23`: "M16 owns preference, channel, and content. M10 owns delivery to
  // the vendor that sends it." The rule is recorded so it is not mistaken for a
  // suppression, and so the declaration it bears on is visible to whoever writes
  // that allowlist.
  const trigger = triggerFor('kyc.rejected');
  expect(trigger).toBeDefined();
  if (trigger === undefined) return;
  expect(trigger.guard.kind).toBe('contentRule');
  const outcome = evaluateGuard(trigger, CLEAR);
  expect(outcome.decision).toBe('send');
  expect(outcome.why).toContain('M16');
  expect(M10).toContain('M16 owns preference, channel, and content');
});

test('7.9 guard_expression cannot express the one guard that reads live state', () => {
  // The finding, asserted rather than asserted-in-prose. `0018` declares the
  // column as evaluated over the allowlisted fields only, and none of the three
  // terms `M10:232` names is a field of `breach.detected`.
  expect(MIGRATION).toContain('evaluated over the allowlisted fields only');
  expect(M10).toContain(
    'The dispatcher re-reads restriction status, open flag severity, and account state',
  );
  const breachKeys = declaredPayloadKeys('breach.detected');
  for (const term of ['identity_id', 'restricted', 'flag_severity'])
    expect(breachKeys, `breach.detected carries ${term}`).not.toContain(term);
  for (const contract of LOOPS_CONTRACTS) expect(contract.guardExpression).toBeNull();
});

// =============================================================================
// 8. THE NUMBERS
// =============================================================================

test('8.1 the attempt budget is unstated, and no corpus line states one', () => {
  expect(LOOPS_DISPATCH_POLICY.maxAttempts.state).toBe('unstated');
  expect(LOOPS_DISPATCH_POLICY.maxAttempts.value).toBeNull();
  expect(M10).toContain('retrying --> dead_letter: attempts exhausted');
  // Whitespace-normalised, because the column is aligned in the DDL and an
  // alignment change is not a change to the claim.
  expect(MIGRATION.replace(/[ \t]+/g, ' ')).toContain(
    'attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)',
  );
});

test('8.2 the two stated numbers match the guards transcribed from the same lines', () => {
  // Two transcriptions of one document cannot drift apart if one asserts the
  // other. The `unstated` member has no guard to check it against, which is the
  // difference a reader should see.
  const throttle = LOOPS_TRIGGERS.find(
    (trigger) => trigger.guard.kind === 'throttlePerAccount',
  )?.guard;
  const suppress = LOOPS_TRIGGERS.find(
    (trigger) => trigger.guard.kind === 'suppressWhenRestrictedOrFlagged',
  )?.guard;
  expect(throttle?.kind === 'throttlePerAccount' ? throttle.days : null).toBe(
    LOOPS_DISPATCH_POLICY.throttleDays.value,
  );
  expect(
    suppress?.kind === 'suppressWhenRestrictedOrFlagged' ? suppress.minOpenSeverity : null,
  ).toBe(LOOPS_DISPATCH_POLICY.suppressAtSeverity.value);
});

// =============================================================================
// 9. THE BARREL
// =============================================================================

test('9.1 the leg is declared and every exported name is re-exported', () => {
  expect(BARREL).toContain("from './integrations/loops.ts'");
  const declared = [
    ...LOOPS_SOURCE.matchAll(
      /^export (?:declare )?(?:const|function|class|interface|type|enum) ([A-Za-z0-9_]+)/gm,
    ),
  ].map((match) => match[1] ?? '');
  expect(declared.length).toBeGreaterThan(10);
  const reExported = new Set(
    [...BARREL.matchAll(/^\s{2}([A-Za-z0-9_]+)(?: as [A-Za-z0-9_]+)?,$/gm)].map(
      (match) => match[1] ?? '',
    ),
  );
  for (const name of declared)
    expect(
      reExported,
      `integrations/loops.ts exports \`${name}\` and the barrel no longer re-exports it. A type ` +
        'checker cannot see an export that is simply gone, so this is the only thing that can',
    ).toContain(name);
});

// =============================================================================
// 10. THE DOOR, AND NO SECRET
// =============================================================================

test('10.1 the module imports nothing at all', () => {
  // `ADR-165`: `src/db.ts` is the one file under `apps/worker/src` that may
  // import `@merit/db`. This module needs no door because it holds no read, and
  // the strongest form of that claim is that it has no import statement at all.
  //
  // **A SPECIFIER AND NOT A SUBSTRING, WHICH `test/db.test.ts` LEARNED THE HARD
  // WAY AND WROTE DOWN.** Its own docstring: "The first draft of the
  // acquisition-point case below tested whether a file CONTAINED the accessor's
  // name and it failed on `src/provisioning/ports.ts`, whose header names
  // `@merit/db` in order to say that it does not import it." This file's header
  // does exactly that, the first draft of this case failed here for that
  // recorded reason, and the instrument is the import statement. THE REGEX IS
  // `db.test.ts`'s OWN, so the two files read the tree the same way.
  const specifiers = [
    ...LOOPS_SOURCE.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+'([^']+)'/g),
  ].map((match) => match[1] ?? '');
  expect(specifiers, 'integrations/loops.ts gained an import or a re-export').toStrictEqual([]);

  // And the two names `P7` section 11 rule 10 forecloses appear nowhere as CODE.
  // The header MAY say the module adds neither; a member would be a declaration.
  for (const forbidden of ['SqlExecutorReason', 'SystemReason'])
    expect(
      new RegExp(`^\\s*(?:readonly )?${forbidden}\\b`, 'm').test(LOOPS_SOURCE),
      `integrations/loops.ts declares ${forbidden}`,
    ).toBe(false);
});

test('10.2 no vendor endpoint, no hostname and no credential', () => {
  // `ADR-012`'s discipline on `ADMIN_ORIGIN`, read onto a vendor: a real
  // hostname in an artifact is a real hostname in an artifact.
  expect(/https?:\/\//.test(LOOPS_SOURCE), 'a URL reached integrations/loops.ts').toBe(false);
  for (const secret of ['API_KEY', 'apiKey', 'Bearer', 'Authorization', 'token'])
    expect(LOOPS_SOURCE, `integrations/loops.ts names ${secret}`).not.toContain(secret);
});

test('10.3 no float and no money arithmetic', () => {
  // Nothing here computes money, and the one number it does arithmetic on is a
  // count of days. Asserted so a later send path does not quietly add one.
  expect(/\d+\.\d+/.test(LOOPS_SOURCE.replace(/\d+\.\d+\.\d+/g, '')), 'a decimal literal').toBe(
    false,
  );
});
