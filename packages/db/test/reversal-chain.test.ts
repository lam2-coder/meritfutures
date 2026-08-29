import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// =============================================================================
// LEDGER-C3: a reversal may not chain onto another reversal
// =============================================================================
// CI-02, the `unit` project. ADR-193, migration 0059. MONEY PATH.
//
// WHY THIS FILE EXISTS. ADR-193 shipped `0059` with no assertion anywhere in
// this repository: `grep -rl "0059\|LEDGER-C3" --include='*.test.ts'` returned
// nothing before this file. The ruling was watched executing against a real
// PostgreSQL by the session that wrote it, in that entry's section 5, and that
// run is not a control: it happened once, in the session that also wrote the
// migration, and nothing re-runs it.
//
// WHAT THESE CAN AND CANNOT ASSERT, STATED FIRST. There is no database in
// CI-02, so nothing here executes the trigger. What is asserted is that THE
// ARTIFACT WHICH DECIDES THAT BEHAVIOUR STILL SAYS WHAT ADR-193 RULED, which is
// `account-adjustments.test.ts`'s idiom one table over and is the strongest
// form available in a stage with no database. A rewrite that preserved this
// text and changed the behaviour would defeat every case below, and that limit
// is named rather than left to be discovered.
//
// THE CENTRAL CLAIM THESE HOLD, in the entry's own heading: the rule refuses
// the LINK and not the operation, and it lives in a trigger because a row-level
// CHECK is not merely insufficient here but INCAPABLE.
//
//   1. THE LINK, not the operation. The trigger is armed by a WHEN clause on
//      `NEW.reversal_of IS NOT NULL`, so a re-application posted as a fresh
//      transaction with its own key and its own reason never reaches the
//      function at all, and the refusal fires on the TARGET row's own
//      `reversal_of` rather than on anything about entries or amounts. Lose the
//      WHEN clause and the guard becomes a rule about postings; lose the
//      `target_link` test and it becomes a rule about nothing.
//   2. INCAPABLE, not weak. The function SELECTs a SECOND row -- the one
//      `NEW.reversal_of` names -- which is exactly what a row-level CHECK
//      cannot do and is why `0009`'s constraint could only ever carry
//      `reversal_of <> id`.
//   3. TWO STATEMENTS, TWO OBJECTS, AND NO `DROP`. `0009`'s constraint says
//      something true and narrow about ONE row and goes on saying it; `0059`
//      says the other thing about a SECOND row. ADR-193 states that difference
//      from `0057` in terms, and a supersession smuggled into this file would
//      make the entry's own bullet false.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');

const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

// COMMENTS COME OFF FIRST. `0059`'s header argues the ruling at length and
// quotes `0009`'s promise verbatim, so reading the raw file would parse the
// argument as though it were the statement. That is
// `identity-provisioning.test.ts`'s recorded reason for the same move.
const BARE_0059 = read('packages/db/migrations/0059_reversal_chain.sql').replace(/--[^\n]*/g, '');
const BARE_0009 = read('packages/db/migrations/0009_ledger.sql').replace(/--[^\n]*/g, '');

/** The body of the guard function, between its dollar quotes. */
function guardBody(): string {
  const at = BARE_0059.indexOf('CREATE FUNCTION assert_reversal_does_not_chain');
  if (at < 0) throw new Error('0059 no longer creates assert_reversal_does_not_chain');
  const open = BARE_0059.indexOf('$$', at);
  const close = BARE_0059.indexOf('$$', open + 2);
  if (open < 0 || close < 0) throw new Error('the guard body is not dollar quoted');
  return BARE_0059.slice(open + 2, close);
}

/** The `CREATE TRIGGER` statement, up to its terminating semicolon. */
function triggerStatement(): string {
  const at = BARE_0059.indexOf('CREATE TRIGGER ledger_transactions_reversal_does_not_chain');
  if (at < 0) throw new Error('0059 no longer creates the chain trigger');
  const end = BARE_0059.indexOf(';', at);
  if (end < 0) throw new Error('the trigger statement is not terminated');
  return BARE_0059.slice(at, end);
}

