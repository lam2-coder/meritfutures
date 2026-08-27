// =============================================================================
// packages/db/test/seed-detectors.test.ts
// =============================================================================
// A SEED TEST THAT ASSERTS THE SEED LOADS PROVES ALMOST NOTHING. What this file
// asserts instead is that the seed IS the registry: that it agrees with M07
// section 3.2 IN BOTH DIRECTIONS, that every value in it can be pointed at, and
// that none of it implies the one thing ADR-155 forecloses.
//
// -----------------------------------------------------------------------------
// THE TWO DIRECTIONS, AND WHY THE EXPECTED SET IS PARSED RATHER THAN WRITTEN
// -----------------------------------------------------------------------------
// A hand-kept list of the detectors M07 names is one more hand-maintained
// count, and it goes stale on the day section 3.2 gains a row: silently, and in
// the direction that matters, because the stale list would agree with the stale
// seed. So the expected set is PARSED OUT OF M07 ITSELF and the two failures
// are separate findings:
//
//   detector-named-by-m07-and-not-seeded    M07 gained a row and the seed did not
//   detector-seeded-and-not-named-by-m07    the seed gained a row with nothing to cite
//
// Both are seeded below and watched failing on their own finding, so a detector
// added to the seed without a citation fails, and a detector M07 names and the
// seed forgot fails too.
//
// -----------------------------------------------------------------------------
// EVERY REJECTION SHIPS WITH A SEEDED VIOLATION, ON ITS OWN FINDING
// -----------------------------------------------------------------------------
// `trading-calendar-generator.test.ts`'s rule, unchanged: a rule that rejects
// for the wrong reason and a rule that accepts for the wrong reason are the
// same defect. "every finding in the generator is seeded" is itself a test, so
// a rejection added to `generate.mjs` without a seed turns this file red.
//
// The three findings no source file can reach are named there with their proof
// rather than papered over with a seed that fails on a different finding and
// looks like coverage.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  AUTHORITY,
  build,
  checkCitations,
  collectCitations,
  detectorsNamedByTheAuthority,
  DetectorSourceError,
  ROW_COLUMNS,
  serialize,
} from '../src/seed/detectors/generate.mjs';

const GENERATOR = fileURLToPath(new URL('../src/seed/detectors/generate.mjs', import.meta.url));
const SOURCE_FILE = fileURLToPath(
  new URL('../src/seed/detectors/m07-detectors-v1.source.json', import.meta.url),
);
const ROWS_FILE = fileURLToPath(
  new URL('../src/seed/detectors/m07-detectors-v1.rows.json', import.meta.url),
);
const AUTHORITY_FILE = fileURLToPath(new URL(`../../../${AUTHORITY}`, import.meta.url));
const MIGRATION = fileURLToPath(new URL('../migrations/0008_risk.sql', import.meta.url));

const SOURCE_TEXT = readFileSync(SOURCE_FILE, 'utf8');
const ROWS_TEXT = readFileSync(ROWS_FILE, 'utf8');
const AUTHORITY_TEXT = readFileSync(AUTHORITY_FILE, 'utf8');

type Cited = { cite: string; quote: string };
type Parameter = {
  state: string;
  value: unknown;
  unit: string;
  cite: string;
  quote: string;
  reason?: string;
  cases?: Array<{ value: unknown; cite: string; quote: string }>;
};
type Meta = {
  name: string;
  m07_row: string;
  input: Cited;
  evidence_of: Cited;
  is_sensitive_reason: string;
  parameter_counts: Record<string, number>;
};
type Row = {
  detector: string;
  version: string;
  parameters: { _meta: Meta } & Record<string, Parameter>;
  description: string;
  effective_from: string;
  effective_to: null;
  is_sensitive: boolean;
};
type Generated = {
  rows: Row[];
  counts: Record<string, number>;
  posture: {
    recommendation: Cited;
    routing: { state: string; value: unknown; counter_cites: unknown[] };
  };
  refusals: { auto_enforce: unknown[] };
};

const GENERATED = JSON.parse(ROWS_TEXT) as Generated;

/**
 * THE SOURCE FILE'S SHAPE, WRITTEN OUT RATHER THAN TYPED AS AN INDEX
 * SIGNATURE. Every field is optional because every seeded violation below
 * exists to remove one, and a fixture type that could not express the absence
 * could not express the violation. The alternative, a bare record, hides a
 * misspelt key inside a mutation and turns a seeded violation into a test that
 * passes for the wrong reason, which is the one thing this suite is against.
 */
type SourceCite = { cite?: string; quote?: string };
type SourceCase = { value?: unknown; cite?: string; quote?: string };
type SourceParameter = {
  state?: string;
  value?: unknown;
  unit?: string;
  cite?: string;
  quote?: string;
  reason?: string;
  note?: string;
  cases?: SourceCase[];
};
type SourceDetector = {
  detector?: string;
  m07_row?: string;
  name?: SourceCite;
  input?: SourceCite;
  evidence_of?: SourceCite;
  is_sensitive?: { value?: boolean; reason?: string };
  parameters?: Record<string, SourceParameter>;
};
type SourceDefault = {
  state?: string;
  value?: unknown;
  reason?: string;
  cite?: string;
  quote?: string;
};
type SourceFile = {
  id?: string;
  status?: string;
  provenance?: {
    authority?: string;
    authority_sha256?: string;
    read_at?: string;
    read_by?: string;
  };
  row_defaults?: {
    version?: SourceDefault;
    effective_from?: SourceDefault;
    effective_to?: SourceDefault;
  };
  posture?: {
    recommendation?: SourceCite;
    routing?: { state?: string; value?: unknown; counter_cites?: unknown[] };
  };
  refusals?: { auto_enforce?: Array<{ reason?: string }> };
  detectors?: SourceDetector[] | null;
  declared?: {
    detector_count?: number;
    rows_with_at_least_one_stated_number?: number;
    rows_with_no_stated_number?: number;
    sensitive_row_count?: number;
  };
};

