-- =============================================================================
-- 0013_ingest
-- =============================================================================
-- Not a money-path file by table, but it is the file every money number is
-- computed from, and two things in it deserve the same attention:
--
--   1. SD-M2-03's disposition is A DECISION THE PARSER MUST MAKE EXPLICITLY.
--      Three of its four outcomes look identical in a directory listing, and
--      a corrected redelivery that is treated as a new file DOUBLE-APPLIES A
--      DAY.
--   2. SD-M2-04 keeps the vendor's stated session date BESIDE ours rather
--      than overwriting it. The engine is already immune to date arithmetic
--      by construction (R-01, R-05); what this buys is DETECTION OF
--      DISAGREEMENT, which is invisible if we silently resolve it in our
--      favour.
--
-- Deltas folded: SD-M2-03, SD-M2-04
--
-- PROVISIONAL (ADR-005): the ingest_files.kind set and the correction arrival
-- semantics both depend on what Rithmic actually delivers. M02 holds at
-- 'review' for exactly this reason.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- ingest_files
-- -----------------------------------------------------------------------------
-- THE QUARANTINE MACHINE for B4 #4. A file in 'quarantined' has committed NO
-- downstream rows, enforced by processing the whole file in one transaction.
CREATE TABLE ingest_files (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name                text NOT NULL,
  sha256                   bytea NOT NULL,

  -- PROVISIONAL: the real set depends on what the vendor delivers.
  kind                     text NOT NULL CHECK (kind IN (
                             'eod_report', 'fills', 'positions', 'unknown'
                           )),

  trading_day              date NULL,   -- parsed from content, null until known
  byte_size                bigint NOT NULL CHECK (byte_size >= 0),
  received_at              timestamptz NOT NULL DEFAULT now(),
  status                   ingest_file_status NOT NULL DEFAULT 'received',
  row_count                integer NULL CHECK (row_count >= 0),
  quarantine_reason        text NULL,
  applied_at               timestamptz NULL,

  -- SD-M2-03. A VENDOR REDELIVERY THAT IS NOT BYTE-IDENTICAL IS CURRENTLY
  -- INDISTINGUISHABLE FROM A NEW FILE.
  --
  -- The disposition is a four-way decision the parser must make EXPLICITLY,
  -- with the replaced file recorded. This is the most dangerous branch in M02:
  --
  --   new                 a day we have not seen
  --   duplicate_ignored   byte-identical redelivery, a no-op (the sha256
  --                       unique below makes this the cheap case)
  --   full_replacement    supersedes rather than deletes, emits
  --                       ingest.file_replaced, triggers replay forward
  --   correction_set      rows that correct an already-applied day
  --
  -- A row touching an already-applied day WITHOUT correction_of quarantines
  -- the whole file (AS-M2-02, GS-086). Merit would rather lose a day of data
  -- than double-apply one.
  replaces_ingest_file_id  uuid NULL REFERENCES ingest_files(id)
                             ON DELETE RESTRICT,                 -- SD-M2-03
  disposition              text NULL CHECK (disposition IN (
                             'new', 'duplicate_ignored',
                             'full_replacement', 'correction_set'
                           )),                                   -- SD-M2-03

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- SD-M2-03. A replacement names what it replaces, and only a replacement
  -- does. The two halves of the delta must agree or the audit chain has holes.
  CONSTRAINT ingest_files_replacement_names_target CHECK (
    (disposition IN ('full_replacement', 'duplicate_ignored')
       AND replaces_ingest_file_id IS NOT NULL)
    OR
    (disposition NOT IN ('full_replacement', 'duplicate_ignored')
       AND replaces_ingest_file_id IS NULL)
    OR disposition IS NULL
  ),

  CONSTRAINT ingest_files_no_self_replace CHECK (
    replaces_ingest_file_id IS NULL OR replaces_ingest_file_id <> id
  ),

  CONSTRAINT ingest_files_quarantine_is_explained CHECK (
    status <> 'quarantined' OR quarantine_reason IS NOT NULL
  ),

  -- SD-M2-03. A file cannot be applied without a stated disposition. This is
  -- the constraint that makes the decision explicit rather than default.
  CONSTRAINT ingest_files_applied_has_disposition CHECK (
    status <> 'applied' OR (disposition IS NOT NULL AND applied_at IS NOT NULL)
  )
);

-- RE-DELIVERY OF AN IDENTICAL FILE IS A NO-OP, which is what makes retries
-- safe. This index is the guarantee, not a helper for one.
CREATE UNIQUE INDEX ingest_files_sha256_uq ON ingest_files (sha256);

CREATE INDEX ingest_files_status_idx ON ingest_files (status);
CREATE INDEX ingest_files_trading_day_idx ON ingest_files (trading_day);
CREATE INDEX ingest_files_replaces_idx
  ON ingest_files (replaces_ingest_file_id) WHERE replaces_ingest_file_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- raw_ingest_rows
