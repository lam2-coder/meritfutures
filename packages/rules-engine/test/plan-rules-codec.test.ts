// =============================================================================
// packages/rules-engine/test/plan-rules-codec.test.ts
// =============================================================================
// `ADR-283`. THE SUITE FOR `plan/rules-codec.ts`, and its spine is a ROUND TRIP
// against a transcription this session did not write.
//
// `published-plans-in-code.ts` holds Appendix A's three plans as `PlanRulesJson`
// values, transcribed from the appendix by a session that had not written a
// decoder. So every case below that renders one of those values into JSON and
// reads it back is comparing TWO independent transcriptions of one document
// rather than a function against its own output, which is the property
// `plan-resolve.test.ts` already buys for the resolver.
//
// **THE JSON LEG IS NEVER SKIPPED AND `ADR-250` SECTION 3 IS WHY.** An object
// copy would carry the `bigint` that no `jsonb` column can hold, and a suite
// that skipped `JSON.parse` would be green on a rendering the store cannot
// produce. `render()` below is the document's own rendering: DATA_MODEL section
// 11 writes `"min_payout_cents": 10000`, a JSON NUMBER, and `JSON.stringify`
// throws on a `bigint`, so the one cents leaf in this document is rendered the
// way the corpus renders it.
//
// **THE CASES THAT DECODE DATA_MODEL SECTION 11's OWN EXAMPLE ARE NOT HERE AND
// THAT IS `M01`'s PURITY BOUNDARY RATHER THAN A CHOICE.** This package's
// tsconfig declares no `node` types, so `tsc --noEmit` refuses `node:fs` inside
// it, and widening that project to read a document would be spending the
// engine's I/O boundary on a test. They live in
// `apps/api/test/rule-state-producibility.test.ts` link 7, which already reads
// the tree and is the file that asks what this deployable can produce.
// =============================================================================

import { describe, expect, test } from 'vitest';

import { EngineInvariantError } from '../src/errors.ts';
import { decodePlanRules, PlanRulesCodecError } from '../src/plan/rules-codec.ts';
import { resolvePlan } from '../src/plan/resolve.ts';
import type { PlanRulesJson } from '../src/types.ts';
import {
  CORE_50K_SIZE,
  DIRECT_50K_SIZE,
  DIRECT_RULES,
  RAPID_50K_SIZE,
  RAPID_RULES,
  coreRules,
} from './published-plans-in-code.ts';

/**
 * One `PlanRulesJson` as the column holds it.
 *
 * THE ONE `bigint` IS RENDERED AS A JSON NUMBER because that is what DATA_MODEL
 * section 11 writes, and the two `null` lock cents are `null` in every v1 plan.
 * A `JSON.stringify` replacer is used rather than a hand-built object so that a
 * NEW `Cents` leaf appearing on `PlanRulesJson` is rendered too instead of being
 * silently dropped by a literal this file forgot to extend.
 */
function render(rules: PlanRulesJson): string {
  return JSON.stringify(rules, (_key, value: unknown) =>
    typeof value === 'bigint' ? Number(value) : value,
  );
}

/** The column's value as the driver hands it over: parsed JSON and nothing else. */
function stored(rules: PlanRulesJson): unknown {
  return JSON.parse(render(rules)) as unknown;
}

/** One stored document with one path edited, for a seed. */
function mutate(rules: PlanRulesJson, edit: (doc: Record<string, unknown>) => void): unknown {
  const doc = stored(rules) as Record<string, unknown>;
  edit(doc);
  return doc;
}

