import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { TABLE_KEYS } from '@merit/db';
import type { SystemTx } from '@merit/db';
import { describe, expect, test } from 'vitest';

import type {
  DetectorRegistryRow,
  EvidenceDocument,
  EvidenceExporterDeps,
  EvidenceFlagRecord,
  EvidencePackRow,
  EvidenceReadTable,
  EvidenceSubject,
  EvidenceSubjectResult,
  EvidenceTx,
} from '../src/admin-source/evidence.ts';
import {
  EVIDENCE_COLUMNS,
  EVIDENCE_READ_TABLES,
  EVIDENCE_REDACTION_PROFILES,
  EvidenceExportError,
  EvidenceRedactionError,
  assertIntegerAmounts,
  assertTraderPackIsClean,
  buildEvidenceDocument,
  canonicalJson,
  createEvidenceExporter,
  evidenceReadPort,
  foreignIdentifiers,
  includesDetectorDetail,
  readEvidenceDetectorRegistry,
  readEvidenceSubject,
  redactionProfileFor,
  renderEvidencePack,
  sensitiveParameterNames,
} from '../src/admin-source/evidence.ts';
import {
  AdminSourceNotComposed,
  IMPLEMENTED_ADMIN_READS,
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

  test('every one of the seven methods is present on a composed source', () => {
    // The count is read off the port rather than typed, so a method added to
    // `AdminReadSource` is a red test here rather than a silent gap. IT WENT RED
    // FOR EXACTLY THAT REASON when ADR-184 ruling 1's `listEvents` landed, which
    // is the control working; the list follows the port and never leads it.
    const source = composeAdminReadSource({});
    expect(Object.keys(source).sort()).toEqual([
      'exportEvidence',
      'listEvents',
      'listFlags',
      'readAccount',
      'readIdentityGraph',
      'readLiability',
      'searchAccounts',
    ]);
  });
});