/** A fresh deep copy of the committed source, for a seeded violation to mutate. */
function source(mutate: (s: SourceFile) => void = () => {}): string {
  const s = JSON.parse(SOURCE_TEXT) as SourceFile;
  mutate(s);
  return JSON.stringify(s);
}

/** The detector entry in a mutable copy, by id. Throws rather than returning undefined. */
function detectorIn(s: SourceFile, id: string): SourceDetector {
  const d = (s.detectors ?? []).find((x) => x.detector === id);
  if (!d) throw new Error(`the fixture has no ${id}`);
  return d;
}

/** The parameters map of a detector entry in a mutable copy. */
function paramsIn(s: SourceFile, id: string): Record<string, SourceParameter> {
  const p = detectorIn(s, id).parameters;
  if (!p) throw new Error(`${id} has no parameters in the fixture`);
  return p;
}

/** One parameter of a detector entry in a mutable copy. */
function paramIn(s: SourceFile, id: string, key: string): SourceParameter {
  const p = paramsIn(s, id)[key];
  if (!p) throw new Error(`${id} has no ${key} in the fixture`);
  return p;
}

/** One parameter of a generated row. Throws rather than returning undefined. */
function param(row: Row, key: string): Parameter {
  const p = row.parameters[key];
  if (!p) throw new Error(`${row.detector} has no ${key}`);
  return p;
}

/** One generated row, by detector id. */
function rowFor(id: string): Row {
  const r = GENERATED.rows.find((x) => x.detector === id);
  if (!r) throw new Error(`the registry has no ${id}`);
  return r;
}

function findingOf(run: () => unknown): string {
  try {
    run();
  } catch (e) {
    if (e instanceof DetectorSourceError) return e.finding;
    return `threw ${(e as Error).name}: ${(e as Error).message}`;
  }
  return 'did not throw';
}

const parametersOf = (row: Row): Array<[string, Parameter]> =>
  Object.entries(row.parameters).filter(([k]) => !k.startsWith('_')) as Array<[string, Parameter]>;

// -----------------------------------------------------------------------------
// The precondition. `detector_definitions` is landed DDL and this slice seeds
// it rather than declaring it.
// -----------------------------------------------------------------------------

describe('the table this seed writes into already exists as landed DDL', () => {
  const ddl = readFileSync(MIGRATION, 'utf8');

  it('0008_risk.sql creates detector_definitions', () => {
    expect(ddl).toContain('CREATE TABLE detector_definitions');
  });

  it('declares every column a generated row carries, and the key the seed assumes', () => {
    // No migration number is allocated to this slice and none is taken. If a
    // column a row needs were missing, the instruction is to report it and
    // stop rather than write DDL, and this is the assertion that would say so
    // before anything else in the file ran.
    for (const column of ROW_COLUMNS) expect(ddl).toContain(column);
    expect(ddl).toContain('PRIMARY KEY (detector, version)');
    expect(ddl).toContain('is_sensitive    boolean NOT NULL DEFAULT true');
  });

  it('indexes the current row as the one with a null effective_to, which the seed writes', () => {
    expect(ddl).toContain('ON detector_definitions (detector) WHERE effective_to IS NULL');
  });
});

// -----------------------------------------------------------------------------
// BOTH DIRECTIONS
// -----------------------------------------------------------------------------

