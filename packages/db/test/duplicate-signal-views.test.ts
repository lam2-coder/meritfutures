import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// =============================================================================
// GS-291, GS-292: the six standing duplicate-signal views
// =============================================================================
// CI-02, the `unit` project. ADR-066 section 4, FOLD-03 section 5.3, folded
// into M06 section 7.10 with one sentence in M07 section 3.1.
//
// WHAT THESE CAN AND CANNOT ASSERT, STATED FIRST, on the rule both of this
// repository's check runners open with: a check that cannot verify the whole of
// what it claims says so and verifies the part it can.
//
// THERE IS NO VIEW TO RUN. The admin console is unbuilt, these six surfaces are
// sized SHOULD, and nothing below mounts a screen or executes a query. What
// ADR-066 section 4 asks for is "a test asserting they read `identity_signals`
// and the link tiers and compute no confidence of their own", and before the
// surface exists the artifact that decides those three things IS THE MODULE
// PLAN. So the plan is what is read here, and it is read against the migrations
// rather than against itself, which is the half that makes it a check.
//
// THE STRONGEST ASSERTION IN THIS FILE IS THE KIND CROSS-CHECK. Every signal
// kind M06 section 7.10 names is asserted to exist in `identity_signals`' CHECK
// constraint as `0029` leaves it. That is a REAL two-sided regression: a later
// migration renaming or dropping a kind, or a later editor inventing one in the
// plan, breaks the view before anybody builds it, and neither side can drift
// alone. It is the same shape as the embed assertion GS-285 to GS-287 carry.
//
// THE SECOND-STRONGEST IS THE ABSENCE ASSERTION. "Computes no confidence of its
// own" is a negative, and a negative asserted by quoting the sentence that
// claims it is not asserted at all. What is checked instead is that no numeric
// basis-point threshold appears anywhere in the section, because a threshold IS
// a computed confidence and it is exactly what a later session reaches for when
// asked to make the view "smarter". ADR-022 gave the score to D-16 and a second
// place that computes one is a second answer to the same question.
//
// What is deliberately NOT claimed: that any row exists, that any ordering has
// ever been executed, or that the aggregate is correct against a book. GS-291's
// ranking and GS-292's soft link get their executable half when the console is
// built. The corpus-level half is here so the design cannot drift out from
// under them first.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');

const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const M06 = 'docs/plans/M06-admin-ops-console.md';
const M07 = 'docs/plans/M07-risk-abuse.md';
const IDENTITY = 'packages/db/migrations/0002_identity.sql';
const PHONE = 'packages/db/migrations/0029_phone_identity_and_auth.sql';
const PAYOUTS = 'packages/db/migrations/0010_payouts.sql';
const WALLET = 'packages/db/migrations/0011_wallet.sql';

/**
 * M06 section 7.10, bounded at both ends. Every assertion about "the section"
 * runs against this and not against the module plan, because M06 is a 60KB
 * document that mentions liability, tiers and identities throughout: an
 * unbounded grep would pass on section 3.1 and prove nothing about the views.
 */
function section710(): string {
  const body = read(M06);
  const start = body.indexOf('## 7.10 The standing duplicate-signal views');
  expect(start, 'M06 has no section 7.10').toBeGreaterThan(-1);
  const end = body.indexOf('\n## ', start + 1);
  expect(
    end,
    'section 7.10 is unterminated; the bound would swallow the rest of M06',
  ).toBeGreaterThan(start);
  const text = body.slice(start, end);
  // Rule 2 on a derived input: a bound that silently collapsed to a heading
  // would make every absence assertion below pass against nothing.
  expect(text.length).toBeGreaterThan(2000);
  return text;
}

/** A migration minus its `--` comments, so a header naming a column in prose cannot satisfy a DDL assertion. */
function ddl(path: string): string {
  const body = read(path);
  const stripped = body
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
  expect(stripped.length).toBeLessThan(body.length);
  return stripped;
}

/**
 * The `--` comment prose of a migration, unwrapped onto one line.
 *
 * The other half of `ddl()`, and it exists because this file quotes migration
 * COMMENTS as the primary source of two design rulings, and those comments are
 * hard-wrapped at 79 columns. A `toContain` against the raw file passes only
 * for a quotation that happens not to straddle a line break, which makes the
 * assertion depend on where the original author pressed return.
 */