/** `phase_funded`, as a mutable bag inside a stored document. */
function funded(doc: Record<string, unknown>): Record<string, unknown> {
  return doc['phase_funded'] as Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// 1. The round trip, over the three plans Appendix A publishes
// -----------------------------------------------------------------------------

describe('the round trip is against a transcription this module did not write', () => {
  test.each([
    ['Core EOD (A.1)', coreRules()],
    ['Merit Rapid (A.2)', RAPID_RULES],
    ['Direct (A.3)', DIRECT_RULES],
  ])('%s survives render, JSON and decode unchanged', (_name, rules) => {
    expect(decodePlanRules(stored(rules))).toEqual(rules);
  });

  test.each([
    ['Core EOD (A.1)', coreRules(), CORE_50K_SIZE],
    ['Merit Rapid (A.2)', RAPID_RULES, RAPID_50K_SIZE],
    ['Direct (A.3)', DIRECT_RULES, DIRECT_50K_SIZE],
  ])('%s RESOLVES to the same plan through the decoder as it does directly', (_n, rules, size) => {
    // **THIS IS THE CASE THAT MATTERS AND IT IS NOT THE ONE ABOVE.** A decoder
    // can be `toEqual`-green on a document and still hand `resolvePlan` a value
    // that resolves differently, because `ResolvedPlan` is where the cents a
    // payout is decided against actually live.
    expect(resolvePlan(decodePlanRules(stored(rules)), size)).toEqual(resolvePlan(rules, size));
  });

  test('key order is read by NOTHING, because `jsonb` does not return what was written', () => {
    // `ADR-206` ruling 6 and `gates-codec.ts` section 5: Postgres sorts object
    // keys by length and then bytewise. The decoder reads every key by name, and
    // this case proves it by decoding a document whose every level has been
    // re-sorted into that order.
    const jsonbOrder = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(jsonbOrder);
      if (typeof value !== 'object' || value === null) return value;
      const bag = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(bag).sort((a, b) => a.length - b.length || (a < b ? -1 : 1)))
        out[key] = jsonbOrder(bag[key]);
      return out;
    };

    expect(decodePlanRules(jsonbOrder(stored(coreRules())))).toEqual(coreRules());
  });
});

// -----------------------------------------------------------------------------
// 2. Every declared key is OWED, and an absent key is never a default
// -----------------------------------------------------------------------------

describe('an absent key is refused by name and never defaulted', () => {
  test.each([
    ['schema_version', (d: Record<string, unknown>) => delete d['schema_version']],
    ['phase_eval', (d: Record<string, unknown>) => delete d['phase_eval']],
    ['phase_funded', (d: Record<string, unknown>) => delete d['phase_funded']],
    ['phase_funded.split_bp', (d: Record<string, unknown>) => delete funded(d)['split_bp']],
    [
      'phase_funded.min_payout_cents',
      (d: Record<string, unknown>) => delete funded(d)['min_payout_cents'],
    ],
    [
      'phase_funded.post_payout_floor_rule',
      (d: Record<string, unknown>) => delete funded(d)['post_payout_floor_rule'],
    ],
    ['phase_funded.win_days', (d: Record<string, unknown>) => delete funded(d)['win_days']],
    [
      'phase_eval.max_days',
      (d: Record<string, unknown>) =>
        delete (d['phase_eval'] as Record<string, unknown>)['max_days'],
    ],
  ])('a document missing `%s` throws rather than filling it in', (path, edit) => {
    expect(() => decodePlanRules(mutate(coreRules(), edit))).toThrow(
      new RegExp(`${path.replaceAll('.', '\\.')}: is absent`),
    );
  });

  test('an ABSENT `max_days` and a NULL `max_days` are DIFFERENT, which is why the key is tested', () => {
    // `null` MEANS UNLIMITED (DATA_MODEL section 11) and every v1 plan carries
    // it. A decoder that read `bag[key] !== undefined` could not tell the two
    // apart and would silently turn a missing key into an unlimited eval phase.
    const withNull = decodePlanRules(stored(coreRules()));
    expect(withNull.phase_eval.max_days).toBeNull();

    expect(() =>
      decodePlanRules(
        mutate(coreRules(), (d) => {
          delete (d['phase_eval'] as Record<string, unknown>)['max_days'];
        }),
      ),
    ).toThrow(/phase_eval\.max_days: is absent/);
  });
});

// -----------------------------------------------------------------------------
// 3. Money, which is the only leaf with a ceiling
// -----------------------------------------------------------------------------

