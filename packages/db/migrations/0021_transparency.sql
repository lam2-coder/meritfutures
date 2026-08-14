-- =============================================================================
-- 0021_transparency
-- =============================================================================
-- Not a money-path file, and it is the one whose output is hardest to take
-- back. Four things worth the careful read:
--
--   1. A PASS RATE IS NOT A NUMBER, IT IS A CHOICE OF DENOMINATOR, and the
--      choices are all defensible and move the answer by tens of points
--      (AS-M12-01). SD-M12-01 stores the definition as a versioned row with an
--      ADR reference, which is what converts "we compute it honestly" from a
--      promise into an artifact.
--   2. published_statistics IS APPEND-ONLY AND NEVER UPDATED. A correction is
--      a RESTATEMENT that points at what it restates. There is no approval
--      step between computation and publication, ON PURPOSE.
--   3. numerator and denominator are stored ALONGSIDE the ratio, because a
--      published ratio without its components cannot be checked by the reader,
--      and A READER WHO CANNOT CHECK IS BEING ASKED TO TRUST, which is the
--      thing this module exists to avoid.
--   4. min_sample lives in the definition row rather than in code because it
--      is A PUBLICATION POLICY, not an implementation detail.
--   5. THE PUBLISHED FIGURE IS bigint WITH A UNIT (ADR-031), not numeric. Its
--      no-floats exemption is retired: all seven ruled statistics are exactly
--      representable as integers, and for ST-03 and ST-04 the column holds
--      MONEY on a public surface.
--   6. A ROW CARRIES ONE `measure` (ADR-032), because ST-04, ST-05 and ST-06
--      each publish two figures and M12 says neither is published alone. The
--      "alone" half is a multi-row invariant and lives in 0027.
--
-- Deltas folded: SD-M12-01, SD-M12-02, SD-M12-03, SD-M12-04
-- Amended by:    ADR-031 (value, value_unit, statistic_unit)
--                ADR-032 (measure, statistic_definitions.measures)
--
-- effective_from on a definition is ALWAYS IN THE FUTURE at write time
-- (INV-M12-07). A definition that takes effect retroactively is a definition
-- chosen after seeing the number it produces.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- measures_are_distinct
-- -----------------------------------------------------------------------------
-- A CHECK constraint may not contain a subquery, and duplicate-detection over
-- an array needs one. IMMUTABLE because it reads nothing outside its argument,
-- which is what makes it legal in a CHECK rather than merely accepted there.
CREATE FUNCTION measures_are_distinct(m statistic_measure[]) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT cardinality(m) = (SELECT count(DISTINCT x) FROM unnest(m) AS x);
$$;

-- -----------------------------------------------------------------------------
-- statistic_definitions                                         -- SD-M12-01
-- -----------------------------------------------------------------------------
CREATE TABLE statistic_definitions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stat_code        text NOT NULL,
  version          integer NOT NULL CHECK (version > 0),
  title            text NOT NULL,

  -- THE TWO SPECS ARE THE STATISTIC. Both required, both prose-precise, and
  -- the denominator is always on the surface.
  numerator_spec   text NOT NULL,
  denominator_spec text NOT NULL,

  exclusions       text[] NOT NULL DEFAULT '{}',
  window_spec      text NOT NULL,   -- trailing window AND lifetime forms
  grain            text NOT NULL,

  -- SD-M12-01. A PUBLICATION POLICY, not an implementation detail. Below it
  -- the statistic is suppressed rather than published with a wide error bar
  -- nobody reads.
  min_sample       integer NOT NULL CHECK (min_sample > 0),       -- SD-M12-01

  -- ADR-032. THE MEASURE SET THIS DEFINITION DECLARES, and the thing the
  -- completeness trigger in 0027 checks a publish run against.
  --
  -- It is on the DEFINITION rather than in code because it is part of what the
  -- statistic IS. ST-04 is not "average payout, and median as a nice extra";
  -- it is a definition whose published form is two figures, and a version of
  -- it that published one would be a different definition. Declaring the set
  -- beside numerator_spec and denominator_spec is what lets the database
  -- enforce "neither is published alone" instead of a reviewer remembering it.
  --
  --   ST-01, ST-02, ST-07  {rate}
  --   ST-03                {total}
  --   ST-04                {mean, median}
  --   ST-05, ST-06         {p50, p95}
  --
  -- Changing this set on a live statistic is a new definition VERSION, by the
  -- same rule that governs the specs: statistic_definitions rows are versioned
  -- and superseded, never edited in place.
  measures         statistic_measure[] NOT NULL,                  -- ADR-032

  method_body_mdx  text NOT NULL,   -- the published methodology page
  adr_ref          text NULL,       -- the ruling that fixed this definition

  effective_from   date NOT NULL,
  superseded_by    uuid NULL REFERENCES statistic_definitions(id)
                     ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT statistic_definitions_no_self_supersede CHECK (
    superseded_by IS NULL OR superseded_by <> id
  ),

  -- A definition that declares no measure publishes nothing, and a definition
  -- that declares the same measure twice makes the completeness check in 0027
  -- ambiguous about what "every measure" counted.
  --
  -- cardinality(), NOT array_length(). array_length(ARRAY[]::x[], 1) is NULL,
  -- NULL >= 1 is NULL, and a CHECK that evaluates to NULL PASSES. Written the
  -- obvious way this constraint admits the empty set, which is the one value
  -- it exists to reject: an empty declared set makes STAT-C1 vacuous, so a
  -- statistic could publish nothing at all and satisfy "every measure it
  -- declares". Caught by testing the constraint rather than reading it.
  CONSTRAINT statistic_definitions_measures_nonempty CHECK (
    cardinality(measures) >= 1
  ),
  CONSTRAINT statistic_definitions_measures_distinct CHECK (
    measures_are_distinct(measures)
  )
);

