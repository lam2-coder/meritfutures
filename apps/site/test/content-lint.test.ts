import { expect, test } from 'vitest';

import {
  ContentLintError,
  SETTLEMENT_WINDOW_CARVE_OUT,
  assertAuthoredContentIsClean,
  authoredSurfaces,
  lintAuthoredContent,
} from '../src/content/lint.ts';

// CI-02, the `unit` project. VG-M9-2, INV-M9-07: the content lint.
//
// BOTH DIRECTIONS, DELIBERATELY, AND THE CLEAN HALF IS ASSERTED AS HARD AS THE
// REFUSAL. A lint tested only where it refuses is indistinguishable from a lint
// that refuses everything, and the second one is worse than no lint: it gets
// disabled the first week, by a reviewer who is right.

const doc = (frontmatter: string, body: string): string =>
  `---\ntitle: A post\n${frontmatter}\n---\n\n${body}\n`;

const CLEAN_BODY = [
  'Merit publishes every plan parameter from the pinned plan version.',
  '',
  'The payout cap for this plan and size is <PlanValue plan="core_eod" size="50K" field="payout_cap_cents"/>,',
  'and the winning-day requirement is <PlanValue plan="core_eod" size="50K" field="win_days_required_count"/>.',
  '',
  'Our published pass rate is <Statistic code="eval_pass_rate"/>.',
  '',
  "The cap is set per plan and shown on that plan's rules page.",
].join('\n');

const CLEAN_OG = [
  'og_title: How Merit states a parameter',
  'og_description: Every figure on this page is read from the pinned plan version.',
].join('\n');

// -----------------------------------------------------------------------------
// GS-143, the direction that PASSES
// -----------------------------------------------------------------------------

test('GS-143: MDX that states its figures through <PlanValue> builds', () => {
  expect(lintAuthoredContent(doc(CLEAN_OG, CLEAN_BODY))).toEqual([]);
  expect(() =>
    assertAuthoredContentIsClean(doc(CLEAN_OG, CLEAN_BODY), 'faq/how-we-state-a-parameter'),
  ).not.toThrow();
});

test('describing the mechanism rather than the value builds, which is the escape M09 section 5 tells authors to take', () => {
  const body =
    'The cap is set per plan and shown on the plan rules page. It moves when the plan moves.';
  expect(lintAuthoredContent(doc(CLEAN_OG, body))).toEqual([]);
});

test('a fenced code block is a code sample and not prose, and an inline span is prose', () => {
  const fenced = doc(CLEAN_OG, ['```json', '{ "payout_cap_cents": 150000 }', '```'].join('\n'));
  expect(lintAuthoredContent(fenced)).toEqual([]);

  const inline = doc(CLEAN_OG, 'The cap is `$1,500` per payout.');
  expect(lintAuthoredContent(inline).map((f) => f.rule)).toEqual(['GS-143']);
});

// -----------------------------------------------------------------------------
// GS-143, the direction that FAILS. This is the row's own assertion
// -----------------------------------------------------------------------------

test('GS-143: MDX content containing a bare parameter value fails the build', () => {
  const body = 'Our 50K plan pays up to $1,500 per payout and requires 5 winning days.';
  expect(() => assertAuthoredContentIsClean(doc(CLEAN_OG, body), 'blog/launch')).toThrow(
    ContentLintError,
  );
});

test('GS-143: the same sentence written with <PlanValue> builds', () => {
  const bare = 'The cap is $1,500 per payout.';
  const emitted =
    'The cap is <PlanValue plan="core_eod" size="50K" field="payout_cap_cents"/> per payout.';
  expect(lintAuthoredContent(doc(CLEAN_OG, bare)).length).toBe(1);
  expect(lintAuthoredContent(doc(CLEAN_OG, emitted))).toEqual([]);
});

test('GS-143: all three shapes M09 section 5 names are refused', () => {
  const shapes = [
    'The cap is $1,500 per payout.',
    'The profit split is 90%.',
    'The consistency threshold is 40 percent.',
    'The gap is 250 basis points.',
    'You need 5 winning days.',
    'It unlocks after a 30-day period.',
  ];
  for (const body of shapes) {
    expect(lintAuthoredContent(doc(CLEAN_OG, body)).length, body).toBeGreaterThan(0);
  }
});

test('GS-143: <PlanValue> without its three attributes is refused, because the verbosity IS the control', () => {
  const body = 'The cap is <PlanValue field="payout_cap_cents"/>.';
  const findings = lintAuthoredContent(doc(CLEAN_OG, body));
  expect(findings.length).toBe(1);
  expect(findings[0]?.message).toMatch(/plan, size/);
});

