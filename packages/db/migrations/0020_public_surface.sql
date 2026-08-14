-- =============================================================================
-- 0020_public_surface
-- =============================================================================
-- Not a money-path file, and it is the file the outside world reads. Three
-- things worth the careful read:
--
--   1. SD-M9-02's checksum is what makes "the page a trader accepted" A
--      PROVABLE ARTIFACT rather than a git blame. Legal pages are versioned
--      documents WITH ACCEPTANCE CONSEQUENCES, and once they need version
--      history, giving blog posts a different storage mechanism means two
--      content systems and one of them without an audit trail.
--   2. SD-M9-03's page_revalidations. INV-M9-04 makes revalidation part of the
--      PUBLISH TRANSACTION'S DEFINITION OF DONE. An invalidation that is
--      fire-and-forget is a cache that is USUALLY RIGHT, and "usually right"
--      on a price page is AS-M9-01.
--   3. certificates. A "verifiable" share card that verifies nothing is WORSE
--      THAN NO CARD AT ALL (AS-M4-03), because the transparency moat inverts:
--      forged proof of payouts damages the thing it imitates. `code` is
--      distinct from `id` so the public token can be rotated after an incident
--      WITHOUT REWRITING THE PRIMARY KEY.
--
-- Deltas folded: SD-M4-01, SD-M9-02, SD-M9-03, SD-M11-01, SD-M11-02, SD-M11-03
--
-- SD-M11-04's certificate_verifications is in the RESERVED sequence (0025).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- content_documents                                             -- SD-M9-02
-- -----------------------------------------------------------------------------
CREATE TABLE content_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('page', 'post', 'faq', 'legal')),
  slug          text NOT NULL,
  locale        text NOT NULL DEFAULT 'en',
  title         text NOT NULL,
  body_mdx      text NOT NULL,
  version       integer NOT NULL DEFAULT 1 CHECK (version > 0),
  published_at  timestamptz NULL,

  -- Supersession rather than update, the same discipline as daily_marks and
  -- contact_channels and for the same reason: the previous answer is
  -- evidence.
  superseded_by uuid NULL REFERENCES content_documents(id) ON DELETE RESTRICT,

  author        text NOT NULL,

  -- SD-M9-02. WHAT MAKES "THE PAGE A TRADER ACCEPTED" A PROVABLE ARTIFACT.
  checksum      bytea NOT NULL,                                   -- SD-M9-02

  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT content_documents_no_self_supersede CHECK (
    superseded_by IS NULL OR superseded_by <> id
  )
);

CREATE UNIQUE INDEX content_documents_slug_version_uq
  ON content_documents (kind, slug, locale, version);

-- The site's read path: the live document per slug per locale.
CREATE UNIQUE INDEX content_documents_live_uq
  ON content_documents (kind, slug, locale)
  WHERE superseded_by IS NULL AND published_at IS NOT NULL;

-- -----------------------------------------------------------------------------
-- page_revalidations                                            -- SD-M9-03
-- -----------------------------------------------------------------------------
-- INV-M9-04. Revalidation is PART OF PUBLISH'S DEFINITION OF DONE, so it needs
-- a row with a completion state. A fire-and-forget invalidation cannot be
-- waited on, retried, or alarmed on, and a stale price page is the one cache
-- miss Merit cannot absorb.
CREATE TABLE page_revalidations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger       text NOT NULL,   -- plan_version_published, content_published, ...
  reference_id  uuid NULL,
  paths         text[] NOT NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz NULL,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'ok', 'failed')),
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT page_revalidations_has_paths CHECK (array_length(paths, 1) >= 1),
  CONSTRAINT page_revalidations_settled_has_timestamp CHECK (
    status = 'pending' OR completed_at IS NOT NULL
  )
);

-- The publish path waits on this, and the alarm reads it.
CREATE INDEX page_revalidations_open_idx
  ON page_revalidations (requested_at) WHERE status <> 'ok';

