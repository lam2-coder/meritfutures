-- =============================================================================
-- 0008_risk
-- =============================================================================
-- Not a money-path file: nothing here holds an amount. It is read line by line
-- for a different reason, which is that every table below is EVIDENCE. A flag
-- is an accusation, and an accusation without the numbers behind it is one
-- Merit cannot defend in a dispute or act on with confidence.
--
-- Deltas folded: SD-M6-04, SD-M7-01, SD-M7-02, SD-M7-03, SD-M7-05
--
-- Ordering note: risk_flags is created here rather than later because
-- payout_requests.freeze_flag_id (SD-M5-01) references it, and 0010 must have
-- it. A freeze that cites no flag is an indefinite hold with a citation
-- nobody can look up.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- detector_definitions                                          -- SD-M7-03
-- -----------------------------------------------------------------------------
-- Three needs at once: INV-M7-04's provenance, M06's redaction strip list
-- (DEP-M6-03), and the ability to TUNE A THRESHOLD AS A DATA CHANGE WITH A
-- RECORDED EFFECTIVE DATE rather than as a deploy.
--
-- The last of those is the one that matters operationally. A threshold tuned
-- by deploy is a threshold whose history lives in git and whose "why did this
-- not fire in March" answer is an archaeology exercise.
CREATE TABLE detector_definitions (
  detector        text NOT NULL,
  version         text NOT NULL,
  parameters      jsonb NOT NULL,
  description     text NOT NULL,
  effective_from  date NOT NULL,
  effective_to    date NULL,

  -- Marks the parameters that MUST NEVER REACH A TRADER. Default true, because
  -- a detector parameter that leaks tells the adversary exactly where the line
  -- is, and defaulting to safe means a new detector is protected before anyone
  -- remembers to protect it.
  is_sensitive    boolean NOT NULL DEFAULT true,                 -- SD-M7-03

  created_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (detector, version),

  CONSTRAINT detector_definitions_range_ordered CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

CREATE INDEX detector_definitions_current_idx
  ON detector_definitions (detector) WHERE effective_to IS NULL;

-- -----------------------------------------------------------------------------
-- detector_runs
-- -----------------------------------------------------------------------------
-- Provenance for every flag, so "why did this not fire in March" is
-- answerable.
CREATE TABLE detector_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detector            text NOT NULL,
  detector_version    text NOT NULL,
  trading_day         date NOT NULL,
  started_at          timestamptz NULL,
  finished_at         timestamptz NULL,
  rows_scanned        integer NOT NULL DEFAULT 0 CHECK (rows_scanned >= 0),
  flags_raised        integer NOT NULL DEFAULT 0 CHECK (flags_raised >= 0),

  -- SD-M7-01. INV-M7-07. A DETECTOR WHOSE QUERY SILENTLY RETURNS NOTHING
  -- LOOKS EXACTLY LIKE A CLEAN NIGHT.
  --
  -- A schema change, a null-handling bug, or a threshold that no longer
  -- matches the data's shape all produce zero rows and zero alarms. Seeded
  -- synthetic positives are the only way to tell the difference, and their
  -- ABSENCE MUST BE A FAILURE STATE rather than a metric nobody reads
  -- (AS-M7-05).
  synthetic_expected  integer NOT NULL DEFAULT 0
                        CHECK (synthetic_expected >= 0),         -- SD-M7-01
  synthetic_found     integer NOT NULL DEFAULT 0
                        CHECK (synthetic_found >= 0),            -- SD-M7-01

  -- SD-M7-01 adds 'degraded'. It is a distinct state from 'failed' because a
  -- detector that ran, completed, and found fewer synthetics than it seeded
  -- did not fail: it produced an answer that must not be trusted. Those need
  -- different handling and a single failure state hides one inside the other.
  status              text NOT NULL CHECK (status IN (
                        'ok', 'failed', 'degraded'               -- SD-M7-01
                      )),

  created_at          timestamptz NOT NULL DEFAULT now(),

  -- SD-M7-01. The state and the counters must agree. A run that missed a
  -- seeded positive cannot claim 'ok', which is what makes the synthetic
  -- battery a control rather than a dashboard.
  CONSTRAINT detector_runs_synthetics_match_status CHECK (
    status <> 'ok' OR synthetic_found >= synthetic_expected
  )
);

