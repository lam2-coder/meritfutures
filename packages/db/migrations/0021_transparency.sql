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
--
-- Deltas folded: SD-M12-01, SD-M12-02, SD-M12-03, SD-M12-04
--
-- effective_from on a definition is ALWAYS IN THE FUTURE at write time
-- (INV-M12-07). A definition that takes effect retroactively is a definition
-- chosen after seeing the number it produces.
-- =============================================================================

BEGIN;

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

  method_body_mdx  text NOT NULL,   -- the published methodology page
  adr_ref          text NULL,       -- the ruling that fixed this definition

  effective_from   date NOT NULL,
  superseded_by    uuid NULL REFERENCES statistic_definitions(id)
                     ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT statistic_definitions_no_self_supersede CHECK (
    superseded_by IS NULL OR superseded_by <> id
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

  -- numeric, not bigint: these are ratios and counts, not money. The
  -- no-floats rule governs financial paths, and rounding a pass rate to cents
  -- would be the actual error.
  value_numeric      numeric NULL,

  -- SD-M12-02. STORED ALONGSIDE THE RATIO. A published ratio without its
  -- components cannot be checked by the reader.
  numerator          numeric NULL,                                -- SD-M12-02
  denominator        numeric NULL,                                -- SD-M12-02
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
  -- not. Never neither, and never a value with no denominator.
  CONSTRAINT published_statistics_value_or_suppression CHECK (
    (suppressed_reason IS NULL
       AND value_numeric IS NOT NULL
       AND numerator IS NOT NULL
       AND denominator IS NOT NULL)
    OR
    (suppressed_reason IS NOT NULL AND value_numeric IS NULL)
  ),

  CONSTRAINT published_statistics_no_self_restatement CHECK (
    restatement_of IS NULL OR restatement_of <> id
  )
);

CREATE INDEX published_statistics_code_idx
  ON published_statistics (stat_code, as_of_trading_day DESC);
CREATE INDEX published_statistics_restatement_idx
  ON published_statistics (restatement_of) WHERE restatement_of IS NOT NULL;

-- One live publication per statistic per window per grain. A restatement is
-- how a second one exists.
CREATE UNIQUE INDEX published_statistics_window_uq
  ON published_statistics (stat_code, definition_version, window_start_day,
                           window_end_day, coalesce(grain_key, ''))
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