-- -----------------------------------------------------------------------------
-- certificates                       -- SD-M4-01, SD-M11-01/02/03
-- -----------------------------------------------------------------------------
-- SD-M4-01. API_CONTRACT section 6 returns a certificate_id and a verify_url,
-- and the approved DATA_MODEL had NO TABLE BEHIND EITHER. Without a row there
-- is nothing to verify against.
--
-- THE CARD IS A RENDERING; THE CERTIFICATE IS THE ROW.
CREATE TABLE certificates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  identity_id           uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  kind                  text NOT NULL CHECK (kind IN ('pass', 'payout')),
  payout_request_id     uuid NULL REFERENCES payout_requests(id) ON DELETE RESTRICT,

  -- What Merit actually issued: plan, size, trading day, and amount for a
  -- payout card. The public verification page states these FROM THE SIGNED
  -- ROW, never from the image.
  claims                jsonb NOT NULL,
  signature             bytea NOT NULL,

  -- SD-M11-01. INV-M11-06. WITHOUT A KEY ID, THE FIRST ROTATION MAKES EVERY
  -- HISTORICAL SIGNATURE UNVERIFIABLE, which means either the key is never
  -- rotated or the history is discarded. Both are worse than the column.
  signing_key_id        text NOT NULL,                            -- SD-M11-01

  -- SD-M11-01. The short unguessable token that appears in the image and
  -- resolves on the verify page. DISTINCT FROM id so the public token can be
  -- ROTATED AFTER AN INCIDENT without rewriting the primary key or breaking
  -- every foreign key pointing at it.
  code                  text NOT NULL,                            -- SD-M11-01

  -- SD-M11-01. INV-M11-05. Lets the claim shape evolve without making old
  -- cards unreadable.
  claims_schema_version integer NOT NULL DEFAULT 1
                          CHECK (claims_schema_version > 0),      -- SD-M11-01

  issued_at             timestamptz NOT NULL DEFAULT now(),
  revoked_at            timestamptz NULL,
  revoked_reason        text NULL,   -- INTERNAL free text

  -- SD-M11-02. INV-M11-07. revoked_reason alone is free text, and FREE TEXT ON
  -- A PUBLIC PAGE IS HOW AN ENFORCEMENT GETS DESCRIBED INCONSISTENTLY TWICE.
  -- The class drives the PUBLISHED sentence; the free text stays internal
  -- (AS-M11-05).
  revocation_class      text NULL CHECK (revocation_class IN (
                          'fact_untrue', 'account_enforced',
                          'issued_in_error', 'trader_request'
                        )),                                       -- SD-M11-02

  -- SD-M11-03. INV-M11-09. AN ACHIEVEMENT EARNED WHILE A FLAG IS OPEN IS
  -- STILL AN ACHIEVEMENT. Deferral needs a state, or the alternative is
  -- issuing a card Merit may have to revoke publicly within the week, and a
  -- public revocation costs more than a private delay.
  deferred_until        timestamptz NULL,                         -- SD-M11-03
  deferred_reason       text NULL,                                -- SD-M11-03

  created_at            timestamptz NOT NULL DEFAULT now(),

  -- A payout certificate names its payout; a pass certificate does not.
  CONSTRAINT certificates_payout_kind_has_request CHECK (
    (kind = 'payout' AND payout_request_id IS NOT NULL)
    OR
    (kind = 'pass' AND payout_request_id IS NULL)
  ),

  -- SD-M11-02. A revocation carries BOTH: the class that drives the public
  -- sentence and the internal reason.
  CONSTRAINT certificates_revocation_is_complete CHECK (
    (revoked_at IS NULL AND revocation_class IS NULL AND revoked_reason IS NULL)
    OR
    (revoked_at IS NOT NULL AND revocation_class IS NOT NULL
     AND revoked_reason IS NOT NULL)
  ),

  -- SD-M11-03. A deferral is explained.
  CONSTRAINT certificates_deferral_is_explained CHECK (
    deferred_until IS NULL OR deferred_reason IS NOT NULL
  )
);

-- SD-M11-01. The public token. Unique, and the verify page's only lookup key.
CREATE UNIQUE INDEX certificates_code_uq ON certificates (code);

CREATE INDEX certificates_account_idx ON certificates (account_id, issued_at DESC);
CREATE INDEX certificates_identity_idx ON certificates (identity_id, issued_at DESC);

-- SD-M11-03. The deferral release sweep.
CREATE INDEX certificates_deferred_idx
  ON certificates (deferred_until) WHERE deferred_until IS NOT NULL;

COMMENT ON TABLE certificates IS
  'The card is a rendering; this row is the certificate. An unverifiable card '
  'is reported as unverifiable, never as false (AS-M4-03).';

COMMIT;
