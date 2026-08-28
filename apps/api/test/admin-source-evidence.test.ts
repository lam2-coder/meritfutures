import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import type {
  DetectorRegistryRow,
  EvidenceDocument,
  EvidenceExporterDeps,
  EvidenceFlagRecord,
  EvidencePackRow,
  EvidenceSubject,
} from '../src/admin-source/evidence.ts';
import {
  EVIDENCE_REDACTION_PROFILES,
  EvidenceExportError,
  EvidenceRedactionError,
  assertIntegerAmounts,
  assertTraderPackIsClean,
  buildEvidenceDocument,
  canonicalJson,
  createEvidenceExporter,
  foreignIdentifiers,
  includesDetectorDetail,
  redactionProfileFor,
  renderEvidencePack,
  sensitiveParameterNames,
} from '../src/admin-source/evidence.ts';
import {
  AdminSourceNotComposed,
  adminReadSourceParts,
  composeAdminReadSource,
} from '../src/admin-source/index.ts';
import { EVIDENCE_PACK_AUDIENCES } from '../src/routes/admin-reads.ts';
import type { AdminPrincipal, EvidencePackAudience } from '../src/routes/admin-reads.ts';

// CI-02, the `unit` project. P7 section 8's `P7-j`, the SECOND DONE-GATE.
//
// =============================================================================
// GS-112 IS A GATE THAT PASSES WHEN A DOCUMENT OMITS SOMETHING
// =============================================================================
// "A `trader` pack contains every fill, mark, rule state, gate result, and the
// plan's rule text, plus the fact and ToS clause of any flag, and contains NO
// detector parameter, threshold, or other identity. An `internal` pack contains
// everything. AS-M6-01."
//
// SO EVERY NEGATIVE IS ASSERTED DIRECTLY AND INDIVIDUALLY. A single
// `expect(pack).toMatchSnapshot()` or one `isRedacted` boolean would pass on a
// pack that leaked one parameter of eighteen, and `AS-M6-01` is permanent damage
// on a single occurrence: a ring that learns one window tunes to it forever.
// Each parameter name gets its own case, each threshold value gets its own case,
// and the other identity gets its own case.
//
// -----------------------------------------------------------------------------
// THE REGISTRY IN THIS SUITE IS `P7-d`'s ACTUAL SEED
// -----------------------------------------------------------------------------
// `INV-M7-10`'s strip list is computed from `detector_definitions.is_sensitive`
// and `P7-d`'s seed IS that table's contents. A suite that hand-wrote a registry
// would assert the function against a fixture nobody deploys, and the drift it
// exists to prevent would live in this file instead. So the eighteen rows are
// READ off disk and the expected parameter names are DERIVED from them.
//
// -----------------------------------------------------------------------------
// THE COLUMN IS UNIFORMLY `true` TODAY, WHICH IS WHY THE MECHANISM NEEDS ITS OWN
// FIXTURE
// -----------------------------------------------------------------------------
// `P7-d`'s session recorded it: while every row is sensitive, a pack that
// COMPUTES the strip list and a pack that strips every detector UNCONDITIONALLY
// produce byte-identical output, so `GS-112` passes either way and `INV-M7-10`'s
// mechanism is untested. The distinguishing row cannot come from the seed,
// because there is no `M07` line to cite for an `is_sensitive: false`. It comes
// from a REGISTRY FIXTURE in section 3 below, where flipping one row's column
// changes the answer -- which is a property of the function and not of the seed.
// =============================================================================

const HERE = import.meta.dirname;
const SEED = join(
  HERE,
  '..',
  '..',
  '..',
  'packages',
  'db',
  'src',
  'seed',
  'detectors',
  'm07-detectors-v1.rows.json',
);

interface SeedFile {
  readonly rows: readonly DetectorRegistryRow[];
}

/** `P7-d`'s committed rows, read rather than restated. */
const SEEDED: readonly DetectorRegistryRow[] = (
  JSON.parse(readFileSync(SEED, 'utf8')) as SeedFile
).rows.map((row) => ({
  detector: row.detector,
  version: row.version,
  parameters: row.parameters,
  is_sensitive: row.is_sensitive,
}));

/** Every top-level parameter name in the seed, `_meta` excluded, DERIVED. */
function seededParameterNames(): readonly string[] {
  const names = new Set<string>();
  for (const row of SEEDED)
    for (const name of Object.keys(row.parameters as Record<string, unknown>))
      if (name !== '_meta') names.add(name);
  return [...names].sort();
}

// -----------------------------------------------------------------------------
// The subject
// -----------------------------------------------------------------------------

const SUBJECT_ACCOUNT = '11111111-1111-4111-8111-111111111111';
const SUBJECT_IDENTITY = '22222222-2222-4222-8222-222222222222';
/** The other side of `D-01`'s clustering. `GS-112`'s "other identity". */
const COUNTERPARTY_IDENTITY = '33333333-3333-4333-8333-333333333333';
const COUNTERPARTY_ACCOUNT = '44444444-4444-4444-8444-444444444444';
const FLAG_ID = '55555555-5555-4555-8555-555555555555';

const ACTOR: AdminPrincipal = { actorId: 'ops:jordan', role: 'support' };

/**
 * A flag whose `evidence` bag is exactly what `AS-M6-01` is written about.
 *
 * THE THREE NUMBERS ARE THE NUMBERS BEHIND THE ACCUSATION: the window that
 * tripped fill clustering, the correlation floor, the fill-share threshold. Each
 * arrives under the NAME `P7-d`'s seed gives it, which is what makes them
 * reachable by a strip list computed from that seed.
 */
const FLAG: EvidenceFlagRecord = {
  flag_id: FLAG_ID,
  identity_id: SUBJECT_IDENTITY,
  account_id: SUBJECT_ACCOUNT,
  flag_type: 'copy_cluster',
  severity: 3,
  status: 'open',
  first_detected_on: '2026-08-20',
  detector: 'D-01',
  detector_version: 'v1',
  evidence: {
    window_seconds: 2,
    correlation_floor_bp: -8000,
    min_shared_fill_share_bp: 4200,
    counterparty_identity_id: COUNTERPARTY_IDENTITY,
    counterparty_account_id: COUNTERPARTY_ACCOUNT,
    shared_fills: 41,
  },
  tos_clause: 'ToS 9.3: accounts under common control may not trade in coordination',
};