describe('integer cents, at the rendering DATA_MODEL section 11 writes', () => {
  test('a JSON number is the documented rendering and decodes to a `bigint`', () => {
    const decoded = decodePlanRules(stored(coreRules()));
    expect(decoded.phase_funded.min_payout_cents).toBe(10_000n);
    expect(typeof decoded.phase_funded.min_payout_cents).toBe('bigint');
  });

  test('a base-10 STRING is accepted too, and it is the only rendering above the ceiling', () => {
    // `ADR-206` section 5 measured the loss: `jsonb` numbers are `numeric` and
    // Postgres holds `9007199254740993` exactly, while the same value read back
    // through `JSON.parse` as a NUMBER returns `9007199254740992`. So a cents
    // value past `Number.MAX_SAFE_INTEGER` has ALREADY lost digits by the time a
    // decoder sees it as a number, and this codec refuses it rather than
    // rounding; as a string it round-trips exactly.
    const past = 9_007_199_254_740_993n;
    expect(past).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));

    const asString = mutate(coreRules(), (d) => {
      funded(d)['min_payout_cents'] = past.toString(10);
    });
    expect(decodePlanRules(asString).phase_funded.min_payout_cents).toBe(past);

    const asNumber = mutate(coreRules(), (d) => {
      funded(d)['min_payout_cents'] = Number(past);
    });
    expect(() => decodePlanRules(asNumber)).toThrow(/min_payout_cents: is not a safe integer/);
  });

  test.each([
    ['the empty string', ''],
    ['a padded string', ' 12'],
    ['a trailing space', '12 '],
    ['a leading zero', '0012'],
    ['an explicit plus', '+12'],
    ['negative zero', '-0'],
    ['hexadecimal', '0x10'],
    ['exponential notation', '1e3'],
  ])('%s is refused, because `BigInt` would tolerate it and lose the distinction', (_n, text) => {
    expect(() =>
      decodePlanRules(
        mutate(coreRules(), (d) => {
          funded(d)['min_payout_cents'] = text;
        }),
      ),
    ).toThrow(PlanRulesCodecError);
  });

  test.each([
    ['a fraction', 0.5],
    ['NaN, which `jsonb` reaches through other writers', Number.NaN],
    ['a boolean', true],
    ['an object', {}],
  ])('%s is refused where integer cents were required', (_n, value) => {
    expect(() =>
      decodePlanRules(
        mutate(coreRules(), (d) => {
          funded(d)['min_payout_cents'] = value;
        }),
      ),
    ).toThrow(/min_payout_cents/);
  });

  test('a NULLABLE cents leaf takes `null` and refuses a fraction', () => {
    // `lock.at_profit_cents` is `null` on all three v1 plans, and the values
    // live on `plan_version_sizes` because they scale with size.
    expect(
      decodePlanRules(stored(coreRules())).phase_funded.drawdown.lock.at_profit_cents,
    ).toBeNull();

    expect(() =>
      decodePlanRules(
        mutate(coreRules(), (d) => {
          ((funded(d)['drawdown'] as Record<string, unknown>)['lock'] as Record<string, unknown>)[
            'at_profit_cents'
          ] = 1.5;
        }),
      ),
    ).toThrow(/lock\.at_profit_cents/);
  });
});

// -----------------------------------------------------------------------------
// 4. What the decoder does NOT do, which is section 4 of the module's header
// -----------------------------------------------------------------------------

describe('no CV rule is re-run at read, and the five `resolvePlan` refuses are the floor', () => {
  test('`intraday_trailing` DECODES and `resolvePlan` refuses it, which is CV-01 reachable', () => {
    // R-17 arriving where CV-01 put it. A decoder that narrowed the union to two
    // members would make `resolvePlan`'s refusal unreachable and its test
    // vacuous, which is the shape `types.ts` refuses at the type.
    const document = mutate(coreRules(), (d) => {
      (funded(d)['drawdown'] as Record<string, unknown>)['type'] = 'intraday_trailing';
    });

    expect(decodePlanRules(document).phase_funded.drawdown.type).toBe('intraday_trailing');
    expect(() => resolvePlan(decodePlanRules(document), CORE_50K_SIZE)).toThrow(
      EngineInvariantError,
    );
  });

  test('a loss-limit type outside CV-16 DECODES and `resolvePlan` refuses it', () => {
    // `PublishedDailyLossLimit.type` is `string` in the engine's own type, and
    // narrowing it in a decoder would take CV-16's job.
    const document = mutate(coreRules(), (d) => {
      (funded(d)['daily_loss_limit'] as Record<string, unknown>)['type'] = 'squishy';
    });

    expect(decodePlanRules(document).phase_funded.daily_loss_limit.type).toBe('squishy');
    expect(() => resolvePlan(decodePlanRules(document), CORE_50K_SIZE)).toThrow(/CV-16/);
  });

  test('a consistency rule enabled with a null share DECODES and `resolvePlan` refuses it', () => {
    const document = mutate(coreRules(), (d) => {
      (funded(d)['consistency'] as Record<string, unknown>)['max_day_share_bp'] = null;
    });

    expect(decodePlanRules(document).phase_funded.consistency.max_day_share_bp).toBeNull();
    expect(() => resolvePlan(decodePlanRules(document), CORE_50K_SIZE)).toThrow(/CV-06/);
  });

  test('AND A `CV-13` VIOLATION DECODES AND RESOLVES, which is the ruling stated as a case', () => {
    // **THIS CASE IS THE HONEST HALF OF `ADR-283` RULING 2 AND IT IS DELIBERATELY
    // NOT A REFUSAL.** `CV-13` bounds `split_bp` at 10,000 and it is checked at
    // PUBLISH. `validatePlan` takes the DECODED type and needs EVERY size of the
    // version, so it is neither prior to this function nor callable from a read
    // that holds one size; the read therefore TRUSTS the publish gate for the
    // rules this decoder does not restate, and a row published before `CV-13`
    // existed passes here unchecked.
    //
    // A reader who thinks that is too permissive is reading the ruling
    // correctly: `ADR-283` section 4 names the whole unchecked set and puts it
    // in the `E2` read. WHAT IS REFUSED IS RESTATING NINETEEN RULES IN A SECOND
    // PLACE ON THE MONEY PATH, which is `FM-16` nineteen times.
    const document = mutate(coreRules(), (d) => {
      funded(d)['split_bp'] = 20_000;
    });

    expect(decodePlanRules(document).phase_funded.split_bp).toBe(20_000);
    expect(resolvePlan(decodePlanRules(document), CORE_50K_SIZE).funded.splitBp).toBe(20_000);
  });
});

