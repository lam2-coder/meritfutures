-- =============================================================================
-- 0038_account_adjustments
-- =============================================================================
-- E2 READ: MONEY PATH. This is the first admin route in this corpus that moves
-- money to a NAMED PERSON, and it is the first table that permits taking money
-- back. Seven things need the founder's line-by-line read.
--
--   1. THE DESTINATION. An adjustment posts to `trader_wallet` or to
--      `promotional_credit` and NEVER to `trader_withdrawable`.
--      packages/rules-engine/src/payout/gates.ts:78 computes
--      `withdrawable = max(0, balance - size - buffer)` from the TRADING
--      balance, so no ledger entry is an input to it. A credit to the
--      `trader_withdrawable` class would raise a position no gate, no clamp and
--      no screen reads, while the engine's number stayed where it was. That is
--      not a manufactured obligation, it is a ledger that disagrees with the
--      engine, which is ADR-027's failure arriving from the other end.
--      ADR-067 section 2.1.
--
--   2. THE DEBIT DIRECTION, WHICH IS THE DANGEROUS ONE. A debit takes money
--      from a trader's wallet and nothing in this corpus permitted that before
--      this file. `account_adjustments_debit_is_a_reversal` plus
--      `account_adjustments_reversal_uq` plus
--      `assert_adjustment_reversal_is_sound` make a debit UNWRITABLE unless it
--      names one credit THIS TABLE posted and matches it in identity,
--      destination and cents. So a debit can only remove money Merit itself put
--      there by adjustment; IT CAN NEVER REACH A CENT THE TRADER EARNED, which
--      is what keeps it clear of M06 INV-M6-03. A clawback, a penalty, an
--      offset, a recovery of an overpayment that was not an adjustment: none of
--      them can be written, because none of them names a prior credit here.
--      ADR-067 section 4.
--
--   3. THE SIGN, BECAUSE GETTING IT BACKWARDS IS THIS CORPUS'S NAMED REPEAT
--      ERROR (0009:118, "four times in one day on LT-01"). THIS TABLE FOLLOWS
--      wallet_entries AND NOT ledger_entries: `amount_cents` is a MAGNITUDE,
--      always positive, and `direction` carries the sign. 0011:55 says why in
--      terms: reusing one convention for two different questions is the shape
--      of error ADR-027 was reversed over. The mapping is written out in the
--      comment above assert_adjustment_posting_matches and the trigger asserts
--      exactly it.
--
--   4. THE DEBIT LEG IS `fees_revenue` AND NO EIGHTH LEDGER CLASS IS CREATED.
--      The seven codes are declared "the whole permitted set" (0009:49) and
--      enforced twice, by the CHECK and by LEDGER-C2 in 0027. Checked against
--      the ruled recognition timing rather than assumed compatible with it:
--      the batch 1 gate ruled that payout liability books at approval, cash
--      derecognizes at settlement, and evaluation fees recognize at purchase
--      (M05:560, OQ-M5-04). An adjustment is none of the three. It books a
--      liability and reduces revenue in ONE moment, its own, and it moves NO
--      CASH. `firm_treasury` was the available mistake and is refused for the
--      reason M05:140 already refused it on LT-01: it books a cash movement in
--      a moment when no cash moved. THE COST IS STATED: the revenue line now
--      nets goodwill against fees, so a revenue figure quoted without joining
--      this table understates both by the same number. OQ-F6-03.
--
--   5. NEVER A BALANCE MUTATION, AND THE TRIGGERS ARE WHAT MAKE THAT TRUE.
--      `ledger_transaction_id NOT NULL` makes an unposted adjustment
--      unwritable, which is identity_restriction_restore_is_complete's shape
--      (0031:264). The two deferred constraint triggers go further than that
--      constraint can: they read the posting the row claims and assert it IS
--      the adjustment, to the account, the identity, the cent and the sign. A
--      row whose transaction says something else does not survive COMMIT.
--
--   6. THE PROMOTIONAL PAIRING. M20 INV-M20-03 says promotional credit can
--      never become wallet balance AND THAT NO CHAIN OF TRANSACTIONS MAY
--      CONVERT IT INTO ONE. One table with one destination and three reasons
--      would be that chain, in one hop, on its first row.
--      `account_adjustments_reason_picks_destination` makes it unwritable, and
--      `account_adjustments_promotional_names_its_grant` keeps 0024:204's
--      mandatory expiry in the path: an admin route posting to the
--      `promotional_credit` class without a grant row would create the
--      "unexpiring promotional balance" that migration calls a liability
--      wearing a marketing label.
--
--   7. THE DUAL-CONTROL THRESHOLD IS A COLUMN, NOT A LOOKUP. ADR-010's
--      sensitive set is a closed list of five (M06:160) and an adjustment is
--      not on it, so ADR-067 AMENDS ADR-010 rather than applying it. The
--      threshold in force is recorded on the row on plan_breaker_state's
--      precedent (0016), because otherwise "was this above the line" is
--      answered by TODAY's configuration against a row written last quarter,
--      and a threshold raised after the fact would retroactively make an
--      uncontrolled adjustment look compliant.
--
-- ADR-067 (status: proposed, founder approval PENDING) is the ruling.
-- FOLD-03 section 6 is the specification. SD-M6-09.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS FILE DOES NOT DO, STATED SO THE ABSENCES READ AS DECISIONS
-- -----------------------------------------------------------------------------
-- IT WIDENS NO CLOSED LIST. No new `wallet_entries.provenance` value
-- ('correction' has been legal since 0011:74 and is described there as "a
-- compensating entry, never an update"), no new `ledger_accounts.code`, no new
-- `identity_status`, no new payout status, no new `wallet_withdrawal_status`.
-- Every vocabulary this table needs already existed. That is the strongest
-- available evidence that item 1's destination is the right one: the wallet was
-- built to hold this and nobody had built the door.
--
-- IT ADDS NO ELIGIBILITY RULE, because none is needed. See item 1.
--
-- IT DOES NOT GATE ON `identities.status`. 0001:27 declares
-- ('active','restricted','closed') and ADR-041 refused a fourth. An adjustment
-- is permitted against all three: M20 INV-M20-06 already blocks wallet spend
-- AND external withdrawal while `restricted`, so a credit posted to a
-- restricted identity is an obligation Merit acknowledges and the trader cannot
-- extract until restore. The extraction gate exists; a second one here would be
-- a second expression of it, and refusing the row would mean Merit cannot
-- correct its own error against a person under investigation. `closed` is
-- permitted for INV-M20-09's reason: a wallet balance is payable on demand
-- FOREVER. ADR-067 section 7, GS-298.
--
-- IT DOES NOT SUM SUB-THRESHOLD ROWS. The dual-control CHECK is per row, so
-- repeated sub-threshold credits by one actor are unconstrained by this file.
-- That gap is real, it is named as OQ-F6-02 rather than left, and its home is
-- velocity policy and CRON_INVENTORY. `account_adjustments_actor_idx` exists so
-- that whoever rules it has the query. ADR-067 section 5.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- account_adjustments                                            -- SD-M6-09
-- -----------------------------------------------------------------------------
-- THE TABLE IS NAMED FOR THE OCCASION AND NOT FOR THE POSITION, and the
-- distinction is worth one paragraph because the name would otherwise mislead.
-- FOLD-03 section 6 asks for an adjustment "against an account or a wallet".
-- The POSITION is always identity-scoped, because both permitted destinations
-- are identity-scoped ledger classes (0009:56, 0009:57). The ACCOUNT is the
-- occasion: the incident, the reconciliation difference or the dispute that
-- produced the adjustment. So `identity_id` is NOT NULL and `account_id` is
-- nullable context, and no adjustment ever touches an account's TRADING
-- balance. A reconciliation difference on a trading balance is absorbed and
-- reported through liability_snapshots.absorbed_corrections_cents (0009, the
-- OQ-10 ruling), which is a path that already exists.
CREATE TABLE account_adjustments (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The position. Always the human, never the account.
  identity_id                  uuid NOT NULL REFERENCES identities(id)
                                 ON DELETE RESTRICT,

  -- The occasion. Context, and deliberately nullable: a goodwill credit for a
  -- support failure has no account.
  account_id                   uuid NULL REFERENCES accounts(id)
                                 ON DELETE RESTRICT,

  -- wallet_entries' convention, NOT ledger_entries'. See header item 3.
  direction                    text NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount_cents                 bigint NOT NULL CHECK (amount_cents > 0),

  -- THE CLOSED VOCABULARY. FOLD-03 section 6: "a controlled vocabulary plus
  -- free text, both required, the vocabulary is closed and lives in the
  -- migration". A reason column that accepts free text is a reason column
  -- nobody can aggregate, and "goodwill" spelled four ways is four categories.
  reason_code                  text NOT NULL CHECK (reason_code IN (
                                 'goodwill',              -- Merit chooses to give value
                                 'reconciliation_error',  -- Merit got a number wrong
                                 'promotional_credit'     -- a marketing grant, NEVER wallet value
                               )),

  -- THE FREE TEXT, AND THE EMPTINESS CHECK IS NOT DECORATION. INV-M6-01
  -- already requires a non-empty reason on admin_actions and calls NOT NULL
  -- "the whole control"; a column that accepts a single space satisfies NOT
  -- NULL and satisfies nothing else.
  reason_note                  text NOT NULL CHECK (btrim(reason_note) <> ''),

  -- Which identity-scoped ledger class the value lands in. Tied to reason_code
  -- below, so this is not a second free choice.
  destination                  text NOT NULL CHECK (destination IN (
                                 'trader_wallet',
                                 'promotional_credit'
                               )),

  -- AN ADJUSTMENT POSTS A TRANSACTION OR IT DOES NOT EXIST. Header item 5.
  -- UNIQUE: an adjustment owns its transaction. Two adjustments sharing one
  -- would make both posting assertions below ambiguous, and "which half of this
  -- transaction was which adjustment" is exactly the archaeology 0009:96 says
  -- must be instant.
  ledger_transaction_id        uuid NOT NULL REFERENCES ledger_transactions(id)
                                 ON DELETE RESTRICT,

  -- NOT NULL exactly when the destination is promotional. Header item 6.
  promotional_credit_grant_id  uuid NULL REFERENCES promotional_credit_grants(id)
                                 ON DELETE RESTRICT,

  -- THE ONLY DEBIT THAT EXISTS. Header item 2.
  reverses_adjustment_id       uuid NULL REFERENCES account_adjustments(id)
                                 ON DELETE RESTRICT,

  actor                        text NOT NULL CHECK (btrim(actor) <> ''),

  -- The threshold IN FORCE when this row was written. Header item 7.
  dual_control_threshold_cents bigint NOT NULL
                                 CHECK (dual_control_threshold_cents > 0),

  dual_control_approval_id     uuid NULL REFERENCES dual_control_approvals(id)
                                 ON DELETE RESTRICT,

  -- Optional, and optional deliberately: FOLD-03 section 6 puts the evidence
  -- pack in the audit set, and a goodwill credit for a late support reply has
  -- no pack to export. INV-M6-05 governs the pack when there is one.
  evidence_pack_id             uuid NULL REFERENCES evidence_packs(id)
                                 ON DELETE RESTRICT,

  created_at                   timestamptz NOT NULL DEFAULT now(),

  -- INV-M20-03 IN DDL. Header item 6. Written as an equivalence rather than as
  -- two implications, so neither direction can be added to later without the
  -- other: a promotional reason reaches only the promotional class, and the
  -- promotional class is reached only by a promotional reason.
  CONSTRAINT account_adjustments_reason_picks_destination CHECK (
    (reason_code = 'promotional_credit') = (destination = 'promotional_credit')
  ),

  -- 0024:204's mandatory expiry stays in the path. Header item 6.
  CONSTRAINT account_adjustments_promotional_names_its_grant CHECK (
    (destination = 'promotional_credit') = (promotional_credit_grant_id IS NOT NULL)
  ),

  -- THE CONTROL ITSELF, IN DDL. A debit names a credit or it is not writable,
  -- and a credit never names one. Header item 2.
  CONSTRAINT account_adjustments_debit_is_a_reversal CHECK (
    (direction = 'debit') = (reverses_adjustment_id IS NOT NULL)
  ),

  -- ledger_transactions_no_self_reversal's shape, one table up (0009).
  CONSTRAINT account_adjustments_no_self_reversal CHECK (
    reverses_adjustment_id IS NULL OR reverses_adjustment_id <> id
  ),

  -- THE DUAL-CONTROL CONTROL CANNOT BE WRITTEN AROUND: a row that needed a
  -- second key and does not name one does not exist. `>=` the threshold
  -- requires the approval, so the comparison is strictly-below for the free
  -- case. Header item 7. A REVERSAL IS DUAL-CONTROLLED ON ITS OWN AMOUNT by
  -- this same constraint, so reversing an above-threshold credit needs the
  -- second key too.
  CONSTRAINT account_adjustments_dual_control_above_threshold CHECK (
    amount_cents < dual_control_threshold_cents
    OR dual_control_approval_id IS NOT NULL
  )
);

-- An adjustment owns its transaction, and one grant is claimed by at most one
-- adjustment.
CREATE UNIQUE INDEX account_adjustments_transaction_uq
  ON account_adjustments (ledger_transaction_id);
CREATE UNIQUE INDEX account_adjustments_grant_uq
  ON account_adjustments (promotional_credit_grant_id)
  WHERE promotional_credit_grant_id IS NOT NULL;

-- AT MOST ONE REVERSAL PER ADJUSTMENT, in identity_restriction_open_uq's shape
-- (0031). Without it a credit could be reversed twice and the wallet would be
-- debited for double what Merit ever credited, which balance_after_cents >= 0
-- would refuse only if the wallet happened to be short.
CREATE UNIQUE INDEX account_adjustments_reversal_uq
  ON account_adjustments (reverses_adjustment_id)
  WHERE reverses_adjustment_id IS NOT NULL;

-- The account timeline and the identity drill-down (M06 sections 3.2, 3.2a).
CREATE INDEX account_adjustments_identity_idx
  ON account_adjustments (identity_id, created_at DESC);
CREATE INDEX account_adjustments_account_idx
  ON account_adjustments (account_id, created_at DESC)
  WHERE account_id IS NOT NULL;

-- OQ-F6-02's query, existing before the ruling that needs it: every adjustment
-- one actor wrote, in time order. Header, last paragraph.
CREATE INDEX account_adjustments_actor_idx
  ON account_adjustments (actor, created_at DESC);

COMMENT ON TABLE account_adjustments IS
  'SD-M6-09, ADR-067. The audited admin adjustment. Never a balance mutation: '
  'an adjustment posts a ledger transaction or it does not exist. Destination '
  'is trader_wallet or promotional_credit and NEVER trader_withdrawable. A '
  'debit is only ever the exact reversal of a credit this table posted.';

COMMENT ON COLUMN account_adjustments.amount_cents IS
  'MAGNITUDE, always positive; direction carries the sign. wallet_entries'''
  ' convention (0011:55), deliberately NOT ledger_entries'' signed one.';

COMMENT ON COLUMN account_adjustments.dual_control_threshold_cents IS
  'The threshold IN FORCE when the row was written, not the current one. '
  'plan_breaker_state''s precedent (0016). Without it a later configuration '
  'change retroactively makes an uncontrolled adjustment look compliant.';

-- -----------------------------------------------------------------------------
-- assert_adjustment_reversal_is_sound
-- -----------------------------------------------------------------------------
-- Header item 2, the half a CHECK cannot express because it reads another row.
--
-- SIX ASSERTIONS, and the FIRST is the one a reader should look at hardest:
-- a reversal may not reverse a reversal. 0009:104 states the rule one table
-- down, in the note on ledger_transactions_no_self_reversal, and states the
-- remedy in the same sentence: "a reversal of a reversal is an adjustment and
-- should be posted as one". THIS IS THAT TABLE. The corpus named this action in
-- the migration that created the ledger and nothing has ever been able to post
-- one; reversing a reversal here is therefore not a hard case, it is a new
-- credit with its own reason and its own second key.
--
-- BEFORE INSERT rather than deferred, because every fact it reads is already
-- committed: the row being reversed exists or the FK would have refused.
CREATE FUNCTION assert_adjustment_reversal_is_sound() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target       account_adjustments%ROWTYPE;
  target_txn   uuid;
  claimed_txn  uuid;
BEGIN
  IF NEW.reverses_adjustment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO target
    FROM account_adjustments
   WHERE id = NEW.reverses_adjustment_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'ADJ-C1: adjustment % reverses %, which does not exist',
      NEW.id, NEW.reverses_adjustment_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- 1. NO CHAIN. See the note above. THIS IS CHECKED FIRST DELIBERATELY: it and
  --    the direction check below both catch a reversal of a reversal, and this
  --    is the one whose message names the rule the writer actually broke.
  IF target.reverses_adjustment_id IS NOT NULL THEN
    RAISE EXCEPTION
      'ADJ-C1: adjustment % reverses %, which is itself a reversal. A reversal '
      'of a reversal is an adjustment and should be posted as one (0009)',
      NEW.id, target.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- 2. A debit reverses a CREDIT. Reversing a debit is the double-recovery
  --    this table exists to make unwritable.
  --
  --    STATED HONESTLY: THIS BRANCH IS UNREACHABLE WHILE
  --    `account_adjustments_debit_is_a_reversal` STANDS, because that CHECK
  --    makes every debit a reversal and check 1 above already refuses those. It
  --    is kept as a second line for LEDGER-C2's stated reason (0027): a
  --    guarantee that depends on a CHECK a later migration could drop is a
  --    guarantee with a dependency. It is NOT the control, and a reader must
  --    not count it as one. This was found by watching the trigger run rather
  --    than by reading it.
  IF target.direction <> 'credit' THEN
    RAISE EXCEPTION
      'ADJ-C1: adjustment % reverses %, whose direction is % and must be credit',
      NEW.id, target.id, target.direction
      USING ERRCODE = 'check_violation';
  END IF;

  -- 3. Same human. A debit against one identity may not answer a credit given
  --    to another, which would be a transfer between identities wearing a
  --    correction's clothes (INV-M20-02's concern, one table over).
  IF target.identity_id <> NEW.identity_id THEN
    RAISE EXCEPTION
      'ADJ-C1: adjustment % reverses %, which belongs to a different identity',
      NEW.id, target.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- 4. Same destination class. Debiting a wallet to answer a promotional grant
  --    converts promotional credit into wallet value by subtraction, which is
  --    INV-M20-03's "no chain of transactions" reached backwards.
  IF target.destination <> NEW.destination THEN
    RAISE EXCEPTION
      'ADJ-C1: adjustment % reverses %, whose destination is % and not %',
      NEW.id, target.id, target.destination, NEW.destination
      USING ERRCODE = 'check_violation';
  END IF;

  -- 5. TO THE CENT. ADR-067 section 4 refuses partial reversal: a 50,000 cent
  --    credit that should have been 20,000 is reversed IN FULL and re-posted at
  --    20,000, which leaves three visible postings instead of a row that
  --    quietly shrank. SD-M5-05's reasoning, applied one table up: corrections
  --    are compensating entries, never updates.
  IF target.amount_cents <> NEW.amount_cents THEN
    RAISE EXCEPTION
      'ADJ-C1: adjustment % reverses % at % cents against % cents. A reversal '
      'is exact; a partial correction is a full reversal plus a new credit',
      NEW.id, target.id, NEW.amount_cents, target.amount_cents
      USING ERRCODE = 'check_violation';
  END IF;

  -- 6. SD-M5-05's link, on the transaction itself. Without it a reversal is a
  --    transaction that happens to be equal and opposite, and reconstructing
  --    which reversal answered which original becomes archaeology at exactly
  --    the moment it must be instant (0009:96).
  SELECT lt.reversal_of INTO claimed_txn
    FROM ledger_transactions lt WHERE lt.id = NEW.ledger_transaction_id;
  target_txn := target.ledger_transaction_id;

  IF claimed_txn IS DISTINCT FROM target_txn THEN
    RAISE EXCEPTION
      'ADJ-C1: adjustment % reverses %, but its transaction''s reversal_of is '
      '% and must be %',
      NEW.id, target.id, claimed_txn, target_txn
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER account_adjustments_reversal_is_sound
  BEFORE INSERT ON account_adjustments
  FOR EACH ROW EXECUTE FUNCTION assert_adjustment_reversal_is_sound();

