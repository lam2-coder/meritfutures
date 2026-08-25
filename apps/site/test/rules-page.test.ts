import { expect, test } from 'vitest';

import type { Cents } from '@merit/rules-engine';

import { money } from '../src/render/cents.ts';
import { DisclosureError } from '../src/render/disclosure.ts';
import type { RulesPage } from '../src/routes/rules.ts';
import { RulesPageError, assertRuleTextIsPublished, rulesPage } from '../src/routes/rules.ts';
import { BUILT_AT, label, sizeRow, sizeView, versionView } from './fixtures.ts';

// CI-02, the `unit` project. M9-C-nn and M9-V-nn.

const disclosure = {
  form: 'short' as const,
  body: 'Counsel drafts this.',
  document_version: 3,
  document_slug: 'terms-of-service',
};

const COPY = {
  'phase_funded.win_days':
    'You need three winning days of at least the win-day floor before your next payout.',
  'phase_funded.drawdown': 'Your floor trails your end-of-day balance and never moves down.',
  'phase_eval.profit_target': 'Reach the profit target to pass the evaluation.',
};

const build = (overrides: Parameters<typeof versionView>[0] = {}): RulesPage => {
  const version = versionView({ copy_blocks: COPY, ...overrides });
  return rulesPage({ version, size: version.sizes[0]!, disclosure }, BUILT_AT);
};

// -----------------------------------------------------------------------------
// INV-M9-02: the page has no prose of its own
// -----------------------------------------------------------------------------

test('INV-M9-02: every block on the page is a published copy_block, verbatim', () => {
  const version = versionView({ copy_blocks: COPY });
  const page = rulesPage({ version, size: version.sizes[0]!, disclosure }, BUILT_AT);

  expect(page.blocks).toHaveLength(3);
  for (const block of page.blocks) {
    expect(block.body).toBe(COPY[block.rule_path as keyof typeof COPY]);
  }
  expect(() => assertRuleTextIsPublished(page, version)).not.toThrow();
});

// The check is equality and not containment, because containment passes on a
// page that wrapped the block in a sentence of its own, which is AS-M9-05.
test("INV-M9-02: a block wrapped in the site's own sentence fails the check", () => {
  const version = versionView({ copy_blocks: COPY });
  const page = rulesPage({ version, size: version.sizes[0]!, disclosure }, BUILT_AT);

  const embellished: RulesPage = {
    ...page,
    blocks: page.blocks.map((b) => ({ ...b, body: `Note: ${b.body}` })),
  };

  expect(() => assertRuleTextIsPublished(embellished, version)).toThrow(RulesPageError);
});

test('INV-M9-02: even a trim is prose of its own', () => {
  const version = versionView({ copy_blocks: { 'phase_funded.win_days': ' spaced ' } });
  const page = rulesPage({ version, size: version.sizes[0]!, disclosure }, BUILT_AT);

  expect(page.blocks[0]!.body).toBe(' spaced ');
  expect(() =>
    assertRuleTextIsPublished({ ...page, blocks: [{ rule_path: 'x', body: 'spaced' }] }, version),
  ).toThrow(RulesPageError);
});

// FM-M9-08 asserts the build digest after deploy, so two builds of one version
// have to produce the same bytes.
test('the block order is deterministic across builds of the same version', () => {
  const first = build().blocks.map((b) => b.rule_path);
  const second = build().blocks.map((b) => b.rule_path);

  expect(first).toEqual(second);
  expect(first).toEqual([...first].sort());
});

test('a version with no copy blocks renders none rather than inventing any', () => {
  const version = versionView({ copy_blocks: {} });
  const page = rulesPage({ version, size: version.sizes[0]!, disclosure }, BUILT_AT);

  expect(page.blocks).toEqual([]);
});

// -----------------------------------------------------------------------------
// Section 8.3, on the surface where the figures sit beside the rule text
// -----------------------------------------------------------------------------