CREATE UNIQUE INDEX statistic_definitions_code_version_uq
  ON statistic_definitions (stat_code, version);

CREATE UNIQUE INDEX statistic_definitions_live_uq
  ON statistic_definitions (stat_code) WHERE superseded_by IS NULL;

COMMENT ON TABLE statistic_definitions IS
  'SD-M12-01. effective_from is always in the future at write time '
  '(INV-M12-07): a definition chosen after seeing its own number is not a '
  'definition.';

-- -----------------------------------------------------------------------------
-- published_statistics                                          -- SD-M12-02
-- -----------------------------------------------------------------------------
-- INV-M12-03, INV-M12-12. APPEND ONLY, NEVER UPDATED.
--
-- The first published number publishes whatever it says. There is no approval
-- step between computation and publication, and that is a design decision
-- rather than an oversight: an approval step is a place where an inconvenient
-- number stops.
CREATE TABLE published_statistics (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stat_code          text NOT NULL,
  definition_version integer NOT NULL CHECK (definition_version > 0),

  window_start_day   date NOT NULL,
  window_end_day     date NOT NULL,
  as_of_trading_day  date NOT NULL,

  -- ADR-032. WHICH FIGURE THIS ROW CARRIES.
  --
  -- Without it, ST-04's mean and median, and ST-05's and ST-06's p50 and p95,
  -- collide on published_statistics_window_uq below and the second one is
  -- unwritable. The rejected alternative was separate stat_codes per figure
  -- (ST-04-mean, ST-04-median), which needs no schema change and is worse: it
  -- makes the pair INDEPENDENTLY PUBLISHABLE, and M12 forbids exactly that.
  -- See ADR-032.
  --
  -- The measure a row carries must be one its definition declares, and a
  -- publish run that emits one measure for a stat_code must emit ALL of them.
  -- That is a multi-row invariant and it lives with the other multi-row
  -- invariants, as a deferred constraint trigger in 0027.
  measure            statistic_measure NOT NULL,                  -- ADR-032

  -- ADR-031. BIGINT, AND THE NO-FLOATS EXEMPTION THIS COLUMN HELD IS GONE.
  --
  -- It was `value_numeric numeric`, authorized as an exemption on the reading
  -- that a published rate is not expressible as an integer. All seven ruled
  -- statistics are exactly representable as integers under the corpus's own
  -- conventions:
  --
  --   ST-01, ST-02, ST-07  rates, in integer BASIS POINTS
  --   ST-03, ST-04         money, in INTEGER CENTS
  --   ST-05, ST-06         durations, in WHOLE SECONDS
  --
  -- THE CENTS CASE IS THE ONE THAT DECIDED IT. For ST-03 and ST-04 this column
  -- holds money on a public surface, and DATA_MODEL section 1 says money is
  -- bigint integer cents, never numeric and never float. An exemption that
  -- covers a money column is not an exemption, it is a hole with a ruling
  -- attached.
  --
  -- RENAMED from value_numeric, because the old name describes a type this
  -- column no longer has. A column called `value_numeric` holding a bigint is
  -- a lie that survives every grep a future reader runs.
  value              bigint NULL,                                 -- ADR-031

  -- Forced by the type, exactly as numerator_unit was: a bare bigint is
  -- ambiguous between 1470 basis points and 1470 cents, and this is a surface
  -- Merit cannot restate quietly. Same statistic_unit type as the numerator
  -- below, because two vocabularies for one concept is how they drift.
  value_unit         statistic_unit NULL,                         -- ADR-031

  -- SD-M12-02. STORED ALONGSIDE THE RATIO. A published ratio without its
  -- components cannot be checked by the reader.
  --
  -- BIGINT, NOT NUMERIC, AND THE REASON IS NOT TIDINESS.
  --
  -- Across the seven ruled statistics the numerator is one of exactly three
  -- things and every one of them is an integer:
  --
  --   count             ST-01, ST-02, ST-07 (evaluations, accounts, requests)
  --   cents             ST-03, ST-04 (sum of trader_cents across settled
  --                     payouts). THIS IS MONEY. DATA_MODEL section 1 says
  --                     money is bigint integer cents and "never numeric,
  --                     never float", and it does not stop being money
  --                     because it is being published
  --   duration_seconds  ST-05, ST-06 (elapsed request-to-credit and
  --                     request-to-settlement)
  --
  -- The denominator is a COUNT in all six statistics that have one, and ST-03
  -- has none at all because it is a total rather than a rate. A numeric
  -- denominator permits 249.7, which is not a number of accounts, and it is
  -- compared against min_sample (250 on ST-01, 100 on ST-02, 50 elsewhere),
  -- which is an integer. A sample gate decided on a rounding is a sample gate
  -- that does not gate.
  --
  -- numerator_unit is FORCED BY THE TYPE, not added alongside it: DATA_MODEL
  -- section 1 makes a quantity column with no unit a review reject, and a
  -- bigint numerator is otherwise ambiguous between cents and a count on a
  -- surface Merit cannot restate quietly. It carries the SAME statistic_unit
  -- type as value_unit above (ADR-031); the standalone CHECK list it used to
  -- carry was the second of two vocabularies for one concept.
  numerator          bigint NULL,                                 -- SD-M12-02
  numerator_unit     statistic_unit NULL,                         -- SD-M12-02
  denominator        bigint NULL CHECK (denominator IS NULL OR denominator >= 0),
                                                                  -- SD-M12-02
  sample_size        integer NOT NULL CHECK (sample_size >= 0),

  grain_key          text NULL,   -- per plan, per size, or null for global

  -- Set when the value is withheld. A suppressed row EXISTS, which is what
  -- makes suppression visible rather than a gap in a series.
  suppressed_reason  text NULL,

  -- A correction is a NEW ROW pointing at what it restates.
  restatement_of     uuid NULL REFERENCES published_statistics(id)
                       ON DELETE RESTRICT,

  computed_at        timestamptz NOT NULL DEFAULT now(),

  -- SD-M12-02. Makes reproduction VERIFIABLE rather than merely possible.
  input_digest       bytea NOT NULL,                              -- SD-M12-02

  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT published_statistics_window_ordered CHECK (
    window_end_day >= window_start_day
  ),

  -- A row either publishes a value with its components, or states why it did
  -- not. Never neither.
  --
  -- The denominator is NOT required, and that is a correction rather than a
  -- relaxation: ST-03 (total paid to traders) has NO DENOMINATOR by ruling,
  -- because it is a total and the surface says so rather than implying a rate.
  -- Requiring one here made ST-03 unpublishable.
  CONSTRAINT published_statistics_value_or_suppression CHECK (
    (suppressed_reason IS NULL
       AND value IS NOT NULL
       AND value_unit IS NOT NULL
       AND numerator IS NOT NULL
       AND numerator_unit IS NOT NULL)
    OR
    (suppressed_reason IS NOT NULL AND value IS NULL)
  ),

  -- A numerator without its unit is a number whose meaning depends on which
  -- statistic the reader thinks they are looking at.
  CONSTRAINT published_statistics_numerator_has_unit CHECK (
    (numerator IS NULL) = (numerator_unit IS NULL)
  ),

  -- ADR-031. The same rule for the published figure itself, which is the one a
  -- reader actually quotes. 1470 is 14.70 percent or $14.70 depending on a
  -- column nobody made mandatory.
  CONSTRAINT published_statistics_value_has_unit CHECK (
    (value IS NULL) = (value_unit IS NULL)
  ),

  CONSTRAINT published_statistics_no_self_restatement CHECK (
    restatement_of IS NULL OR restatement_of <> id
  )
);