// =============================================================================
// 12. THE ADAPTER. `EvidenceReadPort` OVER ADR-112's KEYED ACCESSOR
// =============================================================================
// Everything above drives the GENERATOR through hand-written ports. This section
// drives the one port this directory may implement, over the accessor, and it
// asserts three separable things:
//
//   THE TABLES ARE REAL KEYS OF `packages/db`, which is the half the module
//   cannot assert about itself because it holds no import of that package. The
//   compile-time form of the same claim is the narrowing in section 12.1: a
//   `SystemTx` satisfies `EvidenceTx` only while every member of
//   `EVIDENCE_READ_TABLES` is a `TableKey`, which is the `TS2322` two sessions
//   were stopped by on `events`.
//
//   THE COLUMN MAPS MATCH THE SCHEMA IN BOTH DIRECTIONS, read out of
//   `packages/db/src/schema.ts` rather than restated here. A column the map has
//   and the table does not is a typo; a column the table has and the map does
//   not is a field somebody has to decide about, because `buildEvidenceDocument`
//   carries these six sections through WHOLE at every audience and a new column
//   would reach a trader the day it landed.
//
//   THE THREE VALUES `canonicalJson` CANNOT RENDER ARE DEMONSTRATED FAILING
//   BEFORE THEY ARE DEMONSTRATED FIXED. A `Date` is the one that matters: it does
//   not throw, it renders as `{}`, and `content_sha256` is the digest over
//   exactly those bytes. A suite that only asserted the projected row would pass
//   against a projection that had never been needed.
// =============================================================================

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Every `.ts` file under a directory tree, so a sweep cannot go quiet on a new one. */
function typescriptFilesUnder(root: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) out.push(...typescriptFilesUnder(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const SCHEMA_TS = read(join(HERE, '..', '..', '..', 'packages', 'db', 'src', 'schema.ts'));

/** One Drizzle table's columns, property name to column name, READ OFF THE SOURCE. */
function schemaColumns(exportName: string): ReadonlyMap<string, string> {
  const pattern = new RegExp(
    `export const ${exportName} = pgTable\\('[a-z_]+',\\s*\\{([\\s\\S]*?)\\n\\}\\);`,
  );
  const block = pattern.exec(SCHEMA_TS)?.[1] ?? '';
  const columns = new Map<string, string>();
  for (const match of block.matchAll(/^ {2}(\w+): \w+\(\s*'([a-z_0-9]+)'/gm))
    columns.set(match[1] ?? '', match[2] ?? '');
  return columns;
}

// -----------------------------------------------------------------------------
// 12.1 The tables
// -----------------------------------------------------------------------------

describe('the tables this module names', () => {
  test('are all keys packages/db registers', () => {
    // The half the module cannot make about itself. `@merit/db` is reachable
    // from this suite and nothing under `admin-source/` imports it, which
    // `admin-source-flags.test.ts` pins for the whole directory.
    for (const key of EVIDENCE_READ_TABLES) expect(TABLE_KEYS).toContain(key);
  });

  test('a SystemTx satisfies EvidenceTx structurally, which is the TS2322 check', () => {
    // THE COMPILE-TIME FORM OF THE CASE ABOVE, and the one sessions 349 and 353
    // were stopped by: `SystemTx.rows` is generic over `TableKey`, so this
    // assignment fails to compile the moment `EVIDENCE_READ_TABLES` names a
    // table `packages/db` does not register. A green `pnpm run typecheck` is
    // half of this suite's answer about these eleven names.
    const narrow = (tx: SystemTx): EvidenceTx => tx;
    expect(typeof narrow).toBe('function');
  });

  test('are the eleven the read actually touches, sorted, and no wider', () => {
    expect([...EVIDENCE_READ_TABLES]).toStrictEqual([...EVIDENCE_READ_TABLES].sort());
    expect([...EVIDENCE_READ_TABLES]).toStrictEqual([
      'accounts',
      'dailyMarks',
      'detectorDefinitions',
      'detectorRuns',
      'fills',
      'identities',
      'identityRestrictionEpisodes',
      'payoutRequests',
      'planVersions',
      'riskFlags',
      'ruleStates',
    ]);
  });

  test('every table whose ROWS reach a pack has a column map, and the other five do not', () => {
    // `detectorDefinitions` becomes `DetectorRegistryRow` and `riskFlags`
    // becomes `EvidenceFlagRecord`, both field by field. `detectorRuns`,
    // `payoutRequests` and `identityRestrictionEpisodes` contribute ONE STRING
    // each and no row, which is what keeps a payout's `eligibility_snapshot`
    // out of a document nobody asked to put it in.
    expect(Object.keys(EVIDENCE_COLUMNS).sort()).toStrictEqual([
      'accounts',
      'dailyMarks',
      'fills',
      'identities',
      'planVersions',
      'ruleStates',
    ]);
  });
});

// -----------------------------------------------------------------------------
// 12.2 The column maps, against schema.ts itself
// -----------------------------------------------------------------------------

describe('the column maps are the schema, transcribed and checked', () => {
  test('the reader finds a real table, so an empty map cannot pass every case below', () => {
    // A REGEX THAT MATCHED NOTHING WOULD MAKE EVERY CASE IN THIS BLOCK VACUOUS,
    // which is the shape `falsify.mjs`'s own warning is about: a table that went
    // from 36 rows to 0 while every gate stayed green.
    const accounts = schemaColumns('accounts');
    expect(accounts.size).toBeGreaterThan(20);
    expect(accounts.get('sizeCents')).toBe('size_cents');
    expect(schemaColumns('thisIsNotATable').size).toBe(0);
  });

  for (const table of [
    'accounts',
    'identities',
    'fills',
    'dailyMarks',
    'ruleStates',
    'planVersions',
  ])
    test(`${table} names every column of its table and no other, with the schema's own column names`, () => {
      const declared = schemaColumns(table);
      const mapped = EVIDENCE_COLUMNS[table] ?? {};
      // BOTH DIRECTIONS. A name the map has and the table does not is a typo
      // nothing else would catch; a name the table has and the map does not is
      // a column that would silently stop reaching a court-grade exhibit, or
      // silently start reaching a trader, depending on which way it was added.
      expect(Object.keys(mapped).sort()).toStrictEqual([...declared.keys()].sort());
      for (const [property, spec] of Object.entries(mapped))
        expect(spec[0], `${table}.${property}`).toBe(declared.get(property));
    });

  test('the plan version carries copy_blocks and invents no rule_text column', () => {
    // `GS-112` requires "the plan's rule text" and `plan_versions` has no such
    // column. `0028_supersede_plan_version_immutability.sql` names the one that
    // holds it -- "`copy_blocks` (the published rule TEXT)" -- and `INV-M4-08`
    // says the same from the reading end.
    const planVersions = EVIDENCE_COLUMNS['planVersions'] ?? {};
    expect(planVersions['copyBlocks']).toStrictEqual(['copy_blocks', 'json']);
    expect(Object.values(planVersions).map((spec) => spec[0])).not.toContain('rule_text');
    expect(schemaColumns('planVersions').has('ruleText')).toBe(false);
  });

  test('a gate result is TWO COLUMNS on a rule state and there is no gate_results table', () => {
    // `SD-06` split it (`0015_rule_states.sql`), and {@link EvidenceSubject}
    // says a section that would be silently empty is worse than two named ones.
    const ruleStates = EVIDENCE_COLUMNS['ruleStates'] ?? {};
    expect(ruleStates['engineGates']).toStrictEqual(['engine_gates', 'json']);
    expect(ruleStates['contextGates']).toStrictEqual(['context_gates', 'json']);
    expect(TABLE_KEYS).not.toContain('gateResults');
  });
});

// -----------------------------------------------------------------------------
// 12.3 The estate, as the accessor hands it back
// -----------------------------------------------------------------------------

type RawRow = Readonly<Record<string, unknown>>;
type Estate = Readonly<Record<string, readonly RawRow[]>>;

const PLAN_VERSION = '66666666-6666-4666-8666-666666666666';
const RUN_ID = '88888888-8888-4888-8888-888888888888';
const OTHER_ACCOUNT = '99999999-9999-4999-8999-999999999999';
const IDENTITY_FLAG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ACCOUNT_FLAG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * ADR-112's read vocabulary and NOTHING ELSE ON THE OBJECT.
 *
 * `admin-source-flags.test.ts`'s recorder, one directory of tables over: the
 * fake carries no `insert`, no `updateAt` and no `sqlExecutor`, so a module that
 * grew a reach for one fails here rather than in a deployment.
 */
class Accessor implements EvidenceTx {
  readonly calls: string[] = [];

  constructor(private readonly estate: Estate) {}

  private of(key: string): readonly RawRow[] {
    return this.estate[key] ?? [];
  }

  rows(key: EvidenceReadTable): Promise<unknown[]> {
    this.calls.push(`rows ${key}`);
    return Promise.resolve([...this.of(key)]);
  }

  rowsWhere(key: EvidenceReadTable, where: Readonly<Record<string, unknown>>): Promise<unknown[]> {
    this.calls.push(`rowsWhere ${key} ${Object.keys(where).sort().join('+')}`);
    return Promise.resolve(
      this.of(key).filter((row) => Object.entries(where).every(([k, v]) => row[k] === v)),
    );
  }

  rowAt(key: EvidenceReadTable, at: Readonly<Record<string, unknown>>): Promise<unknown> {
    this.calls.push(`rowAt ${key} ${Object.keys(at).sort().join('+')}`);
    return Promise.resolve(
      this.of(key).find((row) => Object.entries(at).every(([k, v]) => row[k] === v)),
    );
  }
}

function instantOf(iso: string): Date {
  return new Date(iso);
}

function accountRow(overrides: RawRow = {}): RawRow {
  return {
    id: SUBJECT_ACCOUNT,
    identityId: SUBJECT_IDENTITY,
    userId: '12121212-1212-4121-8121-121212121212',
    purchaseId: '13131313-1313-4131-8131-131313131313',
    planVersionId: PLAN_VERSION,
    // A `bigint` cents column, which is what `assertIntegerAmounts` has to be
    // able to see as a number.
    sizeCents: 5000000n,
    phase: 'funded',
    status: 'active',
    platform: 'rithmic',
    platformAccountRef: 'APEX-4471',
    feed: null,
    frontEndPermissions: [],
    openedOn: '2026-07-01',
    fundedOn: '2026-08-01',
    closedOn: null,
    closeReason: null,
    payoutsFrozen: false,
    reconBlocked: false,
    expiresOn: null,
    graduatedAt: null,
    graduationPath: null,
    terminalSettlementId: null,
    graduationEligible: false,
    createdAt: instantOf('2026-07-01T12:00:00.000Z'),
    updatedAt: instantOf('2026-08-20T12:00:00.000Z'),
    ...overrides,
  };
}

function identityRow(overrides: RawRow = {}): RawRow {
  return {
    id: SUBJECT_IDENTITY,
    displayName: 'Jordan R.',
    leaderboardOptIn: false,
    status: 'active',
    statusReason: null,
    maxAccountsOverride: null,
    payoutsFrozen: false,
    frozenReason: null,
    frozenAt: null,
    supportContactRef: null,
    firstSeenAt: instantOf('2026-06-30T09:00:00.000Z'),
    createdAt: instantOf('2026-06-30T09:00:00.000Z'),
    updatedAt: instantOf('2026-08-20T09:00:00.000Z'),
    ...overrides,
  };
}

function planVersionRow(overrides: RawRow = {}): RawRow {
  return {
    id: PLAN_VERSION,
    planId: '14141414-1414-4141-8141-141414141414',
    version: 7,
    status: 'published',
    rules: { trailing_drawdown_cents: 200000 },
    copyBlocks: { floor: 'Trailing drawdown of 2,000 dollars from the high-water balance.' },
    publicSlug: 'apex-50k',
    publicVisible: true,
    publishedAt: instantOf('2026-06-01T00:00:00.000Z'),
    retiredAt: null,
    createdBy: 'ops:sam',
    createdAt: instantOf('2026-05-30T00:00:00.000Z'),
    feeBackRepeats: false,
    decidedOnSimulationRunId: null,
    simulationWaiverReason: null,
    ...overrides,
  };
}

function fillRow(id: bigint, executedAt: string, overrides: RawRow = {}): RawRow {
  return {
    id,
    accountId: SUBJECT_ACCOUNT,
    platform: 'rithmic',
    platformFillId: `RF-${String(id)}`,
    orderId: null,
    venue: null,
    symbol: 'ESZ6',
    side: 'buy',
    quantity: 2,
    priceNumerator: 445025n,
    priceDenominator: 100n,
    executedAt: instantOf(executedAt),
    tradingDay: '2026-08-20',
    correctionOf: null,
    isCorrected: false,
    ingestFileId: '15151515-1515-4151-8151-151515151515',
    rawRowId: 4001n,
    recordedAt: instantOf(executedAt),
    tradingDayVendor: null,
    tradingDaySource: 'calendar',
    createdAt: instantOf(executedAt),
    ...overrides,
  };
}

function markRow(id: bigint, tradingDay: string, overrides: RawRow = {}): RawRow {
  return {
    id,
    accountId: SUBJECT_ACCOUNT,
    tradingDay,
    openingBalanceCents: 5000000n,
    closingBalanceCents: 5012500n,
    highBalanceCents: 5020000n,
    lowBalanceCents: 4998000n,
    realizedPnlCents: 12500n,
    fillCount: 2,
    tradedDay: true,
    winDay: true,
    adjustmentCents: 0n,
    // A `bytea`, which renders as an object keyed by byte index if nothing
    // converts it.
    sourceHash: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    source: 'rithmic',
    ingestFileId: null,
    supersededBy: null,
    computedAt: instantOf(`${tradingDay}T22:00:00.000Z`),
    createdAt: instantOf(`${tradingDay}T22:00:00.000Z`),
    ...overrides,
  };
}

function ruleStateRow(id: bigint, tradingDay: string, overrides: RawRow = {}): RawRow {
  return {
    id,
    accountId: SUBJECT_ACCOUNT,
    tradingDay,
    phase: 'funded',
    floorCents: 4800000n,
    floorLocked: false,
    floorOpenCents: 4800000n,
    highWaterBalanceCents: 5020000n,
    balanceCents: 5012500n,
    withdrawableCents: 212500n,
    tradedDaysCount: 9,
    winDaysCount: 6,
    consistencyBestDayCents: 12500n,
    consistencyPeriodProfitCents: 42000n,
    consistencyPeriodStartDay: null,
    payoutsSettledCount: 1,
    payoutAnchorDay: null,
    cadenceAnchorDay: null,
    engineEligible: true,
    engineGates: { profit_target: true, drawdown: true, min_days: true },
    contextGates: { freeze: false, recon_blocked: false, kyc: true },
    stateHash: new Uint8Array([0x01, 0x02, 0x03]),
    engineVersion: 'engine@1.4.0',
    computedAt: instantOf(`${tradingDay}T22:05:00.000Z`),
    createdAt: instantOf(`${tradingDay}T22:05:00.000Z`),
    calendarRevisionId: null,
    ...overrides,
  };
}

function riskFlagRow(id: string, overrides: RawRow = {}): RawRow {
  return {
    id,
    identityId: SUBJECT_IDENTITY,
    accountId: SUBJECT_ACCOUNT,
    flagType: 'copy_cluster',
    severity: 3,
    status: 'open',
    source: 'internal',
    detectorRunId: RUN_ID,
    evidence: {
      window_seconds: 2,
      counterparty_identity_id: COUNTERPARTY_IDENTITY,
    },
    firstDetectedOn: '2026-08-20',
    ...overrides,
  };
}

const REGISTRY_ROWS: readonly RawRow[] = SEEDED.map((row) => ({
  detector: row.detector,
  version: row.version,
  parameters: row.parameters,
  description: 'seeded',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  isSensitive: row.is_sensitive,
}));

function estateOf(overrides: Partial<Record<string, readonly RawRow[]>> = {}): Estate {
  return {
    accounts: [accountRow()],
    identities: [identityRow()],
    planVersions: [planVersionRow()],
    fills: [fillRow(902n, '2026-08-20T14:31:00.000Z'), fillRow(901n, '2026-08-20T14:30:00.000Z')],
    dailyMarks: [markRow(52n, '2026-08-20'), markRow(51n, '2026-08-19')],
    ruleStates: [ruleStateRow(72n, '2026-08-20'), ruleStateRow(71n, '2026-08-19')],
    riskFlags: [riskFlagRow(FLAG_ID)],
    detectorRuns: [
      { id: RUN_ID, detector: 'D-01', detectorVersion: 'v1', tradingDay: '2026-08-20' },
    ],
    payoutRequests: [],
    identityRestrictionEpisodes: [],
    detectorDefinitions: REGISTRY_ROWS,
    ...overrides,
  };
}

async function subjectFrom(estate: Estate = estateOf()): Promise<EvidenceSubjectResult> {
  const result = await readEvidenceSubject(new Accessor(estate), SUBJECT_ACCOUNT);
  expect(result).not.toBeNull();
  return result as EvidenceSubjectResult;
}

// -----------------------------------------------------------------------------
// 12.4 The three values canonicalJson cannot render
// -----------------------------------------------------------------------------

describe('the JSON hazards this projection exists for', () => {
  test('a bigint THROWS, which is the loud one', () => {
    // `JSON.stringify` has no representation for one, and every surrogate key
    // and every cents column on these tables is a `bigint`.
    expect(() => canonicalJson({ balance_cents: 5012500n })).toThrow(TypeError);
  });

  test('a Date renders as {} and NOTHING COMPLAINS, which is the one that matters', () => {
    // `canonicalJson` reaches a `Date` through the same object branch every
    // record takes, and `Object.keys(new Date())` is empty. The bytes would be
    // wrong, the digest would be over exactly those wrong bytes, and the pack
    // would be self-consistent about it.
    expect(canonicalJson({ executed_at: instantOf('2026-08-20T14:30:00.000Z') })).toBe(
      '{"executed_at":{}}',
    );
  });

  test('a Uint8Array renders as an object keyed by byte index', () => {
    expect(canonicalJson({ source_hash: new Uint8Array([0xde, 0xad]) })).toBe(
      '{"source_hash":{"0":222,"1":173}}',
    );
  });

  test('a projected subject renders whole, and every one of the three is converted', async () => {
    const { subject } = await subjectFrom();
    const rendered = canonicalJson(subject);
    expect(rendered).toContain('"executed_at":"2026-08-20T14:30:00.000Z"');
    expect(rendered).toContain('"source_hash":"deadbeef"');
    expect(rendered).toContain('"id":"901"');
    expect(rendered).toContain('"size_cents":5000000');
    expect(rendered).not.toContain('{}');
  });

  test('the projected subject also survives the generators own integer refusal', async () => {
    const { subject } = await subjectFrom();
    // `assertIntegerAmounts` walks numbers and refuses a fractional one. A cents
    // column carried as a STRING would walk past it, which is why `int` is a
    // number and `bigid` is not.
    expect(() => {
      assertIntegerAmounts(subject);
    }).not.toThrow();
  });
});

// -----------------------------------------------------------------------------
// 12.5 The subject
// -----------------------------------------------------------------------------

describe('readEvidenceSubject', () => {
  test('answers null for an account that is not there, which the route answers 404', async () => {
    expect(await readEvidenceSubject(new Accessor(estateOf()), OTHER_ACCOUNT)).toBeNull();
  });

  test('an account that has never traded is a subject with empty sections, not a 404', async () => {
    const { subject, cost } = await subjectFrom(
      estateOf({ fills: [], dailyMarks: [], ruleStates: [] }),
    );
    expect(subject.account_id).toBe(SUBJECT_ACCOUNT);
    expect(subject.fills).toStrictEqual([]);
    expect(cost.fills).toBe(0);
  });

  test('refuses an account whose identity row is missing rather than blanking the section', async () => {
    // `accounts.identity_id` REFERENCES `identities(id)`, so this cannot happen
    // while the constraint holds. A pack whose subject section is blank is an
    // exhibit saying the firm does not know who this is.
    await expect(
      readEvidenceSubject(new Accessor(estateOf({ identities: [] })), SUBJECT_ACCOUNT),
    ).rejects.toThrow(/has no `identities` row/);
  });

  test('refuses an account whose pinned plan version is missing', async () => {
    // GS-112 requires the plan's rule text, and a pack that omits the rule it is
    // arguing about proves nothing.
    await expect(
      readEvidenceSubject(new Accessor(estateOf({ planVersions: [] })), SUBJECT_ACCOUNT),
    ).rejects.toThrow(/rule text/);
  });

  test('carries the plan version whole, including copy_blocks', async () => {
    const { subject } = await subjectFrom();
    expect(subject.plan_version['copy_blocks']).toStrictEqual({
      floor: 'Trailing drawdown of 2,000 dollars from the high-water balance.',
    });
    expect(subject.plan_version['rule_text']).toBeUndefined();
  });

  test('orders fills, marks and rule states OLDEST FIRST with the row id as the tie-break', async () => {
    // `account.ts`'s rule and its reason: a dispute about a specific day is
    // worked from before it to after it. The estate hands them back newest
    // first, so an unsorted implementation fails this.
    const { subject } = await subjectFrom();
    expect(subject.fills.map((row) => row['id'])).toStrictEqual(['901', '902']);
    expect(subject.marks.map((row) => row['trading_day'])).toStrictEqual([
      '2026-08-19',
      '2026-08-20',
    ]);
    expect(subject.rule_states.map((row) => row['trading_day'])).toStrictEqual([
      '2026-08-19',
      '2026-08-20',
    ]);
  });

  test('breaks a tie on the id as a NUMBER, because "10" sorts before "9" as text', async () => {
    const { subject } = await subjectFrom(
      estateOf({
        fills: [fillRow(10n, '2026-08-20T14:30:00.000Z'), fillRow(9n, '2026-08-20T14:30:00.000Z')],
      }),
    );
    expect(subject.fills.map((row) => row['id'])).toStrictEqual(['9', '10']);
  });

  test('pushes every section down as an equality rather than reading a table whole', async () => {
    // ADR-112's vocabulary is a typed equality. The only whole-table read this
    // module makes is the registry, and section 12.7 says why that one must be.
    const accessor = new Accessor(estateOf());
    await readEvidenceSubject(accessor, SUBJECT_ACCOUNT);
    expect(accessor.calls).toContain('rowsWhere fills accountId');
    expect(accessor.calls).toContain('rowsWhere riskFlags identityId');
    expect(accessor.calls.filter((call) => call.startsWith('rows '))).toStrictEqual([]);
  });
});

// -----------------------------------------------------------------------------
// 12.6 The flags, the detector attribution and the ToS clause
// -----------------------------------------------------------------------------

describe('the flag set is the accounts plus the persons', () => {
  test('keeps this accounts flags and the identity-level ones, and drops another accounts', async () => {
    // `account.ts`'s narrowing, adopted rather than reinvented: `IS NULL` is not
    // a term this directory can mint, so the read is keyed on the identity and
    // the predicate runs in memory. `full-detail` bounds the DETAIL and never
    // the SCOPE.
    const { subject, cost } = await subjectFrom(
      estateOf({
        riskFlags: [
          riskFlagRow(FLAG_ID),
          riskFlagRow(IDENTITY_FLAG, { accountId: null }),
          riskFlagRow(OTHER_ACCOUNT_FLAG, { accountId: OTHER_ACCOUNT }),
        ],
      }),
    );
    expect(subject.flags.map((flag) => flag.flag_id)).toStrictEqual([FLAG_ID, IDENTITY_FLAG]);
    expect(cost.identityFlags).toBe(3);
    expect(cost.flags).toBe(2);
  });

  test('reads detector and detector_version off the RUN, which risk_flags does not carry', async () => {
    // `risk_flags` has `detector_run_id` and no detector column;
    // `detector_runs` has both names. This is `flags.ts`'s reading of the same
    // two tables, with the version it does not need.
    const { subject } = await subjectFrom();
    expect(subject.flags[0]?.detector).toBe('D-01');
    expect(subject.flags[0]?.detector_version).toBe('v1');
    expect(schemaColumns('riskFlags').has('detector')).toBe(false);
  });

  test('an unattributed flag carries null and NOT a sentinel, because the field is nullable', async () => {
    const { subject } = await subjectFrom(
      estateOf({ riskFlags: [riskFlagRow(FLAG_ID, { detectorRunId: null })] }),
    );
    expect(subject.flags[0]?.detector).toBeNull();
    expect(subject.flags[0]?.detector_version).toBeNull();
  });

  test('reads one run per distinct id rather than the table, which is one row per night', async () => {
    const accessor = new Accessor(
      estateOf({ riskFlags: [riskFlagRow(FLAG_ID), riskFlagRow(IDENTITY_FLAG)] }),
    );
    await readEvidenceSubject(accessor, SUBJECT_ACCOUNT);
    expect(accessor.calls.filter((call) => call === 'rowAt detectorRuns id')).toHaveLength(1);
  });
});

describe('the ToS clause is the enforcements and never a map', () => {
  test('carries null when nothing has cited the flag, and NEVER invents one', async () => {
    // STATE finding B: `risk_flags` carries no clause column and `DEP-M7-05`
    // still owes two of the three texts. A flag-type-to-clause map written here
    // would be the hand-listed drift `INV-M7-10` exists to prevent, one table
    // over.
    const { subject, cost } = await subjectFrom();
    expect(subject.flags[0]?.tos_clause).toBeNull();
    expect(cost.clauseSources).toBe(0);
  });

  test('takes the clause off a held payout request', async () => {
    // `payout_requests_hold_is_complete`: a held payout carries a cited flag AND
    // a clause AND a reason, or it carries none of them.
    const { subject } = await subjectFrom(
      estateOf({
        payoutRequests: [
          {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            accountId: SUBJECT_ACCOUNT,
            holdFlagId: FLAG_ID,
            holdTosClause: 'ToS 9.3',
          },
        ],
      }),
    );
    expect(subject.flags[0]?.tos_clause).toBe('ToS 9.3');
  });

  test('takes the clause off an identity restriction episode', async () => {
    const { subject, cost } = await subjectFrom(
      estateOf({
        identityRestrictionEpisodes: [
          {
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            identityId: SUBJECT_IDENTITY,
            flagId: FLAG_ID,
            tosClause: 'ToS 9.4',
          },
        ],
      }),
    );
    expect(subject.flags[0]?.tos_clause).toBe('ToS 9.4');
    expect(cost.clauseSources).toBe(1);
  });

  test('ignores a payout request that is not held, which carries no flag and no clause', async () => {
    const { subject, cost } = await subjectFrom(
      estateOf({
        payoutRequests: [
          {
            id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            accountId: SUBJECT_ACCOUNT,
            holdFlagId: null,
            holdTosClause: null,
          },
        ],
      }),
    );
    expect(subject.flags[0]?.tos_clause).toBeNull();
    expect(cost.payoutRequests).toBe(1);
    expect(cost.clauseSources).toBe(0);
  });

  test('two enforcements citing one flag under the SAME clause is one answer, not a conflict', async () => {
    const { subject } = await subjectFrom(
      estateOf({
        payoutRequests: [
          { accountId: SUBJECT_ACCOUNT, holdFlagId: FLAG_ID, holdTosClause: 'ToS 9.3' },
        ],
        identityRestrictionEpisodes: [
          { identityId: SUBJECT_IDENTITY, flagId: FLAG_ID, tosClause: 'ToS 9.3' },
        ],
      }),
    );
    expect(subject.flags[0]?.tos_clause).toBe('ToS 9.3');
  });

  test('two enforcements citing one flag under DIFFERENT clauses is a refusal', async () => {
    // `EvidenceFlagRecord.tos_clause` is one string and a pack is the document a
    // dispute is argued from. Stating one of them would cite a rule the firm did
    // not cite for the other enforcement. A ruling that makes the field a list
    // retires this; nothing is guessed in the meantime.
    await expect(
      readEvidenceSubject(
        new Accessor(
          estateOf({
            payoutRequests: [
              { accountId: SUBJECT_ACCOUNT, holdFlagId: FLAG_ID, holdTosClause: 'ToS 9.3' },
            ],
            identityRestrictionEpisodes: [
              { identityId: SUBJECT_IDENTITY, flagId: FLAG_ID, tosClause: 'ToS 12.1' },
            ],
          }),
        ),
        SUBJECT_ACCOUNT,
      ),
    ).rejects.toThrow(EvidenceExportError);
  });
});

// -----------------------------------------------------------------------------
// 12.7 The registry
// -----------------------------------------------------------------------------

describe('readEvidenceDetectorRegistry', () => {
  test('reads the WHOLE table, because INV-M7-10s strip list is a union over it', async () => {
    // A read narrowed to the detectors that flagged THIS account would compute a
    // strip list missing every name only another detector claims, and
    // `sensitiveParameterNames` says why that matters: `severity` and
    // `window_trading_days` belong to several detectors at once.
    const accessor = new Accessor(estateOf());
    const registry = await readEvidenceDetectorRegistry(accessor);
    expect(accessor.calls).toStrictEqual(['rows detectorDefinitions']);
    expect(registry).toHaveLength(SEEDED.length);
  });

  test('produces exactly the strip list the seed produces, computed and not restated', async () => {
    const registry = await readEvidenceDetectorRegistry(new Accessor(estateOf()));
    expect([...sensitiveParameterNames(registry)].sort()).toStrictEqual(seededParameterNames());
  });

  test('an is_sensitive it cannot read is a refusal, because a name it misses is a name that ships', async () => {
    await expect(
      readEvidenceDetectorRegistry(
        new Accessor(
          estateOf({
            detectorDefinitions: [
              { detector: 'D-99', version: 'v1', parameters: {}, isSensitive: 'yes' },
            ],
          }),
        ),
      ),
    ).rejects.toThrow(/is_sensitive/);
  });
});

// -----------------------------------------------------------------------------
// 12.8 The refusals, one per kind
// -----------------------------------------------------------------------------

describe('the column readers refuse rather than render', () => {
  test('a cents column past the safe integer range is a refusal and not a rounding', async () => {
    await expect(
      readEvidenceSubject(
        new Accessor(estateOf({ accounts: [accountRow({ sizeCents: 9007199254740993n })] })),
        SUBJECT_ACCOUNT,
      ),
    ).rejects.toThrow(/outside the range a JSON number holds exactly/);
  });

  test('a NOT NULL text column arriving empty is the transcription disagreeing with the database', async () => {
    await expect(
      readEvidenceSubject(
        new Accessor(estateOf({ accounts: [accountRow({ phase: '' })] })),
        SUBJECT_ACCOUNT,
      ),
    ).rejects.toThrow(/carries no `phase`/);
  });

  test('a trading day derived from an instant is refused, because CT and UTC disagree for hours', async () => {
    await expect(
      readEvidenceSubject(
        new Accessor(
          estateOf({
            dailyMarks: [
              markRow(51n, '2026-08-19', { tradingDay: instantOf('2026-08-19T22:00:00.000Z') }),
            ],
          }),
        ),
        SUBJECT_ACCOUNT,
      ),
    ).rejects.toThrow(/not a trading day/);
  });

  test('a boolean column arriving as anything else is refused', async () => {
    await expect(
      readEvidenceSubject(
        new Accessor(
          estateOf({ ruleStates: [ruleStateRow(71n, '2026-08-19', { engineEligible: 1 })] }),
        ),
        SUBJECT_ACCOUNT,
      ),
    ).rejects.toThrow(/engine_eligible/);
  });

  test('a jsonb carrying a value canonicalJson cannot render is refused at the boundary', async () => {
    // It should never fire, because `pg` parses JSON into plain values. It is
    // here because when it does not fire the alternative is `canonicalJson`
    // throwing three layers from the row, or rendering `{}` and hashing it.
    await expect(
      readEvidenceSubject(
        new Accessor(
          estateOf({
            ruleStates: [
              ruleStateRow(71n, '2026-08-19', {
                engineGates: { at: instantOf('2026-08-19T00:00:00.000Z') },
              }),
            ],
          }),
        ),
        SUBJECT_ACCOUNT,
      ),
    ).rejects.toThrow(/cannot render/);
  });

  test('an optional column arriving null is null, and is not an error', async () => {
    const { subject } = await subjectFrom();
    expect(subject.account['closed_on']).toBeNull();
    expect(subject.account['feed']).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// 12.9 The port, end to end through the generator
// -----------------------------------------------------------------------------

describe('evidenceReadPort, driving the generator it was written for', () => {
  function depsOver(estate: Estate = estateOf()): Recorder {
    const recorder = recorderOf();
    return {
      ...recorder,
      deps: { ...recorder.deps, reads: evidenceReadPort(new Accessor(estate)) },
    };
  }

  test('a trader pack built from the accessor passes the redaction refusal', async () => {
    const recorder = depsOver();
    const pack = await createEvidenceExporter(recorder.deps).exportEvidence(REQUEST);
    expect(pack?.audience).toBe('trader');
    expect(recorder.written[0]?.redaction_profile).toBe('trader-facts-only');
    expect(recorder.written[0]?.includes_detector_detail).toBe(false);
  });

  test('the bytes it stored are the digest it wrote, over a document with no {} in it', async () => {
    const recorder = depsOver();
    await createEvidenceExporter(recorder.deps).exportEvidence(REQUEST);
    const bytes = recorder.stored[0];
    expect(bytes).toBeDefined();
    const text = Buffer.from(bytes ?? new Uint8Array()).toString('utf8');
    expect(text).toContain('"trader-facts-only"');
    expect(text).not.toContain('{}');
  });

  test('a trader pack carries the fills, the marks, the gate results and the rule text', async () => {
    // `GS-112` in both directions. The positives are asserted here and the
    // negatives are sections 4 through 8 above.
    const recorder = depsOver();
    await createEvidenceExporter(recorder.deps).exportEvidence(REQUEST);
    const text = Buffer.from(recorder.stored[0] ?? new Uint8Array()).toString('utf8');
    expect(text).toContain('"platform_fill_id":"RF-901"');
    expect(text).toContain('"closing_balance_cents":5012500');
    expect(text).toContain('"engine_gates"');
    expect(text).toContain('"context_gates"');
    expect(text).toContain('Trailing drawdown of 2,000 dollars');
  });

  test('a trader pack whose flag names another identity is REFUSED, over the accessor', async () => {
    // The counterparty uuid reaches the document through the flag's `evidence`
    // bag only at `full-detail`; at `trader` the allowlist drops the bag, so the
    // case that matters is the one where it reaches a field the pack must keep.
    const recorder = depsOver(
      estateOf({
        identityRestrictionEpisodes: [
          {
            identityId: SUBJECT_IDENTITY,
            flagId: FLAG_ID,
            tosClause: `ToS 9.3: coordinated with account ${COUNTERPARTY_IDENTITY}`,
          },
        ],
      }),
    );
    await expect(createEvidenceExporter(recorder.deps).exportEvidence(REQUEST)).rejects.toThrow(
      EvidenceRedactionError,
    );
    expect(recorder.written).toHaveLength(0);
    expect(recorder.stored).toHaveLength(0);
  });

  test('an account the accessor does not hold answers null, which the route answers 404', async () => {
    const recorder = depsOver();
    expect(
      await createEvidenceExporter(recorder.deps).exportEvidence({
        ...REQUEST,
        accountId: OTHER_ACCOUNT,
      }),
    ).toBeNull();
    expect(recorder.written).toHaveLength(0);
  });

  test('an internal pack over the accessor carries the detectors section and the whole flag', async () => {
    const recorder = depsOver();
    await createEvidenceExporter(recorder.deps).exportEvidence({
      ...REQUEST,
      audience: 'internal',
    });
    const text = Buffer.from(recorder.stored[0] ?? new Uint8Array()).toString('utf8');
    expect(text).toContain('"detectors"');
    expect(text).toContain(COUNTERPARTY_IDENTITY);
    expect(recorder.written[0]?.includes_detector_detail).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// 12.10 What this adapter is still two ports short of
// -----------------------------------------------------------------------------

describe('exportEvidence still does not join IMPLEMENTED_ADMIN_READS, and the reason is measured', () => {
  const SRC = join(HERE, '..', 'src');

  test('every table this read needs was ALREADY registered, so no table is what blocks it', () => {
    // The opposite of what sessions 349 and 353 found for `events`. Nothing here
    // waits on `packages/db`.
    for (const key of EVIDENCE_READ_TABLES) expect(TABLE_KEYS).toContain(key);
  });

  test('nothing in this deployable implements EvidencePackStore, and no table registration would', () => {
    // `evidence_packs.storage_ref` is "Private object storage, signed URL only"
    // in the DDL's own comment. A store is not a table, so no registration
    // reaches it, and a `download_url` invented here is a pack an operator cites
    // and nobody can open.
    //
    // THE PROBE IS THE INTERFACE NAME AND NOT THE COLUMN NAME. A first version
    // swept for `storage_ref:` and matched the DECLARATION, which is this file
    // asserting that a type it declares is declared. The measurement that means
    // something is that ONE file in the whole deployable mentions the port at
    // all: nothing references it, so no deployment can install one.
    const mentions = typescriptFilesUnder(SRC)
      .filter((file) => read(file).includes('EvidencePackStore'))
      .map((file) => file.slice(SRC.length + 1));
    expect(mentions).toStrictEqual([join('admin-source', 'evidence.ts')]);
  });

  test('the writer is an INSERT and its home is the write side, which already registers the table', () => {
    // `routes/admin-writes.ts` names `evidencePacks` in `ADMIN_WRITE_TABLES` and
    // `AdminWriteTx` carries `insert`. THIS directory's stated property is a
    // handle it cannot write through, so the row is reported as the write side's
    // rather than minted here.
    const writes = read(join(SRC, 'routes', 'admin-writes.ts'));
    expect(writes).toContain("'evidencePacks'");
    expect(writes).toContain('insert(key: AdminWriteTable');
    for (const name of readdirSync(join(SRC, 'admin-source')))
      expect(read(join(SRC, 'admin-source', name)), `${name} writes`).not.toContain('.insert(');
  });

  test('IMPLEMENTED_ADMIN_READS does not name it, so the wiring triple does not move', () => {
    // A METHOD IS NOT A PORT. `composeImplementedAdminReads` takes ONE
    // parameter, an `AdminSourceBackend`, and no door onto this database
    // produces a signed URL, so a key added there would have to invent a store.
    expect(IMPLEMENTED_ADMIN_READS).not.toContain('exportEvidence');
    expect(read(join(SRC, 'start.ts'))).not.toContain('setAdminReadSource(');
  });

  test('and the run-time defence still names it, over a green typecheck', () => {
    // The third of the three, and the only one that fires at run time. It is
    // thrown SYNCHRONOUSLY where the port's signature returns a promise, which
    // is why this case does not await.
    expect(() => composeAdminReadSource({}).exportEvidence(REQUEST)).toThrow(
      AdminSourceNotComposed,
    );
    expect(() => composeAdminReadSource({}).exportEvidence(REQUEST)).toThrow(/exportEvidence/);
  });
});