test('every figure equals the row it came from, beside the text that governs it', () => {
  const size = sizeView({ row: sizeRow({ win_day_floor_cents: 30_000n as Cents }) });
  const version = versionView({ copy_blocks: COPY, sizes: [size] });
  const page = rulesPage({ version, size, disclosure }, BUILT_AT);

  expect(page.figures.win_day_floor).toBe(money(size.row.win_day_floor_cents));
  expect(page.figures.size).toBe(money(size.row.size_cents));
  expect(page.figures.drawdown).toBe(money(size.row.drawdown_cents));
});

test('GS-309: the label names the size and no figure is derived from it', () => {
  const size = sizeView({
    row: sizeRow({ size_cents: 2_500_000n as Cents }),
    marketed_size_label: label('$50K'),
  });
  const version = versionView({ copy_blocks: COPY, sizes: [size] });
  const page = rulesPage({ version, size, disclosure }, BUILT_AT);

  expect(page.size_label).toBe('$50K');
  expect(page.size_label_is_marketed).toBe(true);
  expect(page.figures.size).toBe(money(2_500_000n as Cents));
  expect(JSON.stringify(page.figures)).not.toContain('50K');
});

// -----------------------------------------------------------------------------
// OQ-M9-01's selector, and the version boundary
// -----------------------------------------------------------------------------

test('OQ-M9-01: one size at a time, with a selector to the others on permanent paths', () => {
  const small = sizeView({ row: sizeRow({ size_cents: 2_500_000n as Cents }) });
  const large = sizeView({ row: sizeRow({ size_cents: 5_000_000n as Cents }) });
  const version = versionView({ copy_blocks: COPY, sizes: [small, large] });

  const page = rulesPage({ version, size: small, disclosure }, BUILT_AT);

  expect(page.size_choices).toHaveLength(2);
  expect(page.size_choices[0]!.selected).toBe(true);
  expect(page.size_choices[1]!.selected).toBe(false);
  expect(page.size_choices[1]!.path).toContain('5000000');
});

test('a size the version does not publish cannot be rendered on its page', () => {
  const version = versionView({ copy_blocks: COPY });
  const foreign = sizeView({ row: sizeRow({ size_cents: 99_999_999n as Cents }) });

  expect(() => rulesPage({ version, size: foreign, disclosure }, BUILT_AT)).toThrow(RulesPageError);
});

// -----------------------------------------------------------------------------
// GS-148 on the rules page
// -----------------------------------------------------------------------------

test('GS-148: a superseded version is labeled, names its successor, and is excluded', () => {
  const page = build({
    version: 1,
    public_slug: 'merit-rapid-v1',
    superseded_by: { version: 2, public_slug: 'merit-rapid-v2' },
  });

  expect(page.supersession_notice).toContain('superseded by version 2');
  expect(page.envelope.indexable).toBe(false);
  expect(page.envelope.canonical_path).toBe('/plans/merit-rapid-v2');
  expect(page.envelope.renders_version?.superseded).toBe(true);
  expect(page.envelope.renders_version?.successor_path).toBe('/plans/merit-rapid-v2');
});

// AS-M9-07: the trader pinned to v1 must be able to read v1, and the page must
// say plainly that v1 still governs their account.
test('GS-148: the notice says the superseded rules still govern accounts opened under them', () => {
  const page = build({ superseded_by: { version: 2, public_slug: 'merit-rapid-v2' } });
  expect(page.supersession_notice).toContain('still governed by the rules on this page');
});

test('a current version carries no supersession notice', () => {
  expect(build().supersession_notice).toBeNull();
});

test('INV-M9-03: the page names the version it renders, by number and by address', () => {
  const stamp = build().envelope.renders_version;

  expect(stamp?.version).toBe(1);
  expect(stamp?.public_slug).toBe('merit-rapid-v1');
  expect(stamp?.plan_code).toBe('merit_rapid');
});

test('INV-M9-05: the rules page cannot be built without a disclosure', () => {
  const version = versionView({ copy_blocks: COPY });
  expect(() => rulesPage({ version, size: version.sizes[0]!, disclosure: null }, BUILT_AT)).toThrow(
    DisclosureError,
  );
});