CREATE INDEX published_statistics_code_idx
  ON published_statistics (stat_code, as_of_trading_day DESC);
CREATE INDEX published_statistics_restatement_idx
  ON published_statistics (restatement_of) WHERE restatement_of IS NOT NULL;

-- One live publication per statistic per window per grain PER MEASURE. A
-- restatement is how a second one exists.
--
-- OI-02, closed by ADR-032. Three of the seven statistics publish two figures
-- at once and this index used to make the second one unwritable:
--
--   ST-04  mean AND median together. "Neither is published alone": a mean is
--          the number one large payout distorts, and a median alone hides that
--          large payouts happen at all
--   ST-05  p50 AND p95
--   ST-06  p50 AND p95
--
-- `measure` is what makes the pair expressible, and it is in this key rather
-- than only on the table because without it the uniqueness guarantee would
-- read "one row per window" while the table needs two.
--
-- WHAT THIS KEY DOES NOT DO, and why 0027 carries a trigger. Adding measure
-- makes the second row WRITABLE; it does nothing to make it REQUIRED. A run
-- that emits ST-04's mean and never emits its median satisfies every
-- constraint on this table, and publishes exactly the thing M12 forbids. That
-- is a multi-row invariant, so it is a deferred constraint trigger next to the
-- ledger zero-sum check rather than anything expressible here.
CREATE UNIQUE INDEX published_statistics_window_uq
  ON published_statistics (stat_code, definition_version, window_start_day,
                           window_end_day, coalesce(grain_key, ''), measure)
  WHERE restatement_of IS NULL;