-- -----------------------------------------------------------------------------
-- assert_adjustment_posting_matches
-- -----------------------------------------------------------------------------
-- HEADER ITEM 5, AND THIS IS THE FILE'S CENTRAL CONTROL. `ledger_transaction_id
-- NOT NULL` makes an UNPOSTED adjustment unwritable. It does nothing whatever
-- about an adjustment posted against the WRONG ACCOUNT, for the WRONG AMOUNT,
-- or in the WRONG DIRECTION, and every one of those is a balance mutation with
-- a receipt stapled to it.
--
-- THE MAPPING THIS ASSERTS, WRITTEN OUT ONCE. ledger_entries.amount_cents is
-- SIGNED and positive is DEBIT (0009:118). account_adjustments.amount_cents is
-- a MAGNITUDE and direction carries the sign (0011:55). So:
--
--   direction   leg on the identity's destination class   leg on fees_revenue
--   ---------   ---------------------------------------   -------------------
--   credit      -amount_cents                             +amount_cents
--   debit       +amount_cents                             -amount_cents
--
-- fees_revenue is the debit leg and no eighth ledger class is created; header
-- item 4 argues it against the ruled recognition moments and states its cost.
--
-- EXACTLY TWO ENTRIES. A third leg would be a posting this table cannot
-- describe, and an adjustment whose transaction says more than the adjustment
-- does is the row a reader would trust and should not.
--
-- DEFERRED, for the reason 0027's zero-sum trigger is deferred: the entries
-- arrive one at a time and the set is only complete once the transaction has
-- written all of them. Checking at statement time would fail on every correct
-- write whose adjustment row lands before its second leg.
CREATE FUNCTION assert_adjustment_posting_matches() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  want_position bigint;
  want_revenue  bigint;
  legs          integer;
  got_position  bigint;
  got_revenue   bigint;
BEGIN
  IF NEW.direction = 'credit' THEN
    want_position := -NEW.amount_cents;
    want_revenue  :=  NEW.amount_cents;
  ELSE
    want_position :=  NEW.amount_cents;
    want_revenue  := -NEW.amount_cents;
  END IF;

  SELECT count(*) INTO legs
    FROM ledger_entries e
   WHERE e.transaction_id = NEW.ledger_transaction_id;

  IF legs <> 2 THEN
    RAISE EXCEPTION
      'ADJ-C2: adjustment % posts % ledger leg(s) and an adjustment is exactly '
      'two: the identity''s % position and fees_revenue',
      NEW.id, legs, NEW.destination
      USING ERRCODE = 'check_violation';
  END IF;

  -- The identity's destination position. `ledger_accounts_identity_code_uq`
  -- makes (code, identity_id) unique for identity scope, so this join can
  -- match at most one account.
  SELECT e.amount_cents INTO got_position
    FROM ledger_entries e
    JOIN ledger_accounts a ON a.id = e.ledger_account_id
   WHERE e.transaction_id = NEW.ledger_transaction_id
     AND a.scope          = 'identity'
     AND a.identity_id    = NEW.identity_id
     AND a.code           = NEW.destination;

  IF got_position IS NULL THEN
    RAISE EXCEPTION
      'ADJ-C2: adjustment % posts no leg against identity %''s % position. '
      'An adjustment IS its posting; a transaction that moves some other '
      'account is not this adjustment',
      NEW.id, NEW.identity_id, NEW.destination
      USING ERRCODE = 'check_violation';
  END IF;

  IF got_position <> want_position THEN
    RAISE EXCEPTION
      'ADJ-C2: adjustment % is a % of % cents, so its % leg must be % and '
      'it is %. Positive is DEBIT (0009)',
      NEW.id, NEW.direction, NEW.amount_cents, NEW.destination,
      want_position, got_position
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT e.amount_cents INTO got_revenue
    FROM ledger_entries e
    JOIN ledger_accounts a ON a.id = e.ledger_account_id
   WHERE e.transaction_id = NEW.ledger_transaction_id
     AND a.scope          = 'firm'
     AND a.code           = 'fees_revenue';

  IF got_revenue IS DISTINCT FROM want_revenue THEN
    RAISE EXCEPTION
      'ADJ-C2: adjustment %''s fees_revenue leg must be % and it is %. The '
      'debit leg is fees_revenue and never firm_treasury: no cash moves at an '
      'adjustment (ADR-067 section 2.3)',
      NEW.id, want_revenue, got_revenue
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER account_adjustments_posting_matches
  AFTER INSERT ON account_adjustments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_adjustment_posting_matches();

-- -----------------------------------------------------------------------------
-- assert_adjustment_wallet_entry_matches
-- -----------------------------------------------------------------------------
-- The wallet's own statement has to agree with the adjustment, and the reason
-- it is a separate assertion from the one above is 0011's own: "the ledger
-- records the money; this records WHAT KIND OF MONEY IT IS". A posting that
-- balances perfectly and leaves no wallet_entries row is a wallet balance that
-- moved with no provenance, which makes every rule in M20 section 3.4
-- unevaluable against it, and `balance_after_cents` is where the trader's
-- statement actually comes from.
--
-- `provenance` MUST be 'correction'. It is the only value in 0011:74's closed
-- list that an adjustment can honestly claim: it is not a payout, it is not a
-- refund of a wallet-funded purchase, and 0011:64 defines it as exactly this,
-- "a compensating entry, never an update".
--
-- `reference_id` MUST be the adjustment's id. 0011 describes that column as
-- "polymorphic: payout_request, purchase, or the corrected entry", and an
-- adjustment is a FOURTH kind. The comment is prose rather than a constraint so
-- nothing had to change in 0011; this assertion is what makes the fourth kind
-- real, and it is why the adjustment row carries no wallet_entry_id of its own:
-- the reference points one way and the shared transaction id points the other,
-- so a second FK would only be a cycle to insert around.
--
-- DEFERRED, and here it is load bearing rather than merely consistent: the
-- wallet entry cannot be written until the adjustment has an id, and the
-- adjustment cannot be validated until the wallet entry exists.
CREATE FUNCTION assert_adjustment_wallet_entry_matches() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entries integer;
BEGIN
  IF NEW.destination <> 'trader_wallet' THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO entries
    FROM wallet_entries w
   WHERE w.reference_id           = NEW.id
     AND w.ledger_transaction_id  = NEW.ledger_transaction_id
     AND w.identity_id            = NEW.identity_id
     AND w.direction              = NEW.direction
     AND w.amount_cents           = NEW.amount_cents
     AND w.provenance             = 'correction';

  IF entries <> 1 THEN
    RAISE EXCEPTION
      'ADJ-C3: adjustment % has % matching wallet_entries row(s) and must '
      'have exactly one, with provenance ''correction'', direction %, % cents '
      'and this adjustment''s id as reference_id',
      NEW.id, entries, NEW.direction, NEW.amount_cents
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER account_adjustments_wallet_entry_matches
  AFTER INSERT ON account_adjustments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_adjustment_wallet_entry_matches();

-- -----------------------------------------------------------------------------
-- Append-only, by grant rather than by convention (VG-8)
-- -----------------------------------------------------------------------------
-- 0026 ends with ALTER DEFAULT PRIVILEGES granting merit_app full DML on
-- anything a later migration creates, so this table is UPDATE-able and
-- DELETE-able the instant it exists. Without this REVOKE, every constraint
-- above is bypassable by writing a compliant row and then editing it: the
-- reversal that was exact becomes partial, the row that named its second key
-- stops naming it, and the deferred triggers never fire again because they are
-- INSERT triggers. THE REVOKE IS WHAT MAKES THE REST OF THIS FILE HOLD.
--
-- Against PUBLIC as well as merit_app, because a revoke that only binds the
-- application role is a revoke a second connection string bypasses. 0032's and
-- 0039's precedent: this SUPERSEDES 0026's list rather than editing it.
REVOKE UPDATE, DELETE ON account_adjustments FROM merit_app, PUBLIC;

-- merit_analytics is deliberately NOT granted SELECT, on 0032's stated default:
-- a new table is invisible to analytics until somebody grants it, and it
-- arrives with a consumer that names itself or not at all. This one carries
-- trader-identifying data by construction (every row names an identity), so the
-- eventual grant is a decision with a redaction question attached rather than a
-- formality, and INV-M6-10 is the reason to make it deliberately.

COMMIT;