// -----------------------------------------------------------------------------
// 5. Structure, which is the whole of what this function does refuse
// -----------------------------------------------------------------------------

describe('the document is refused where it is not the shape', () => {
  test.each([
    ['null', null],
    ['an array', []],
    ['a string', 'rules'],
    ['a number', 1],
  ])('a top-level %s is refused', (_n, value) => {
    expect(() => decodePlanRules(value)).toThrow(PlanRulesCodecError);
  });

  test('a second schema version is a different build rather than a branch inside this one', () => {
    expect(() =>
      decodePlanRules(
        mutate(coreRules(), (d) => {
          d['schema_version'] = 2;
        }),
      ),
    ).toThrow(/schema_version: is 2 and this build reads 1/);
  });

  test.each([
    ['a fractional basis-point figure', 0.5],
    ['an infinite day count', Number.POSITIVE_INFINITY],
    ['a numeric string where a number was required', '9000'],
  ])('%s is refused rather than coerced', (_n, value) => {
    expect(() =>
      decodePlanRules(
        mutate(coreRules(), (d) => {
          funded(d)['split_bp'] = value;
        }),
      ),
    ).toThrow(/split_bp/);
  });

  test('a group that is not an object names its own path', () => {
    expect(() =>
      decodePlanRules(
        mutate(coreRules(), (d) => {
          funded(d)['win_days'] = [];
        }),
      ),
    ).toThrow(/phase_funded\.win_days: expected an object and found an array/);
  });

  test('the cap schedule is an ARRAY from day one, and a scalar is refused', () => {
    expect(decodePlanRules(stored(coreRules())).phase_funded.payout_cap_schedule).toEqual([
      { from_ordinal: 1, cap_bp: 300 },
    ]);

    expect(() =>
      decodePlanRules(
        mutate(coreRules(), (d) => {
          funded(d)['payout_cap_schedule'] = { from_ordinal: 1, cap_bp: 300 };
        }),
      ),
    ).toThrow(/payout_cap_schedule: expected an array/);
  });

  test('a cap step carries its INDEX in the path, because a schedule is read by position', () => {
    expect(() =>
      decodePlanRules(
        mutate(coreRules(), (d) => {
          funded(d)['payout_cap_schedule'] = [
            { from_ordinal: 1, cap_bp: 300 },
            { from_ordinal: 2 },
          ];
        }),
      ),
    ).toThrow(/payout_cap_schedule\[1\]\.cap_bp: is absent/);
  });

  test('a consistency mode outside the two is refused, and the message names both', () => {
    expect(() =>
      decodePlanRules(
        mutate(coreRules(), (d) => {
          (funded(d)['consistency'] as Record<string, unknown>)['mode'] = 'whenever';
        }),
      ),
    ).toThrow(/is "whenever", which is outside \{pass_time_dilutable, payout_gated\}/);
  });

  test('the error carries the dotted path as a FIELD and not only inside its message', () => {
    // `EngineGatesCodecError`'s reason unchanged: the value that came back wrong
    // is read by somebody holding a row, and a caller that has to parse a
    // message to find the leaf is a caller that will not.
    let caught: unknown;
    try {
      decodePlanRules(
        mutate(coreRules(), (d) => {
          delete funded(d)['buffer_bp'];
        }),
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PlanRulesCodecError);
    expect((caught as PlanRulesCodecError).path).toBe('$.phase_funded.buffer_bp');
    expect((caught as PlanRulesCodecError).name).toBe('PlanRulesCodecError');
  });

  test('the caller may name the document, and the default is `$`', () => {
    expect(() => decodePlanRules(null, 'plan_versions[0199c7a1].rules')).toThrow(
      /plan_versions\[0199c7a1\]\.rules: expected an object and found null/,
    );
  });
});
