import { describe, expect, test } from 'vitest';

import { YamlSubsetError, parseYamlSubset } from '../src/yaml.ts';

// =============================================================================
// The parser's refusals are the feature, so they are what is tested
// =============================================================================
// A permissive parser that gets a fixture SLIGHTLY wrong produces a golden file
// pinning something nobody wrote, and a golden file nobody wrote is worse than
// no golden file. Every case below is a construct outside the subset, asserted
// to throw rather than to be coerced into something plausible.

describe('the subset it reads', () => {
  test('reads the fixture shape GOLDEN_SCENARIOS section 2 prints', () => {
    const parsed = parseYamlSubset(
      [
        'id: GS-011',
        'name: trailing floor does not trail on an intraday spike',
        'plan: CORE-50K              # resolves to fixtures/plans/CORE-50K.json',
        'account:',
        '  phase: funded',
        '  opened_on: 2026-11-02',
        '  size_cents: 5000000',
        'days:',
        '  - trading_day: 2026-11-03',
        '    closing_balance_cents: 5020000',
        '    fill_count: 4',
        '  - trading_day: 2026-11-04',
        '    closing_balance_cents: 5010000',
        '    fill_count: 0',
        'settlements: []',
      ].join('\n'),
    );

    expect(parsed).toEqual({
      id: 'GS-011',
      name: 'trailing floor does not trail on an intraday spike',
      plan: 'CORE-50K',
      account: { phase: 'funded', opened_on: '2026-11-02', size_cents: 5000000 },
      days: [
        { trading_day: '2026-11-03', closing_balance_cents: 5020000, fill_count: 4 },
        { trading_day: '2026-11-04', closing_balance_cents: 5010000, fill_count: 0 },
      ],
      settlements: [],
    });
  });

  test('an unquoted trading day stays a string, which is the whole reason this parser exists', () => {
    // A real YAML library resolves this to a Date through the core schema's
    // timestamp rule, and a Date reaching the engine is a clock reading in a
    // package whose entire contract is that it has none. Anyone swapping in
    // `yaml` quotes every date in every fixture in the same commit.
    const parsed = parseYamlSubset('trading_day: 2026-11-03') as Record<string, unknown>;
    expect(parsed['trading_day']).toBe('2026-11-03');
  });

  test('the trading day is the ONLY member of its class that is admitted', () => {
    // The admission is deliberate and it is exactly one shape wide. Every other
    // plain scalar a real YAML library would type differently is refused, so
    // the fixture tree cannot quietly acquire a second one while the dependency
    // question is open.
    expect(() => parseYamlSubset('opened_on: 2026-11-3')).toThrow(/ambiguous plain scalar/);
    expect(() => parseYamlSubset('opened_on: 2026-11-03T00:00:00Z')).toThrow(
      /ambiguous plain scalar/,
    );
  });

  test('quoting is the escape hatch, and it means the text under every schema', () => {
    expect(parseYamlSubset('clamp_reason: "yes"\nnote: "007"')).toEqual({
      clamp_reason: 'yes',
      note: '007',
    });
  });

  test('booleans, null and negative integers', () => {
    expect(parseYamlSubset('a: true\nb: false\nc: null\nd: ~\ne: -20000')).toEqual({
      a: true,
      b: false,
      c: null,
      d: null,
      e: -20000,
    });
  });

  test('a "#" inside a quoted scalar is content, not a comment', () => {
    expect(parseYamlSubset('pins: "the floor never retreats # not even here"')).toEqual({
      pins: 'the floor never retreats # not even here',
    });
  });
});

describe('the constructs it refuses', () => {
  const refused: Array<[string, string, string]> = [
    ['a decimal, because money is integer cents', 'floor_cents: 4770000.0', 'decimal number'],
    ['an exponent', 'floor_cents: 4.77e6', 'decimal number'],
    ['a tab', 'account:\n\tphase: funded', 'tab character'],
    ['an odd indent', 'account:\n   phase: funded', 'indent of 3'],
    ['a document marker', '---\nid: GS-011', 'document marker'],
    ['an anchor', 'account: &base', 'outside the subset'],
    ['an alias', 'account: *base', 'outside the subset'],
    ['a block scalar', 'pins: |', 'outside the subset'],
    ['a non-empty flow sequence', 'events: [day.closed]', 'outside the subset'],
    ['a non-empty flow mapping', 'account: {phase: funded}', 'outside the subset'],
    ['a duplicate key', 'id: GS-011\nid: GS-012', 'duplicate key'],
    ['a key with no value', 'account:\nid: GS-011', 'has no value'],
    ['a nested block under a scalar item', 'days:\n  - scalar\n    key: 1', 'nested block'],
    ['an unterminated quote', 'pins: "the floor', 'unterminated'],
    ['a mapping after a top-level sequence', '- a\nkey: 1', 'unread content'],
    ['a plain scalar that is not a pair', 'id: GS-011\nbad line here', 'not a "key: value" pair'],

    // THE SEEDED CASE FOR THE ONE SILENT MIS-PARSE THIS PARSER HAD. Before
    // `readWholeItem`, this parsed to `{days: [["a"]]}` on every stream, with
    // `keep_me` read from disk and discarded. A fixture input the engine never
    // sees is the worst outcome available to a golden file, because the
    // scenario passes while pinning something the author did not write.
    [
      'content after a nested sequence inside one item, which used to be dropped',
      'days:\n  -\n    - a\n    keep_me: 1',
      'unread content inside the sequence item',
    ],
    [
      'a second nested block after a nested sequence',
      'days:\n  -\n    - a\n    - b\n    c: 1',
      'unread content inside the sequence item',
    ],

    // THE AMBIGUOUS PLAIN SCALARS, which are the date hazard generalized. Each
    // is a string here and something else under `yaml`, so each is refused
    // rather than read as the wrong type.
    ['a case-variant boolean', 'breached: True', 'ambiguous plain scalar'],
    ['a YAML 1.1 boolean word', 'breached: yes', 'ambiguous plain scalar'],
    ['a case-variant null', 'daily_loss_limit: NULL', 'ambiguous plain scalar'],
    ['a hexadecimal integer', 'fill_count: 0x1F', 'ambiguous plain scalar'],
    ['an integer with a leading zero', 'fill_count: 007', 'ambiguous plain scalar'],
    ['an integer with an explicit plus', 'realized_pnl_cents: +20000', 'ambiguous plain scalar'],
    ['an integer with digit separators', 'size_cents: 5_000_000', 'ambiguous plain scalar'],
    ['a float constant', 'floor_cents: .inf', 'ambiguous plain scalar'],
    ['a sexagesimal', 'session_length: 1:30', 'ambiguous plain scalar'],
  ];

  test.each(refused)('refuses %s', (_label, source, needle) => {
    let thrown: unknown;
    try {
      parseYamlSubset(source);
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toBeInstanceOf(YamlSubsetError);
    expect((thrown as YamlSubsetError).message).toContain(needle);
  });

  test('the float refusal names the rule rather than the type', () => {
    expect(() => parseYamlSubset('floor_cents: 4770000.5')).toThrow(/integer cents/);
  });
});