function subjectOf(overrides: Partial<EvidenceSubject> = {}): EvidenceSubject {
  return {
    account_id: SUBJECT_ACCOUNT,
    identity_id: SUBJECT_IDENTITY,
    account: { id: SUBJECT_ACCOUNT, identity_id: SUBJECT_IDENTITY, phase: 'funded' },
    identity: { id: SUBJECT_IDENTITY, status: 'active' },
    fills: [
      {
        id: 901,
        account_id: SUBJECT_ACCOUNT,
        symbol: 'ESZ6',
        side: 'buy',
        quantity: 2,
        price_numerator: 445025,
        price_denominator: 100,
        trading_day: '2026-08-20',
      },
      {
        id: 902,
        account_id: SUBJECT_ACCOUNT,
        symbol: 'ESZ6',
        side: 'sell',
        quantity: 2,
        price_numerator: 445075,
        price_denominator: 100,
        trading_day: '2026-08-20',
      },
    ],
    marks: [
      {
        account_id: SUBJECT_ACCOUNT,
        trading_day: '2026-08-20',
        balance_cents: 5012500,
        equity_low_cents: 4998000,
      },
    ],
    rule_states: [
      {
        account_id: SUBJECT_ACCOUNT,
        trading_day: '2026-08-20',
        phase: 'funded',
        floor_cents: 4800000,
        floor_open_cents: 4800000,
        balance_cents: 5012500,
        withdrawable_cents: 212500,
        engine_eligible: true,
        // SD-06. THE GATE RESULTS, and they are two columns on this row rather
        // than a table: `0015_rule_states.sql` split them because freeze, recon,
        // KYC and in-flight were true on the day and may not be true now.
        engine_gates: { profit_target: true, drawdown: true, min_days: true },
        context_gates: { freeze: false, recon_blocked: false, kyc: true },
      },
    ],
    plan_version: {
      id: '66666666-6666-4666-8666-666666666666',
      version: 7,
      rule_text: 'Trailing drawdown of 2,000 dollars from the high-water balance.',
    },
    flags: [FLAG],
    ...overrides,
  };
}

function documentFor(
  audience: EvidencePackAudience,
  subject: EvidenceSubject = subjectOf(),
  registry: readonly DetectorRegistryRow[] = SEEDED,
): EvidenceDocument {
  return buildEvidenceDocument({
    subject,
    registry,
    audience,
    reason: 'dispute 4471',
    actor: ACTOR,
  });
}

/** The whole document as one string, for a "does this appear anywhere" question. */
function flatten(document: EvidenceDocument): string {
  return canonicalJson(document);
}

// =============================================================================
// 1. The profile vocabulary. ADR-179: A CLOSED SET OF TWO
// =============================================================================

/** `evidence.ts` as text, for the two properties a TYPE has no runtime shape for. */
const EVIDENCE_TS = readFileSync(join(HERE, '..', 'src', 'admin-source', 'evidence.ts'), 'utf8');

/** The members of `EvidenceRedactionProfile`, read off its declaration. */
function declaredProfiles(): string[] {
  const declared = /export type EvidenceRedactionProfile =([^;]+);/.exec(EVIDENCE_TS)?.[1] ?? '';
  return [...declared.matchAll(/'([a-z-]+)'/g)].map((m) => m[1] as string).sort();
}

describe('SD-M6-04: the profile follows from the audience', () => {
  test('all four audiences have a profile and three of them share one', () => {
    // M06 section 4 and EC-071: `internal`, `counsel` and `regulator` carry full
    // detail. THE MAPPING IS A TRANSCRIPTION AND THE VOCABULARY IS A RULING, and
    // ADR-179 clause 2 keeps them separate: a later entry that gives `regulator`
    // its own profile changes THIS case, and the vocabulary case below is the
    // one that then says a third name is a decision rather than a consequence.
    expect(Object.keys(EVIDENCE_REDACTION_PROFILES).sort()).toEqual(
      [...EVIDENCE_PACK_AUDIENCES].sort(),
    );
    expect(redactionProfileFor('trader')).toBe('trader-facts-only');
    expect(redactionProfileFor('internal')).toBe('full-detail');
    expect(redactionProfileFor('counsel')).toBe('full-detail');
    expect(redactionProfileFor('regulator')).toBe('full-detail');
  });

  test('includes_detector_detail is false for trader and true for the other three', () => {
    // `evidence_packs_trader_gets_no_detector_detail` makes
    // `audience = 'trader' AND includes_detector_detail = true` unrepresentable.
    // This function has no argument that produces it.
    expect(includesDetectorDetail('trader')).toBe(false);
    for (const audience of EVIDENCE_PACK_AUDIENCES)
      if (audience !== 'trader') expect(includesDetectorDetail(audience)).toBe(true);
  });
});