-- -----------------------------------------------------------------------------
-- IMMUTABLE LANDING ZONE. We keep the vendor's bytes because OUR
-- NORMALIZATION CAN BE WRONG AND THEIR FILE IS THE EVIDENCE.
CREATE TABLE raw_ingest_rows (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ingest_file_id  uuid NOT NULL REFERENCES ingest_files(id) ON DELETE RESTRICT,
  line_number     integer NOT NULL CHECK (line_number > 0),
  raw             jsonb NOT NULL,   -- parsed columns, verbatim values
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX raw_ingest_rows_file_line_uq
  ON raw_ingest_rows (ingest_file_id, line_number);

COMMENT ON TABLE raw_ingest_rows IS
  'Append-only. Retention: 24 months hot, then archived to object storage '
  'with the file digest.';

-- -----------------------------------------------------------------------------
-- fills
-- -----------------------------------------------------------------------------
-- APPEND-ONLY, INCLUDING CORRECTIONS. Retention: forever.
CREATE TABLE fills (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,

  platform            text NOT NULL DEFAULT 'rithmic',   -- B3 reservation
  platform_fill_id    text NOT NULL,
  order_id            text NULL,                         -- B3 reservation
  venue               text NULL,                         -- B3 reservation, MIC

  symbol              text NOT NULL,                     -- joins contract_specs
  side                text NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity            integer NOT NULL CHECK (quantity > 0),   -- contracts, never fractional

  -- EXACT RATIONAL PRICE, NEVER A FLOAT. Same discipline as money and for the
  -- same reason: a price that rounds is a P&L that disagrees with the vendor's.
  price_numerator     bigint NOT NULL,
  price_denominator   bigint NOT NULL CHECK (price_denominator > 0),

  executed_at         timestamptz NOT NULL,   -- vendor execution time

  -- RESOLVED THROUGH THE CALENDAR, never from the timestamp's UTC date.
  trading_day         date NOT NULL,

  correction_of       bigint NULL REFERENCES fills(id) ON DELETE RESTRICT,
  is_corrected        boolean NOT NULL DEFAULT false,

  ingest_file_id      uuid NOT NULL REFERENCES ingest_files(id) ON DELETE RESTRICT,
  raw_row_id          bigint NOT NULL REFERENCES raw_ingest_rows(id) ON DELETE RESTRICT,

  -- ARRIVAL time, which differs from executed_at on corrections. Both, because
  -- "when did it happen" and "when did we learn it" are different questions
  -- and a correction is exactly where they diverge.
  recorded_at         timestamptz NOT NULL DEFAULT now(),

  -- SD-M2-04. WHEN THE VENDOR STATES A SESSION DATE AND OUR CALENDAR
  -- CONTAINMENT DISAGREES, THAT DISAGREEMENT IS THE SINGLE MOST VALUABLE
  -- INGEST SIGNAL WE CAN COLLECT, and it is invisible if we simply overwrite
  -- with our own answer.
  --
  -- trading_day above stays OUR answer, because the engine must be
  -- deterministic. trading_day_vendor is theirs, and trading_day_source
  -- records which of the two produced the stored value:
  --
  --   calendar   our containment, vendor silent or agreeing
  --   vendor     the vendor's day was adopted (an operator decision)
  --   agreed     both present and identical
  --
  -- Divergence ALARMS rather than being silently resolved in our favour
  -- (AS-M2-06, FM-M2-04). A fill on the wrong trading day shifts win-day
  -- counts, minimum days, and the breach comparison for that account.
  trading_day_vendor  date NULL,                                 -- SD-M2-04
  trading_day_source  text NOT NULL DEFAULT 'calendar' CHECK (
                        trading_day_source IN ('calendar', 'vendor', 'agreed')
                      ),                                         -- SD-M2-04

  created_at          timestamptz NOT NULL DEFAULT now(),

  -- SD-M2-04. 'agreed' means both present and identical; 'vendor' means the
  -- vendor's day was adopted. Neither is expressible without their date.
  CONSTRAINT fills_vendor_day_present_when_claimed CHECK (
    trading_day_source = 'calendar' OR trading_day_vendor IS NOT NULL
  ),
  CONSTRAINT fills_agreed_means_equal CHECK (
    trading_day_source <> 'agreed' OR trading_day_vendor = trading_day
  ),

  CONSTRAINT fills_no_self_correction CHECK (
    correction_of IS NULL OR correction_of <> id
  )
);

CREATE UNIQUE INDEX fills_platform_fill_uq ON fills (platform, platform_fill_id);
CREATE INDEX fills_account_day_idx ON fills (account_id, trading_day);
CREATE INDEX fills_trading_day_idx ON fills (trading_day);
CREATE INDEX fills_account_executed_idx ON fills (account_id, executed_at);
CREATE INDEX fills_correction_idx ON fills (correction_of) WHERE correction_of IS NOT NULL;

-- SD-M2-04. The divergence alarm's read path.
CREATE INDEX fills_day_divergence_idx
  ON fills (trading_day, account_id)
  WHERE trading_day_vendor IS NOT NULL AND trading_day_vendor <> trading_day;

COMMENT ON TABLE fills IS
  'Append-only, including corrections. PROVISIONAL (ADR-005): the design '
  'assumes corrections arrive as new rows referencing the original. If the '
  'vendor restates in place, the ingest layer converts a restatement into a '
  'correction row so this table''s contract holds regardless.';

COMMIT;