test('a marketed size label inside <PlanValue> is config and does not read as bare prose (INV-M9-12)', () => {
  const body = 'At <PlanValue plan="core_eod" size="50K" field="size_cents"/> the account trades.';
  expect(lintAuthoredContent(doc(CLEAN_OG, body))).toEqual([]);
});

// -----------------------------------------------------------------------------
// ADR-042's settlement window, the one carve-out, in both directions
// -----------------------------------------------------------------------------

test('the canonical payout copy builds, because ADR-042 makes the settlement window a quoted banking-rail unit', () => {
  const body = `Payouts land in your Merit Wallet the same day you request them. ${SETTLEMENT_WINDOW_CARVE_OUT}`;
  expect(lintAuthoredContent(doc(CLEAN_OG, body))).toEqual([]);
});

test('a DIFFERENT day count in that sentence is a different sentence, and it fails', () => {
  const body = 'Withdrawing from your wallet to your bank takes 5 to 7 business days.';
  expect(lintAuthoredContent(doc(CLEAN_OG, body)).length).toBeGreaterThan(0);
});

// -----------------------------------------------------------------------------
// GS-144 ON THE OG IMAGE PATH. The half a lint written in a hurry drops
// -----------------------------------------------------------------------------

test('every og_* frontmatter key is a surface, discovered rather than listed', () => {
  const source = doc(
    ['og_title: A title', 'og_description: A description', 'og_card_headline: A headline'].join(
      '\n',
    ),
    CLEAN_BODY,
  );
  expect(authoredSurfaces(source).map((s) => s.name)).toEqual([
    'og_title',
    'og_description',
    'og_card_headline',
    'body',
  ]);
});

test('GS-144: a bare figure in the OG description fails the build even though the body is clean', () => {
  const source = doc(
    ['og_title: Our pass rate', 'og_description: 41% of evaluations pass.'].join('\n'),
    CLEAN_BODY,
  );
  const findings = lintAuthoredContent(source);
  expect(findings.length).toBe(1);
  expect(findings[0]?.surface).toBe('og_description');
  expect(() => assertAuthoredContentIsClean(source, 'blog/pass-rate')).toThrow(ContentLintError);
});

test('GS-144: a published statistic rendered without its trailing window fails the build', () => {
  const stripped = 'Our pass rate is <Statistic code="eval_pass_rate" value-only/>.';
  const findings = lintAuthoredContent(doc(CLEAN_OG, stripped));
  expect(findings.map((f) => f.rule)).toEqual(['GS-144']);
  expect(findings[0]?.message).toMatch(/trailing window/);
});

test('GS-144: it fails on the OG image path too, which is where screenshots actually come from', () => {
  const source = doc(
    [
      'og_title: Our pass rate',
      'og_description: <Statistic code="eval_pass_rate" value-only/>',
    ].join('\n'),
    CLEAN_BODY,
  );
  const findings = lintAuthoredContent(source);
  expect(findings.map((f) => [f.rule, f.surface])).toEqual([['GS-144', 'og_description']]);
});

test('GS-144: an author-supplied window is refused, because a stated window drifts from the computed one', () => {
  const source = doc(
    CLEAN_OG,
    'Our pass rate is <Statistic code="eval_pass_rate" window="90 days"/>.',
  );
  const findings = lintAuthoredContent(source);
  expect(findings.map((f) => f.rule)).toContain('GS-144');
});

test('GS-144: <Statistic> without a code names a figure the transparency run never published', () => {
  const findings = lintAuthoredContent(doc(CLEAN_OG, 'Our pass rate is <Statistic/>.'));
  expect(findings.map((f) => f.rule)).toEqual(['GS-144']);
});

test('GS-144: the sanctioned form builds, on the body and on the OG surface alike', () => {
  const source = doc(
    ['og_title: Our pass rate', 'og_description: <Statistic code="eval_pass_rate"/>'].join('\n'),
    'Our pass rate is <Statistic code="eval_pass_rate"/>.',
  );
  expect(lintAuthoredContent(source)).toEqual([]);
});

// -----------------------------------------------------------------------------
// The refusal has to be usable
// -----------------------------------------------------------------------------

test('the error names every finding, so one build reports every violation rather than one per rebuild', () => {
  const source = doc(
    ['og_title: 90% pass', 'og_description: The cap is $1,500.'].join('\n'),
    'You need 5 winning days.',
  );
  let error: unknown;
  try {
    assertAuthoredContentIsClean(source, 'blog/launch');
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ContentLintError);
  expect((error as ContentLintError).findings.length).toBe(3);
  expect((error as ContentLintError).message).toMatch(/blog\/launch/);
});

test('a `g` regex is rebuilt per call, so a second figure on one surface is not skipped', () => {
  const body = 'The cap is $1,500 and the target is $3,000.';
  expect(lintAuthoredContent(doc(CLEAN_OG, body)).length).toBe(2);
});