describe('ADR-179: the redaction vocabulary is CLOSED at two members', () => {
  test('the union is still exactly two, so a third profile is a diff on this case', () => {
    // `packages/db/test/scoped-db.test.ts`'s shape for `SystemReason`, for the
    // same reason: a session that widens a closed vocabulary should find a case
    // that says why it is closed rather than a paragraph nobody reads. The stake
    // is AS-M6-01, which is permanent damage on a single occurrence, and a
    // profile name that nothing refuses is a redaction that nothing performs.
    expect(declaredProfiles()).toEqual(['full-detail', 'trader-facts-only']);
  });

  test('the vocabulary is DECLARED, and the map is annotated BY it rather than by `string`', () => {
    // ADR-179 clause 2, and it is the one property in this file with no runtime
    // shape at all. While the type read
    // `(typeof EVIDENCE_REDACTION_PROFILES)[keyof typeof EVIDENCE_REDACTION_PROFILES]`
    // the vocabulary was a SHADOW OF THE MAP, so `regulator: 'regulator-detail'`
    // type-checked GREEN; it is now TS2322 twice, naming the type at the map and
    // at `redactionProfileFor`'s return. BOTH HALVES ARE ASSERTED because either
    // one alone leaves the hole open: a declared union that nothing is annotated
    // by constrains nothing, and an annotated map whose type is derived from it
    // is annotated by itself.
    expect(EVIDENCE_TS).not.toMatch(/type EvidenceRedactionProfile =\s*\(typeof/);
    expect(EVIDENCE_TS).toContain(
      'satisfies Readonly<Record<EvidencePackAudience, EvidenceRedactionProfile>>',
    );
  });

  test('the declared members and the produced members are the SAME SET, both directions', () => {
    // NO PARALLEL ARRAY OF THE NAMES IS DECLARED ANYWHERE, on ADR-092's
    // `DDL_NAMES` landmine: a `readonly EvidenceRedactionProfile[]` beside the
    // union catches a member the union does not have and NEVER a union member
    // the array is missing, which is how `DDL_NAMES` went one short of
    // `SQL_NAME` with the suite green. So totality is asserted here, between the
    // declaration and its one consumer, in both directions at once.
    //
    // A DECLARED MEMBER NO AUDIENCE PRODUCES IS THE SAME DEFECT SEEN FROM THE
    // OTHER SIDE: a name a row may legally carry and that no code in this tree
    // performs.
    expect([...new Set(Object.values(EVIDENCE_REDACTION_PROFILES))].sort()).toEqual(
      declaredProfiles(),
    );
  });
});

// =============================================================================
// 1b. ADR-179 clause 3: WHAT EACH MEMBER PROMISES, asserted as a WHOLE
// =============================================================================
//
// THE POSITIVES AND NEGATIVES BELOW ARE ASSERTED ONE AT A TIME AND THAT LEAVES A
// HOLE THIS SECTION CLOSES. Sections 2 and 4 assert that named fields are present
// and that named fields are absent; neither asserts that the carried set is
// EXACTLY the promise. Adding `'detector'` to `TRADER_FLAG_FIELDS` ships the name
// of the detector that found the flag -- internal tier always, per ADR-022 -- and
// it was seeded against the 155 cases that existed before this section and CAUGHT
// BY NOTHING. A promise is a set, so it is asserted as a set.

describe('ADR-179 clause 3: `trader-facts-only` carries exactly what it promises', () => {
  const document = documentFor('trader');

  test('the flag carries the FIVE promised fields and no sixth', () => {
    // M06 section 4: "the fact that a flag exists with its type and its ToS
    // clause". A sixth field is a widening of the promise whatever it is, and
    // the four absent ones are absent for four different reasons: `evidence` is
    // the bag AS-M6-01 is written about, `severity` is the queue ordering, and
    // `detector` and `detector_version` name the machinery.
    expect(Object.keys(document.flags[0] ?? {}).sort()).toEqual([
      'first_detected_on',
      'flag_id',
      'flag_type',
      'status',
      'tos_clause',
    ]);
  });

  test('the document carries the promised sections and no others', () => {
    // A section added to a trader pack is a channel nobody argued for, and a
    // section dropped is GS-112's positive half lost. Both are this one case.
    expect(Object.keys(document).sort()).toEqual([
      'account',
      'fills',
      'flags',
      'identity',
      'marks',
      'pack',
      'plan_version',
      'rule_states',
    ]);
  });

  test('no comparison against a population, which is the FOURTH negative', () => {
    // GS-112's own line names three negatives. M06 section 4, EC-071 and the
    // wave 3 batch 1 gate closure each name a fourth: "no comparison against a
    // population", the closure putting "population comparisons" at internal and
    // counsel tier with the thresholds. The promise is the UNION of the three
    // statements, so the fourth negative is asserted under its own name.
    //
    // IT IS CARRIED BY THE ALLOWLIST AND NOT BY THE SWEEP: a population
    // comparison is a NAME nobody registered, so no strip list reaches it. What
    // keeps it out is that it can only arrive in the `evidence` bag or a
    // `detectors` section, and the trader projection admits neither.
    const compared = documentFor(
      'trader',
      subjectOf({
        flags: [
          {
            ...FLAG,
            evidence: { percentile_rank_bp: 9900, cohort_accounts: 4000, cohort_median_bp: 120 },
          },
        ],
      }),
    );
    const bytes = flatten(compared);
    expect(bytes).not.toContain('percentile_rank_bp');
    expect(bytes).not.toContain('cohort_accounts');
    expect(bytes).not.toContain('cohort_median_bp');
    expect(compared.flags[0]).not.toHaveProperty('evidence');
  });

  test('the pack row records the profile and the derived boolean together', () => {
    expect(document.pack.redaction_profile).toBe('trader-facts-only');
    expect(document.pack.includes_detector_detail).toBe(false);
  });
});

describe('ADR-179 clause 3: `full-detail` strips nothing and bounds DETAIL, not SCOPE', () => {
  const document = documentFor('internal');

  test('the flag carries the WHOLE record, derived from the record rather than restated', () => {
    // `FULL_FLAG_FIELDS` is the trader allowlist plus the six it withholds, and
    // the promise is "everything". So the expectation is the fixture record's
    // own key set: a field added to `EvidenceFlagRecord` and forgotten in the
    // full projection fails here rather than shipping a pack that quietly
    // withholds something from the audience promised everything.
    expect(Object.keys(document.flags[0] ?? {}).sort()).toEqual(Object.keys(FLAG).sort());
  });

  test('the document carries the promised sections plus the detector registry', () => {
    expect(Object.keys(document).sort()).toEqual([
      'account',
      'detectors',
      'fills',
      'flags',
      'identity',
      'marks',
      'pack',
      'plan_version',
      'rule_states',
    ]);
  });

  test('it is ONE account, which is the half the name does not say', () => {
    // `full-detail` bounds the detail and never the scope. Every row in the
    // document is the requested account's, and `exportEvidence` refuses a read
    // port that answers with a different one (section 8's case). Asserted here
    // because a reader of the NAME is likeliest to get this wrong.
    expect(document.pack.account_id).toBe(SUBJECT_ACCOUNT);
    expect(document.account['id']).toBe(SUBJECT_ACCOUNT);
    for (const fill of document.fills) expect(fill['account_id']).toBe(SUBJECT_ACCOUNT);
    for (const state of document.rule_states) expect(state['account_id']).toBe(SUBJECT_ACCOUNT);
  });
});

// =============================================================================
// 2. GS-112, THE POSITIVES: a trader pack carries the account's own facts whole
// =============================================================================

describe('GS-112 positives: everything about their account and every rule applied to it', () => {
  const document = documentFor('trader');

  test('every fill', () => {
    expect(document.fills).toEqual(subjectOf().fills);
    expect(document.fills).toHaveLength(2);
  });

  test('every mark', () => {
    expect(document.marks).toEqual(subjectOf().marks);
  });

  test('every rule state', () => {
    expect(document.rule_states).toEqual(subjectOf().rule_states);
  });

  test('every gate result, which is engine_gates and context_gates and not a table', () => {
    const state = document.rule_states[0];
    expect(state).toBeDefined();
    expect(state?.['engine_gates']).toEqual({
      profit_target: true,
      drawdown: true,
      min_days: true,
    });
    expect(state?.['context_gates']).toEqual({ freeze: false, recon_blocked: false, kyc: true });
  });

  test("the plan's rule text", () => {
    expect(document.plan_version['rule_text']).toBe(
      'Trailing drawdown of 2,000 dollars from the high-water balance.',
    );
  });

  test('the FACT of a flag: its id, its type, its status and the day it was raised', () => {
    expect(document.flags).toHaveLength(1);
    expect(document.flags[0]?.['flag_id']).toBe(FLAG_ID);
    expect(document.flags[0]?.['flag_type']).toBe('copy_cluster');
    expect(document.flags[0]?.['status']).toBe('open');
    expect(document.flags[0]?.['first_detected_on']).toBe('2026-08-20');
  });

  test('the ToS clause of the flag, verbatim', () => {
    expect(document.flags[0]?.['tos_clause']).toBe(FLAG.tos_clause);
  });

  test('a flag with no enforcement carries a NULL clause and never an invented one', () => {
    // `risk_flags` has no clause column. The clause lives on the enforcement that
    // cites the flag (`payout_requests.hold_tos_clause`,
    // `identity_restriction_episodes`), and DEP-M7-05 still owes two of the three
    // texts, so an `open` flag nobody has acted on has none.
    const unenforced = documentFor('trader', subjectOf({ flags: [{ ...FLAG, tos_clause: null }] }));
    expect(unenforced.flags[0]).toHaveProperty('tos_clause', null);
  });
});

// =============================================================================
// 3. INV-M7-10: THE STRIP LIST IS COMPUTED, AND HERE IS THE PROOF IT IS
// =============================================================================

describe('INV-M7-10: the strip list is a query over detector_definitions.is_sensitive', () => {
  test("it equals P7-d's seed exactly, derived from the file rather than restated", () => {
    expect([...sensitiveParameterNames(SEEDED)].sort()).toEqual(seededParameterNames());
  });

  test('every seeded row is sensitive today, so this suite pins that and it goes red on the first false', () => {
    // P7-d: "is_sensitive IS UNIFORMLY true, AND THAT IS A FINDING FOR P7-j
    // RATHER THAN A RESULT." The day a row acquires `false`, this case fails and
    // sends the reader to the mechanism cases below rather than letting the
    // seed's uniformity quietly become the test's assumption.
    expect(SEEDED.filter((row) => !row.is_sensitive)).toEqual([]);
    expect(SEEDED).toHaveLength(18);
  });

  // ---------------------------------------------------------------------------
  // THE MECHANISM, ON A REGISTRY THE SEED CANNOT SUPPLY
  // ---------------------------------------------------------------------------
  const MIXED: readonly DetectorRegistryRow[] = [
    {
      detector: 'X-01',
      version: 'v1',
      parameters: { _meta: { name: 'sensitive one' }, window_seconds: 2, severity: 3 },
      is_sensitive: true,
    },
    {
      detector: 'X-02',
      version: 'v1',
      // `severity` is SHARED with X-01 and `public_knob` is this row's alone.
      parameters: { severity: 4, public_knob: 9 },
      is_sensitive: false,
    },
  ];

  test('a row marked not sensitive releases the names only IT claims', () => {
    const strip = sensitiveParameterNames(MIXED);
    expect(strip.has('window_seconds')).toBe(true);
    expect(strip.has('public_knob')).toBe(false);
  });

  test('a name a still-sensitive row shares is NOT released, because the list is a union', () => {
    // The reading that costs the most is "per detector". `severity` and
    // `window_trading_days` are parameters of several detectors at once, so a
    // per-detector strip would ship a threshold another detector still guards.
    expect(sensitiveParameterNames(MIXED).has('severity')).toBe(true);
  });

  test('the computed list DIFFERS from stripping every detector unconditionally', () => {
    // This is the case P7-d said could not be written against the seed. An
    // unconditional strip is the union over ALL rows; the computed one is the
    // union over SENSITIVE rows, and on this registry they are different sets.
    const unconditional = new Set(
      MIXED.flatMap((row) => Object.keys(row.parameters as Record<string, unknown>)).filter(
        (name) => name !== '_meta',
      ),
    );
    const computed = sensitiveParameterNames(MIXED);
    expect([...unconditional].sort()).not.toEqual([...computed].sort());
    expect(unconditional.has('public_knob')).toBe(true);
    expect(computed.has('public_knob')).toBe(false);
  });

  test('the `_meta` bookkeeping block is not a parameter and its prose keys are not stripped', () => {
    // `_meta` holds `name`, `input`, `quote` and `is_sensitive_reason`. Sweeping
    // those would strip ordinary trader facts and read as a redaction working.
    const strip = sensitiveParameterNames(SEEDED);
    for (const key of ['_meta', 'name', 'quote', 'cite', 'is_sensitive_reason'])
      expect(strip.has(key)).toBe(false);
  });

  test('a nineteenth detector added to the registry is covered with no edit to this file', () => {
    const extended = [
      ...SEEDED,
      {
        detector: 'D-19',
        version: 'v1',
        parameters: { brand_new_threshold_bp: 1500 },
        is_sensitive: true,
      },
    ];
    expect(sensitiveParameterNames(extended).has('brand_new_threshold_bp')).toBe(true);
  });
});

// =============================================================================
// 4. GS-112, THE NEGATIVES, ONE AT A TIME
// =============================================================================

describe('GS-112 negatives: no detector parameter', () => {
  const document = documentFor('trader');
  const flags = canonicalJson(document.flags);

  // ONE CASE PER SEEDED PARAMETER NAME. Seventy-odd cases rather than one, on
  // purpose: a single loop inside one case reports "the pack leaked" and this
  // reports WHICH name leaked, which is the first thing an incident asks.
  for (const name of seededParameterNames())
    test(`the flags section carries no key named \`${name}\``, () => {
      expect(flags).not.toContain(`"${name}"`);
    });

  test('the three parameter-named keys the fixture flag carried are all gone', () => {
    expect(document.flags[0]).not.toHaveProperty('window_seconds');
    expect(document.flags[0]).not.toHaveProperty('correlation_floor_bp');
    expect(document.flags[0]).not.toHaveProperty('min_shared_fill_share_bp');
  });

  test('the evidence bag itself does not cross, which is the projection and not the sweep', () => {
    // Two independent controls. The allowlist means the bag never arrives; the
    // sweep means a name that arrived some other way still does not leave.
    expect(document.flags[0]).not.toHaveProperty('evidence');
  });

  test('there is no detectors section at all, absent rather than empty', () => {
    expect(document.detectors).toBeUndefined();
    expect(Object.keys(document)).not.toContain('detectors');
  });

  test('the pack records includes_detector_detail false', () => {
    expect(document.pack.includes_detector_detail).toBe(false);
    expect(document.pack.redaction_profile).toBe('trader-facts-only');
  });
});

describe('GS-112 negatives: no threshold', () => {
  const document = documentFor('trader');

  // A BARE `2` IS NOT A THRESHOLD BY ITS VALUE, IT IS A THRESHOLD BY THE NAME IT
  // ARRIVES UNDER. `quantity: 2` is a trader fact and `window_seconds: 2` is a
  // detector internal, and no value-based filter can tell them apart. That is
  // why the strip list is NAMES, and why the values asserted here are the
  // distinctive ones the fixture carried.
  test('the correlation floor does not appear anywhere in the pack', () => {
    expect(flatten(document)).not.toContain('-8000');
  });

  test('the fill-share threshold does not appear anywhere in the pack', () => {
    expect(flatten(document)).not.toContain('4200');
  });

  test('the trader facts that happen to be small integers DO survive', () => {
    expect(document.fills[0]?.['quantity']).toBe(2);
    expect(document.marks[0]?.['balance_cents']).toBe(5012500);
  });
});

describe('GS-112 negatives: no other identity', () => {
  const subject = subjectOf();
  const document = documentFor('trader', subject);

  test('the counterparty identity is derived as foreign from the input', () => {
    const foreign = foreignIdentifiers(subject);
    expect(foreign.has(COUNTERPARTY_IDENTITY)).toBe(true);
    expect(foreign.has(COUNTERPARTY_ACCOUNT)).toBe(true);
  });

  test("the subject's own account and identity are NOT foreign", () => {
    const foreign = foreignIdentifiers(subject);
    expect(foreign.has(SUBJECT_ACCOUNT)).toBe(false);
    expect(foreign.has(SUBJECT_IDENTITY)).toBe(false);
  });

  test('the counterparty identity does not appear in the pack', () => {
    expect(flatten(document)).not.toContain(COUNTERPARTY_IDENTITY);
  });

  test('the counterparty account does not appear in the pack', () => {
    expect(flatten(document)).not.toContain(COUNTERPARTY_ACCOUNT);
  });

  test('an identity EMBEDDED IN FREE TEXT is found, and an anchored test would not see it', () => {
    // The defect this suite found: a `^...$` match reads a clause that CONTAINS
    // a uuid as an ordinary sentence. Every free-text column a pack carries has
    // this shape, and `tos_clause` is one GS-112 requires the pack to carry.
    const seen = new Set<string>();
    const clause = `ToS 9.3, coordinated with account ${COUNTERPARTY_ACCOUNT}`;
    expect(clause).not.toBe(COUNTERPARTY_ACCOUNT);
    const inText = foreignIdentifiers(
      subjectOf({ flags: [{ ...FLAG, evidence: { note: clause } }] }),
    );
    expect(inText.has(COUNTERPARTY_ACCOUNT)).toBe(true);
    expect(seen.size).toBe(0);
  });

  test('a clause naming no other identity survives into the trader pack unchanged', () => {
    const plain = documentFor(
      'trader',
      subjectOf({ flags: [{ ...FLAG, tos_clause: 'ToS 9.3: coordination is prohibited' }] }),
    );
    expect(plain.flags[0]?.['tos_clause']).toBe('ToS 9.3: coordination is prohibited');
  });

  test("the subject's own identity DOES appear, because the pack is about them", () => {
    expect(flatten(document)).toContain(SUBJECT_IDENTITY);
    expect(flatten(document)).toContain(SUBJECT_ACCOUNT);
  });
});

// =============================================================================
// 5. An internal pack contains everything
// =============================================================================

describe('GS-112: an internal pack contains everything', () => {
  for (const audience of ['internal', 'counsel', 'regulator'] as const)
    describe(audience, () => {
      const document = documentFor(audience);

      test('the flag carries its evidence bag, its severity and the detector that found it', () => {
        expect(document.flags[0]?.['evidence']).toEqual(FLAG.evidence);
        expect(document.flags[0]?.['severity']).toBe(3);
        expect(document.flags[0]?.['detector']).toBe('D-01');
        expect(document.flags[0]?.['detector_version']).toBe('v1');
      });

      test('the detector registry is carried in full, parameters included', () => {
        expect(document.detectors).toHaveLength(SEEDED.length);
        expect(document.detectors?.[0]?.['parameters']).toEqual(SEEDED[0]?.parameters);
      });

      test('the pack records includes_detector_detail true and the full-detail profile', () => {
        expect(document.pack.includes_detector_detail).toBe(true);
        expect(document.pack.redaction_profile).toBe('full-detail');
      });

      test('the counterparty identity IS carried, because this audience may see it', () => {
        expect(flatten(document)).toContain(COUNTERPARTY_IDENTITY);
      });
    });
});

// =============================================================================
// 6. THE REFUSAL THAT RUNS LAST, and every seeded defect it must catch
// =============================================================================

describe('assertTraderPackIsClean refuses rather than repairs', () => {
  const clean = documentFor('trader');
  const foreign = foreignIdentifiers(subjectOf());

  test('a correctly built trader pack passes', () => {
    expect(() => {
      assertTraderPackIsClean(clean, SEEDED, foreign);
    }).not.toThrow();
  });

  test('SEEDED DEFECT: a trader pack carrying a sensitive detector parameter is refused', () => {
    const leaked: EvidenceDocument = {
      ...clean,
      flags: [{ ...clean.flags[0], correlation_floor_bp: -8000 }],
    };
    expect(() => {
      assertTraderPackIsClean(leaked, SEEDED, foreign);
    }).toThrow(EvidenceRedactionError);
    expect(() => {
      assertTraderPackIsClean(leaked, SEEDED, foreign);
    }).toThrow(/correlation_floor_bp/);
  });

  test('SEEDED DEFECT: the leak is refused even when it is nested inside another key', () => {
    const leaked: EvidenceDocument = {
      ...clean,
      flags: [{ ...clean.flags[0], summary: { window_seconds: 2 } }],
    };
    expect(() => {
      assertTraderPackIsClean(leaked, SEEDED, foreign);
    }).toThrow(/window_seconds/);
  });

  test('SEEDED DEFECT: a trader pack with includes_detector_detail true is refused', () => {
    const wrong: EvidenceDocument = {
      ...clean,
      pack: { ...clean.pack, includes_detector_detail: true },
    };
    expect(() => {
      assertTraderPackIsClean(wrong, SEEDED, foreign);
    }).toThrow(/unrepresentable/);
  });

  test('SEEDED DEFECT: a trader pack carrying a detectors section is refused', () => {
    const wrong: EvidenceDocument = { ...clean, detectors: [{ detector: 'D-01' }] };
    expect(() => {
      assertTraderPackIsClean(wrong, SEEDED, foreign);
    }).toThrow(/detectors. section/);
  });

  test('SEEDED DEFECT: a trader pack naming another identity is refused', () => {
    const wrong: EvidenceDocument = {
      ...clean,
      account: { ...clean.account, linked_to: COUNTERPARTY_IDENTITY },
    };
    expect(() => {
      assertTraderPackIsClean(wrong, SEEDED, foreign);
    }).toThrow(/no other identity/);
  });

  test('THE HAND-LISTED STRIP LIST IS WHAT THIS CATCHES: a stale registry misses the new name', () => {
    // A session that added `D-19` to `detector_definitions` and hand-maintained
    // a list here would leak `brand_new_threshold_bp`. Driven with the LIVE
    // registry the refusal fires; driven with the stale one it does not, and the
    // difference is the whole of INV-M7-10.
    const live: readonly DetectorRegistryRow[] = [
      ...SEEDED,
      {
        detector: 'D-19',
        version: 'v1',
        parameters: { brand_new_threshold_bp: 1500 },
        is_sensitive: true,
      },
    ];
    const leaked: EvidenceDocument = {
      ...clean,
      flags: [{ ...clean.flags[0], brand_new_threshold_bp: 1500 }],
    };
    expect(() => {
      assertTraderPackIsClean(leaked, SEEDED, foreign);
    }).not.toThrow();
    expect(() => {
      assertTraderPackIsClean(leaked, live, foreign);
    }).toThrow(/brand_new_threshold_bp/);
  });

  test('a full-detail pack is not swept, because that audience may have the parameters', () => {
    const internal = documentFor('internal');
    expect(() => {
      assertTraderPackIsClean(internal, SEEDED, foreign);
    }).not.toThrow();
  });
});

// =============================================================================
// 7. Money is integer cents, in the document too
// =============================================================================

describe('assertIntegerAmounts', () => {
  test('the seeded fixture passes', () => {
    expect(() => {
      assertIntegerAmounts(documentFor('trader'));
    }).not.toThrow();
  });

  test('SEEDED DEFECT: a float anywhere in the document is refused, and the path is named', () => {
    expect(() => {
      assertIntegerAmounts({ marks: [{ balance_cents: 5012500.5 }] });
    }).toThrow(EvidenceExportError);
    expect(() => {
      assertIntegerAmounts({ marks: [{ balance_cents: 5012500.5 }] });
    }).toThrow(/\$\.marks\[0\]\.balance_cents/);
  });
});

// =============================================================================
// 8. The digest is over the bytes and not over key order
// =============================================================================

describe('renderEvidencePack', () => {
  test('the hex digest is a SHA-256, which is what admin-reads.ts refuses without', () => {
    const rendered = renderEvidencePack(documentFor('trader'));
    expect(rendered.contentSha256Hex).toMatch(/^[0-9a-f]{64}$/);
  });

  test('the bytea and the hex are the SAME digest', () => {
    const rendered = renderEvidencePack(documentFor('trader'));
    expect(Buffer.from(rendered.contentSha256Bytes).toString('hex')).toBe(
      rendered.contentSha256Hex,
    );
    expect(rendered.contentSha256Bytes).toHaveLength(32);
  });

  test('key order does not move the digest, at every depth', () => {
    // `admin-writes.ts`'s reasoning one table over: a digest over
    // `JSON.stringify` of an unsorted object is a digest over KEY ORDER, and a
    // pack that failed to match itself after a round trip through a client that
    // reordered it is a pack nobody can authenticate.
    expect(canonicalJson({ alpha: 1, beta: [{ x: 1, y: 2 }] })).toBe(
      canonicalJson({ beta: [{ y: 2, x: 1 }], alpha: 1 }),
    );
  });

  test('rendering the same document twice gives the same digest', () => {
    expect(renderEvidencePack(documentFor('trader')).contentSha256Hex).toBe(
      renderEvidencePack(documentFor('trader')).contentSha256Hex,
    );
  });

  test('ARRAY order DOES move the digest, because a pack is an ordered record', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  test('a changed VALUE does move the digest', () => {
    const a = renderEvidencePack(documentFor('trader'));
    const b = renderEvidencePack(
      documentFor('trader', subjectOf({ plan_version: { rule_text: 'different' } })),
    );
    expect(b.contentSha256Hex).not.toBe(a.contentSha256Hex);
  });

  test('a trader pack and an internal pack of the same account have different digests', () => {
    // The digest is what makes an exported pack the pack that was exported, so
    // two audiences over one account must never share one.
    expect(renderEvidencePack(documentFor('trader')).contentSha256Hex).not.toBe(
      renderEvidencePack(documentFor('internal')).contentSha256Hex,
    );
  });
});

// =============================================================================
// 9. The generator end to end
// =============================================================================

interface Recorder {
  readonly deps: EvidenceExporterDeps;
  readonly written: EvidencePackRow[];
  readonly stored: Uint8Array[];
  readonly order: string[];
}

function recorderOf(
  overrides: {
    readonly subject?: EvidenceSubject | null;
    readonly registry?: readonly DetectorRegistryRow[];
  } = {},
): Recorder {
  const written: EvidencePackRow[] = [];
  const stored: Uint8Array[] = [];
  const order: string[] = [];
  const subject = overrides.subject === undefined ? subjectOf() : overrides.subject;
  return {
    written,
    stored,
    order,
    deps: {
      reads: {
        readSubject: (): Promise<EvidenceSubject | null> => {
          order.push('read');
          return Promise.resolve(subject);
        },
        readDetectorRegistry: (): Promise<readonly DetectorRegistryRow[]> => {
          order.push('registry');
          return Promise.resolve(overrides.registry ?? SEEDED);
        },
      },
      store: {
        put: (input: { readonly bytes: Uint8Array }) => {
          order.push('store');
          stored.push(input.bytes);
          return Promise.resolve({
            storage_ref: 's3://merit-evidence/pack-1',
            download_url: 'https://storage.example.invalid/signed/pack-1',
            expires_at: '2026-08-29T00:00:00.000Z',
          });
        },
      },
      writer: {
        writePack: (row: EvidencePackRow) => {
          order.push('write');
          written.push(row);
          return Promise.resolve({
            evidence_pack_id: '77777777-7777-4777-8777-777777777777',
            generated_at: '2026-08-28T00:00:00.000Z',
          });
        },
      },
    },
  };
}

const REQUEST = {
  accountId: SUBJECT_ACCOUNT,
  reason: 'dispute 4471',
  audience: 'trader' as const,
  actor: ACTOR,
};

describe('createEvidenceExporter', () => {
  test('it writes an evidence_packs row with ALL THREE SD-M6-04 columns', async () => {
    const recorder = recorderOf();
    await createEvidenceExporter(recorder.deps).exportEvidence(REQUEST);
    const row = recorder.written[0];
    expect(row).toBeDefined();
    expect(row?.audience).toBe('trader');
    expect(row?.redaction_profile).toBe('trader-facts-only');
    expect(row?.includes_detector_detail).toBe(false);
  });

  test('the row carries the account, the actor, the reason, the digest and the storage ref', () => {
    // `evidence_packs` makes every one of these NOT NULL, and 0008's own header
    // says export is ITSELF AN AUDITED ACT: the row is the audit.
    const recorder = recorderOf();
    return createEvidenceExporter(recorder.deps)
      .exportEvidence(REQUEST)
      .then(() => {
        const row = recorder.written[0];
        expect(row?.account_id).toBe(SUBJECT_ACCOUNT);
        expect(row?.requested_by).toBe('ops:jordan');
        expect(row?.reason).toBe('dispute 4471');
        expect(row?.storage_ref).toBe('s3://merit-evidence/pack-1');
        expect(row?.content_sha256).toHaveLength(32);
      });
  });

  test('the response echoes the REQUESTED audience, which admin-reads.ts compares', async () => {
    const recorder = recorderOf();
    const pack = await createEvidenceExporter(recorder.deps).exportEvidence(REQUEST);
    expect(pack?.audience).toBe('trader');
    expect(pack?.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pack?.evidence_pack_id).toBe('77777777-7777-4777-8777-777777777777');
    expect(pack?.download_url).toBe('https://storage.example.invalid/signed/pack-1');
  });

  test('the row digest and the response digest are the same digest', async () => {
    const recorder = recorderOf();
    const pack = await createEvidenceExporter(recorder.deps).exportEvidence(REQUEST);
    expect(
      Buffer.from(recorder.written[0]?.content_sha256 ?? new Uint8Array()).toString('hex'),
    ).toBe(pack?.content_sha256);
  });

  test('the stored bytes are the bytes the digest was taken over', async () => {
    const recorder = recorderOf();
    const pack = await createEvidenceExporter(recorder.deps).exportEvidence(REQUEST);
    const bytes = recorder.stored[0];
    expect(bytes).toBeDefined();
    const document = JSON.parse(Buffer.from(bytes ?? new Uint8Array()).toString('utf8')) as {
      pack: { audience: string };
    };
    expect(document.pack.audience).toBe('trader');
    expect(pack?.content_sha256).toBe(renderEvidencePack(documentFor('trader')).contentSha256Hex);
  });

  test('the object is stored BEFORE the row is written', async () => {
    const recorder = recorderOf();
    await createEvidenceExporter(recorder.deps).exportEvidence(REQUEST);
    expect(recorder.order).toEqual(['read', 'registry', 'store', 'write']);
  });

  test('a missing account answers null, which the route turns into 404', async () => {
    const recorder = recorderOf({ subject: null });
    expect(await createEvidenceExporter(recorder.deps).exportEvidence(REQUEST)).toBeNull();
    expect(recorder.written).toEqual([]);
  });

  test('SEEDED DEFECT: a read port returning a different account is refused', async () => {
    const recorder = recorderOf({ subject: subjectOf({ account_id: COUNTERPARTY_ACCOUNT }) });
    await expect(createEvidenceExporter(recorder.deps).exportEvidence(REQUEST)).rejects.toThrow(
      EvidenceExportError,
    );
    expect(recorder.stored).toEqual([]);
  });

  test('SEEDED DEFECT: an empty registry is refused rather than treated as nothing to strip', async () => {
    const recorder = recorderOf({ registry: [] });
    await expect(createEvidenceExporter(recorder.deps).exportEvidence(REQUEST)).rejects.toThrow(
      /INV-M7-10/,
    );
    expect(recorder.stored).toEqual([]);
    expect(recorder.written).toEqual([]);
  });

  test('SEEDED DEFECT: an identity riding inside the ToS CLAUSE TEXT is refused end to end', async () => {
    // THE ONE LEAK PATH THE ALLOWLIST CANNOT CLOSE, AND IT IS THE REALISTIC ONE.
    // `tos_clause` is free text an operator writes during a dispute and the pack
    // carries it verbatim, so an investigator who pasted the counterparty's
    // account id into the clause has put another identity into a `trader` pack
    // through a field GS-112 REQUIRES the pack to carry. Control 3 is what sees
    // it, and nothing may be stored or written when it fires.
    const recorder = recorderOf({
      subject: subjectOf({
        flags: [
          {
            ...FLAG,
            tos_clause: `ToS 9.3, coordinated with account ${COUNTERPARTY_ACCOUNT}`,
          },
        ],
      }),
    });
    await expect(createEvidenceExporter(recorder.deps).exportEvidence(REQUEST)).rejects.toThrow(
      EvidenceRedactionError,
    );
    expect(recorder.stored).toEqual([]);
    expect(recorder.written).toEqual([]);
  });

  test('the same clause text at an INTERNAL audience exports normally', () => {
    // The refusal is about the audience and not about the string. Reported as
    // the shape this control has: it makes an operator fix the clause before a
    // trader pack exports, and it never stands between counsel and the record.
    const recorder = recorderOf({
      subject: subjectOf({
        flags: [
          {
            ...FLAG,
            tos_clause: `ToS 9.3, coordinated with account ${COUNTERPARTY_ACCOUNT}`,
          },
        ],
      }),
    });
    return createEvidenceExporter(recorder.deps)
      .exportEvidence({ ...REQUEST, audience: 'counsel' })
      .then((pack) => {
        expect(pack?.audience).toBe('counsel');
        expect(recorder.written).toHaveLength(1);
      });
  });

  test('an internal export writes includes_detector_detail true', async () => {
    const recorder = recorderOf();
    await createEvidenceExporter(recorder.deps).exportEvidence({
      ...REQUEST,
      audience: 'internal',
    });
    expect(recorder.written[0]?.includes_detector_detail).toBe(true);
    expect(recorder.written[0]?.redaction_profile).toBe('full-detail');
  });

  test('every audience produces a row whose profile and detail flag agree with the CHECK', async () => {
    for (const audience of EVIDENCE_PACK_AUDIENCES) {
      const recorder = recorderOf();
      await createEvidenceExporter(recorder.deps).exportEvidence({ ...REQUEST, audience });
      const row = recorder.written[0];
      // `evidence_packs_trader_gets_no_detector_detail`:
      //   audience <> 'trader' OR includes_detector_detail = false
      expect(row?.audience !== 'trader' || row.includes_detector_detail === false).toBe(true);
    }
  });
});

// =============================================================================
// 10. ADR-012: no admin host is named anywhere in this slice
// =============================================================================

test('neither the module nor this suite names a real admin domain', () => {
  const module = readFileSync(join(HERE, '..', 'src', 'admin-source', 'evidence.ts'), 'utf8');
  const suite = readFileSync(join(HERE, 'admin-source-evidence.test.ts'), 'utf8');
  // ADR-012. `ADMIN_ORIGIN` is a placeholder and the real domain is never
  // written into the corpus, the repository, or any artifact. The only hosts
  // this slice names are `.invalid`, which is reserved by RFC 2606.
  for (const source of [module, suite]) {
    const hosts = [...source.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1] ?? '');
    for (const host of hosts)
      expect(host.endsWith('.invalid') || host.endsWith('.example')).toBe(true);
  }
});

// =============================================================================
// 11. The composition, and the leg a keep-both merge would drop
// =============================================================================

describe('composeAdminReadSource', () => {
  test('the exportEvidence key reaches this slice, detached from its object', async () => {
    // The composition passes the METHOD and not the exporter, so a bound `this`
    // would break here rather than at the first real export.
    const recorder = recorderOf();
    const source = composeAdminReadSource(adminReadSourceParts({ evidence: recorder.deps }));
    const pack = await source.exportEvidence(REQUEST);
    expect(pack?.audience).toBe('trader');
    expect(recorder.written).toHaveLength(1);
  });

  test('a method no module supplies THROWS WITH ITS OWN NAME rather than being absent', () => {
    // P7 section 5.5 and section 9: a keep-both merge that drops a leg
    // type-checks. This is what makes the drop loud at the first request.
    const source = composeAdminReadSource({});
    expect(() =>
      source.listFlags({ flagType: null, status: null, severity: null, limit: 25, cursor: null }),
    ).toThrow(/listFlags/);
    expect(() => source.readLiability()).toThrow(AdminSourceNotComposed);
  });

  test('every one of the six methods is present on a composed source', () => {
    // The count is read off the port rather than typed, so a seventh method
    // added to `AdminReadSource` is a red test here rather than a silent gap.
    const source = composeAdminReadSource({});
    expect(Object.keys(source).sort()).toEqual([
      'exportEvidence',
      'listFlags',
      'readAccount',
      'readIdentityGraph',
      'readLiability',
      'searchAccounts',
    ]);
  });
});