-- -----------------------------------------------------------------------------
-- review_requests                                               -- SD-M12-03
-- -----------------------------------------------------------------------------
-- INV-M12-09. The compliance question a regulator or Trustpilot asks is NOT
-- "did you incentivize" but "WHO DID YOU INVITE, AND WERE THEY A
-- REPRESENTATIVE SET".
--
-- That question is answerable only from a table that records the trigger class
-- of EVERY invitation, INCLUDING THE UNFAVORABLE ONES (AS-M12-03). A table
-- containing only happy triggers answers the question badly and provably so.
CREATE TABLE review_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id       uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  trigger_event     text NOT NULL,

  -- The whole delta. 'unfavorable' rows are the ones that make the set
  -- representative, and they are the ones a review-farming design would omit.
  trigger_class     text NOT NULL CHECK (trigger_class IN (
                      'favorable', 'unfavorable', 'neutral'
                    )),                                           -- SD-M12-03

  sent_at           timestamptz NULL,
  suppressed_reason text NULL,
  provider_ref      text NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT review_requests_sent_or_suppressed CHECK (
    sent_at IS NOT NULL OR suppressed_reason IS NOT NULL
  )
);

CREATE INDEX review_requests_identity_idx ON review_requests (identity_id);

-- The representativeness query: invitations by trigger class over a period.
CREATE INDEX review_requests_class_idx
  ON review_requests (trigger_class, created_at DESC);

-- -----------------------------------------------------------------------------
-- proof_links                                                   -- SD-M12-04
-- -----------------------------------------------------------------------------
-- INV-M12-11, AS-M12-02. AN ON-CHAIN ADDRESS PUBLISHED AS PROOF IS A
-- PERMANENT, IRREVOCABLE DISCLOSURE.
--
-- It cannot be unpublished, it cannot be scoped after the fact, and everything
-- that address ever does becomes public commentary on Merit. The decision to
-- publish one needs an audited row WITH A WRITTEN SCOPE NOTE rather than a
-- link somebody added to a template.
CREATE TABLE proof_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN (
                'onchain_address', 'onchain_tx',
                'third_party_tracker', 'certificate_verify'
              )),
  label       text NOT NULL,
  url         text NOT NULL,

  -- NOT NULL. What this link does and does not prove. A proof link with no
  -- stated scope is a claim the reader gets to interpret.
  scope_note  text NOT NULL,                                      -- SD-M12-04

  enabled     boolean NOT NULL DEFAULT false,
  added_by    text NOT NULL,
  added_at    timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX proof_links_url_uq ON proof_links (url);
CREATE INDEX proof_links_enabled_idx ON proof_links (kind) WHERE enabled;

COMMIT;