CREATE INDEX detector_runs_detector_day_idx
  ON detector_runs (detector, trading_day DESC);

-- The morning read: anything that did not come back clean.
CREATE INDEX detector_runs_unhealthy_idx
  ON detector_runs (trading_day DESC) WHERE status <> 'ok';

-- -----------------------------------------------------------------------------
-- risk_flags
-- -----------------------------------------------------------------------------
-- Flags attach to HUMANS, not to accounts. account_id is set when a flag is
-- account-specific, and the identity is always there because that is the level
-- enforcement acts at.
CREATE TABLE risk_flags (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id        uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  account_id         uuid NULL REFERENCES accounts(id) ON DELETE RESTRICT,

  flag_type          text NOT NULL,   -- inverse_pair, copy_cluster, news_window,
                                      -- martingale, velocity, entity_cap,
                                      -- payment_velocity, name_mismatch,
                                      -- reset_velocity, affiliate_self_deal

  -- A SCORED QUEUE, NOT A BOOLEAN. Severity is what makes an SLA meaningful
  -- and what stops a queue from being worked in arrival order.
  severity           smallint NOT NULL CHECK (severity BETWEEN 1 AND 5),

  status             risk_flag_status NOT NULL DEFAULT 'open',

  -- Reserved: 'internal' or 'vendor:<name>', so a QuantSentry-class detector
  -- plugs in without a migration.
  source             text NOT NULL DEFAULT 'internal',

  detector_run_id    uuid NULL REFERENCES detector_runs(id) ON DELETE RESTRICT,

  -- THE NUMBERS BEHIND THE ACCUSATION, NEVER A BARE LABEL.
  evidence           jsonb NOT NULL,

  first_detected_on  date NOT NULL,
  resolved_at        timestamptz NULL,
  resolved_by        text NULL,
  resolution_note    text NULL,

  -- SD-M7-02. A SEVERITY-SCORED QUEUE WITH NO CLOCK IS A QUEUE THAT GROWS.
  --
  -- Severity 4 and 5 need a stated time-to-first-touch, or detection produces
  -- evidence nobody acts on, which is worse than no detection because it is
  -- DOCUMENTED NEGLIGENCE. first_touched_at is separate from resolved_at on
  -- purpose: "someone looked" and "someone decided" are different service
  -- levels and only the first can be promised in hours.
  sla_due_at         timestamptz NULL,                           -- SD-M7-02
  first_touched_at   timestamptz NULL,                           -- SD-M7-02

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- SD-M7-02. High severity carries a clock. Without this the column exists
  -- and the promise does not.
  CONSTRAINT risk_flags_high_severity_has_sla CHECK (
    severity < 4 OR sla_due_at IS NOT NULL
  ),

  -- A resolved flag carries who resolved it and why. Enforcement without a
  -- recorded reason is the thing every dispute turns on.
  CONSTRAINT risk_flags_resolution_is_explained CHECK (
    status NOT IN ('dismissed', 'enforced')
    OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL
        AND resolution_note IS NOT NULL)
  )
);

-- The queue's read path: worst first, oldest first within a severity.
CREATE INDEX risk_flags_queue_idx
  ON risk_flags (status, severity DESC, first_detected_on);
CREATE INDEX risk_flags_identity_idx ON risk_flags (identity_id);
CREATE INDEX risk_flags_type_idx ON risk_flags (flag_type);

-- SD-M7-02. The breach query: open, past due, nobody has touched it.
CREATE INDEX risk_flags_sla_breached_idx
  ON risk_flags (sla_due_at)
  WHERE first_touched_at IS NULL AND status IN ('open', 'investigating');

COMMENT ON TABLE risk_flags IS 'Retention: forever.';