function prose(path: string): string {
  return read(path)
    .split('\n')
    .filter((line) => /^\s*--/.test(line))
    .map((line) => line.replace(/^\s*--\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');
}

// -----------------------------------------------------------------------------
// The six views, and the one that is not a signal
// -----------------------------------------------------------------------------
// Five read `identity_signals`. The sixth reads `destination_ref`, and that is
// a finding rather than an inconsistency: M07:84's "settlement-rail identity"
// is `kind = 'rise_identity'`, who the rail says the payee is, and D-09 at
// M07:116 reads where the money actually went. The table below is the
// distinction expressed as a fixture.
const SIGNAL_VIEWS = [
  { view: 'Shared IP', kinds: ['ip', 'asn'] },
  { view: 'Shared device fingerprint', kinds: ['device'] },
  { view: 'Shared payment fingerprint', kinds: ['payment'] },
  { view: 'Shared phone or carrier', kinds: ['phone', 'phone_carrier'] },
  { view: 'Shared KYC match', kinds: ['kyc_identity'] },
] as const;

describe('M06 section 7.10: the six views read signals that exist', () => {
  test('the section names all six views', () => {
    const text = section710();
    for (const { view } of SIGNAL_VIEWS) expect(text).toContain(`**${view}**`);
    expect(text).toContain('**Shared payout destination**');
  });

  test('the five signal-backed views read identity_signals', () => {
    const text = section710();
    // One per view rather than one for the section: a single mention would
    // satisfy a lazy grep while four views read something else.
    const mentions = text.match(/`identity_signals`/g) ?? [];
    expect(mentions.length).toBeGreaterThanOrEqual(SIGNAL_VIEWS.length);
  });

  test('every kind the section names exists in identity_signals CHECK, as 0029 leaves it', () => {
    const text = section710();
    // ANCHORED ON THE CONSTRAINT NAME, and the first draft of this line was
    // not. `/CHECK\s*\(\s*kind IN \(/` matched the notification-channel kinds
    // further down 0029 and produced a three-value set, which is why the size
    // guard below is here and not decoration: it caught this.
    const allowed = /identity_signals_kind_allowed CHECK \(\s*kind IN \(([^)]*)\)/.exec(ddl(PHONE));
    // Thrown rather than expected, on gates.mjs' rule 2: a parser that stopped
    // matching must stop the check, not quietly assert against an empty set.
    if (!allowed?.[1]) {
      throw new Error(`${PHONE} no longer states identity_signals' allowed kind list`);
    }
    const kinds = new Set([...allowed[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? ''));
    // The parser could not have produced a set this small by accident.
    expect(kinds.size).toBeGreaterThanOrEqual(10);

    for (const { view, kinds: named } of SIGNAL_VIEWS) {
      for (const kind of named) {
        expect(text, `${view} does not name kind '${kind}'`).toContain(`'${kind}'`);
        expect(
          kinds,
          `${view} reads kind '${kind}', which identity_signals does not allow`,
        ).toContain(kind);
      }
    }
  });

  test('the payment view reads the hashed value and previews it, never the raw one', () => {
    const text = section710();
    expect(text).toContain('`value_hash`');
    expect(text).toContain('`value_preview`');
    // 0002's own words, quoted in the section, and asserted still to be 0002's.
    expect(prose(IDENTITY)).toContain('not enough to reconstruct the value it previews');
    // And the preview the section shows the operator is 0002's example, not one
    // this plan invented.
    expect(prose(IDENTITY)).toContain("'visa ****4242'");
    expect(section710()).toContain('visa ****4242');
  });

  test('the payout-destination view reads BOTH legs, and both columns exist', () => {
    const text = section710();
    expect(text).toContain('`payout_transfers.destination_ref`');
    expect(text).toContain('`wallet_withdrawals.destination_ref`');
    // ADR-028 split the legs. The wallet half is the one a view would omit.
    expect(ddl(PAYOUTS)).toMatch(
      /CREATE TABLE payout_transfers[\s\S]*destination_ref\s+text NOT NULL/,
    );
    expect(ddl(WALLET)).toMatch(
      /CREATE TABLE wallet_withdrawals[\s\S]*destination_ref\s+text NOT NULL/,
    );
  });

  test('rise_identity is a signal and is NOT what the destination view reads', () => {
    // The finding, pinned. If a later session "simplifies" the sixth view onto
    // identity_signals, this fails and says why.
    const text = section710();
    expect(ddl(PHONE)).toContain("'rise_identity'");
    const destinationRow = text
      .split('\n')
      .find((l) => l.includes('**Shared payout destination**'));
    expect(destinationRow).toBeDefined();
    expect(destinationRow!).not.toContain('rise_identity');
    expect(destinationRow!).toContain('destination_ref');
  });
});

// -----------------------------------------------------------------------------
// The link tiers, and the absence of a second confidence
// -----------------------------------------------------------------------------
describe('M06 section 7.10: the tiers are read, never derived', () => {
  test('the tier comes from identity_links.confidence_bp and the hard-link ceiling', () => {
    const text = section710();
    expect(text).toContain('`identity_links.confidence_bp`');
    expect(text).toContain('hard-link ceiling');
    expect(ddl(IDENTITY)).toMatch(
      /confidence_bp\s+integer NOT NULL CHECK \(confidence_bp BETWEEN 0 AND 10000\)/,
    );
  });

  test('the section states no numeric basis-point threshold of its own', () => {
    // THE NEGATIVE, ASSERTED MECHANICALLY. A bp literal in a view section is a
    // computed confidence wearing a different hat, and it is precisely what
    // arrives when somebody is asked to make the views "smarter". D-16 owns the
    // score (ADR-022); a second place that holds a threshold is a second answer.
    const text = section710();
    const thresholds = text.match(/\b\d+\s*bp\b/g) ?? [];
    expect(
      thresholds,
      `section 7.10 states its own threshold(s): ${thresholds.join(', ')}`,
    ).toEqual([]);
  });

  test('a soft link renders as a soft link and changes nothing a trader may buy', () => {
    const text = section710();
    expect(text).toContain('GS-292');
    expect(text).toContain('changes nothing the trader may buy');
    // The sentence the whole safety property rests on, asserted still to be in
    // its primary source rather than only in the quotation of it.
    expect(read(M07)).toContain('**Only a hard merge changes what a trader may buy.**');
  });

  test('suppressed edges leave the aggregate and stay visible as history', () => {
    const text = section710();
    expect(text).toContain('SD-M7-04');
    expect(text).toMatch(/suppressed edges? .*aggregate/i);
    expect(ddl(IDENTITY)).toMatch(/suppressed\s+boolean NOT NULL DEFAULT false/);
    expect(prose(IDENTITY)).toContain(
      'stays visible as history and stops contributing to enforcement',
    );
  });
});

// -----------------------------------------------------------------------------
// The sort, which is the ruling
// -----------------------------------------------------------------------------
describe('M06 section 7.10: sorted by liability, on the authoritative figure', () => {
  test('the default sort is aggregate open liability, descending, and GS-291 asserts it', () => {
    const text = section710();
    expect(text).toMatch(/default sort is aggregate open liability, descending/i);
    expect(text).toContain('GS-291');
    // The reason, not just the rule: a sort by count ranks the coffee shop first.
    expect(read(M07)).toContain('A shared IP is a coffee shop');
  });

  test('the liability figure is P-M6-01 and carries its four constraints', () => {
    const text = section710();
    expect(text).toContain('`P-M6-01`');
    for (const inv of ['INV-M6-11', 'INV-M6-12', 'INV-M6-04', '`P-M6-09`']) {
      expect(text, `the sort key does not state ${inv}`).toContain(inv);
    }
  });

  test('INV-M6-10 holds and no export or browse affordance is offered', () => {
    const text = section710();
    expect(text).toContain('`INV-M6-10`');
    expect(text).toMatch(/no export affordance/i);
  });
});

// -----------------------------------------------------------------------------
// M07's one sentence, and the delta that was released rather than spent
// -----------------------------------------------------------------------------
describe('the fold is exactly as wide as ADR-066 ruled', () => {
  test('M07 gains one sentence, and it is one sentence', () => {
    const body = read(M07);
    const line = body
      .split('\n')
      .find((l) => l.includes('duplicate-signal views') && l.includes('ADR-066'));
    expect(line, 'M07 records nothing about the views').toBeDefined();
    // ONE sentence. FOLD-03 section 5.3's "New in M07" cell reads "Nothing. One
    // sentence", and a paragraph here would be M07 gaining scope it was ruled
    // not to gain.
    const sentences = line!.split(/\.\s|\.$/).filter((s) => s.trim().length > 0);
    expect(sentences.length, `M07's addition is ${sentences.length} sentences`).toBe(1);
    expect(line!).toContain('computing no confidence of their own');
  });

  test('section 7.10 claims no schema delta of this module', () => {
    // The reservation is released BY POSITION rather than by name: ADR-026's
    // completeness gate reads any SD- identifier under docs/ as a claim, so
    // naming it in order to decline it creates the claim the sentence refuses
    // to make (M07 section 2's own finding). This asserts the decline held.
    const text = section710();
    const claimed = text.match(/\bSD-M6-\d{2}\b/g) ?? [];
    expect(claimed, `section 7.10 claims ${claimed.join(', ')}`).toEqual([]);
    expect(text).toMatch(/No schema delta is claimed by this section/);
  });

  test('no migration was written for this fold', () => {
    // ADR-066 section 4: "Nothing new is detected and no migration is needed."
    // 0039 and 0040 belong to F1 and F2; F3 spends nothing.
    const text = section710();
    const migrations = text.match(/\b00\d{2}_[a-z_]+\.sql/g) ?? [];
    for (const m of migrations) {
      expect(
        ['0002_identity.sql', '0029_phone_identity_and_auth.sql'].includes(m),
        `section 7.10 names ${m}, which is not a table these views read`,
      ).toBe(true);
    }
  });
});
