-- =============================================================================
-- 0041_contact_channel_complaints
-- =============================================================================
-- NON-MONEY PATH, and the adjacency is worth one paragraph rather than an E2
-- header. This column lives on contact_channels, which is the table INV-M16-03's
-- account-takeover countermeasure reads, and 0034 carries an E2 header for work
-- on that same surface because AUTH is a money path. Nothing here touches auth:
-- the column suppresses the MARKETING class and only the marketing class, and
-- M16 section 3.4's send-path table states what each of the five classes does
-- with it. THE ONE MISREADING THAT WOULD MAKE THIS FILE DANGEROUS is a send path
-- that consults complained_at before a SECURITY-class message. That is a trader
-- locked out of OTP login by having once reported a newsletter, which is GS-293's
-- failure arriving through GS-295's remedy.
--
-- ADR-066 (status: proposed, founder approval PENDING) admits the outcomes.
-- M16 section 3.4 is the specification. SD-M16-08.
--
-- -----------------------------------------------------------------------------
-- THIS FILE IS SMALLER THAN ITS RESERVATION, AND THE REASON IS THE FINDING
-- -----------------------------------------------------------------------------
-- ALLOCATION reserved 0041 as "0041_notification_delivery_outcomes.sql, widening
-- M16's delivery status to carry bounced and spam_complaint". NEITHER HALF OF
-- THAT SURVIVED BEING READ AGAINST 0019.
--
--   bounced         ALREADY LEGAL. 0019's check is
--                   delivery_status IN ('pending','delivered','bounced',
--                   'suppressed','failed'). What was missing was the
--                   SPECIFICATION, not the column: M16's lifecycle machine had
--                   no bounced state, so the schema could store an outcome no
--                   document described. That gap is closed in M16, not here.
--
--   spam_complaint  REFUSED as a delivery_status value, on three grounds stated
--                   in M16 section 3.4. The one that decides it is the grain: a
--                   bounce is about ONE MESSAGE and a complaint is about THE
--                   ADDRESS, outlives every message, and governs every marketing
--                   message sent to that destination afterwards.
--
--                   The sharpest of the three is worth repeating where the DDL
--                   is: a complaint arrives AFTER delivery, so writing it into
--                   delivery_status OVERWRITES 'delivered'. INV-M16-09 makes the
--                   delivery receipt half of the proof of notice, so under the
--                   obvious implementation A TRADER WHO COMPLAINS ABOUT A FREEZE
--                   NOTICE ERASES MERIT'S EVIDENCE THAT IT ARRIVED, by
--                   complaining about it. It would also move the row off
--                   'delivered' and out from under
--                   notifications_delivered_has_timestamp, after which
--                   delivered_at can be cleared with nothing objecting.
--
-- So notifications is NOT TOUCHED by this file and one nullable column is the
-- whole delta.
--
-- -----------------------------------------------------------------------------
-- WHY NOT THE TWO PLACES IT LOOKS LIKE IT BELONGS
-- -----------------------------------------------------------------------------
-- notification_preferences is the TRADER'S OWN CHOICE, and INV-M16-04 makes
-- editing it a security-class ceremony that confirms to the existing contact
-- first. A complaint cannot go through that ceremony because Merit cannot ask the
-- complainer to confirm, so storing it there creates a SECOND WRITER to the
-- preference table that skips the confirmation. AS-M16-02 is the scenario about
-- an attacker muting the alarms first, and an unconfirmed writer reachable from a
-- forged provider webhook is the mechanism it warns about.
--
-- Supersession is worse. contact_channels_live_uq is partial on
-- superseded_at IS NULL, so marking the channel superseded leaves the identity
-- with NO LIVE CHANNEL OF THAT KIND and the security class with nowhere to go.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. The complaint, recorded against the destination
-- -----------------------------------------------------------------------------
-- Nullable and unset is the ordinary state. NOT a boolean: the date is what
-- makes a complaint auditable against the marketing sends that preceded it, and
-- a boolean would answer "is this address suppressed" while losing "since when",
-- which is the only half a deliverability review can act on.
--
-- Channel-agnostic by construction. kind is ('email','push','sms') after
-- SD-M16-06, and an SMS STOP reply is the same fact arriving on a different
-- wire; nothing here is email-shaped.
--
-- NO CHECK PAIRS IT WITH verified_at OR superseded_at. A complaint from an
-- unverified address is still a complaint, and a superseded address that
-- complained stays complained: the row is history from that point and rewriting
-- history is what supersession exists to avoid.
ALTER TABLE contact_channels
  ADD COLUMN complained_at timestamptz NULL;                      -- SD-M16-08

COMMENT ON COLUMN contact_channels.complained_at IS
  'SD-M16-08, M16 section 3.4, INV-M16-13. When the provider reported a spam '
  'complaint against this destination. SUPPRESSES THE MARKETING CLASS AND '
  'NOTHING ELSE: security, money and account-state messages are sent unchanged, '
  'because no preference reaches those classes and a complaint is not stronger '
  'than a preference (M16 section 1.2). A send path that consults this column '
  'before a security-class message locks a trader out of OTP login for having '
  'once reported a newsletter (GS-293, GS-295). Never written by a trader '
  'action: a preference edit is INV-M16-04''s confirmed ceremony and this is '
  'not one.';

-- -----------------------------------------------------------------------------
-- 2. The send path's read
-- -----------------------------------------------------------------------------
-- Partial, on 0019's contact_channels_recently_superseded_idx precedent. The set
-- of complained-against destinations is small and stays small; indexing the
-- nulls would index every contact channel Merit holds to answer a question about
-- the few that are not null.
CREATE INDEX contact_channels_complained_idx
  ON contact_channels (identity_id, kind)
  WHERE complained_at IS NOT NULL;

COMMIT;