-- -----------------------------------------------------------------------------
-- correlation_groups                                            -- SD-M7-05
-- -----------------------------------------------------------------------------
-- PAIRWISE CORRELATION IS DEFEATED BY ROTATING A THIRD LEG (AS-M7-02).
--
-- Group-level results have no home in a schema built around pairwise
-- identity_links, and inventing one at detection time means the result cannot
-- be reviewed, replayed, or explained.
--
-- This table is also a RESERVE control rather than only an abuse control, and
-- that is the strongest argument in the corpus for funding it: the risk engine
-- shows mean monthly payouts flat near $45.3K across every correlation level
-- while CVaR99 nearly doubles from $84.8K at rho=0.05 to $132.9K at rho=0.30.
-- THE TAIL IS ALL CORRELATION.
CREATE TABLE correlation_groups (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trading_day        date NOT NULL,

  -- The group as a set. An array rather than a join table because the group is
  -- the finding: decomposing it into rows makes "which accounts did this
  -- result cover" a query rather than a fact.
  member_account_ids uuid[] NOT NULL,

  method             text NOT NULL,

  -- numeric rather than bigint because these are STATISTICS, not money. The
  -- no-floats rule governs financial paths; a correlation coefficient is not
  -- one, and rounding it to cents would be the actual error.
  statistic          numeric NOT NULL,
  threshold          numeric NOT NULL,

  detector_run_id    uuid NULL REFERENCES detector_runs(id) ON DELETE RESTRICT,
  evidence           jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),

  -- A group of one is a pair detector with extra steps; a group of two is
  -- identity_links' job. This table starts at three.
  CONSTRAINT correlation_groups_is_a_group CHECK (
    array_length(member_account_ids, 1) >= 3
  )
);

CREATE INDEX correlation_groups_day_idx ON correlation_groups (trading_day DESC);
CREATE INDEX correlation_groups_members_idx
  ON correlation_groups USING gin (member_account_ids);

-- -----------------------------------------------------------------------------
-- evidence_packs
-- -----------------------------------------------------------------------------
-- Export is ITSELF AN AUDITED ACT, because an evidence pack contains
-- everything about a trader.
CREATE TABLE evidence_packs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  requested_by            text NOT NULL,
  reason                  text NOT NULL,
  content_sha256          bytea NOT NULL,

  -- Private object storage, signed URL only. Never a public path.
  storage_ref             text NOT NULL,
  generated_at            timestamptz NOT NULL DEFAULT now(),

  -- SD-M6-04. AS-M6-01. A PACK GIVEN TO A TRADER IN A DISPUTE IS A CHANNEL
  -- THAT DISCLOSES DETECTOR THRESHOLDS TO THE ADVERSARY WHO TRIGGERED THEM.
  --
  -- The audience must be a DECLARED, AUDITED PROPERTY of the export rather
  -- than a judgment made in the moment by whoever is answering the ticket at
  -- the time. Detector internals are internal-tier always (ADR-022): the
  -- richer the graph, the more a leak is worth.
  audience                text NOT NULL CHECK (audience IN (
                            'internal', 'trader', 'counsel', 'regulator'
                          )),                                    -- SD-M6-04
  redaction_profile       text NOT NULL,                         -- SD-M6-04
  includes_detector_detail boolean NOT NULL,                     -- SD-M6-04

  created_at              timestamptz NOT NULL DEFAULT now(),

  -- SD-M6-04. The rule, in DDL rather than in a handler: a pack destined for a
  -- trader may never carry detector detail. This is the one combination that
  -- must be unrepresentable, and it is the combination a hurried export would
  -- produce.
  CONSTRAINT evidence_packs_trader_gets_no_detector_detail CHECK (
    audience <> 'trader' OR includes_detector_detail = false
  )
);

CREATE INDEX evidence_packs_account_idx
  ON evidence_packs (account_id, generated_at DESC);
CREATE INDEX evidence_packs_audience_idx
  ON evidence_packs (audience, generated_at DESC);

COMMIT;