describe('the seed and M07 section 3.2 agree in both directions', () => {
  const named = detectorsNamedByTheAuthority(AUTHORITY_TEXT) as Array<{
    detector: string;
    line: number;
  }>;

  it('parses a real detector set out of the authority rather than trusting a written list', () => {
    // The guard on the guard. If the parse silently found nothing, or found
    // one row, every "both directions" assertion below would pass vacuously.
    expect(named.length).toBeGreaterThan(10);
    expect(new Set(named.map((n) => n.detector)).size).toBe(named.length);
  });

  it('has a row for every detector M07 section 3.2 names', () => {
    const seeded = new Set(GENERATED.rows.map((r) => r.detector));
    expect(named.filter((n) => !seeded.has(n.detector)).map((n) => n.detector)).toEqual([]);
  });

  it('has a row for no detector M07 section 3.2 does not name', () => {
    const namedIds = new Set(named.map((n) => n.detector));
    expect(GENERATED.rows.filter((r) => !namedIds.has(r.detector)).map((r) => r.detector)).toEqual(
      [],
    );
  });

  it('follows the reading order of the authority, so the two diff line by line', () => {
    expect(GENERATED.rows.map((r) => r.detector)).toEqual(named.map((n) => n.detector));
  });

  it('cites each detector to the M07 line that actually holds its row', () => {
    const byId = new Map(named.map((n) => [n.detector, n.line]));
    for (const row of GENERATED.rows) {
      expect(row.parameters._meta.m07_row).toBe(`${AUTHORITY}:${byId.get(row.detector)}`);
    }
  });

  it('fails when M07 names a detector the seed forgot', () => {
    expect(
      findingOf(() =>
        build(
          source((s) => {
            s.detectors = (s.detectors ?? []).filter((d) => d.detector !== 'D-05');
            s.declared = { ...s.declared, detector_count: 17 };
          }),
          { sourceFile: 'synthetic.json' },
        ),
      ),
    ).toBe('detector-named-by-m07-and-not-seeded');
  });

  it('fails when the seed carries a detector M07 does not name', () => {
    expect(
      findingOf(() =>
        build(
          source((s) => {
            const clone = JSON.parse(JSON.stringify(detectorIn(s, 'D-18'))) as SourceDetector;
            clone.detector = 'D-99';
            (s.detectors ?? []).push(clone);
            s.declared = { ...s.declared, detector_count: 19 };
          }),
          { sourceFile: 'synthetic.json' },
        ),
      ),
    ).toBe('detector-seeded-and-not-named-by-m07');
  });

  it('fails on a reshuffle, which a set comparison would let through', () => {
    expect(
      findingOf(() =>
        build(
          source((s) => {
            const d = s.detectors ?? [];
            const [first, second] = [d[0], d[1]];
            if (!first || !second) throw new Error('the fixture has fewer than two detectors');
            d[0] = second;
            d[1] = first;
          }),
          { sourceFile: 'synthetic.json' },
        ),
      ),
    ).toBe('seed-order-disagrees-with-m07');
  });
});

// -----------------------------------------------------------------------------
// EVERY VALUE CAN BE POINTED AT
// -----------------------------------------------------------------------------