describe('0059 refuses the LINK and not the operation', () => {
  test('the guard is not vacuous: the migration creates one function and one trigger', () => {
    // A FILE THAT STOPPED CREATING EITHER WOULD PASS EVERY TEXT SEARCH BELOW
    // that looks for an absence, which is the shape of green this case refuses.
    expect(guardBody().length).toBeGreaterThan(0);
    expect(triggerStatement().length).toBeGreaterThan(0);
  });

  test('the trigger is ARMED by reversal_of, so an un-chained posting never reaches it', () => {
    // THIS IS THE HALF THE ENTRY'S HEADING CALLS "not the operation". ADR-193
    // section 2: "A re-application posted as a new transaction with its own
    // kind, its own idempotency_key and its own reason is ACCEPTED by 0059."
    // The WHEN clause is what makes that true of the artifact rather than of an
    // argument: without it every INSERT runs the function body.
    const trigger = triggerStatement();
    expect(trigger).toMatch(/WHEN\s*\(\s*NEW\.reversal_of\s+IS\s+NOT\s+NULL\s*\)/);
    expect(trigger).toMatch(/\bON\s+ledger_transactions\b/);
    expect(trigger).toMatch(/\bFOR\s+EACH\s+ROW\b/);
  });

  test('the refusal fires on the TARGET row`s own link and on nothing else', () => {
    // The guard reads the row NEW.reversal_of names, takes its reversal_of into
    // `target_link`, and raises when THAT is not null. A guard that raised on
    // any reversal at all, or on an amount, or on a leg, would be refusing the
    // operation.
    const body = guardBody();
    expect(body).toMatch(/SELECT\s+lt\.reversal_of\s+INTO\s+target_link/);
    expect(body).toMatch(/IF\s+target_link\s+IS\s+NOT\s+NULL\s+THEN/);
    // AND THE EARLY EXIT IS THE SAME CLAIM FROM THE OTHER SIDE: a row with no
    // link is returned unexamined even if the WHEN clause is ever widened.
    expect(body).toMatch(/IF\s+NEW\.reversal_of\s+IS\s+NULL\s+THEN\s+RETURN\s+NEW;/);
    // Nothing in the guard reads a leg, an amount or a kind. If it ever does,
    // this rule has stopped being about what a row may CLAIM.
    expect(body).not.toMatch(/ledger_entries/);
    expect(body).not.toMatch(/amount_cents/);
  });

  test('it reads a SECOND row, which is what a row-level CHECK cannot do', () => {
    // ADR-193's third heading clause: the builder is "not weak here but
    // INCAPABLE". The evidence is that the guard's predicate is a SELECT
    // against another row of the same table, keyed on the link.
    const body = guardBody();
    expect(body).toMatch(/FROM\s+ledger_transactions\s+lt/);
    expect(body).toMatch(/WHERE\s+lt\.id\s*=\s*NEW\.reversal_of/);
    // AND THE ROW-LOCAL HALF IS STILL WHERE IT WAS. `0009`'s constraint carries
    // the clause a CHECK CAN say, and it says only that.
    expect(BARE_0009).toMatch(
      /CONSTRAINT\s+ledger_transactions_no_self_reversal\s+CHECK\s*\(\s*reversal_of\s+IS\s+NULL\s+OR\s+reversal_of\s*<>\s*id\s*\)/,
    );
  });

  test('both refusals name LEDGER-C3, so a reader meets the rule and not a stack trace', () => {
    const body = guardBody();
    const raises = [...body.matchAll(/RAISE\s+EXCEPTION/g)];
    expect(raises).toHaveLength(2);
    expect([...body.matchAll(/'LEDGER-C3:/g)]).toHaveLength(2);
  });
});

describe('0059 supersedes nothing, which is its stated difference from 0057', () => {
  test('no merged object is dropped, replaced or altered through this migration', () => {
    // ADR-193's own bullet: "0009's constraint is NOT superseded ... Two
    // statements, two objects, and no DROP." A supersession landing here would
    // make that sentence false in a file nobody may edit afterwards.
    expect(BARE_0059).not.toMatch(/\bDROP\b/);
    expect(BARE_0059).not.toMatch(/\bALTER\s+TABLE\b/);
    expect(BARE_0059).not.toMatch(/CREATE\s+OR\s+REPLACE\b/);
    expect(BARE_0059).not.toMatch(/\bCREATE\s+TABLE\b/);
  });

  test('0009 still carries the promise 0059 is the second clause of', () => {
    // The comment is the reason this migration exists and it is not a control
    // (ADR-042). It is asserted here so that a session deleting the promise and
    // the clause together is caught by the half that is executable.
    expect(read('packages/db/migrations/0009_ledger.sql')).toContain(
      'may not chain onto another reversal',
    );
  });
});