describe('every value in the committed registry is cited to a line of M07 that contains it', () => {
  const lines = AUTHORITY_TEXT.split('\n');

  it('resolves every citation in the generated rows, read from the committed artifact', () => {
    // Deliberately run over the COMMITTED file rather than over a fresh build,
    // so a hand-edited rows file is caught here and not only by the
    // regeneration check further down.
    const citations = collectCitations(GENERATED) as Array<{
      where: string;
      cite: string;
      quote: string;
    }>;
    expect(citations.length).toBeGreaterThan(150);
    const unresolved = citations.filter(({ cite, quote }) => {
      const m = /^(.+):(\d+)$/.exec(cite);
      if (!m || m[1] !== AUTHORITY) return true;
      const line = lines[Number(m[2]) - 1];
      return line === undefined || !line.includes(quote);
    });
    expect(unresolved).toEqual([]);
  });

  it('gives every parameter of every row a cite and a quote', () => {
    for (const row of GENERATED.rows) {
      for (const [key, p] of parametersOf(row)) {
        expect(typeof p.cite, `${row.detector}.${key}`).toBe('string');
        expect(p.quote.length, `${row.detector}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('composes each description out of quoted M07 text rather than out of fresh prose', () => {
    for (const row of GENERATED.rows) {
      expect(row.description).toContain(row.parameters._meta.name);
      expect(row.description).toContain(row.parameters._meta.evidence_of.quote);
      expect(row.description).toContain(row.parameters._meta.m07_row);
    }
  });

  it('fails on a paraphrase, which is the failure a citation exists to catch', () => {
    expect(
      findingOf(() =>
        build(
          source((s) => {
            paramIn(s, 'D-02', 'window_trading_days').quote = 'a rolling twenty day correlation';
          }),
          { sourceFile: 'synthetic.json' },
        ),
      ),
    ).toBe('quote-not-at-the-cite');
  });

  it('fails on a line number that has drifted, even when the quote is verbatim', () => {
    expect(
      findingOf(() =>
        build(
          source((s) => {
            paramIn(s, 'D-02', 'window_trading_days').cite = `${AUTHORITY}:110`;
          }),
          { sourceFile: 'synthetic.json' },
        ),
      ),
    ).toBe('quote-not-at-the-cite');
  });

  it('fails when the authority itself has moved under the cites', () => {
    expect(
      findingOf(() =>
        build(source(), {
          sourceFile: 'synthetic.json',
          readFile: () => 'a different M07\n### 3.2 The detector set\n| D-01 | x | y | z | w |\n',
        }),
      ),
    ).toBe('authority-digest-disagrees');
  });
});

// -----------------------------------------------------------------------------
// ADR-155. THE ONE RULE THIS PHASE EXISTS TO KEEP
// -----------------------------------------------------------------------------

describe('nothing in the registry implies an automatic path to enforced', () => {
  it('writes no flag status other than open, and not_applicable where no flag exists', () => {
    for (const row of GENERATED.rows) {
      const status = param(row, 'flag_status');
      expect(status, `${row.detector} states no flag_status`).toBeDefined();
      if (status.state === 'stated') expect(status.value, row.detector).toBe('open');
      else expect(status.state, row.detector).toBe('not_applicable');
    }
  });

  it('has exactly one detector that raises no flag at all, and D-12 is it', () => {
    // M07: "Output is a watched-cluster set, not a flag". `open` here would be
    // FALSE rather than merely cautious, and a runner reading `open` off every
    // row would look for a flag D-12 never raises and report it missing.
    const notApplicable = GENERATED.rows.filter(
      (r) => param(r, 'flag_status').state === 'not_applicable',
    );
    expect(notApplicable.map((r) => r.detector)).toEqual(['D-12']);
  });

  it('carries no parameter VALUE that spells an enforcement outcome', () => {
    for (const row of GENERATED.rows) {
      for (const [key, p] of parametersOf(row)) {
        if (typeof p.value !== 'string') continue;
        expect(
          /(^|[^a-z_-])(enforced|enforce|auto-enforce|ban|banned|restricted)([^a-z_-]|$)/i.test(
            p.value,
          ),
          `${row.detector}.${key} = ${JSON.stringify(p.value)}`,
        ).toBe(false);
      }
    }
  });

  it('leaves the auto_enforce of D-16 not_applicable, because OQ-M7-05 answers it both ways', () => {
    // M07 says "Hard links auto-enforce" in the D-16 cell and "no state changes
    // automatically" in section 3.1's third tier, and files the disagreement
    // OPEN as OQ-M7-05. A seed row is not where that gets ruled: writing EITHER
    // value settles an open question by being written, which is the
    // fixture-is-a-control reading of ADR-042 one artifact over.
    const p = param(rowFor('D-16'), 'auto_enforce');
    expect(p.state).toBe('not_applicable');
    expect(p.value).toBeNull();
    expect(p.reason).toContain('OQ-M7-05');
  });

  it('records both refused sentences rather than omitting them', () => {
    // A seed that merely omitted them is indistinguishable from one whose
    // author never read them, and the next session encodes them.
    expect(GENERATED.refusals.auto_enforce.length).toBe(2);
  });

  it('refuses a source that writes a flag status other than open', () => {
    expect(
      findingOf(() =>
        build(
          source((s) => {
            paramIn(s, 'D-09', 'flag_status').value = 'investigating';
          }),
          { sourceFile: 'synthetic.json' },
        ),
      ),
    ).toBe('flag-status-other-than-open');
  });

  it('refuses a parameter whose value spells an enforcement outcome', () => {
    expect(
      findingOf(() =>
        build(
          source((s) => {
            paramIn(s, 'D-09', 'link_class').value = 'hard, auto-enforce';
          }),
          { sourceFile: 'synthetic.json' },
        ),
      ),
    ).toBe('parameter-implies-enforcement');
  });

  it('refuses the auto_enforce of D-16 being set true, the transcription M07 invites', () => {
    expect(
      findingOf(() =>
        build(
          source((s) => {
            const p = paramIn(s, 'D-16', 'auto_enforce');
            p.state = 'stated';
            p.value = true;
            delete p.reason;
          }),
          { sourceFile: 'synthetic.json' },
        ),
      ),
    ).toBe('parameter-implies-enforcement');
  });
});

// -----------------------------------------------------------------------------
// D-18. THE ONE VALUE THE WHOLE RELIABILITY OF A DETECTOR SITS ON
// -----------------------------------------------------------------------------

describe('D-18 tests footprint_present IS FALSE and never IS NOT TRUE', () => {
  const d18 = rowFor('D-18');

  it('seeds the test as data, so a code path has something to be checked against', () => {
    expect(param(d18, 'footprint_present_test').value).toBe('IS FALSE');
  });

  it('requires all four legs, because no leg of the composite means anything alone', () => {
    expect(param(d18, 'required_legs').value).toBe(4);
    for (const leg of ['leg_voip', 'leg_fresh_email', 'leg_datacenter_ip', 'leg_no_footprint'])
      expect(param(d18, leg), leg).toBeDefined();
  });

  it('refuses a line type nowhere, which is the ruling rather than a tolerance', () => {
    expect(param(d18, 'refuses_line_type').value).toBe(false);
    expect(param(d18, 'evaluated_as_refusal').value).toBe(false);
  });

  it('refuses the source when the test is written IS NOT TRUE', () => {
    // A detector written against IS NOT TRUE scores every vendor timeout as a
    // fleet member, which converts a supplier outage into a flood of flags
    // against real customers on the day Merit can least afford it.
    expect(
      findingOf(() =>
        build(
          source((s) => {
            paramIn(s, 'D-18', 'footprint_present_test').value = 'IS NOT TRUE';
          }),
          { sourceFile: 'synthetic.json' },
        ),
      ),
    ).toBe('three-valued-trap');
  });
});

// -----------------------------------------------------------------------------
// is_sensitive IS THE STRIP LIST OF P7-j
// -----------------------------------------------------------------------------

describe('is_sensitive is treated as the security decision it is', () => {
  it('states a reason on every row, in the row, rather than leaning on the DDL default', () => {
    for (const row of GENERATED.rows) {
      expect(row.parameters._meta.is_sensitive_reason.length, row.detector).toBeGreaterThan(40);
    }
  });

  it('gives every row its OWN reason, so no value was set by copying its neighbour', () => {
    const reasons = GENERATED.rows.map((r) => r.parameters._meta.is_sensitive_reason);
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it('IS UNIFORMLY TRUE TODAY, AND THAT IS A FINDING FOR P7-j RATHER THAN A RESULT', () => {
    // INV-M7-10 is unqualified: "Detector parameters never appear in a
    // trader-audience evidence pack". Nothing in M07 designates any detector
    // parameter as trader-visible, so every row is sensitive and no row is a
    // counter-example.
    //
    // THE CONSEQUENCE BELONGS TO P7-j AND IS RECORDED HERE BECAUSE THIS IS THE
    // FILE THAT KNOWS IT. While this column is uniform, a `trader` pack that
    // COMPUTES its strip list from `is_sensitive` and one that strips every
    // detector unconditionally produce byte-identical output, so GS-112 passes
    // either way and the mechanism of INV-M7-10 is untested. P7-j needs a
    // fixture row with `is_sensitive: false` to tell the two apart, and it
    // cannot come from this seed, because there is no M07 line to cite for it.
    //
    // IF THIS ASSERTION EVER GOES RED, the column has acquired its first false
    // and the test of P7-j must be revisited in the same change.
    expect(GENERATED.rows.every((r) => r.is_sensitive)).toBe(true);
    expect(GENERATED.counts['sensitive_row_count']).toBe(GENERATED.rows.length);
  });

  it('refuses a row that states is_sensitive without saying why', () => {
    expect(
      findingOf(() =>
        build(
          source((s) => {
            detectorIn(s, 'D-09').is_sensitive = { value: false };
          }),
          { sourceFile: 'synthetic.json' },
        ),
      ),
    ).toBe('is-sensitive-without-a-reason');
  });
});

// -----------------------------------------------------------------------------
// THE THREE STATES, AND NO FLOATS
// -----------------------------------------------------------------------------

describe('a value M07 does not give is null and says so', () => {
  it('never carries a value on an unstated parameter', () => {
    for (const row of GENERATED.rows)
      for (const [k, p] of parametersOf(row))
        if (p.state === 'unstated') expect(p.value, `${row.detector}.${k}`).toBeNull();
  });

  it('never carries a null on a stated parameter', () => {
    for (const row of GENERATED.rows)
      for (const [k, p] of parametersOf(row))
        if (p.state === 'stated') expect(p.value, `${row.detector}.${k}`).not.toBeNull();
  });

  it('distinguishes not_applicable from unstated, and reasons every not_applicable', () => {
    // `unstated` sends a later session to find the number M07 owes;
    // `not_applicable` tells them there was never one to find.
    let seen = 0;
    for (const row of GENERATED.rows)
      for (const [k, p] of parametersOf(row))
        if (p.state === 'not_applicable') {
          seen += 1;
          expect(p.value, `${row.detector}.${k}`).toBeNull();
          expect((p.reason ?? '').length, `${row.detector}.${k}`).toBeGreaterThan(0);
        }
    expect(seen).toBeGreaterThan(0);
  });

  it('reports honestly which rows carry a stated number and which carry none', () => {
    // The state of OQ-M7-02 rather than a gap in the transcription. M07:
    // "Every threshold in section 3.2 is currently a number from the dossier
    // or from judgment", and most of them are not written down.
    const withNumbers = GENERATED.rows.filter((r) =>
      parametersOf(r).some(([, p]) => p.state === 'stated' && typeof p.value === 'number'),
    );
    expect(withNumbers.length).toBe(GENERATED.counts['rows_with_at_least_one_stated_number']);
    expect(GENERATED.rows.length - withNumbers.length).toBe(
      GENERATED.counts['rows_with_no_stated_number'],
    );
    expect(withNumbers.map((r) => r.detector)).toEqual([
      'D-01',
      'D-02',
      'D-09',
      'D-16',
      'D-12',
      'D-13',
      'D-18',
    ]);
  });

  it('carries no float anywhere, and carries the decimals of M07 as basis points', () => {
    const floats: string[] = [];
    const walk = (v: unknown, where: string): void => {
      if (typeof v === 'number') {
        if (!Number.isInteger(v)) floats.push(`${where} = ${v}`);
        return;
      }
      if (Array.isArray(v)) {
        v.forEach((x, i) => walk(x, `${where}[${i}]`));
        return;
      }
      if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) walk(x, `${where}.${k}`);
    };
    walk(GENERATED, '$');
    expect(floats).toEqual([]);

    // M07 writes -0.8 and -0.95 as decimals. A Pearson correlation is a pure
    // ratio, so basis points express both exactly with no rounding at all.
    expect(param(rowFor('D-02'), 'correlation_floor_bp').value).toBe(-8000);
    expect(param(rowFor('D-13'), 'correlation_floor_bp').value).toBe(-9500);
  });

  it('scores severity on the 1 to 5 scale of M07, per CONDITION where M07 does', () => {
    // "Severity is contextual, not per-detector", and moving the output of a
    // detector from 3 to 4 changes who gets held. So a bare per-detector
    // integer would contradict M07 in the one place this slice treats as money.
    let contextual = 0;
    for (const row of GENERATED.rows) {
      const s = param(row, 'severity');
      expect(s, `${row.detector} states no severity`).toBeDefined();
      if (s.state !== 'contextual') continue;
      contextual += 1;
      expect(s.value, row.detector).toBeNull();
      for (const c of s.cases ?? []) {
        expect(Number.isInteger(c.value), `${row.detector} case`).toBe(true);
        expect(c.value as number).toBeGreaterThanOrEqual(1);
        expect(c.value as number).toBeLessThanOrEqual(5);
      }
    }
    expect(contextual).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
// THE POSTURE OF OQ-M7-02, RECORDED AND UNEXERCISED
// -----------------------------------------------------------------------------

describe('the posture is recorded and its contested half is not resolved', () => {
  it('records the recommendation with its cite', () => {
    expect(GENERATED.posture.recommendation.quote).toContain('recall over precision');
  });

  it('leaves the routing half contested, with the four M07 lines that answer it otherwise', () => {
    // Read literally, "everything above severity 3 going to the digest" sends
    // severity 4 and 5 to the digest. That is the band G-HOLD-REQUIRED reads to
    // HOLD A PAYOUT, the band SD-M7-02 gives sla_due_at to, and it is severity
    // 1 that M07 twice sends to the digest. It bears on money, so this seed
    // writes neither reading.
    const routing = GENERATED.posture.routing;
    expect(routing.state).toBe('contested');
    expect(routing.value).toBeNull();
    expect(routing.counter_cites.length).toBe(4);
  });

  it('refuses a source that quietly resolves it', () => {
    expect(
      findingOf(() =>
        build(
          source((s) => {
            const routing = s.posture?.routing;
            if (!routing) throw new Error('the fixture records no posture');
            routing.state = 'stated';
            routing.value = 'digest';
          }),
          { sourceFile: 'synthetic.json' },
        ),
      ),
    ).toBe('contested-posture-resolved');
  });
});

// -----------------------------------------------------------------------------
// THE COMMITTED ARTIFACT IS WHAT ITS SOURCE GENERATES
// -----------------------------------------------------------------------------

describe('the generated rows file cannot drift from its source', () => {
  it('regenerates byte-identically, which is what --check asserts in CI', () => {
    expect(serialize(build(SOURCE_TEXT, { sourceFile: SOURCE_FILE }))).toBe(ROWS_TEXT);
  });

  it('exits 0 on --check against the committed pair', () => {
    const out = execFileSync('node', [GENERATOR, SOURCE_FILE, '--check', ROWS_FILE], {
      encoding: 'utf8',
    });
    expect(out).toContain('is up to date');
  });

  it('gives every row exactly the columns detector_definitions declares', () => {
    for (const row of GENERATED.rows)
      expect(Object.keys(row).sort()).toEqual([...ROW_COLUMNS].sort());
  });

  it('writes v1 and a null effective_to on every row, from one declared default', () => {
    for (const row of GENERATED.rows) {
      expect(row.version).toBe('v1');
      expect(row.effective_to).toBeNull();
      expect(row.effective_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(new Set(GENERATED.rows.map((r) => r.effective_from)).size).toBe(1);
  });

  it('keys uniquely on (detector, version), which is the primary key of the table', () => {
    const keys = GENERATED.rows.map((r) => `${r.detector} ${r.version}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// -----------------------------------------------------------------------------
// THE SEEDED VIOLATIONS
// -----------------------------------------------------------------------------

const CASES: Array<[string, string, (s: SourceFile) => void]> = [
  [
    'it has not been transcribed, which is the positive statement of the transcriber',
    'source-not-transcribed',
    (s) => {
      s.status = 'awaiting-transcription';
    },
  ],
  [
    'it has no id',
    'source-has-no-id',
    (s) => {
      delete s.id;
    },
  ],
  [
    'the detector list is null rather than empty, nobody-has-read versus M07-names-none',
    'detector-list-not-transcribed',
    (s) => {
      s.detectors = null;
    },
  ],
  [
    'the provenance does not say who read the authority',
    'provenance-not-transcribed',
    (s) => {
      delete s.provenance?.read_by;
    },
  ],
  [
    'the provenance names an authority other than M07',
    'provenance-names-another-authority',
    (s) => {
      if (s.provenance) s.provenance.authority = 'docs/plans/M06-admin-ops-console.md';
    },
  ],
  [
    'the authority digest disagrees with the authority on disk',
    'authority-digest-disagrees',
    (s) => {
      if (s.provenance) s.provenance.authority_sha256 = 'f'.repeat(64);
    },
  ],
  [
    'a NOT NULL column M07 gives no value for is declared without a reason',
    'chosen-value-without-a-reason',
    (s) => {
      if (s.row_defaults?.version) s.row_defaults.version.reason = '';
    },
  ],
  [
    'a chosen value wears a citation, the defect the whole file exists to prevent',
    'chosen-value-carries-a-cite',
    (s) => {
      const v = s.row_defaults?.version;
      if (!v) throw new Error('the fixture declares no version');
      v.cite = `${AUTHORITY}:395`;
      v.quote = 'Hard links plus KYC dedupe';
    },
  ],
  [
    'a NOT NULL column is not declared at all',
    'row-defaults-not-transcribed',
    (s) => {
      delete s.row_defaults?.effective_to;
    },
  ],
  [
    'a row default states a state the vocabulary does not hold',
    'row-default-state-unknown',
    (s) => {
      if (s.row_defaults?.version) s.row_defaults.version.state = 'transcribed';
    },
  ],
  [
    'the effective date is not a date',
    'effective-from-not-a-date',
    (s) => {
      if (s.row_defaults?.effective_from) s.row_defaults.effective_from.value = 'launch';
    },
  ],
  [
    'a seed supersedes itself on arrival by writing a non-null effective_to',
    'effective-to-not-null-on-a-seed',
    (s) => {
      if (s.row_defaults?.effective_to) s.row_defaults.effective_to.value = '2027-01-01';
    },
  ],
  [
    'the posture is not recorded at all',
    'posture-not-recorded',
    (s) => {
      delete s.posture;
    },
  ],
  [
    'the contested reading is stated with no counter-cites to support the contest',
    'contested-posture-unsupported',
    (s) => {
      if (s.posture?.routing) s.posture.routing.counter_cites = [];
    },
  ],
  [
    'the two refused sentences are omitted rather than named',
    'refusals-not-recorded',
    (s) => {
      delete s.refusals;
    },
  ],
  [
    'a refusal names no reason',
    'refusal-without-a-reason',
    (s) => {
      if (s.refusals?.auto_enforce?.[0]) s.refusals.auto_enforce[0].reason = '';
    },
  ],
  [
    'a detector id is not a D-nn',
    'detector-id-malformed',
    (s) => {
      detectorIn(s, 'D-05').detector = 'D5';
    },
  ],
  [
    'a detector is seeded twice',
    'detector-seeded-twice',
    (s) => {
      (s.detectors ?? []).push(JSON.parse(JSON.stringify(detectorIn(s, 'D-05'))) as SourceDetector);
      s.declared = { ...s.declared, detector_count: 19 };
    },
  ],
  [
    'the name of a detector is not cited at all',
    'detector-field-uncited',
    (s) => {
      // BOTH keys go. Removing only `cite` is caught earlier and more
      // specifically by `quote-without-cite`, which is the right answer to a
      // different question: a quote with nothing to resolve it against. This
      // finding is about a FIELD that carries no citation at all.
      detectorIn(s, 'D-05').name = {};
    },
  ],
  [
    'a detector does not locate its own row in M07',
    'detector-row-not-located',
    (s) => {
      detectorIn(s, 'D-05').m07_row = 'section 3.2';
    },
  ],
  [
    'a detector cites a row M07 holds another detector on',
    'detector-row-cite-disagrees',
    (s) => {
      detectorIn(s, 'D-05').m07_row = `${AUTHORITY}:113`;
    },
  ],
  [
    'a detector does not state is_sensitive at all',
    'is-sensitive-not-stated',
    (s) => {
      delete detectorIn(s, 'D-05').is_sensitive;
    },
  ],
  [
    'a detector carries no parameters, so no run can record what it ran under',
    'detector-has-no-parameters',
    (s) => {
      detectorIn(s, 'D-05').parameters = {};
    },
  ],
  [
    'a detector is silent about the status it writes, which INV-M7-02 binds for all',
    'detector-does-not-state-its-flag-status',
    (s) => {
      delete paramsIn(s, 'D-05')['flag_status'];
    },
  ],
  [
    'a flag status is left unstated rather than settled by the invariant',
    'flag-status-not-settled',
    (s) => {
      const p = paramIn(s, 'D-05', 'flag_status');
      p.state = 'unstated';
      p.value = null;
    },
  ],
  [
    'a parameter is a bare value rather than a cited entry',
    'parameter-not-an-entry',
    (s) => {
      paramsIn(s, 'D-05')['min_sequences'] = 12 as unknown as SourceParameter;
    },
  ],
  [
    'a parameter states a state the vocabulary does not hold',
    'parameter-state-unknown',
    (s) => {
      paramIn(s, 'D-05', 'min_sequences').state = 'tbd';
    },
  ],
  [
    'a parameter states a unit the vocabulary does not hold, which is how a float sneaks in',
    'parameter-unit-unknown',
    (s) => {
      paramIn(s, 'D-05', 'min_sequences').unit = 'percent';
    },
  ],
  [
    'a parameter has no value key at all, which reads as unstated and is not',
    'parameter-has-no-value-key',
    (s) => {
      delete paramIn(s, 'D-05', 'min_sequences').value;
    },
  ],
  [
    'a parameter is stated and null, unstated wearing the clothes of a transcription',
    'stated-parameter-is-null',
    (s) => {
      paramIn(s, 'D-05', 'scope').value = null;
    },
  ],
  [
    'a number M07 does not give is supplied quietly, the finding this seed exists to make',
    'unstated-parameter-has-a-value',
    (s) => {
      paramIn(s, 'D-05', 'min_sequences').value = 12;
    },
  ],
  [
    'a not_applicable parameter carries a value',
    'not-applicable-parameter-has-a-value',
    (s) => {
      paramIn(s, 'D-12', 'severity').value = 3;
    },
  ],
  [
    'a not_applicable parameter does not say why there was never a number to find',
    'not-applicable-without-a-reason',
    (s) => {
      delete paramIn(s, 'D-12', 'severity').reason;
    },
  ],
  [
    'a contextual severity is flattened to one number, which M07 says it is not',
    'contextual-parameter-has-a-scalar',
    (s) => {
      paramIn(s, 'D-01', 'severity').value = 3;
    },
  ],
  [
    'a contextual parameter names no case, so it states nothing at all',
    'contextual-parameter-without-cases',
    (s) => {
      paramIn(s, 'D-01', 'severity').cases = [];
    },
  ],
  [
    'a contextual case is uncited at all',
    'contextual-case-uncited',
    (s) => {
      // Both keys, for the reason `detector-field-uncited` states above.
      (paramIn(s, 'D-01', 'severity').cases ?? [])[0] = { value: 3 };
    },
  ],
  [
    'a severity is scored off the 1 to 5 scale of M07, and severity is read as money',
    'severity-out-of-scale',
    (s) => {
      (paramIn(s, 'D-01', 'severity').cases ?? [])[0] = {
        ...(paramIn(s, 'D-01', 'severity').cases ?? [])[0],
        value: 6,
      };
    },
  ],
  [
    'a float reaches the seed, where money is integer cents and a ratio is basis points',
    'float-in-seed',
    (s) => {
      paramIn(s, 'D-02', 'correlation_floor_bp').value = -0.8;
    },
  ],
  [
    'a quote is carried with no cite to resolve it against',
    'quote-without-cite',
    (s) => {
      delete paramIn(s, 'D-05', 'min_sequences').cite;
    },
  ],
  [
    'a cite is carried with no quote to look for',
    'cite-without-quote',
    (s) => {
      delete paramIn(s, 'D-05', 'min_sequences').quote;
    },
  ],
  [
    'a cite is not a location',
    'cite-not-a-location',
    (s) => {
      paramIn(s, 'D-05', 'min_sequences').cite = 'M07 section 3.2';
    },
  ],
  [
    'a cite points outside the authority, so the seed could cite a file it wrote itself',
    'cite-outside-the-authority',
    (s) => {
      paramIn(s, 'D-05', 'min_sequences').cite = 'packages/db/src/seed/detectors/README.md:1';
    },
  ],
  [
    'a cite runs past the end of the authority',
    'cite-past-end-of-file',
    (s) => {
      paramIn(s, 'D-05', 'min_sequences').cite = `${AUTHORITY}:999999`;
    },
  ],
  [
    'a quote is empty, which would resolve against every line',
    'quote-empty',
    (s) => {
      paramIn(s, 'D-05', 'min_sequences').quote = '';
    },
  ],
  [
    'the declared count disagrees with the rows, the check that catches a deletion',
    'declared-count-disagrees',
    (s) => {
      s.declared = { ...s.declared, detector_count: 19 };
    },
  ],
  [
    'the declared counts are not stated at all',
    'declared-counts-not-transcribed',
    (s) => {
      delete s.declared;
    },
  ],
];

describe('the source file is refused when', () => {
  it.each(CASES)('%s', (_label, finding, mutate) => {
    expect(findingOf(() => build(source(mutate), { sourceFile: 'synthetic.json' }))).toBe(finding);
  });

  it('is not JSON at all', () => {
    expect(findingOf(() => build('{not json', { sourceFile: 'synthetic.json' }))).toBe(
      'source-not-json',
    );
  });
});

// -----------------------------------------------------------------------------
// THE FINDINGS NO SOURCE FILE CAN REACH, NAMED WITH THEIR PROOF
// -----------------------------------------------------------------------------

describe('every finding the generator can produce is seeded, or is named with its proof', () => {
  const GENERATOR_TEXT = readFileSync(GENERATOR, 'utf8');

  /**
   * Reached through an exported function rather than through a source file,
   * because the source path cannot get there. Each is exercised below rather
   * than merely listed.
   */
  const REACHED_DIRECTLY = [
    'no-citations',
    'authority-section-not-found',
    'authority-names-no-detector',
  ];

  /**
   * BACKSTOPS. The generator BUILDS these rows itself, from `ROW_COLUMNS` and
   * from `describe()`, so no source file can make a row miss a column, carry a
   * column `detector_definitions` does not declare, or hold an empty
   * description: `describe()` interpolates the quote of the name, which
   * `detector-field-uncited` already requires, and an uncited name is refused
   * before `describe()` runs.
   *
   * They are kept because a later change to `generate` could reach them, and
   * the proof is stated here rather than shipping a seed that fails on a
   * different finding and looks like coverage. This is the treatment
   * `trading-calendar-generator.test.ts` gives `absorbed-session-not-claimed`,
   * and if any of them becomes reachable it owes a seed of its own.
   */
  const UNREACHABLE_BACKSTOPS = [
    'row-has-a-column-detector_definitions-does-not',
    'row-is-missing-a-column',
    'row-has-no-description',
  ];

  it('has a seed, a direct reach, or a stated proof for every reject() in the generator', () => {
    const emitted = new Set(
      [...GENERATOR_TEXT.matchAll(/reject\(\s*\n?\s*'([a-z0-9_-]+)'/g)].map((m) => m[1] ?? ''),
    );
    expect(emitted.size).toBeGreaterThan(40);
    const covered = new Set([
      ...CASES.map(([, finding]) => finding),
      'source-not-json',
      'detector-named-by-m07-and-not-seeded',
      'detector-seeded-and-not-named-by-m07',
      'seed-order-disagrees-with-m07',
      'quote-not-at-the-cite',
      'flag-status-other-than-open',
      'parameter-implies-enforcement',
      'three-valued-trap',
      'is-sensitive-without-a-reason',
      'contested-posture-resolved',
      ...REACHED_DIRECTLY,
      ...UNREACHABLE_BACKSTOPS,
    ]);
    expect([...emitted].filter((f) => !covered.has(f)).sort()).toEqual([]);
  });

  it('reaches no-citations directly, because checkPosture guarantees at least one', () => {
    expect(findingOf(() => checkCitations([], () => ''))).toBe('no-citations');
  });

  it('reaches authority-section-not-found on an authority with no 3.2 heading', () => {
    expect(
      findingOf(() => detectorsNamedByTheAuthority('# M7\n\n### 3.1 Entity resolution\n')),
    ).toBe('authority-section-not-found');
  });

  it('reaches authority-names-no-detector on a section 3.2 holding no D-nn row', () => {
    expect(
      findingOf(() =>
        detectorsNamedByTheAuthority('### 3.2 The detector set\n\n| ID | Detector |\n|---|---|\n'),
      ),
    ).toBe('authority-names-no-detector');
  });
});
