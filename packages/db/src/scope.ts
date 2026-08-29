// =============================================================================
// packages/db/src/scope.ts
// =============================================================================
// THE REGISTRY IS DECLARED AND NEVER DERIVED, and that is the whole design.
//
// A mechanical "walk the foreign keys until something carries identity_id"
// derivation returns 25 of the 111 tables on this tree, and it is WRONG ON AT
// LEAST THREE of them:
//
//   treasury_balances.recorded_by -> users   scopes THE FIRM'S TREASURY to
//                                            whichever admin typed the
//                                            attestation.
//   impersonation_sessions.admin_user_id     reaches the ADMIN'S identity, not
//                                            the subject's.
//   sessions.device_fingerprint_id           reaches whoever SHARES A DEVICE.
//     -> identity_signals
//
// Auto-derivation here is not conservative, it is confidently wrong: each of
// those three produces a scoped query that RETURNS ROWS, for the wrong identity,
// with no error anywhere. So every rule below is written by a person and every
// one carries its reason.
//
// TOTALITY IS A COMPILE ERROR, NOT A TEST. `SCOPE_RULES` is declared against a
// mapped type over `TableKey`, so a table added to `schema.ts` without a rule
// here does not compile, and a rule naming a table that does not exist does not
// compile either. The unregistered table is unreachable through either accessor
// rather than reachable and unscoped.

import {
  accountAdjustments,
  accounts,
  accountStatusHistory,
  adminActions,
  affiliateClicks,
  affiliateCreatives,
  affiliates,
  affiliateStatements,
  alarmSuppressions,
  analyticsSnapshots,
  attributions,
  certificates,
  certificateVerifications,
  contactChannels,
  contentDocuments,
  contractSpecs,
  correlationGroups,
  couponRedemptions,
  coupons,
  dailyMarks,
  dedupeMatches,
  detectorDefinitions,
  detectorRuns,
  discordAnnouncements,
  discordLinks,
  dualControlApprovals,
  economicCalendar,
  economicCalendarCurrent,
  economicCalendarLoads,
  events,
  evidencePacks,
  fills,
  geoRestrictions,
  graduationBenefits,
  graduationInvitations,
  idempotencyKeys,
  identities,
  identityLinks,
  identityPhones,
  identityRestrictionEpisodes,
  identitySignals,
  impersonationPageViews,
  impersonationSessions,
  ingestFiles,
  integrationContracts,
  integrationDispatches,
  journalEntries,
  kycFunnelEvents,
  kycVerifications,
  ledgerAccounts,
  ledgerEntries,
  ledgerHalts,
  ledgerTransactions,
  liabilitySnapshots,
  loyaltyBenefitGrants,
  loyaltyCriteria,
  loyaltyStates,
  midHealth,
  notificationKinds,
  notificationPreferences,
  notifications,
  offerExperiments,
  offers,
  operators,
  operatorSessions,
  otpChallenges,
  otpSendBudget,
  pageRevalidations,
  passkeys,
  paymentDisputes,
  payoutDestinations,
  payoutRequests,
  payoutTransfers,
  phoneChangeRequests,
  planBreakerState,
  plans,
  planSizeUnlocks,
  planVersions,
  planVersionSizes,
  platformAccountRefs,
  platformEntitlements,
  priceFloors,
  promotionalCreditGrants,
  proofLinks,
  provisioningQueue,
  pspWebhookEvents,
  publishedStatistics,
  purchases,
  rawIngestRows,
  reconciliationRuns,
  reconciliations,
  reportDeliveries,
  reportSchedules,
  reserveCoverageSnapshots,
  reviewRequests,
  riskFlags,
  roundTrips,
  ruleStates,
  sanctionsScreenings,
  sessions,
  simulationRuns,
  statisticDefinitions,
  supportContextViews,
  tosAcceptances,
  tosVersions,
  tradingCalendar,
  tradingCalendarLoads,
  tradingCalendarRevisions,
  treasuryBalances,
  users,
  walletDormancy,
  walletEntries,
  walletSpendLimits,
  walletWithdrawals,
} from './schema.ts';

/**
 * The registry. `TableKey` is exactly `keyof` this object, by construction.
 *
 * ONE HUNDRED AND FOURTEEN KEYS: 113 OF THE 117 TABLES, PLUS ONE VIEW, AND THE
 * SET IS NOT A PHASE'S. ADR-092 makes the owner the RELATION: it is registered
 * ONCE by the first session that needs it, the registration is never re-argued,
 * and a session computes its own slice from `TABLE_KEYS` on the tree it opened
 * rather than from a roster.
 *
 * `TableKey` NO LONGER MEANS "TABLE" AND ADR-209 IS WHERE THAT WAS DECIDED. One
 * key names `economic_calendar_current`, which `0039` creates with the migration
 * set's only `CREATE VIEW`. The name of the type is left alone deliberately: it
 * is `keyof TABLES` by construction and appears at hundreds of call sites, and a
 * rename would be a very large diff carrying no ruling. What the ADR fixes
 * instead is the CHECK, in `test/scoped-db.test.ts`, where a view is compared
 * against its own `CREATE VIEW` and against the relation it projects rather than
 * against a `CREATE TABLE` it does not have.
 *
 * THE VOCABULARY HAS SIX MEMBERS AND THE SIXTH IS ADR-191's. This file used to
 * say the question `HOW DOES A ROW REACH AN IDENTITY?` has "exactly these four
 * answers on this schema", and that sentence was FALSE about migrations that
 * have been in the tree since `0002`: four tables carry TWO columns declared
 * `REFERENCES identities(id)`, and the fifth answer is BOTH OF THEM. `pair` is
 * that answer, and the ruling attached to it is that a row belonging to two
 * identities is scoped to NEITHER -- see the `PairRule` docblock below.
 *
 * ADR-106 THEN CLOSED THE SET AT FIVE AND THAT SENTENCE WAS FALSE TOO, in a way
 * this file has recorded against `events` since session 195. Its arithmetic ran
 * over WHERE THE IDENTITY IS -- the row itself, one column of this row, a column
 * of another row, two columns of this row, or nothing -- and asked only whether
 * a SIXTH would be THREE columns of this row, which it measured at zero tables.
 * The enumeration is over PLACES and the answer that was missing is over PATHS:
 * a row may reach an identity by one column of ITSELF **or** by a column of
 * ANOTHER ROW, on the same table, with the row deciding which. `either` is that
 * answer -- see the `EitherRule` docblock below.
 *
 * `identity_links`, `dedupe_matches` AND `attributions` ARE REGISTERED `pair`
 * AND ARE STILL UNREADABLE THROUGH THE SCOPED ACCESSOR. THIS PARAGRAPH SAID
 * "UNREACHABLE" AND ADR-230 IS WHY THE WORD MOVED: `attributions` is now
 * WRITABLE by the buyer through `insertAsParty`, and the paragraph below is
 * about what a read RETURNS, which is untouched. The other two are unreachable
 * in both directions and their `writer` field says so with a reason. Their absence from
 * `ScopedTableKey` is now a CLASSIFICATION rather than a hole: they were
 * unregistered for four sessions because an `owned` rule names ONE column and
 * either choice returns a strict subset of a person's own rows, selected by
 * UUID ordering. The disjunction that would return the right rows is not
 * written, because returning the row to either party hands them the OTHER
 * party's identity uuid out of a `NOT NULL` column -- which is exactly what
 * `correlation_groups` below is already refused for at arity three, in its own
 * words, and the disclosure is WORSE at arity two rather than milder: at three
 * a member learns a set, at two they learn precisely who.
 *
 * `affiliate_commissions` IS STILL ABSENT AND ITS REASON MOVED ONE CLASS ALONG
 * RATHER THAN GOING AWAY. Its only path to an identity is `attribution_id uuid
 * NOT NULL REFERENCES attributions(id)`, and `attributions` is now a `TableKey`,
 * so a `derived` rule through it COMPILES where before it could not be written
 * at all. It would then throw the first time anybody read the table, for
 * `raw_ingest_rows`' reason exactly: `scopePredicate` recurses into the via
 * table and the `pair` branch of that switch refuses, so a derivation chain
 * terminates at `owned` or at `root` or it does not terminate. The suite refuses
 * it by name. Registering this table needs a ruling about what a row derived
 * from a two-party row belongs to, and ADR-106 does not make it.
 *
 * `identity_merges` IS ABSENT AND IT IS NO LONGER UNREGISTRABLE. It is the
 * fourth table in this tree carrying two `REFERENCES identities(id)` columns --
 * `surviving_identity_id` and `merged_identity_id`, both `uuid NOT NULL`
 * (0002_identity.sql), with `identity_merges_distinct` CHECKing that they are
 * different people -- so it is a `pair` table by the same derivation as the
 * three above and could be registered today. It is NOT registered here, on
 * ADR-092's own rule: a table is registered by the first session that NEEDS it,
 * M18 is the plan that names it,
 * and session 215's stop condition is four registrations. The refusal that stood
 * here since session 208 is DISCHARGED and replaced by this sentence.
 *
 * `events` IS REGISTERED AND IT IS THE SIXTH CLASS'S ONLY MEMBER (ADR-191).
 * It carries `identity_id uuid NULL REFERENCES identities(id)` AND `account_id
 * uuid NULL REFERENCES accounts(id)`, with NO CHECK tying them and neither one
 * required. That is not a `pair`: a pair is TWO IDENTITIES on one row, and this
 * is one identity beside one ACCOUNT, so `pair` has no second identity column to
 * name and both columns are nullable besides. All five earlier members were
 * tried against the shape and every one is either refused by a mechanical
 * assertion or silently lossy: `owned` on `identity_id` compiles and drops every
 * account-level row; `derived` through `account_id` is refused by ADR-101 clause
 * 1, because the row carries its own identity column, and again by clause 2,
 * because the edge is nullable; `pair` needs a SECOND IDENTITY column; `firm` is
 * refused by the suite's own assertion, because the row declares a column
 * against `identities(id)`; `root` is `identities`' alone.
 *
 * WHAT IT NEEDED WAS A SIXTH CLASS AND `either` IS IT. The rule names BOTH legs
 * and the predicate is their DISJUNCTION, because both halves are genuinely
 * read: EVENTS.md section 2 rows the portal's timeline as PER-ACCOUNT while M04
 * section 5 consumes identity-level events on the same screen, so a rule serving
 * one half is the `owned` failure with a new name. See the `EitherRule` docblock
 * for the arithmetic, for why precedence between the legs is REFUSED, and for
 * what a row reaching neither leg is.
 *
 * THE PAYLOAD OBJECTION IS RULED RATHER THAN CARRIED FORWARD. It ran: a row
 * whose own tenancy column is correct still names a DIFFERENT identity inside
 * `jsonb`, which INV-M4-06 forbids the portal to receive. `idempotency_keys`,
 * registered out of THIS SAME MIGRATION SET, already says in its own `why` that
 * "a scope rule states which ROWS reach an identity and nothing about what is
 * inside one", so the corpus had ruled the adjacent question the other way. What
 * survived of it was a real distinction -- `response_body` holds THIS person's
 * stored response and an `events` payload holds a THIRD PARTY's uuid -- and
 * ADR-191 section 6 rules ON that distinction rather than on the whole
 * objection. THE TWO EVENT NAMES ARE NAMED HERE RATHER THAN COUNTED, because a
 * count is a thing a later session has to re-derive and a name is a thing it can
 * grep: `kyc.dedupe_hit` carries `matched_identity_id` and `identity.merged`
 * carries `merged_identity_id`, and they are the whole of the set as of this
 * entry, read out of EVENTS.md section 3 rather than remembered. NEITHER IS
 * CONSUMED BY `TL`, which is the trader-facing consumer, so the corpus's own
 * catalogue already excludes both from the surface INV-M4-06 is about -- and
 * that exclusion is a PROJECTION and not this rule, which is exactly the
 * division ADR-191 section 6 rules. REGISTERING A TABLE MAKES IT READABLE AND
 * NOTHING ELSE, which is `risk_flags`' sentence and `evidence_packs`' sentence
 * arriving on the first table where the thing being read is `jsonb`.
 *
 * P5-b LOOKED AT IT WITH A FENCE THAT CONTAINED IT AND STOPPED, and that is
 * still worth a sentence because it is why this registration is an ENTRY. That
 * slice was dispatched to register this table by name, tried all five members,
 * was allocated no ADR number and was forbidden to take one, so it registered
 * `payment_disputes` and left this. Session 349 then measured the same wall from
 * downstream: a `Tx` naming `'events'` fails `tsc` with `TS2322` against
 * `TABLE_KEYS`, so the admin event feed could not be adapted. Registering the
 * table is what unblocks that adapter, and the adapter is a LATER SLICE.
 *
 * `reserve_coverage_snapshots` IS REGISTERED AND IT IS THE SIXTH CLASS'S
 * OPPOSITE: `events` needed a NEW member because five could not describe it, and
 * this table needed no argument at all because the DDL answers the question on
 * its own (ADR-199). It declares NO column against `identities(id)`, so `owned`,
 * `pair` and `either` have nothing to name, and `root` is `identities`' alone.
 * WHAT MAKES IT WORTH A PARAGRAPH IS THE ONE EDGE IT DOES CARRY, because a
 * session reaching for it would be reaching for the shape this file exists to
 * refuse: `reserve_coverage_snapshots_anchor_fk` is a COMPOSITE foreign key to
 * `treasury_balances(account_code, as_of)`, and `DerivedRule` names ONE
 * `localColumn` against ONE `foreignColumn`, so the rule cannot be written --
 * and naming the account code alone would compile, MULTIPLY ROWS, and terminate
 * at a `firm` table besides. `treasury_balances` is the table this registry's
 * own opening paragraph uses to show that auto-derivation is confidently wrong,
 * and its only dependent arrives one class away from the same mistake.
 *
 * `trading_calendar` IS REGISTERED AND IT COST NEITHER A CLASS ARGUMENT NOR A
 * RULING, WHICH IS WHY IT SAT HERE UNREGISTERED FOR TEN WAVES. The DDL answers
 * the question outright: `trading_day date PRIMARY KEY`, no foreign key at all,
 * and no column against `identities(id)` or `accounts(id)`, so four members have
 * nothing to name and the fifth has nothing to traverse. WHAT STOOD IN THE WAY
 * WAS A SENTENCE RATHER THAN A FACT. `0032` relaxes two of its columns with
 * `ALTER COLUMN ... DROP NOT NULL`, ADR-094's fold refused that shape, and
 * ADR-103 clause 2 SUPERSEDED exactly that clause and named this table as one of
 * the two the widening makes REGISTRABLE -- while the `why` of both its
 * satellites below, and two headers in `schema.ts`, went on saying it could not
 * be registered. Session 374 measured the cost from the far end: it is the first
 * of `readLiability`'s four blockers, and `eligible_next_7d` names this table as
 * its fold's fourth input. A REFUSAL IN A COMMENT OUTLIVES THE RULING THAT
 * SUPERSEDED IT, and the four sentences are repaired in the same commit as the
 * registration, because a stale refusal standing beside the thing it refuses is
 * worse than either alone.
 *
 * SO THE SCOPE CLASS WAS THE CHEAP HALF AND THE COLUMN CENSUS WAS THE WORK.
 * ADR-199's subject is `readLiability`, which projects three further figures --
 * `per_plan[].cusum`, `integrations.batch` and `eligible_next_7d` -- and the
 * entry rules ALL THREE DERIVABLE from columns that already exist, so it takes
 * no migration number. That belongs here rather than only in the entry because
 * the next session to open this file for that read path would otherwise start
 * by re-measuring what it needs: registering this table is the whole of what
 * `packages/db` owed `readLiability`.
 */
export const TABLES = {
  identities,
  users,
  sessions,
  planVersions,
  planVersionSizes,
  purchases,
  accounts,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
  ledgerHalts,
  treasuryBalances,
  liabilitySnapshots,
  dailyMarks,
  ruleStates,
  contentDocuments,
  pageRevalidations,
  certificates,
  statisticDefinitions,
  publishedStatistics,
  proofLinks,
  reviewRequests,
  identitySignals,
  detectorDefinitions,
  detectorRuns,
  riskFlags,
  correlationGroups,
  coupons,
  couponRedemptions,
  pspWebhookEvents,
  midHealth,
  contactChannels,
  notificationKinds,
  notifications,
  notificationPreferences,
  otpSendBudget,
  identityPhones,
  kycFunnelEvents,
  kycVerifications,
  phoneChangeRequests,
  sanctionsScreenings,
  accountAdjustments,
  adminActions,
  alarmSuppressions,
  dualControlApprovals,
  economicCalendar,
  economicCalendarLoads,
  evidencePacks,
  identityRestrictionEpisodes,
  impersonationPageViews,
  impersonationSessions,
  planBreakerState,
  reportDeliveries,
  reportSchedules,
  affiliates,
  affiliateCreatives,
  affiliateClicks,
  payoutRequests,
  payoutTransfers,
  walletEntries,
  walletWithdrawals,
  walletSpendLimits,
  walletDormancy,
  plans,
  passkeys,
  integrationContracts,
  integrationDispatches,
  supportContextViews,
  simulationRuns,
  contractSpecs,
  fills,
  roundTrips,
  journalEntries,
  analyticsSnapshots,
  graduationBenefits,
  graduationInvitations,
  planSizeUnlocks,
  offerExperiments,
  priceFloors,
  offers,
  promotionalCreditGrants,
  accountStatusHistory,
  platformAccountRefs,
  provisioningQueue,
  platformEntitlements,
  ingestFiles,
  rawIngestRows,
  reconciliationRuns,
  reconciliations,
  loyaltyCriteria,
  loyaltyStates,
  loyaltyBenefitGrants,
  discordLinks,
  discordAnnouncements,
  geoRestrictions,
  tosVersions,
  tosAcceptances,
  certificateVerifications,
  idempotencyKeys,
  tradingCalendarLoads,
  tradingCalendarRevisions,
  // ADR-106. The four tables the registry could not hold. Three are `pair` and
  // the fourth is `firm` for a reason no other firm table has.
  identityLinks,
  dedupeMatches,
  attributions,
  otpChallenges,
  // P5-b. `payment_disputes` is one of the four tables ADR-092 section 3
  // measured as named by NO module plan at all, so it had no module to be
  // "its own" and waited for the first session that needed it. P5 is that
  // session: it is P-3's chargeback-window input.
  paymentDisputes,
  // P5-e. `payout_destinations` is the first table in this registry to be
  // registered by the SESSION THAT CREATED IT, which is ADR-092 section 2's
  // rule meeting its easiest case: the first session that needs a table is the
  // one that wrote its DDL, so there is no waiting reader and nothing to
  // re-argue.
  payoutDestinations,
  // ADR-191. THE SIXTH CLASS'S ONLY MEMBER, and the table two sessions were
  // dispatched to register and neither could. It is `either`: one nullable
  // identity column of its own beside one nullable account column, so a row
  // reaches an identity through the first, or through the second, or through
  // neither. See the class docblock and this table's `why`.
  events,
  // ADR-199. THE TABLE `0049` CREATED AND NOTHING COULD READ. It is `firm`, and
  // the class was settled by the DDL rather than argued: the row declares NO
  // column against `identities(id)`, and its one foreign key is a COMPOSITE
  // edge to `treasury_balances`, which is itself `firm`. Registering it makes
  // `readLiability`'s `reserve` group a keyed read instead of a `TS2322`.
  reserveCoverageSnapshots,
  // ADR-103 clause 2. THE TABLE A MERGED COMMENT SAID COULD NOT BE REGISTERED,
  // on a clause that had already been superseded. `firm`, and the class is the
  // DDL's answer rather than an argument: `trading_day date PRIMARY KEY`, no
  // foreign key at all, and no column against `identities(id)`. Registering it
  // clears the first of the four blockers session 374 measured on
  // `readLiability`, whose `eligible_next_7d` fold names this table as its
  // fourth input.
  tradingCalendar,
  // ADR-209 clause 1. THE FIRST REGISTERED RELATION THAT IS NOT A TABLE. It is
  // `0039`'s only `CREATE VIEW` and the only one in the migration set, and the
  // route that reads it (`apps/api/src/routes/economic-calendar.ts`) declares
  // its source against THIS relation and never the base table, in its own
  // words. `firm`, and the class is the projection's rather than a second
  // judgement: the view selects ten columns of `economic_calendar` unchanged,
  // `economic_calendar` is itself `firm`, and no column of either is declared
  // against `identities(id)`. Registering it clears the FIRST of the two
  // blockers `apps/api/test/wiring.test.ts` records on
  // `setEconomicCalendarSource`, and not the second.
  economicCalendarCurrent,
  // SD-M8-01. `derived` via `affiliates` on `affiliate_id`, which is
  // `affiliate_creatives`' and `affiliate_clicks`' rule a third time on a third
  // table that declares the identical edge. No ruling was needed and none was
  // taken. It clears the FIRST of `useAffiliateDeps`' obstructions and leaves
  // the other three standing.
  affiliateStatements,
  // ADR-237. THE OPERATOR DIRECTORY, AND BOTH KEYS ARE REGISTERED BY THE
  // SESSION THAT WROTE THE DDL, which is `payout_destinations`' and
  // `reconciliation_runs`' shape rather than `live_account_state`'s. The
  // argument for taking it now rather than leaving it to the reader is stated
  // rather than assumed: the next slice on this path is the one that mints an
  // operator session, it needs BOTH relations on its first line, and leaving
  // them unregistered would make it open `packages/db` for a transcription this
  // session has already done.
  //
  // FIRM ON BOTH, AND THE DDL SETTLES IT ON ADR-199's PREDICATE rather than on
  // a fresh argument: no column of either row is declared against
  // `identities(id)` or `accounts(id)`, so `owned`, `pair` and `either` have
  // nothing to name and `root` is `identities`' alone.
  //
  // THE AVAILABLE MISTAKE IS `derived via users` ON `operators`, AND `0042`
  // IS WHAT SUGGESTS IT: `impersonation_sessions.admin_user_id` REFERENCES
  // `users(id)`, so the estate already contains one modelling of an operator as
  // a trader-side row. `0073` declares no such column and ADR-237 section 6
  // refuses the edge, so there is nothing here for a derived rule to traverse
  // and a rule written through it would not compile.
  operators,
  operatorSessions,
} as const;

export type TableKey = keyof typeof TABLES;

/**
 * The six classes, partitioning one question: HOW DOES A ROW REACH AN IDENTITY?
 *
 * THE VOCABULARY WAS FOUR AND THE CLAIM THAT FOUR WAS ALL OF THEM WAS FALSE.
 * This declaration read "The question has exactly these four answers on this
 * schema", and `0002_identity.sql` has carried a counter-example since the day
 * the schema was written: a row whose subject is a PAIR of identities reaches
 * an identity through EITHER of two columns on it, and through both at once.
 * ADR-106 adds `pair` and states the arithmetic that closes the set at five --
 * a column of this row, a column of another row, two columns of this row, the
 * row itself, or nothing -- so the fifth member is the answer that was missing
 * rather than the first of many.
 *
 * IT WAS FIVE AND THE CLAIM THAT FIVE CLOSED IT WAS FALSE IN THE SAME WAY, about
 * a table this file has argued with by name since session 195. ADR-106's
 * arithmetic enumerates WHERE the identity is and asks only whether a sixth
 * would be a third column; `events` is a sixth that is not a third column at
 * all. It carries `identity_id uuid NULL` and `account_id uuid NULL`, so ONE ROW
 * reaches an identity the `owned` way, the NEXT reaches one the `derived` way,
 * and a THIRD reaches none -- and the table is one table. ADR-191 adds `either`,
 * and restates the closure over PATHS rather than places: a rule names one path
 * (`root`, `owned`, `derived`), or two paths of the SAME kind (`pair`), or two
 * paths of DIFFERENT kinds (`either`), or none (`firm`).
 *
 * WHAT A SEVENTH WOULD BE IS STATED SO THE NEXT SESSION MEASURES IT RATHER THAN
 * ARGUES IT: THREE paths on one row. ADR-191 does NOT claim that is zero, and
 * the reason is that ADR-106's measurement does not cover it: "no table declares
 * three columns `REFERENCES identities(id)`" is re-measured here and still true,
 * and it says nothing about a row carrying one identity column beside TWO
 * different tables that each reach an identity. That shape is UNMEASURED and is
 * registered as such rather than asserted away, which is the honest difference
 * between this closure claim and the two before it.
 */
export type ScopeClass = 'root' | 'owned' | 'derived' | 'pair' | 'either' | 'firm';

export interface RootRule {
  readonly class: 'root';
  /** The column that IS the identity. */
  readonly column: 'id';
  readonly why: string;
}

export interface OwnedRule {
  readonly class: 'owned';
  /** The identity column carried on the row itself. */
  readonly column: string;
  /** True when the column is nullable, which is how firm rows are excluded. */
  readonly nullable: boolean;
  readonly why: string;
}

export interface DerivedRule {
  readonly class: 'derived';
  /** The table this row reaches an identity THROUGH. */
  readonly via: TableKey;
  /** This row's column holding `via`'s key. */
  readonly localColumn: string;
  /** `via`'s column that `localColumn` points at. */
  readonly foreignColumn: string;
  /**
   * `hop` is a single-valued reference and a join is safe.
   * `semi-join` means the relationship is one-to-MANY in the direction being
   * traversed, so a join MULTIPLIES ROWS and the predicate must be an EXISTS.
   */
  readonly traversal: 'hop' | 'semi-join';
  readonly why: string;
}

/**
 * A ROW WHOSE SUBJECT IS A PAIR OF IDENTITIES. ADR-106.
 *
 * TWO COLUMNS OF THIS ROW ARE DECLARED `REFERENCES identities(id)` AND BOTH ARE
 * TRUE. `identity_links` and `dedupe_matches` carry `identity_a` and
 * `identity_b` under a canonical-order CHECK, so which column a person lands in
 * is decided by UUID ordering; `attributions` carries `buyer_identity_id` and
 * `affiliate_identity_id`, stored rather than joined because they are two
 * people at the moment of purchase. An `owned` rule names ONE column, and every
 * choice of one returns a strict subset of a person's own rows with no error
 * anywhere, which is the BOLA failure ADR-008 scoped the accessor to bound.
 *
 * THE RULING IS THAT SUCH A ROW IS SCOPED TO NEITHER PARTY, AND `pair` IS
 * EXCLUDED FROM `ScopedTableKey` EXACTLY AS `firm` IS. The reason is not that no
 * predicate exists -- `columnA = $1 OR columnB = $1` returns precisely the rows
 * that are this person's and no others -- it is that every row it returns
 * carries the OTHER party's identity uuid in a `NOT NULL` column. That is the
 * cross-identity read `correlation_groups` is already refused for at arity
 * three, in this file's own words, and it is worse at arity two: a member of a
 * three-account group learns a set, and a party to a two-identity row learns
 * precisely who.
 *
 * IT IS EXCLUDED FROM `FirmTableKey` TOO, AND THAT IS THE HALF WORTH CHECKING.
 * `firmDb()` takes no reason on ADR-102 clause 5's ground that "no identity is
 * at risk"; here TWO are. So a `pair` table is a `TableKey` that is a member of
 * NEITHER `ScopedTableKey` NOR `FirmTableKey` -- the first key in this registry
 * that is a member of neither -- and it is reachable only through
 * `systemDb(reason)`, where somebody has to write down why. The two key sets no
 * longer partition `TableKey`, and the suite asserts the three-way split rather
 * than the old two-way one.
 *
 * REGISTERING THE TABLE IS WHAT MAKES IT READABLE AT ALL. Unregistered is
 * unreachable through BOTH accessors, so M06's admin console and M07's
 * detectors -- the only readers of `identity_links` the corpus names -- had no
 * door. They have `systemDb('operator-console')` now, and traders still have
 * none.
 *
 * ADR-230 ADDS A WRITE AND LEAVES EVERY SENTENCE ABOVE STANDING, AND THAT
 * ASYMMETRY IS THE WHOLE OF THE NEW RULING. Everything above is about what a
 * query RETURNS: the disclosure is the OTHER party's identity uuid arriving in a
 * reader's hands out of a `NOT NULL` column. An INSERT hands the caller nothing
 * -- the door is `Promise<void>` and builds no `RETURNING` clause at all -- and
 * the counterparty it writes is a value the caller already held before it opened
 * the transaction. So ADR-106's ground is not outweighed here, it is ABSENT,
 * which is the shape ADR-191 already used to admit `either` to a key set `pair`
 * is excluded from. `scopePredicate`'s `pair` branch still throws and
 * `ScopedTableKey` still excludes every key in this class.
 *
 * `writer` IS THE PER-TABLE RULING AND IT IS REQUIRED, so a `pair` table
 * registered after this one cannot acquire a write door by saying nothing. Two
 * arms, both carrying a reason rather than a flag: `by: 'nobody'` leaves the
 * table exactly where ADR-106 left it, and `by: 'party'` names WHICH of the two
 * columns the writer must be. That column is STAMPED by the accessor out of the
 * handle's own identity and REFUSED to the caller, which is
 * `scopedInsertStatement`'s construction arriving on the one class that has a
 * second identity column beside the stamped one. Every row the door can write
 * therefore names the writer as a party, and a handler party to one pair cannot
 * write a row for another -- not because it is checked, but because there is no
 * parameter through which the writer's own column could be supplied.
 *
 * THE COUNTERPARTY IS THE CALLER'S AND THE DOOR VALIDATES NOTHING ABOUT IT,
 * which is stated here rather than left to be assumed: this construction proves
 * WHO IS WRITING and never who is being written about. `attributions` is where
 * that matters twice, because its two columns MAY name one person on a voided
 * row under `attributions_literal_self_deal_is_void` -- so a door that refused a
 * counterparty equal to the writer would make the literal self-deal row
 * UNWRITABLE and destroy the evidence SD-M8-05 exists to keep.
 */
export interface PairRule {
  readonly class: 'pair';
  /** One of the two identity columns. Order carries no meaning. */
  readonly columnA: string;
  /** The other. Asserted DISTINCT from `columnA`, and both against the DDL. */
  readonly columnB: string;
  /**
   * WHETHER A REQUEST HANDLER MAY WRITE ONE OF THESE ROWS, AND AS WHICH PARTY.
   * ADR-230.
   *
   * REQUIRED, on this file's own totality rule: a `pair` table registered after
   * this entry answers the question or does not compile. The answer is not
   * derivable from the DDL -- both columns are `uuid NOT NULL REFERENCES
   * identities(id)` on all three members and the DDL says nothing about who
   * authors the row -- so it is declared, like every other rule here, and it
   * carries its own reason.
   */
  readonly writer: PairWriter;
  readonly why: string;
}

/**
 * Who may write a `pair` row through a scoped handle. ADR-230.
 *
 * `column` IS ASSERTED TO BE `columnA` OR `columnB` rather than left to a
 * reader's care: the suite checks it against the rule it sits in and against the
 * DDL, and `pairInsertStatement` checks it again before it stamps, because a
 * third column name here would be a stamp into a column no identity is declared
 * on.
 */
export type PairWriter =
  | {
      readonly by: 'nobody';
      /** Why no party to this row is its author. */
      readonly why: string;
    }
  | {
      readonly by: 'party';
      /** Which of the two identity columns the WRITER is. Stamped, never supplied. */
      readonly column: string;
      /** Why that party, and why writing it discloses nothing. */
      readonly why: string;
    };

/**
 * A ROW THAT REACHES AN IDENTITY TWO DIFFERENT WAYS, AND WHICH WAY IS A FACT
 * ABOUT THE ROW. ADR-191.
 *
 * ONE NULLABLE IDENTITY COLUMN OF ITS OWN BESIDE ONE NULLABLE FOREIGN KEY TO A
 * ROW THAT CARRIES ONE. `events` declares `identity_id uuid NULL REFERENCES
 * identities(id)` and `account_id uuid NULL REFERENCES accounts(id)`
 * (0017_events_and_audit.sql), with NO CHECK tying them and neither one
 * required. This is not `pair`: a pair is TWO IDENTITY columns, both NOT NULL,
 * both true at once. Here the second column is an ACCOUNT, and on any given row
 * at most one of the two is the answer.
 *
 * THE PREDICATE IS THE DISJUNCTION AND NEITHER HALF MAY BE LOST, which is the
 * whole ruling. An `owned` rule on `identity_id` COMPILES and drops every
 * account-level row; a `derived` hop through `account_id` drops every
 * identity-level row. Both halves are genuinely read on one screen: EVENTS.md
 * section 2 rows the `TL` consumer as a PER-ACCOUNT chronological view, and M04
 * section 5 consumes `phone.verified` and `phone.change_requested`, which have
 * no account at all. A rule answering "whose row is this" for one half is the
 * `owned` failure with a new name.
 *
 * A ROW REACHING NEITHER LEG BELONGS TO NO IDENTITY AND IS RETURNED TO NOBODY,
 * and no second predicate is needed for it. SQL NULL never equals anything, so
 * `identity_id = $1` drops the firm rows on its own and the EXISTS drops them
 * again -- `ledger_accounts`' mechanism arriving on both legs at once. THIS IS
 * THE FIRST CLASS IN THIS REGISTRY WHOSE `firm` HALF IS A PROPERTY OF THE ROW
 * RATHER THAN OF THE TABLE, and a session that wants those rows reads them
 * through `systemDb(reason)` like every other firm row.
 *
 * PRECEDENCE BETWEEN THE LEGS IS REFUSED, AND IT IS THE ONE ALTERNATIVE THAT
 * LOOKS STRICTLY SAFER. Making the row's own column authoritative when populated
 * -- `identity_id = $1 OR (identity_id IS NULL AND EXISTS ...)` -- would
 * guarantee that no row is ever returned to two different identity uuids. It is
 * refused because the rows on which the two legs disagree are the rows a HARD
 * MERGE produces: a merge REPOINTS OWNERSHIP into the surviving `identities` row,
 * `accounts.identity_id` moves with it, and this table is APPEND-ONLY -- no
 * UPDATE, no DELETE, by 0017's own comment -- so an account-level event written
 * before a merge names the MERGED identity on the row and the SURVIVOR through
 * the account. Precedence hands that row to the identity that no longer logs in
 * and hides it from the person who owns the account, which is `purchases`' own
 * refusal in this file: "a strict subset of a merged person's purchase history,
 * silently". The disjunction returns it to both, and after a hard merge both ARE
 * one person.
 *
 * SO THE TWO UUIDS THIS RULE CAN REACH FROM ONE ROW ARE NOT TWO PARTIES, AND
 * THAT IS WHY THIS CLASS IS IN `ScopedTableKey` WHERE `pair` IS NOT. ADR-106
 * clause 2 excludes a pair table because every row a disjunction returns carries
 * the OTHER party's identity uuid out of a NOT NULL column. Here `identity_id`
 * is this person and `account_id` is this person's account: no row this
 * predicate returns discloses a second party through a tenancy column. That
 * ground is ABSENT rather than outweighed.
 *
 * WHAT IT STILL LOSES IS NAMED RATHER THAN LEFT TO BE FOUND: a merged identity's
 * own IDENTITY-LEVEL events. Those rows carry the dead uuid in `identity_id` and
 * no `account_id`, this table is append-only so the column is never repointed,
 * and `identity_merges` is not registered -- so the survivor's scoped read
 * cannot reach them by any rule this vocabulary can write. ADR-191 section 8
 * registers it; it is a consequence of append-only storage and not of this
 * class, and no sixth member fixes it.
 *
 * IT CARRIES NO `nullable` FIELD AND NEVER WILL, on ADR-101 clause 3's rule that
 * a field nothing reads and nothing checks is a second thing asserting itself.
 * BOTH columns being NULLABLE is the class rather than a property of one member,
 * and it is asserted against the migrations by the suite. That inverts ADR-101
 * clause 2 rather than evading it: that clause refuses a `derived` rule on a
 * nullable edge because the null rows are a subset it returns in silence, and
 * here the null rows are returned by the OTHER leg, which is the only reason a
 * nullable edge is admissible at all.
 */
export interface EitherRule {
  readonly class: 'either';
  /** The identity column carried on the row itself. NULLABLE by construction. */
  readonly column: string;
  /** The table this row ALSO reaches an identity through. */
  readonly via: TableKey;
  /** This row's column holding `via`'s key. NULLABLE by construction. */
  readonly localColumn: string;
  /** `via`'s column that `localColumn` points at. */
  readonly foreignColumn: string;
  /** As `DerivedRule.traversal`, and checked by the same assertion. */
  readonly traversal: 'hop' | 'semi-join';
  readonly why: string;
}

export interface FirmRule {
  readonly class: 'firm';
  /** Why no identity owns these rows. A reason, never a placeholder. */
  readonly why: string;
}

export type ScopeRule = RootRule | OwnedRule | DerivedRule | PairRule | EitherRule | FirmRule;

/**
 * THE REGISTRY. Total over `TableKey` by the `satisfies` clause below: omit a
 * table and this file does not compile; name one that is not in `TABLES` and it
 * does not compile either.
 */
export const SCOPE_RULES = {
  identities: {
    class: 'root',
    column: 'id',
    why: 'The row IS the identity. `identity_merges` repoints ownership, so `identities.id` is the hard-merged grain and the only correct root.',
  },

  users: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: '`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0002_identity.sql). A USER IS A LOGIN AND AN IDENTITY IS THE PERSON, and ADR-041 is why they are two tables: an identity may hold MORE THAN ONE user, so scoping this table by its own `id` would return a strict subset of the person and scoping by `identity_id` returns all of their logins.',
  },

  sessions: {
    class: 'derived',
    via: 'users',
    localColumn: 'user_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "THE ROW REACHES AN IDENTITY THROUGH `users` AND THROUGH NOTHING ELSE, and the other candidate column is this file's own named trap: `device_fingerprint_id` references `identity_signals`, so a derivation through it reaches WHOEVER SHARES A DEVICE rather than whoever logged in. `user_id uuid NOT NULL REFERENCES users(id)` is single-valued, so the hop cannot multiply rows. A session belongs to a LOGIN, so an identity holding two logins has sessions under both and a scoped read returns both, which is what the trader-visible active-sessions list (SD-M4-03) is for.",
  },

  planVersions: {
    class: 'firm',
    why: 'The published product catalogue. There is no identity column and there is no correct one: EVERY identity is sold the same plan version, and the link runs the other way -- `accounts.plan_version_id` names the version an account was bought under -- so ownership flows FROM the catalogue rather than to it. The public rules pages read it unscoped and that is not a leak: a published plan version is the contract the firm offers in public.',
  },

  planVersionSizes: {
    class: 'firm',
    why: "The price and risk grid of a published plan version, one row per size. There is no identity column and there is no correct one, for `plan_versions`' reason exactly one hop out: EVERY identity is sold the same grid, and an account names the version it was bought under rather than the grid naming a buyer. A `derived` rule through `plan_versions` is not a milder mistake, it THROWS: `scopePredicate` recurses into the via table, the via table is `firm`, and a derivation chain terminates at `owned` or at `root` or it does not terminate. A firm parent makes the whole chain firm rather than making the child derivable.",
  },

  purchases: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0006_commerce.sql). `user_id` is also present, is also NOT NULL, and is NOT the scope: a user is a login and an identity is the person (ADR-041), and this table's own DDL says the two are recorded separately because THEY CAN DIFFER AFTER A MERGE and the difference is evidence. Scoping by the login would therefore return a strict subset of a merged person's purchase history, silently, which is exactly the reading `accounts` refuses for the same pair of columns.",
  },

  accounts: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: '`identity_id uuid NOT NULL REFERENCES identities(id)` on the row (0007_accounts.sql). `user_id` is also present and is NOT the scope: a user is a login and an identity is the person, and ADR-041 is why they are two columns.',
  },

  ledgerAccounts: {
    class: 'owned',
    column: 'identity_id',
    nullable: true,
    why: "NULLABLE ON PURPOSE. `scope` is CHECKed to ('firm','identity') and the table's own constraint ties it to `identity_id`: an identity row has one, a firm row has NULL. Filtering `identity_id = $1` excludes `firm_treasury`, `psp_clearing`, `fees_revenue`, `reserve` and `withdrawals_in_flight` WITHOUT a second predicate, because SQL NULL never equals anything.",
  },

  ledgerEntries: {
    class: 'derived',
    via: 'ledgerAccounts',
    localColumn: 'ledger_account_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: 'One declared hop to `ledger_accounts`, which carries the identity. `ledger_account_id` is NOT NULL and single-valued, so a join cannot multiply rows.',
  },

  ledgerTransactions: {
    class: 'derived',
    via: 'ledgerEntries',
    localColumn: 'id',
    foreignColumn: 'transaction_id',
    traversal: 'semi-join',
    why: 'THE TABLE CARRIES NO IDENTITY COLUMN AT ALL and reaches one only through its entries -- of which it has MORE THAN ONE. Double-entry means a trader leg and a firm leg on the same transaction, so a plain join through `ledger_entries` returns the transaction ONCE PER MATCHING ENTRY. The predicate is an EXISTS for that reason, and the reason is arithmetic rather than style.',
  },

  treasuryBalances: {
    class: 'firm',
    why: "Merit's own bank and PSP balances. No identity owns them. THE TRAP IS `recorded_by`, which references `users`: a derived rule would scope the firm's treasury to whichever admin typed the attestation. That column records WHO ASSERTED THE BALANCE and says nothing about whose money it is.",
  },

  liabilitySnapshots: {
    class: 'firm',
    why: "EC-095's three named numbers, aggregated across every identity. There is no identity column and there is no correct one: a per-identity slice of a firm-wide liability total is not a smaller version of it.",
  },

  dailyMarks: {
    class: 'derived',
    via: 'accounts',
    localColumn: 'account_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT` (0014_marks.sql), and `accounts` carries the identity. NOT NULL and single-valued, so a join cannot multiply rows. The grain is ONE ROW PER ACCOUNT PER TRADING DAY and a correction is a NEW row pointing the old one at it rather than an UPDATE, so a scoped read returns the superseded rows as well as the current one -- which is correct: what Merit believed on the day is the trader's own evidence, and `superseded_by` reaches only other rows of this same table, so the supersession chain never leaves the account it belongs to.",
  },

  ruleStates: {
    class: 'derived',
    via: 'accounts',
    localColumn: 'account_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT` (0015_rule_states.sql), and `accounts` carries the identity. NOT NULL and single-valued, so a join cannot multiply rows. The grain is ONE ROW PER ACCOUNT PER TRADING DAY: the day is the grain and the tenancy is the account's, so this is `accounts`' rule exactly one hop out and the day contributes nothing to who may read it.",
  },

  contentDocuments: {
    class: 'firm',
    why: 'The published pages, posts, FAQs and legal texts. There is no identity column and there is no correct one: a legal document is the SAME document for every reader, and an identity that ACCEPTED one is recorded on the acceptance rather than on the text. Supersession rather than update is the discipline here, so the row a trader accepted is still readable after it stops being current, and `checksum` is what makes that a provable artifact (SD-M9-02).',
  },

  pageRevalidations: {
    class: 'firm',
    why: 'A cache-invalidation log for the public surface: one row per request to re-render a set of public paths. No identity owns a re-render of a page every reader sees. `reference_id` is deliberately untyped in the DDL -- it names whatever the `trigger` was about, a plan version or a content document -- so it declares no foreign key and there is nothing a derived rule could traverse even if the rows belonged to somebody.',
  },

  certificates: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0020_public_surface.sql). THE ROW CARRIES TWO PATHS TO AN IDENTITY AND THE DIRECT COLUMN IS THE RULE: `account_id` reaches the same identity one hop out through `accounts`, and a derived rule through it would make this table's tenancy depend on a join rather than on a column the database itself declares against `identities(id)`. `code` is the public verification token and is DISTINCT from `id` so it can be rotated after an incident (SD-M11-01); a revoked or deferred certificate is still this identity's row, which is why revocation is a column here and never a deletion.",
  },

  statisticDefinitions: {
    class: 'firm',
    why: 'WHAT A PUBLISHED STATISTIC IS: the two specs, the window, the exclusions, the declared measure set and the methodology page. There is no identity column and there is no correct one -- a definition is the method rather than a number about anybody, and it is the same method for every reader. Rows are versioned and superseded, never edited in place, so the definition a figure was published under stays readable after it stops being current.',
  },

  publishedStatistics: {
    class: 'firm',
    why: "An aggregate over EVERY identity, published on a public page. There is no identity column and there is no correct one, which is `liability_snapshots`' reason on a different surface: a per-identity slice of a firm-wide pass rate is not a smaller version of it, it is a different statistic with a sample size of one. A suppressed row EXISTS rather than being omitted, so the suppression is visible rather than a gap in a series, and a correction is a new row pointing at what it restates.",
  },

  proofLinks: {
    class: 'firm',
    why: 'The published list of things a reader can verify for themselves: chain addresses, third-party trackers, the certificate verification page. No identity owns a link Merit publishes about itself. `scope_note` is NOT NULL because a proof link with no stated scope is a claim the reader gets to interpret (SD-M12-04), and that is a property of the published row rather than of any reader.',
  },

  reviewRequests: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0021_transparency.sql). One row per time Merit asked a person for a public review, and the row is ABOUT THAT PERSON. `trigger_class` carries 'unfavorable' as a first-class member and a row that was never sent still exists carrying `suppressed_reason` (SD-M12-03), so the rows a review-farming design would omit are the ones this table is shaped to keep -- and they are the asked person's rows exactly as the sent ones are.",
  },

  identitySignals: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0002_identity.sql). THE ENTITY GRAPH'S NODES, AND A SHARED VALUE PRODUCES TWO ROWS RATHER THAN ONE SHARED ROW: two identities behind one coffee-shop IP each get their own row carrying their own `identity_id`, so the `owned` rule returns each of them exactly their own observations and never the other's. THIS TABLE IS THE OTHER END OF THIS FILE'S NAMED TRAP AND IS NOT THE TRAP: `sessions.device_fingerprint_id` references it, so deriving SESSIONS through it reaches whoever shares a device, which is a defect in a rule for `sessions` and says nothing about this table, whose own identity column is direct, single and NOT NULL. `value_hash` is `bytea` because the observation is stored as a digest and never raw (INV-M7-08), which is why a row is evidence of a MATCH rather than a copy of the value that matched.",
  },

  detectorDefinitions: {
    class: 'firm',
    why: "A DETECTOR'S PARAMETERS, VERSIONED, WITH AN EFFECTIVE DATE. There is no identity column and there is no correct one: a threshold is tuned about the whole population and is the same threshold for every trader, and the link runs the other way -- a `detector_runs` row names the detector and version it ran under. `is_sensitive` defaults to true because a leaked parameter tells the adversary exactly where the line is (SD-M7-03), which is a reason this table must not be trader-readable at all rather than a reason it belongs to some trader.",
  },

  detectorRuns: {
    class: 'firm',
    why: "ONE ROW PER DETECTOR PER NIGHT, OVER THE WHOLE POPULATION. There is no identity column and there is no correct one: a run scans every account, and the identities it touched are its OUTPUT -- recorded on `risk_flags`, which carries its own `identity_id` -- rather than its owner. `synthetic_expected` and `synthetic_found` make a silent detector a FAILURE STATE rather than a clean night (INV-M7-07, SD-M7-01), and that is a property of the run and of the firm's own detection health, which no trader owns and none may read.",
  },

  riskFlags: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0008_risk.sql). A FLAG IS ABOUT A PERSON AND `account_id` IS NOT THE SCOPE: it is NULLABLE, because a flag can be about the identity with no account named at all -- entity_cap, payment_velocity and name_mismatch are identity-level findings -- so a derived rule through `accounts` would silently drop exactly the flags that are about the person. REGISTERING A TABLE MAKES IT READABLE AND NOTHING ELSE, and this rule answers HOW A ROW REACHES AN IDENTITY rather than who may read it: INV-M7-10's no-detector-detail promise is enforced on `evidence_packs` by `evidence_packs_trader_gets_no_detector_detail`, which is a different table and is not registered here. Severity 4 is why the table is money-ADJACENT: ADR-040's `G-HOLD-REQUIRED` holds a payout on an unresolved 4+ flag, so a rule returning another identity's flags would hold the wrong person's money.",
  },

  correlationGroups: {
    class: 'firm',
    why: 'A GROUP-LEVEL FINDING SPANNING THREE OR MORE ACCOUNTS, AND THE `firm` CLASS HERE IS A REFUSAL RATHER THAN A DEFAULT. `correlation_groups_is_a_group` starts the table at three members and M07 section 3.4 filters same-identity clustering AT THE DETECTOR, so a row that exists is a finding about MORE THAN ONE identity by construction and no single identity owns it. `member_account_ids` is `uuid[]`, which this vocabulary cannot traverse in any case -- `DerivedRule` names one `localColumn` against one `foreignColumn`, and an array is neither a `hop` nor a `semi-join` -- but the reason it MUST NOT be traversed is stronger than the reason it cannot: returning the row to each member would tell every member which OTHER accounts the detector grouped them with, which is a cross-identity read and the BOLA failure ADR-008 scoped the accessor to bound. `systemDb` reads it and `scopePredicate` says so by throwing rather than by returning nothing.',
  },

  coupons: {
    class: 'firm',
    why: "The firm's discount codes. There is no identity column and there is no correct one: a coupon is an OFFER MERIT MAKES, and the thing a buyer holds is the REDEMPTION, which is `coupon_redemptions` and carries `identity_id NOT NULL`. THE TRAP IS `affiliate_id`: it references `affiliates`, so a derived rule through it would scope a launch code to whoever is CREDITED for it, which says who gets paid when the code is used and nothing about whose row it is -- and the column is NULLABLE, so most codes name no affiliate and would reach nobody at all. `redemption_count` and `max_redemptions` are counters over every identity, so a per-identity slice of this row is not a smaller version of it.",
  },

  couponRedemptions: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: '`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0006_commerce.sql), and the DDL states why the column is the identity rather than the email: LIMITS ARE PER IDENTITY, because an email limit is a limit on typing and not on people. `purchase_id` is also present and is NOT the scope: it is NULLABLE, null while the claim is HELD and the payment is in flight, so a derivation through `purchases` would return only the redemptions that were paid for -- and the rows it would drop are exactly the claim-and-abandon ones this table keeps on purpose, since a release writes `released_at` rather than deleting the row.',
  },

  pspWebhookEvents: {
    class: 'firm',
    why: "Raw inbound payment events, kept SEPARATELY from `events` because these are THIRD-PARTY ASSERTIONS rather than facts Merit generated (0006_commerce.sql), and the distinction matters the day one of them turns out to be wrong. No identity owns a processor's statement about a payment; the buyer's row is `purchases`. THE TRAP IS `purchase_id`, AND IT IS NULLABLE AND WRITTEN LATE: the handler binds it during processing, so a derived rule would make a row's tenancy a function of whether a job has run yet, the same event belonging to nobody while it is `out_of_order_deferred` and to somebody once it is `applied`. A `rejected_signature` row is stored precisely because its signature did NOT verify, so it belongs to nobody permanently. A class that answers 'whose row is this' differently before and after a re-drive is not an answer.",
  },

  midHealth: {
    class: 'firm',
    why: "SD-M3-03. One row per PSP per window: attempts, declines, chargebacks, and the two basis-point rates the failover decision is made from. There is no identity column and there is no correct one -- the row is about a PROCESSOR, and its counters are aggregates over every identity's card volume, so a per-identity slice of a decline rate is not a smaller version of it. The denominator rule the column names carry (both rates against CARD volume, never total volume, because wallet purchases carry no chargeback exposure) is a property of the published row rather than of any reader.",
  },
  contactChannels: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0019_notifications_and_community.sql). THE ADDRESSES ONE PERSON HAS USED, INCLUDING THE ONES THEY NO LONGER USE, and the superseded rows are the point rather than residue: INV-M16-03's account-takeover countermeasure notifies the PRIOR contact for a window after a change, which is impossible against a value somebody overwrote. So a scoped read returns the live row and every superseded one, and all of them are this identity's. WHAT THE READ RETURNS IS SEALED RATHER THAN LEGIBLE, per ADR-046: `value_hash` is a digest and `value_ciphertext` is envelope-encrypted under a key named by `value_key_id` AND NOT PRESENT IN THIS DATABASE, so scoping this table grants the rows and not the addresses. `complained_at` is a fact about the DESTINATION rather than a preference (INV-M16-13) and moves nothing here either.",
  },

  notificationKinds: {
    class: 'firm',
    why: "THE POLICY CATALOGUE, one row per kind of message Merit sends. There is no identity column and there is no correct one: a kind is the SAME kind for every trader, `class` decides what a preference may silence and decides it once for the estate, and the link runs the other way -- `notifications.kind` names the kind a message was sent under -- so ownership flows FROM the catalogue exactly as it does from `plan_versions`. THIS TABLE IS THE PLAUSIBLE VERSION OF `plan_version_sizes`' MISTAKE: `notifications.kind` and `notification_preferences.kind` are both `NOT NULL REFERENCES notification_kinds(kind)` (0019_notifications_and_community.sql), which reads exactly like the `hop` `daily_marks` makes to `accounts` and is not one, because a derivation chain terminates at `owned` or at `root` and a firm parent makes the whole chain firm. Both of those tables carry `identity_id` on the row and are scoped by it.",
  },

  notifications: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0019_notifications_and_community.sql). ONE ROW PER MESSAGE MERIT SENT ONE PERSON, and the row is about that person. `kind` IS THE OTHER CANDIDATE COLUMN AND IT IS A TRAP: it is a NOT NULL foreign key to `notification_kinds`, which is FIRM, so a derived rule through it compiles at every call site, is a member of `ScopedTableKey`, and throws the first time anybody reads the table. `class` and `template_version` are denormalized here at send time because the class a message was SENT under is a historical fact and the kind's class today is a current policy; reclassifying a kind must not rewrite what was already sent, and neither column moves the tenancy. `read_at` is a convenience and never evidence of notice (INV-M16-09), so a scoped read returns unread, undelivered and suppressed rows alike: they are all this identity's record of what Merit tried to tell them.",
  },

  notificationPreferences: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0019_notifications_and_community.sql), and it is the first column of the composite primary key `(identity_id, kind, channel)`. THE ROW IS A PERSON'S ANSWER ABOUT ONE KIND ON ONE CHANNEL. `kind` is `notifications`' trap repeated and is again not the scope, for the same reason: `notification_kinds` is firm. WHAT A PREFERENCE MAY DO IS DECIDED ONE TABLE OVER AND NOT HERE -- a row against an immutable kind is permitted to exist and is ignored by the send path, because refusing to store it produces a settings screen that lies about what it saved -- so this table's tenancy says nothing about whether the preference binds.",
  },

  otpSendBudget: {
    class: 'firm',
    why: "PRE-IDENTITY BY CONSTRUCTION, which is a stronger statement than 'no identity column'. INV-M16-12 splits INV-M16-11: a message to an authenticated recipient at an address Merit already holds is exempt from rate limiting, and a message to an ATTACKER-SUPPLIED DESTINATION BEFORE ANY IDENTITY EXISTS is not. This table is the second one's control, so there is nobody to own a row and there could not be -- the whole premise of the rows is that nobody has proved who they are yet. THE COLUMN A DERIVATION WOULD REACH FOR IS `scope_key` AND IT IS NOT AN IDENTITY: for 'phone' it holds `encode(phone_hash,'hex')` and never the number, for 'ip' the address, for 'country' the alpha-2 and for 'global' the literal 'global'. It declares no foreign key, so there is nothing to traverse even if the rows belonged to somebody, and a per-identity slice of a global cost circuit breaker is not a smaller version of it.",
  },
  identityPhones: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0029_phone_identity_and_auth.sql). A VERIFIED PHONE IS AN IDENTITY NODE AND NOT A CONTACT FIELD, which is ADR-039 (a) and (b) and is why this table is not `contact_channels`: the delivery address is a preference and this is an identity signal, and collapsing the two is how a contact-preference edit becomes an identity change. SUPERSESSION AND RELEASE RATHER THAN UPDATE, so a prior number remains a row -- ADR-039 (c) requires notifying it -- and a scoped read returns the superseded and released rows as well as the live one, which is correct: the history is the person's own evidence, and `superseded_by` reaches only other rows of this same table. THE PHONE -> IDENTITY DIRECTION IS DELIBERATELY NOT UNIQUE (`identity_phones_live_number_idx`), so one number may be live on more than one identity and a rule scoping by `phone_hash` would return STRANGERS' ROWS; the identity column is the only correct one and the non-uniqueness is what makes that a real distinction rather than a pedantic one.",
  },

  kycFunnelEvents: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0003_kyc.sql). Telemetry ABOUT ONE PERSON'S PASSAGE THROUGH THE GATE, one row per step, and the step vocabulary carries 'abandoned' as a first-class member because THE ABANDONMENT IS THE MEASUREMENT (AS-M19-08): the traders who matter most to the adjudication are the ones who never created a verification row at all, so drop-off cannot be reconstructed from `kyc_verifications` and this table exists to hold what that one cannot. `0026_roles_and_grants.sql` revokes UPDATE and DELETE on it, so the record is append-only; that makes the rows immutable and does not make them firm -- an aggregate over every identity would be a different table, and the grain here is one identity's own funnel.",
  },

  kycVerifications: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0003_kyc.sql). THE ROW IS A REFERENCE TO A VERIFICATION AND NEVER THE VERIFICATION ITSELF: Merit never proxies identity documents, the client goes to the provider's hosted flow, and 0003's header states what is therefore stored -- status and references only, with every jsonb column holding provider decision metadata and never document data (VG-10). That is what makes the tenancy simple and it is also why the tenancy matters most here: these are the most sensitive rows in the estate and the only thing standing between one identity's verification history and another's is this column. A RE-VERIFICATION IS A NEW ROW AND NOT A RE-READ (SD-M19-01, INV-M19-06), so `supersedes` reaches only other rows of this same table and the supersession chain never leaves the identity it belongs to -- a scoped read returns the whole chain, which is correct, because what Merit believed at each check is the person's own record.",
  },

  phoneChangeRequests: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0029_phone_identity_and_auth.sql). THE ROW CARRIES TWO PATHS TO AN IDENTITY AND THE DIRECT COLUMN IS THE RULE: `old_phone_id` is `NOT NULL REFERENCES identity_phones(id)` and reaches the same identity one hop out, and a derived rule through it would make this table's tenancy depend on a join rather than on a column the database itself declares against `identities(id)`. That is `certificates`' shape and it carries `certificates`' unclosed gap with it -- nothing in the schema forces `old_phone_id`'s identity to equal `identity_id`, so a row whose prior phone belongs to A while its `identity_id` says B is representable, and under this rule it is B's request. Naming that here rather than repairing it, because a repair is a migration. The ceremony is state and not steps (ADR-039 (c) and (d)): dual-channel verification, prior-number notification and a still-running withdrawal hold are preconditions of reaching 'applied', asserted by `phone_change_requests_applied_is_complete`.",
  },

  sanctionsScreenings: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0003_kyc.sql). ONE ROW PER TIME MERIT SCREENED A PERSON, and the row is ABOUT THAT PERSON. It is a separate table from `kyc_verifications` rather than a field on it because folding it in would put a legally mandatory refusal in the same column as a blurry-photo rejection (INV-M19-05), and the separation is a tenancy fact as well as a review-path one: `reviewed_by` names a MERIT REVIEWER and is deliberately NOT a second path to an identity, for `treasury_balances.recorded_by`'s reason exactly -- it records who asserted the outcome and says nothing about whose screening it is. `list_refs` names which lists were screened and carries no person's name at all.",
  },
  accountAdjustments: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: '`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0038_account_adjustments.sql), and THE IDENTITY IS THE SCOPE BECAUSE THE ACCOUNT IS NULLABLE: `account_id uuid NULL` means an adjustment may name no account at all, so a derived rule through `accounts` would leave every accountless adjustment unreachable while looking correct on the ones that have one. This is the first table in the corpus that moves money to a named person and the first that permits taking it back (ADR-067), so the rows a scoped read returns are exactly the credits and reversals against that human -- which is the point: an adjustment nobody can see is a correction nobody can contest.',
  },

  adminActions: {
    class: 'firm',
    why: 'MERIT\'S RECORD OF ITS OWN OPERATORS. `reason text NOT NULL` is the control and 0017 states it as "NO UNEXPLAINED ADMIN ACTION, EVER"; the audience for that record is an auditor and never the subject. THE TEMPTING RULE IS `owned` ON `on_behalf_of_identity_id` AND IT IS WRONG IN THE DIRECTION THAT RETURNS ROWS: 0043 sets that column exactly when `initiative = trader_request`, by a biconditional CHECK, so a scoped read would return the actions Merit took FOR a person and silently omit every enforcement action it took AGAINST them -- a strict subset of the rows about that human, presented as all of them, which is `purchases`\' refusal on a different pair of columns. There is no column naming the identity an enforcement row is about: `subject_id uuid NOT NULL` is polymorphic, discriminated by `subject_kind`, and declares no foreign key at all.',
  },

  alarmSuppressions: {
    class: 'firm',
    why: "MERIT MUTING ITS OWN ALARM. The row records an operational decision about Merit's monitoring, and `expires_at NOT NULL` (SD-M6-03, INV-M6-06) is the control that makes the mute temporary. `scope jsonb NOT NULL` MAY NAME AN ACCOUNT OR AN IDENTITY AND THAT DOES NOT MAKE THE ROW THEIRS: a jsonb payload declares no foreign key, so there is nothing a predicate could compare, and a suppression is Merit's decision not to look rather than a fact about whoever it covers. THE UNSUPPRESSIBLE SET IS ENFORCED BY NOTHING TODAY -- `alarm_key text NOT NULL` carries no CHECK and no reference list -- which is M06 section 3.5's own stated limit and OQ-M6-05's open question, and nothing here closes it.",
  },

  dualControlApprovals: {
    class: 'firm',
    why: "TWO OPERATORS, ONE SENSITIVE ACT. The row is about Merit's own authorisation procedure and `dual_control_approvals_second_person` puts the control in DDL: the approver is not the requester. `subject_id uuid NOT NULL` is polymorphic, discriminated by `subject_kind`, and declares no foreign key, so it names the OBJECT being approved -- a price floor, a treasury movement, an adjustment -- rather than a person. `requested_by` and `approved_by` are `text` actor strings and not `users` rows, so there is no identity column here in either direction.",
  },

  economicCalendar: {
    class: 'firm',
    why: "WHEN A TIER-1 MACRO RELEASE IS SCHEDULED, which is a fact about the world rather than about anybody. Every identity reads the same calendar and D-04's news windows are computed from it for all of them at once. `load_id` reaches `economic_calendar_loads`, which is itself firm, so a derived rule would terminate at a firm parent and throw rather than being a milder mistake. `revision` makes each moved release time a NEW row, so what the calendar said when a detector read it is answerable forever -- which is what makes a flag raised against a trader defensible, and it is still a property of the calendar and not of the trader.",
  },

  economicCalendarLoads: {
    class: 'firm',
    why: "ONE ROW PER INGESTED PUBLICATION OF A THIRD PARTY'S RELEASE SCHEDULE. There is no identity column and there is no correct one: a load is the same load for every reader. `actor text NOT NULL` is 0002's actor idiom -- a loader or an operator, not a `users` row -- so it is not a path to anybody. The coverage window is what makes staleness answerable (FM-M7-08): a D-04 run over a day outside every load's coverage must refuse rather than report no releases, and that refusal is firm-wide.",
  },

  economicCalendarCurrent: {
    class: 'firm',
    why: "THE CURRENT REVISION OF EVERY OCCURRENCE, AND IT IS A VIEW RATHER THAN A TABLE (0039_economic_calendar.sql, ADR-209). `SELECT DISTINCT ON (event_key, occurrence_key) ... ORDER BY event_key, occurrence_key, revision DESC` over `economic_calendar`, which that migration calls the only definition of current anywhere. THE CLASS IS THE PROJECTION'S AND NOT A SECOND JUDGEMENT: the view selects ten of `economic_calendar`'s columns unchanged, renames nothing and computes nothing, so every column it offers is a column of a `firm` table and a rule of any other class would have to name a column that is not there. `load_id` IS THE AVAILABLE MISTAKE AND A VIEW CANNOT EVEN CARRY IT: a view declares no foreign key, so `derived` has no edge in the DDL for the suite's own assertion to find, and the target `economic_calendar_loads` is `firm` besides, so the chain would terminate nowhere -- which is `trading_calendar_revisions`' refusal arriving on a relation that has no constraints at all. IT IS REGISTERED BECAUSE THE READER READS IT: `apps/api/src/routes/economic-calendar.ts` declares `EconomicCalendarSource` against this view and NEVER the base table, and an adapter forced onto `economic_calendar` would re-derive the maximum revision in TypeScript, which is the second-source-of-truth failure FM-M7-08 guards and the exact thing the view exists to make impossible. IT HAS NO KEY, AND THE ABSENCE IS THE DDL. `id` is `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY` on the base table and a plain projected column here, so `uniqueKeys` finds nothing, every addressed write is refused before it reaches the database, and the database would have refused it too because a `DISTINCT ON` view is not auto-updatable. REGISTERING IT MAKES IT READABLE AND NOTHING ELSE, which is `events`' and `reserve_coverage_snapshots`' sentence on the first relation whose obstruction was its KIND rather than its tenancy.",
  },

  evidencePacks: {
    class: 'derived',
    via: 'accounts',
    localColumn: 'account_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT` (0008_risk.sql), and `accounts` carries the identity. NOT NULL and single-valued, so a join cannot multiply rows. A pack is an EXPORT OF ONE ACCOUNT'S EVIDENCE and the row is about whoever holds that account, which is why `audience` exists at all: SD-M6-04 makes a trader a possible recipient of a pack about themselves, and `evidence_packs_trader_gets_no_detector_detail` is what stops that channel from disclosing detector thresholds to the adversary who triggered them. REGISTERING THIS TABLE MAKES IT READABLE AND NOTHING ELSE -- the redaction profile is a property of the export and no scope rule enforces it.",
  },

  identityRestrictionEpisodes: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0031_payout_hold_and_identity_restriction.sql). ONE ROW PER TIME MERIT RESTRICTED A PERSON, and the row is ABOUT THAT PERSON rather than about the operator who opened it: `opened_by` and `restored_by` both reference `users` and are `treasury_balances.recorded_by`'s trap exactly -- they record WHO ACTED and say nothing about whose restriction it is. `identity_restriction_open_uq` allows at most one OPEN episode per identity, so the closed ones accumulate and a scoped read returns the whole history, which is what makes a contested enforcement defensible months later.",
  },

  impersonationPageViews: {
    class: 'derived',
    via: 'impersonationSessions',
    localColumn: 'impersonation_session_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`impersonation_session_id uuid NOT NULL REFERENCES impersonation_sessions(id) ON DELETE RESTRICT` (0042_impersonation_sessions.sql). NOT NULL and single-valued, so a join cannot multiply rows. EVERY PAGE AN OPERATOR SAW WHILE WEARING A TRADER'S SESSION, reaching an identity through the session's SUBJECT rather than through its admin, so the parent's trap is not re-entered one hop out. `impersonation_page_view_within_box` bounds every view to its session's two-hour box, which is what makes the read log complete rather than merely present.",
  },

  impersonationSessions: {
    class: 'owned',
    column: 'subject_identity_id',
    nullable: false,
    why: "`subject_identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` (0042_impersonation_sessions.sql). THE OTHER CANDIDATE COLUMN IS THIS FILE'S OWN NAMED TRAP: `admin_user_id` references `users`, so a derivation through it reaches THE ADMIN'S IDENTITY rather than the subject's and returns rows for the wrong person with no error anywhere. The row is about the trader who was worn, and ADR-069's whole argument is that provenance is what an evidence pack turns on: an admin-attributed action preserves it and an impersonated one destroys it, so the record of who was impersonated, by whom, for how long and why must be the SUBJECT'S row. The table carries no `user_id`, no `auth_factor`, no `elevated_at` and no `elevated_by_factor`, which is structural rather than an omission.",
  },

  ledgerHalts: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: '`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` at 0016:55, and THE DDL ARGUES THE RULE IN ITS OWN COMMENT rather than merely permitting it: "null is not permitted, because a halt with no subject is the global halt and the global halt is not a row, it is an incident." So this table needed no per-table ruling and only a session that reached it, which is why ADR-092 section 9 named it as one of four orphans nobody would. THE ROW IS ABOUT THE PERSON HALTED AND NOT ABOUT WHOEVER HALTED THEM, and this table cannot make `treasury_balances.recorded_by`\'s mistake even by accident: `halted_by` and `released_by` are `text` -- a detector name or an operator -- and declare no foreign key to `users` at all, so there is exactly one column here that reaches anybody. `ledger_halts_live_per_identity_uq` allows at most one LIVE halt per identity and the released ones accumulate, so a scoped read returns the whole halt history for that person, which is what makes a disputed freeze answerable months later. WHAT REGISTERING IT DOES NOT DO IS ENFORCE IT: no trigger anywhere reads this table, and 0016\'s own escalation index calls itself "the read every payout and withdrawal path makes before it moves money for this identity" -- a read, made by a code path, which until ADR-104 no code path made.',
  },

  planBreakerState: {
    class: 'firm',
    why: "ONE ROW PER PLAN PER EVALUATION DAY, and a per-plan loss ratio is an aggregate over every account on that plan. There is no identity column and there is no correct one: a per-identity slice of a plan's loss ratio is not a smaller version of it, which is `published_statistics`' reason on an internal surface. `plan_id` reaches `plans`, the product catalogue, so a derived rule would not be a milder mistake -- it would terminate at a firm parent and throw. The breaker is a control on MERIT'S OWN EXPOSURE and the trader-visible consequence of it is a plan being paused, which is a fact about the plan.",
  },

  reportDeliveries: {
    class: 'firm',
    why: 'ONE ROW PER ATTEMPT TO DELIVER A DIGEST TO MERIT\'S OWN STAFF. Its only foreign key is `schedule_id -> report_schedules(id)` and that parent is FIRM, so a derived rule here is `plan_version_sizes`\' refused shape exactly: `scopePredicate` recurses into the via table, the via table is firm, and a chain terminates at `owned` or at `root` or it does not terminate. The delivery-failure alarm reads this table and never the job\'s own report, and `due_at` is what makes absence detectable at all, because without it "nothing arrived" and "not due yet" are the same empty result set.',
  },

  reportSchedules: {
    class: 'firm',
    why: "WHAT MERIT SENDS ITSELF, ON WHAT CADENCE, TO WHICH OPERATOR MAILBOX. `recipients text[] NOT NULL` holds Merit's own staff addresses or a configured SFTP destination, never a trader's, and the row exists to give the C8 weekly risk ritual an input other than a human remembering to look. There is no identity column and there is no correct one. NO CREDENTIAL IS STORED HERE and there is deliberately no column that could hold one, so this table is not a fifth credential surface arriving without a ruling.",
  },

  affiliates: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0005_affiliate_program.sql), and AN AFFILIATE IS AN IDENTITY is the table's own DDL comment rather than an inference from the column: it is what makes the self-deal check possible at all (B4 #16) and what makes INV-M8-12's 'the affiliate is a human Merit has restricted' a query. THE TRAP IS `parent_id`, which references THIS TABLE for the sub-IB trees that are unused in v1: a derived rule through it would scope a person's own affiliate row to their RECRUITER, and on a null parent it would scope it to nobody. `balance_cents` is SIGNED money and negative is owed to Merit, so a wrong rule here is a debt shown to the wrong human.",
  },

  affiliateCreatives: {
    class: 'derived',
    via: 'affiliates',
    localColumn: 'affiliate_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`affiliate_id uuid NOT NULL REFERENCES affiliates(id) ON DELETE RESTRICT` (0005_affiliate_program.sql), and `affiliates` carries the identity. NOT NULL and single-valued, so a join cannot multiply rows. `reviewed_by` IS NOT THE TENANCY AND COULD NOT BE: the DDL declares it `text NULL` with no foreign key, so there is nothing to traverse, and a creative belongs to the affiliate who submitted it rather than to the operator who read it -- a rejected or withdrawn creative is still that affiliate's row, which is the compliance evidence INV-M8-08 is about.",
  },

  affiliateClicks: {
    class: 'derived',
    via: 'affiliates',
    localColumn: 'affiliate_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`affiliate_id uuid NOT NULL REFERENCES affiliates(id) ON DELETE RESTRICT` (0005_affiliate_program.sql), and `affiliates` carries the identity. NOT NULL and single-valued, so a join cannot multiply rows. A CLICK BELONGS TO THE AFFILIATE AND NOT TO THE PERSON WHO CLICKED, and the DDL is what decides that: the table has no identity column, no `user_id` and no `purchase_id`, because a click happens before anybody has signed in. The three columns that look like a clicker are the trap and none of them is a tenancy -- `ip` reaches whoever shares a network, `user_agent` reaches whoever shares a browser build, and `click_fingerprint` is `sessions.device_fingerprint_id`'s named trap arriving on a different table.",
  },
  affiliateStatements: {
    class: 'derived',
    via: 'affiliates',
    localColumn: 'affiliate_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`affiliate_id uuid NOT NULL REFERENCES affiliates(id) ON DELETE RESTRICT` (0012_disputes_and_affiliate_settlement.sql), and `affiliates` carries the identity. NOT NULL and single-valued, so a join cannot multiply rows. THIS IS THE THIRD TABLE ON EXACTLY THE SHAPE `affiliate_creatives` AND `affiliate_clicks` WERE REGISTERED ON, and it is registered without a ruling for that reason: the DDL declares one edge, the edge terminates one hop out at an `owned` table, and no column of this row is declared against `identities(id)` for ADR-101 clause 1 to refuse. WHAT A STATEMENT IS ABOUT IS THE AFFILIATE AND NEVER THE BUYERS WHOSE PURCHASES BUILT IT: the row carries `total_cents` and no line items, and the line items are `affiliate_commissions`, which is UNREGISTERED and stays so -- a scoped read of this table therefore returns a person their own periods and totals and hands them nobody else's uuid, which is the property that makes `derived` admissible here and refuses it one table over. `total_cents bigint NOT NULL` IS SIGNED and a clawback-heavy month is negative, so a wrong rule here shows one affiliate what another is owed; `affiliates.balance_cents` one hop out is signed for the same reason and is already `owned`. `paid_transfer_ref text NULL` IS THE AVAILABLE MISTAKE AND IT IS NOT A COLUMN A RULE COULD NAME: it carries no foreign key at all, so there is nothing to traverse, and it names a row in a payment provider's database rather than one in this one, which is `payout_destinations`' `destination_ref` argument arriving on the affiliate rail. A SCOPED READ RETURNS EVERY PERIOD INCLUDING THE VOID ONES, and that is deliberate: `status` admits `void` and `affiliate_statements_issued_has_date` keeps a non-draft statement's `issued_at` present, so what Merit told an affiliate and later voided stays quotable, which is `tos_acceptances`' history argument on a money document.",
  },

  payoutRequests: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0010_payouts.sql), and the DDL says in its own comment why the column is there at all: it is DENORMALIZED DELIBERATELY, because the aggregate-exposure question -- how much is this human extracting right now -- cannot be a join if it is being asked inside the race it is protecting against. `account_id` is also present, is also NOT NULL, and is NOT the scope: it reaches the same identity one hop out through `accounts`, and a derived rule through it would make THE PAYOUT TABLE'S tenancy depend on a join rather than on a column the database itself declares against `identities(id)`. That is `certificates`' reading on the money path, where a wrong answer returns another identity's payout history and, through `hold_flag_id` and `eligibility_snapshot`, the reasons Merit paid or held them.",
  },

  payoutTransfers: {
    class: 'derived',
    via: 'payoutRequests',
    localColumn: 'payout_request_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "THE TABLE CARRIES NO IDENTITY COLUMN AT ALL and reaches one only through the request it is executing. `payout_request_id uuid NOT NULL REFERENCES payout_requests(id) ON DELETE RESTRICT` (0010_payouts.sql) is single-valued and names that table's PRIMARY KEY, so the join cannot multiply rows and the traversal is a hop rather than a semi-join. The chain terminates at `payout_requests`, which is `owned`, so it ends at an identity rather than at a firm table. `destination_ref` is a PROVIDER-SIDE id and never bank details, and `name_match_reviewed_by` is an operator name rather than a `users` row, so neither is a second path to anybody.",
  },

  walletEntries: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0011_wallet.sql). THE TRAP IS `ledger_transaction_id`, which is NOT NULL and references a REGISTERED table, so a derived rule through it reads exactly like the legitimate hop `ledger_entries` makes -- and it is wrong twice over: `ledger_transactions` carries no identity column and reaches one by a SEMI-JOIN through its entries, so the chain would be longer, would traverse the firm leg of a double-entry posting, and could only ever answer the question this row's own NOT NULL column already answers. The table is APPEND-ONLY and a correction is a new entry rather than an update, so a scoped read returns the corrected row beside the correction, which is what makes a disputed balance explicable.",
  },

  walletWithdrawals: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: '`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0011_wallet.sql). THE EXTERNAL LEG IS A DIFFERENT OBJECT FROM A PAYOUT REQUEST (SD-M5-06): a payout request is a claim against an ACCOUNT evaluated by the engine, and a withdrawal is a movement of an ALREADY-SETTLED balance, so the row carries no `account_id` and there is no account for a derived rule to reach through. `freeze_flag_id` references `risk_flags`, which is `owned` by the same identity, and is still not the scope: it records WHY the rail was halted and would return nothing at all on the rows where it is NULL, which is nearly all of them.',
  },

  walletSpendLimits: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0011_wallet.sql), where it is also half of the primary key `(identity_id, effective_from)`. PER IDENTITY RATHER THAN GLOBAL IS THE WHOLE DESIGN (INV-M20-07): the limit that matters is the one on the compromised session, and a global limit is either set low enough to throttle legitimate traders or high enough to do nothing. A new limit is a NEW ROW at a later `effective_from` rather than an update, so a scoped read returns the person's whole history of limits and the current one is the greatest `effective_from` that has arrived. `set_by text NOT NULL` is an operator name in 0002's `actor` idiom and not a `users` row, so it is not a second path to an identity.",
  },

  walletDormancy: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid PRIMARY KEY REFERENCES identities(id) ON DELETE RESTRICT` on the row (0011_wallet.sql), so it is NOT NULL by the key and there is exactly one row per identity. OWNED AND NOT `root`, ALTHOUGH THE COLUMN IS THE WHOLE PRIMARY KEY: `root` means the row IS the identity and its column is `id`, and `identities` is the only table this vocabulary's root may name; this row is a fact ABOUT an identity that happens to be keyed by it. UNCLAIMED-PROPERTY OBLIGATIONS ARE JURISDICTIONAL AND REAL (INV-M20-09), and `notified_at timestamptz[]` is the proof Merit told the person before the balance became escheatable -- which is evidence a trader is entitled to read about themselves and about nobody else.",
  },

  plans: {
    class: 'firm',
    why: "The product catalogue's root row. There is no identity column and there is no correct one: EVERY identity is offered the same plan, and the link runs the other way -- a plan version names its plan and an account names its version -- so ownership flows FROM the catalogue rather than to it, which is `plan_versions`' reason one level up. `is_active` DELISTS AND NEVER DELETES (0004_catalog.sql), for a records reason rather than a UI one: a plan nobody can buy still has to explain the accounts sold under it, so a delisted row stays readable and stays firm. The public plan pages read it unscoped and that is not a leak, because a listed plan is what the firm offers in public.",
  },

  passkeys: {
    class: 'derived',
    via: 'users',
    localColumn: 'user_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "A CREDENTIAL BELONGS TO A LOGIN AND NOT TO A PERSON, so the row reaches an identity through `users` and there is no second candidate column on it to choose wrongly. `user_id uuid NOT NULL REFERENCES users(id)` (0002_identity.sql) is single-valued, so the hop cannot multiply rows. ADR-041 is why a login and a person are two things: an identity holding two logins holds passkeys under both and a scoped read returns both, which is the same answer `sessions` gives through the same hop, and it is what SC-M4-01 and SC-M4-11 render. `credential_id` is UNIQUE across the whole table rather than per user, which is WebAuthn's own rule and not a scope: uniqueness does not make the row firm and does not make it reachable without the hop.",
  },
  integrationContracts: {
    class: 'firm',
    why: "WHAT MERIT IS ALLOWED TO SEND A VENDOR, one row per integration per event per version (0018_integrations.sql). There is no identity column and there is no correct one: the SAME contract governs every dispatch to that vendor for every identity, and `field_allowlist text[] NOT NULL` holds field NAMES rather than anybody's values, so the row discloses nothing about a person even to a reader who has it. `approved_by text NOT NULL` is 0002's actor idiom and not a `users` row, so unlike `treasury_balances.recorded_by` there is not even a reference to walk wrongly; it records WHO AUTHORISED THE DISCLOSURE, which is a fact about Merit's own approval procedure. The link runs the other way: a dispatch names the vendor and the event it went under, and the contract names no dispatch.",
  },
  integrationDispatches: {
    class: 'owned',
    column: 'identity_id',
    nullable: true,
    why: "NULLABLE ON PURPOSE, WHICH IS `ledger_accounts`' SHAPE. `identity_id uuid NULL REFERENCES identities(id) ON DELETE RESTRICT` (0018_integrations.sql), and the DDL states the requirement in the direction that decides the rule: not every dispatch is about a person, and the ones that are not MUST NOT be findable by an identity search that returns them anyway. Filtering `identity_id = $1` excludes them without a second predicate, because SQL NULL never equals anything. THE ROW IS ABOUT THE PERSON DISCLOSED AND NOT ABOUT WHOEVER'S ACTION PRODUCED THE EVENT: `GET /admin/identities/:identityId/disclosures` is every field ever sent about this identity, per vendor, read from this table, and a privacy deletion request and a vendor breach ask that identical question. THIS IS WHERE THE TABLE PARTS FROM `psp_webhook_events`, whose nullable `purchase_id` is bound by the handler DURING processing so that a rule through it would answer 'whose row is this' differently before and after a re-drive; `identity_id` here is decided when the dispatch row is written, and none of `queued`, `sent`, `failed` or `dropped_by_guard` moves it. `event_id` reaches `events`, which is Merit's own fact rather than the disclosure of it. IT USED TO SAY \"AND IT IS UNREGISTERED BESIDES\" AND ADR-191 TOOK THAT HALF AWAY: `events` is a `TableKey` now, so a `derived` rule through it COMPILES where before it could not be written at all -- which is ADR-106's `affiliate_commissions` shape arriving on this table -- and it is refused on the first half of this sentence, which never depended on the second.",
  },
  supportContextViews: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` (0018_integrations.sql). ONE ROW PER TIME A SUPPORT AGENT READ A TRADER'S IDENTITY GRAPH, and the row is about THE TRADER WHO WAS READ rather than the agent who read: that is `impersonation_sessions`' question one surface out and it has the same answer. THERE IS NO SECOND IDENTITY COLUMN TO CHOOSE BETWEEN AND THAT IS STRUCTURAL: `agent_ref text NOT NULL` is an actor string declaring no foreign key, so the agent side is not a path to anybody, where `impersonation_sessions.admin_user_id` does reference `users` and is this file's own named trap. A support read happens OUTSIDE the admin origin's IP allowlist and hardware-key SSO, so an unaudited one is an unmonitored back door into the crown jewel (AS-M10-01, dossier item 9); `fields_returned` records what was RETURNED rather than what was requested, because a log of the request cannot answer what the agent actually saw. REGISTERING THIS TABLE MAKES IT READABLE AND NOTHING ELSE: per-agent breadth monitoring is a property of the read path and no scope rule enforces it.",
  },
  simulationRuns: {
    class: 'firm',
    why: "A MONTE CARLO RUN OVER A PROPOSED PLAN CONFIG, kept so a published version resolves to the projection it was decided on (M21 INV-M21-05). There is no identity column and there is no correct one: the subject of a run is a PARAMETER SET, its population is synthetic, and no person's rows are read to produce it. THE TRAP IS `requested_by`, and it is weaker than `treasury_balances.recorded_by` rather than stronger -- it is bare `text NOT NULL` with no foreign key at all, so it names no `users` row to derive through, and had it been one, scoping by it would return the firm's plan economics to whichever operator pressed the button. `plan_version_id` IS THE OTHER AVAILABLE MISTAKE and a `derived` rule through it THROWS rather than misleads: `scopePredicate` recurses into the via table, `plan_versions` is firm, and a chain terminates at `owned` or at `root` or it does not terminate. It is NULLABLE besides, because the run is over a DRAFT that may not yet be a row, which is what the two digests beside it exist to pin.",
  },
  contractSpecs: {
    class: 'firm',
    why: "THE INSTRUMENT CATALOGUE: what a tick is worth, per symbol, per effective date (0004_catalog.sql). No identity owns a contract specification and there is no column that could carry one -- the row is a fact about `ES` between two dates and is identical for every trader who ever traded it. THE PRIMARY KEY IS `(symbol, effective_from)` AND A SPEC CHANGE IS ANOTHER ROW, which is what makes a per-instrument figure computed months ago reproducible today. M13 section 7 requires the tick value to come from this table and never from a multiplier in analytics code (B4 #14), and a firm class is what says the read is the estate's rather than a person's.",
  },
  fills: {
    class: 'derived',
    via: 'accounts',
    localColumn: 'account_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT` (0013_ingest.sql), and `accounts` carries the identity. NOT NULL and single-valued, so a join cannot multiply rows. ONE EXECUTION AS THE VENDOR REPORTED IT, and every other reference on the row points at the ingest machinery -- `ingest_file_id` to `ingest_files`, `raw_row_id` to `raw_ingest_rows` -- or at another fill: `correction_of` REFERENCES THIS SAME TABLE, so the correction chain never leaves the account it belongs to and a scoped read returns the corrected fill beside its correction, which is `daily_marks.superseded_by`'s shape exactly. What Merit ingested and then corrected is the trader's own evidence.",
  },
  roundTrips: {
    class: 'derived',
    via: 'accounts',
    localColumn: 'account_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT` (0022_analytics_journal.sql), and `accounts` carries the identity. NOT NULL and single-valued, so a join cannot multiply rows. THE ROW IS A GROUPING OF THAT ACCOUNT'S OWN FILLS and the tenancy is the account's one hop out, which is `daily_marks`' rule exactly; `entry_fills` and `exit_fills` are `bigint[]` naming `fills.id` and are NOT a second path to an identity, because every fill in them is that same account's by construction. `derivation_version` pins WHICH grouping rule produced the row and contributes nothing to who may read it. REGISTERING THIS TABLE MAKES IT READABLE AND NOTHING ELSE: `net_result_cents` is presentational, `daily_marks` reconciles the account (INV-M13-02), and no scope rule enforces that separation.",
  },
  journalEntries: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` (0022_analytics_journal.sql). TWO COLUMNS ON THIS ROW REACH A PERSON AND ONLY ONE OF THEM IS TOTAL: `account_id` is NULLABLE, because a `day`-scoped entry need name no account, so scoping through it would silently drop every entry that names none -- a wrong answer that returns rows rather than an error. `identity_id` is the AUTHOR and the notes are the trader's own; Merit reads them for nothing, and M13 section 3.4 is an absence rather than a state machine. `deleted_at` IS A TOMBSTONE AND NOT THE END STATE, and a scoped read returns soft-deleted rows: registering this table makes it readable and the purge job is what makes deletion a promise (INV-M13-07).",
  },
  analyticsSnapshots: {
    class: 'derived',
    via: 'accounts',
    localColumn: 'account_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT` (0022_analytics_journal.sql), and `accounts` carries the identity. NOT NULL and single-valued, so a join cannot multiply rows. The grain is the PRIMARY KEY, `(account_id, as_of_trading_day)`: ONE SNAPSHOT PER ACCOUNT PER CLOSED DAY, so this is `daily_marks`' and `rule_states`' rule again and the day contributes nothing to who may read it. `payload jsonb` HOLDS COMPUTED STATISTICS ABOUT ONE ACCOUNT and reaches no other identity; `inputs_digest` is a hash of the input rows and not a reference to them.",
  },
  graduationBenefits: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0023_loyalty_and_graduation.sql). THE ROW REACHES AN IDENTITY TWICE AND THE DIRECT COLUMN IS THE RULE, which is `certificates`' rule taken as it stands: `account_id` is also NOT NULL and also reaches an identity, one hop out through `accounts`, and NO CONSTRAINT TIES THE TWO -- nothing in the DDL says this row's `identity_id` is the identity that owns its `account_id`. A derived rule through `accounts` would make this table's tenancy depend on a join rather than on a column the database itself declares against `identities(id)`, and it would silently disagree with the direct column the day the two differ. A BENEFIT IS THE TRADER'S OWN RECORD EVEN WHILE IT IS UNDECIDED: `conferred_at` and `withheld_reason` are nullable and exclusive by CHECK, so a benefit held for review is a row of theirs that says so rather than a row that is absent, which is INV-M18-10's whole point and the reason revocation here is a column and never a deletion.",
  },
  graduationInvitations: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0025_reserved_sequence.sql), and it is the table's ONLY reference, because an invitation is issued to the PERSON rather than earned by one of their accounts. RESERVED AND EMPTY AT LAUNCH IS A FACT ABOUT THE ROWS AND NOT ABOUT THE RULE: 0025's own COMMENT ON TABLE records that no live program exists (OQ-M18-01), and a rule states how a row WOULD reach an identity, so the empty table takes the rule the full one would. Registering it ships no program and confers no read on anybody -- ADR-092 section 9 is explicit that registration makes a table reachable through the scoped accessor and nothing else -- and `terms_version` is here from the first invitation rather than after the first dispute, so the terms a trader accepted stay readable as their own row.",
  },
  planSizeUnlocks: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0044_fee_back_and_ladder_unlock.sql), and ADR-070 section 3 rules that column IS the entitlement's grain rather than a field the ruling constrains: `identities.id` is the hard-merged grain because a merge repoints ownership into that row, nothing here reaches `identity_links`, so a soft-linked pair sharing an unlock is UNREPRESENTABLE rather than forbidden (INV-M18-11). TWO OTHER COLUMNS LOOK LIKE HOPS AND NEITHER IS ONE. `plan_version_id uuid NOT NULL REFERENCES plan_versions(id)` is this file's named trap in its most plausible dress -- A LADDER'S RUNGS ARE THE SAME FOR EVERYONE AND A TRADER'S POSITION ON IT IS THEIR OWN -- and `plan_versions` is FIRM, so a derivation through it constructs no predicate and throws the first time anybody reads this table. `earned_account_id uuid NOT NULL REFERENCES accounts(id)` is `graduation_benefits`' second path exactly: it records WHICH LADDER COMPLETED, which is what a dispute is argued from, and no constraint ties that account's identity to this row's. A REVOKED UNLOCK IS STILL THIS IDENTITY'S ROW, tied to a reason by `plan_size_unlocks_revocation_is_explained`, because a revocation without one is a disappearance.",
  },
  offerExperiments: {
    class: 'firm',
    why: "AN EXPERIMENT IS A THING MERIT RUNS AND NOT A THING ANYBODY OWNS. There is no identity column and there is no correct one: an arm is assigned to a POPULATION and the hypothesis is about the population, so a per-identity slice of an experiment is not a smaller version of it. `arms jsonb` holds arm DEFINITIONS rather than enrolments and there is no enrolment table in this tree, so nothing here reaches an identity even one hop out. The row a person actually holds is the `offers` row naming `experiment_id`, and that table carries the identity. `varies` is CHECKed to price, presentation and bundle_contents with no fourth value, which is 0024's own header: an experiment that varies a rule, a gate or a plan parameter cannot be written down at all (AS-M17-07).",
  },
  priceFloors: {
    class: 'firm',
    why: "THE HARD STOP UNDER STACKING ARITHMETIC, AND IT IS THE FIRM'S NUMBER (0024_offers.sql). The table declares no foreign key at all, carries no identity column, and there is no correct one, because a floor that differed per trader would not be a floor; `approved_by text NOT NULL` is an approver rather than a `users` row, on 0002's `actor` idiom. THE GRAIN IS `(product_ref, effective_from)` AND IT IS THE WHOLE PRIMARY KEY, so the table has no `uuid` of its own, and `dual_control_approvals.subject_id` is `uuid NOT NULL` (0016:227) -- so the dual control M17:150, EC-119 and `data-model/price_floors.md:2` all assert over this table cannot name its subject. THAT IS A FINDING AND NOT A REPAIR: a repair is a migration and a transcription holds none. Registering the table changes nothing about it either way, because a firm table is refused by the scoped accessor at compile time.",
  },
  offers: {
    class: 'owned',
    column: 'identity_id',
    nullable: true,
    why: "NULLABLE ON PURPOSE, AND THE DDL MAKES IT BICONDITIONAL. `offers_identity_scope_matches` CHECKs `(scope = 'identity' AND identity_id IS NOT NULL) OR (scope <> 'identity' AND identity_id IS NULL)`, so filtering `identity_id = $1` returns EXACTLY the rows the schema says are that person's and excludes every `public` and `segment` row without a second predicate, because SQL NULL never equals anything. THIS IS `ledger_accounts`' SHAPE AND NOT `coupons`': a coupon has no identity column and no correct one, while this row has one the DDL declares `REFERENCES identities(id)`, which is also why `firm` is refused here by the suite's own assertion rather than by taste. THE TRAP IS `experiment_id`: it is a foreign key to `offer_experiments`, which is FIRM, so a `derived` rule through it compiles at every call site -- `DerivedRule.via` is `TableKey` and includes every firm key -- and throws the first time anybody reads it. `loyalty_grant_id` is the same shape one table further out. WHAT THIS RULE DOES NOT RETURN IS SAID OUT LOUD: a `segment` offer names no segment, because the table has no segment column at all, so it is unreachable from any identity under any class in this vocabulary, and a scoped read of this table is THE OFFERS ADDRESSED TO A PERSON rather than the offers available to them.",
  },
  promotionalCreditGrants: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "THE TABLE THAT MINTS VALUE, and `identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` is on the row (0024_offers.sql). A grant is a named person's entitlement from the moment it exists and the DDL has no way to write an unowned one. NEVER WITHDRAWABLE (OQ-FREEZE-01): its own ledger class `promotional_credit` at 0009, and no `wallet_entries.provenance` value at 0011. `funding_purchase_id` IS THE DELTA'S CONTENT AND IS NOT THE SCOPE: it is NULLABLE, because a loyalty-issued or fee-back-issued grant has no funding purchase, so a derivation through `purchases` would return only the grants somebody bought and would drop exactly the ones no purchase funded. `source_offer_id` IS THE OTHER TRAP AND IT IS THIS MODULE'S CHARACTERISTIC ONE -- a redemption pointing at its catalogue row reads like a legitimate hop -- and it is nullable besides, so a grant issued from a `public` offer would reach nobody at all through it. `source_payout_request_id` is 0044's later column, folded by ADR-094, and is a settlement rather than a person.",
  },
  accountStatusHistory: {
    class: 'derived',
    via: 'accounts',
    localColumn: 'account_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT` (0007_accounts.sql), and `accounts` carries the identity. NOT NULL and single-valued, so a join cannot multiply rows. THE ROW IS ONE TRANSITION OF ONE ACCOUNT and it is the account's only reference: `from_status`, `to_status`, `from_phase` and `to_phase` are bare `text` state names, `reason` is free text, and THERE IS NO `changed_by` COLUMN AT ALL -- this table records WHAT MOVED and never WHO MOVED IT, so nothing here reads like the `treasury_balances.recorded_by` trap this file's header names. `accounts` splits phase from status on purpose (0007) and this log carries both halves of a transition, which changes nothing about who may read it.",
  },
  platformAccountRefs: {
    class: 'derived',
    via: 'accounts',
    localColumn: 'account_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT` (0007_accounts.sql, SD-M2-02), and `accounts` carries the identity. NOT NULL and single-valued, so a join cannot multiply rows. THE PRIMARY KEY IS `(platform, platform_account_ref)` AND IT IS THE BURN RATHER THAN THE TENANCY: INV-M2-10 says a platform ref is never reused across accounts, and a second row for the same pair cannot exist, so reassignment fails at insert. That is `price_floors`' and `contract_specs`' shape -- the grain is the composite key and the table has no `uuid` of its own -- and it contributes nothing to who may read the row. A RETIRED ROW IS STILL THAT ACCOUNT'S ROW: `retired_at` and `retired_reason` are nullable and tied by `platform_account_refs_retirement_is_explained`, and retirement is what makes the ref permanently unusable rather than what detaches it from the account that burned it.",
  },
  provisioningQueue: {
    class: 'derived',
    via: 'accounts',
    localColumn: 'account_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT` (0007_accounts.sql), and `accounts` carries the identity. NOT NULL and single-valued, so a join cannot multiply rows. ONE ROW PER INTENT, so partial success is legible, and M02 section 3.6 states the grain out loud: THE QUEUE IS PER ACCOUNT AND A RESTRICTION IS PER HUMAN, so one identity-level restriction episode fans out to one operation pair per account the identity holds and there is no identity-level row to enqueue. `payload jsonb` HOLDS THE FIELD VALUES RENDERED INTO CSV FOR THIS ACCOUNT and reaches no second person; `payload_hash bytea NOT NULL` is SD-M2-01's duplicate-intent guard over that payload and is a digest rather than a reference. REGISTERING THIS TABLE MAKES IT READABLE AND NOTHING ELSE: the binding rule over `operation` and `status` -- `set_risk` may never reach `confirmed_inferred` (AS-M2-03, INV-M2-13) -- is `provisioning_queue_set_risk_never_inferred` in the database, and no scope rule enforces or weakens it.",
  },
  platformEntitlements: {
    class: 'derived',
    via: 'accounts',
    localColumn: 'account_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT` (0007_accounts.sql), and `accounts` carries the identity. NOT NULL and single-valued, so a join cannot multiply rows. `platform_user_ref` IS THE AVAILABLE MISTAKE AND IT IS NOT A SECOND PATH TO AN IDENTITY: SD-M2-05 adds it because Rithmic bills per login-month per USER while the row stays per account, and it is `text NULL` with NO foreign key -- the VENDOR's identifier for a login, which names no row in this database at all. It is `simulation_runs.requested_by`'s shape rather than `sessions.user_id`'s. A DEACTIVATED ENTITLEMENT IS STILL THAT ACCOUNT'S ROW, `platform_entitlements_active_matches_dates` making `active` and `deactivated_on` biconditional, so the leak alarm's question -- any entitlement still active on a closed account -- stays answerable from the account's own rows.",
  },
  ingestFiles: {
    class: 'firm',
    why: 'A FILE IS A DELIVERY AND A DELIVERY BELONGS TO NO IDENTITY (0013_ingest.sql). One vendor file carries rows for every account that traded the session, so there is no identity column and no correct one: the table declares exactly ONE foreign key, `replaces_ingest_file_id`, and it points at ITSELF. The tenancy runs the other way -- `fills.ingest_file_id`, `raw_ingest_rows.ingest_file_id` and `reconciliations.source_ingest_file_id` all point IN, and two of those three carry their own `account_id`. THE QUARANTINE MACHINE IS WHY THE GRAIN IS THE FILE (B4 #4): a file in `quarantined` has committed NO downstream rows, so at the moment this row matters most there is no account row anywhere to reach it through. PROVISIONAL UNDER ADR-005 IN ITS CONTENT AND NOT IN ITS CLASS: the `kind` set, the disposition semantics and the delivery cadence are V-M2-01, V-M2-03 and V-M2-04, and none of the three can give a delivery an owner.',
  },
  rawIngestRows: {
    class: 'firm',
    why: "THE IMMUTABLE LANDING ZONE, and it is firm as a CONSEQUENCE rather than as a second judgment (0013_ingest.sql). Its only reference is `ingest_file_id uuid NOT NULL REFERENCES ingest_files(id) ON DELETE RESTRICT`, and `ingest_files` is firm, so a `derived` rule through it compiles at every call site -- `DerivedRule.via` is `TableKey` and includes every firm key -- and throws the first time anybody reads the table. THE REVERSE EDGE IS THE PLAUSIBLE MISTAKE AND IT PASSES EVERY MECHANICAL CHECK HERE: `fills.raw_row_id bigint NOT NULL REFERENCES raw_ingest_rows(id)` is a declared foreign key in a direction the derived-rule assertion accepts, so a rule through `fills` resolves, terminates at an owned table, and is still WRONG -- only some raw rows become fills, an EOD balance row becomes a `daily_marks` input, an unparsed row becomes nothing, and a quarantined file's rows become nothing by design, so the reading would drop exactly the rows a dispute is argued from. `raw jsonb` holds the vendor's verbatim columns for whichever account the line concerns and NO COLUMN ON THIS ROW SAYS WHICH.",
  },
  reconciliations: {
    class: 'derived',
    via: 'accounts',
    localColumn: 'account_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT` (0014_marks.sql), and `accounts` carries the identity. NOT NULL and single-valued, so a join cannot multiply rows. THE GRAIN IS ONE ACCOUNT'S BALANCE, OURS BESIDE THEIRS, FOR ONE TRADING DAY, which is `daily_marks`' rule exactly and the day contributes nothing to who may read the row. `source_ingest_file_id` IS THE TRAP AND IT IS THIS MODULE'S CHARACTERISTIC ONE: it is a foreign key to `ingest_files`, which is FIRM, so a derivation through it constructs no predicate and throws, and it is NULLABLE besides, so even a firm-free version of the reading would drop every row reconciled before SD-M2-06 landed. `delta_cents` is GENERATED from the two balances and `resolved_by` is an operator name on 0002's `actor` idiom rather than a `users` row.",
  },
  reconciliationRuns: {
    class: 'firm',
    why: "ONE ROW PER RECONCILIATION SWEEP, OVER THE WHOLE POPULATION, INSIDE ONE NIGHTLY BATCH RUN (0064_reconciliation_runs.sql). There is no identity column and there is no correct one: the sweep compares every funded account, and the accounts it disagreed with are its OUTPUT -- recorded on `reconciliations`, which carries its own `account_id` and is `derived` through it -- rather than its owner. That is `detector_runs`' rule arriving on the check that blocks eligibility rather than on the one that raises flags. THE ROW ABOVE IS ONE COMPARISON AND THIS IS THE RUN THAT MADE IT, and the distinction is the whole reason the table exists: `reconciliations.account_id` is NOT NULL under `reconciliations_account_day_uq (account_id, trading_day)`, so a fold across those rows is a fold over PER-ACCOUNT CLOCKS, which ADR-199 section 5 refuses for the batch because a sweep resumable at the account boundary would report a success for a run that crashed. `batch_run_id` IS THE AVAILABLE MISTAKE AND IT IS NOT A HOP: it is `uuid NOT NULL` with NO declared foreign key, because no batch run is a row anywhere in this schema -- EVENTS section 5.3 declares the `run_id` in the payloads of `batch.started`, `batch.completed` and `batch.failed` and stores it nowhere -- so `DerivedRule` has no edge to name, and a table it could name would be a firm run record in any case, which is `reserve_coverage_snapshots`' refusal in a second dress. REGISTERING THE TABLE MAKES IT READABLE AND NOTHING ELSE: how often our balances disagree with the platform's is the firm's own operational health, no trader owns it, and `0026`'s default privileges leave it off the `merit_analytics` surface until a consumer names itself.",
  },

  loyaltyCriteria: {
    class: 'firm',
    why: "VERSIONED PROMISES, AND A PROMISE BELONGS TO NOBODY UNTIL IT IS EARNED (0023_loyalty_and_graduation.sql). The table holds the PUBLISHED DEFINITION of a benefit rather than an instance of one, it carries no identity column, and there is no correct one, because criteria that differed per trader would not be published criteria -- which is `statistic_definitions`' reason applied to promises rather than to statistics, and 0023's own COMMENT ON TABLE says so. THE DIRECTION OF THE EDGE IS WHAT DECIDES IT: `loyalty_benefit_grants` cites `(benefit_code, criteria_version)` and carries the identity itself, so ownership flows FROM the grant and never from the criteria, and a `derived` rule the other way would hand every trader the whole published catalogue. THE GRAIN IS `(benefit_code, version)` AND IT IS THE WHOLE PRIMARY KEY, so the table has no `uuid` of its own; `superseded_by text NULL` names a successor CODE with no foreign key and cannot address the pair, which is transcribed rather than repaired. A version is what stops a criteria change silently rewriting what past traders were promised (INV-M14-07, INV-M14-09), so a superseded row stays firm for exactly as long as a live one.",
  },

  loyaltyStates: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0023_loyalty_and_graduation.sql), and it is the ONLY column that reaches a person: every other column is a counter. THE IDENTITY IS THE GRAIN BY RULING AND NOT BY CONVENIENCE -- INV-M14-12 computes cross-account loyalty at the identity grain from completed ladders -- so there is no account column here to be tempted by and no `accounts` hop to write. THE COMPOSITE PRIMARY KEY `(identity_id, as_of_trading_day)` IS A HISTORY AND NOT A SECOND OWNER, which is `analytics_snapshots`' and `daily_marks`' shape: ONE STATE PER IDENTITY PER CLOSED DAY, and the day contributes nothing to who may read it. THE STATE IS DERIVED AND NEVER HAND-GRANTED (INV-M14-03), so a scoped read returns a reproduction rather than a balance, and `inputs_digest bytea NOT NULL` is the tamper indication: recompute, compare, and a mismatch is a finding. Registering the table makes it readable and confers no tier on anybody, because a tier here is a record of spending and surviving and is invisible to risk, to the payout path and to support's default view (INV-M14-05).",
  },

  loyaltyBenefitGrants: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0023_loyalty_and_graduation.sql), which is `promotional_credit_grants`' shape and its reason: a grant is a named person's entitlement from the moment it exists and the DDL has no way to write an unowned one. THE TRAP IS `(benefit_code, criteria_version)` AND IT IS A COMPOSITE FOREIGN KEY TO A FIRM TABLE: `loyalty_benefit_grants_criteria_fk` points at `loyalty_criteria (benefit_code, version)`, `loyalty_criteria` is FIRM, and `DerivedRule.via` is `TableKey` and includes every firm key -- so a derivation through it would compile at every call site and throw the first time anybody read this table. It is also a TWO-COLUMN edge and `DerivedRule` names one column, so the rule could not be written truthfully even if the parent carried an identity. `consumed_ref uuid NULL` IS THE SECOND TRAP AND IT IS POLYMORPHIC: 0023 declares it as an M17 offer id OR an M03 purchase id with NO foreign key, so it names two possible parents and reaches neither, and the single-spend guarantee is the partial unique index rather than a reference. A REVOKED GRANT IS STILL THIS IDENTITY'S ROW, tied to a reason by `loyalty_benefit_grants_revocation_is_explained`, because INV-M14-09 forbids retroactive withdrawal in both directions and a disappearance is how that promise gets broken quietly.",
  },

  discordLinks: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0019_notifications_and_community.sql), and it is the table's ONLY reference. A LINK IS A CONSENT AND CONSENT IS THE PERSON'S. THE PRIMARY KEY IS THE PAIR `(identity_id, discord_user_id)` AND THE SECOND HALF NAMES NO ROW HERE: `discord_user_id text NOT NULL` is a FOREIGN platform's key, so it is not a hop, not an owner, and not a grain the way a trading day is on `loyalty_states`. `role_opt_ins text[]` IS PER-ROLE CONSENT (INV-M15-01) rather than a boolean, because a role is a public statement about a person and consent to be in a server is not consent to be labeled in it. `revoked_at` IS THE END STATE AND THE ROW SURVIVES IT: `discord_links_live_discord_user_uq` is partial on `revoked_at IS NULL`, so revocation frees the Discord account rather than deleting the record, and a scoped read returns revoked links as the trader's own history. REGISTERING THIS TABLE MAKES IT READABLE AND NOTHING ELSE, which is worth saying here rather than anywhere else: INV-M15-03 forbids this link from ever being an authentication factor, a recovery path or a support-verification method, and its enforcement is STRUCTURAL, by grant, outside this package entirely -- so nothing in `scope.ts` implements it and nothing here should be read as doing so.",
  },

  discordAnnouncements: {
    class: 'firm',
    why: "EVERY MESSAGE MERIT HAS EVER POSTED IN ITS OWN COMMUNITY, AND THE ROW IS MERIT SPEAKING (0019_notifications_and_community.sql, INV-M15-04, INV-M15-05). There is no identity column and there is no correct one: a post to a public channel is addressed to the ROOM, so a per-identity slice of it is not a smaller version of it, and the trader-facing row for the same fact is the `notifications` row, which carries the identity. `event_id bigint NULL REFERENCES events(id) ON DELETE RESTRICT` IS THE ONE COLUMN THAT LOOKS LIKE A PATH AND IT IS NOT ONE, twice over: `events` is UNREGISTERED and deliberately so -- it carries `identity_id` and `account_id` both nullable with no CHECK tying them, so neither column covers the reads the corpus makes of it -- and this column is NULLABLE besides, because a status post has no causing event, so a derivation through it would drop exactly the announcements nobody's event caused. `integration_dispatches.event_id` is the same column with the same treatment one migration earlier. ANNOUNCEMENTS ARE TEMPLATE-ONLY: `template_code text NOT NULL` means there is no free-text send path using the bot credential, and `rendered_body` is STORED rather than re-rendered, so what was said stays a fact about the past after the template moves.",
  },
  geoRestrictions: {
    class: 'firm',
    why: "COUNSEL'S EXCLUSION LIST, ONE ROW PER COUNTRY (0004_catalog.sql). There is no identity column and there is no correct one: a restriction is a statement about a JURISDICTION and it is identical for every person in it, which is exactly the property DEP-M9-04 depends on when it makes this one table the source for checkout enforcement, campaign targeting and the public notice at once. A per-identity slice of a country's rule is not a smaller version of it. THE PRIMARY KEY IS `country_code char(2)` AND THE TABLE HAS NO `uuid` OF ITS OWN, so there is no surrogate id for anything to reference and no foreign key in the tree points here; nothing reaches a person even one hop out. `reason` is counsel's rationale in the DDL's own words and `effective_from` is a date, so the row's history is a legal record rather than a tenancy.",
  },

  tosVersions: {
    class: 'firm',
    why: "WHAT THE FIRM PUBLISHED, one row per (document, version) of the ToS, the privacy policy, the risk disclosure and the affiliate terms (0004_catalog.sql). There is no identity column and there is no correct one: EVERY identity is shown the same version, and the link runs the other way -- `tos_acceptances.tos_version_id` names the version a person accepted -- so ownership flows FROM the published document rather than to it, which is `plan_versions`' reason applied to the legal catalogue instead of the commercial one. THIS TABLE AND `tos_acceptances` ARE DECLARED IN THE SAME MIGRATION AND TAKE DIFFERENT CLASSES ON PURPOSE: a version row is a thing Merit published to the world and an acceptance row is a thing one named person did, and M09 section 1.2 draws that line in the corpus's own words -- the site renders versioned legal documents and records nothing about acceptance. A public read of `body_md` is not a leak, and a superseded version stays readable forever because the version a trader accepted has to remain quotable (FM-M9-06, INV-M9-11).",
  },

  tosAcceptances: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "WHAT A PERSON DID. `identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` is on the row (0004_catalog.sql), and the RESTRICT is the DDL saying an acceptance outlives every convenience: the identity cannot be deleted out from under the signature, and there is no way to write an unowned acceptance. `tos_version_id` IS THE TRAP AND THIS PAIR IS WHAT MAKES IT PLAUSIBLE: it is `uuid NOT NULL REFERENCES tos_versions(id)`, single-valued and declared inline, so it reads exactly like `daily_marks`' hop to `accounts` and is not one, because `tos_versions` is FIRM -- `DerivedRule.via` is `TableKey` and includes every firm key, so a derivation through it compiles at every call site and throws the first time anybody reads this table. `ip inet NOT NULL` is stored in the clear here, unlike `certificate_verifications.ip_hash`, because this row is a party's own record of their own act rather than telemetry about strangers, and it references nothing. A SCOPED READ RETURNS EVERY VERSION THIS PERSON EVER ACCEPTED and not the current one: DEP-M16-06 keeps acceptance a positive act with a history, and the history is what FM-M9-06's pinned-version argument is settled from.",
  },

  certificateVerifications: {
    class: 'firm',
    why: "THE VERIFY ENDPOINT'S ACCESS LOG, AND THE ROWS ARE THE VERIFIERS' RATHER THAN THE HOLDER'S (0025_reserved_sequence.sql). `GET /verify/:code` is public, unauthenticated and rate limited (M11 section 6), so whoever produced a row here is an outsider Merit has no identity for; the table declares NO FOREIGN KEY AT ALL and carries no identity column. THE HOP TO `certificates` DOES NOT EXIST, which is worth saying because `certificates` is registered and would make a plausible `via`: the column is `code_hash bytea`, a DIGEST of the attempted code, and 0025's own comment says why -- storing the codes in the clear would make this table a list of valid tokens for anyone who reached it. A hash addresses no row, `unknown` is one of the four results so most attempts resolve to no certificate at all, and a rule cannot be written through a join the schema refuses to declare. THE CLASS WOULD STILL BE WRONG IF THE JOIN EXISTED: the signal this table carries is the RATE of `unknown` across all verifiers, which is an enumeration campaign in progress (AS-M11-04, FM-M11-04), and handing a holder the list of who looked their card up would publish the verifiers instead of the certificate.",
  },
  idempotencyKeys: {
    class: 'owned',
    column: 'identity_id',
    nullable: true,
    why: "`identity_id uuid NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0017_events_and_audit.sql), and it is the ONLY column in the body that reaches a person: `key` is the client's own token, `endpoint` is a route, `request_hash` is a digest and `response_body` is a stored response. NULLABLE IS HOW THE UNOWNED REPLAY IS EXCLUDED, and SQL does the excluding: a key replayed by an unauthenticated caller carries no identity and no correct one, so `identity_id = $1` drops it without a second predicate because NULL never equals anything. THE DDL AGREES IN ITS OWN INDEX: `idempotency_keys_identity_idx (identity_id)` is declared WHERE NOT NULL, so the database already treats the null rows as a separate population. THIS IS `ledger_accounts`' SHAPE AND NOT `offers`': there is NO CHECK making the nullability biconditional here, so `identity_id IS NULL` means NO IDENTITY WAS RECORDED and never THE FIRM OWNS IT, which is why the rule is `owned` on the column the DDL declares against `identities(id)` rather than `firm`. WHAT THIS RULE DOES NOT BOUND IS SAID OUT LOUD: `response_body jsonb` holds a stored response VERBATIM by 0017's own comment, and a scope rule states which ROWS reach an identity and nothing about what is inside one.",
  },

  tradingCalendarLoads: {
    class: 'firm',
    why: "THE EXCHANGE'S CALENDAR BELONGS TO NO TRADER AND THIS ROW IS THE PROVENANCE OF ONE LOAD OF IT (0032_trading_calendar_holidays_coverage_revisions.sql). The table declares no foreign key at all, carries no identity and no account column, and there is no correct one: a coverage window that differed per trader would not be a coverage window. `actor text NOT NULL` is a free-text operator string on 0002's `actor` idiom rather than a `users` reference, which is the same shape `treasury_balances.recorded_by` is refused for being. THE ROW IS WHAT MAKES `WE DO NOT KNOW ABOUT THIS DAY` AN ANSWER (ADR-042 F-4): a day inside `[coverage_start_day, coverage_end_day]` with no `trading_calendar` row is a bug in the load, and a day outside them is UNKNOWN, so the batch refuses rather than guessing. ITS NEIGHBOUR IS REGISTERED NOW AND THIS SENTENCE SAID IT COULD NOT BE. It read that 0032's two `ALTER TABLE trading_calendar ALTER COLUMN ... DROP NOT NULL` statements are refused by ADR-094's one-member fold; ADR-103 clause 2 superseded exactly that clause, folded that one shape, and named the neighbour REGISTRABLE. THE PER-TABLE DERIVATION IS WHAT SURVIVES: replayed across every migration this table carries NO `ALTER TABLE` of any shape at all, which is a fact about its own history and not about the file it was declared in.",
  },

  tradingCalendarRevisions: {
    class: 'firm',
    why: "A CORRECTION TO THE EXCHANGE CALENDAR IS A STATEMENT ABOUT A DAY, AND A DAY BELONGS TO NOBODY (0032_trading_calendar_holidays_coverage_revisions.sql). No column reaches an identity or an account: `trading_day` is a date, `prior_row` is `to_jsonb(OLD)` of a `trading_calendar` row, `source_digest` is a SHA-256, `incident_ref` is an incident label, and `actor` is the same free-text operator string its sibling carries. `dependent_row_count` IS THE COLUMN MOST LIKELY TO BE MISREAD AS TENANCY AND IT IS A COUNT: the number of rows in `fills`, `daily_marks` and `rule_states` that depend on this trading day, asserted a second time by 0033's trigger under ADR-045. Those three tables are each scoped to an identity and this number is not, because a count across every account is a property of the DAY -- zero is an ordinary data change and non-zero is an incident, which is what `trading_calendar_revisions_incident_named_when_dependent` reads. `trading_day` DECLARES AN FK TO `trading_calendar` AND THE REASON THIS RULE IS NOT `derived` CHANGED WITH ADR-103. It used to be that the target was UNREGISTRABLE, so `DerivedRule.via` had no member to name; clause 2 superseded that and the target is registered. WHAT REFUSES THE HOP NOW IS WHERE IT WOULD TERMINATE: `trading_calendar` is itself `firm`, so the chain would end at a table with no identity, which is `reserve_coverage_snapshots`' refusal and `affiliate_commissions`' before it. A DAY IS NOT A TENANCY AND A DERIVATION THROUGH ONE ANSWERS NOTHING. This table also does carry `ALTER TABLE` statements, which this sentence used to deny: 0048 DROPS and re-ADDS `trading_calendar_revisions_trading_day_fkey` as DEFERRABLE INITIALLY DEFERRED, and neither statement touches a column, so the fold passes over both and the CREATE body is still the column set.",
  },

  // ---------------------------------------------------------------------------
  // ADR-106. THE FOUR TABLES THE REGISTRY COULD NOT HOLD.
  // ---------------------------------------------------------------------------

  identityLinks: {
    class: 'pair',
    columnA: 'identity_a',
    columnB: 'identity_b',
    writer: {
      by: 'nobody',
      why: "NEITHER PARTY AUTHORS AN EDGE ABOUT THEMSELVES. An `identity_links` row is MERIT'S assertion that two people are related, produced by M07's D-03 and D-12 as detector output with `evidence jsonb NOT NULL` beside it; a party who could write one could assert an edge to anybody, and `identity_links_canonical_order` means they could not even choose which column they landed in. M07 section 6 puts the one legitimate mutation -- the suppression pair -- `through the SECURITY DEFINER function that arrives with this module, never by the application role`, which is this answer already written in DDL terms one module over.",
    },
    why: "THE ENTITY GRAPH'S EDGES, AND AN EDGE IS A STATEMENT ABOUT TWO PEOPLE (0002_identity.sql). `identity_a` and `identity_b` are both `uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT`, both indexed, and `identity_links_canonical_order` CHECKs `identity_a < identity_b` -- so an edge is stored once and WHICH COLUMN A PERSON LANDS IN IS DECIDED BY UUID ORDERING. An `owned` rule on either column returns a strict subset of a person's own edges chosen by that ordering, which is a wrong answer that returns rows rather than an error. THE DISJUNCTION IS NOT WRITTEN AND THAT IS THE RULING RATHER THAN A LIMITATION: `evidence jsonb NOT NULL` is a detector's output and the counterparty column is another identity's uuid, and INV-M4-06 is that the portal `never receives detector internals or other identities' ids`. THE CORPUS NAMES NO TRADER-FACING READER: M06 section 3 renders the tier from `confidence_bp` on the ADMIN console, M07's D-03 and D-12 read it as detectors, and M07 section 6 writes the suppression pair `through the SECURITY DEFINER function that arrives with this module, never by the application role`. INV-M7-09 IS THE ONE THAT LOOKS LIKE A COUNTER-EXAMPLE AND IS NOT: it says a trader may CONTEST a link and that the contested link is visible TO THE ADMIN WHO ACTS ON IT, which is an admin surface and a support path rather than a scoped read. A SUPPRESSED EDGE IS STILL AN EDGE: `identity_links_live_idx` is partial on `NOT suppressed` and the row is never deleted, because SD-M7-04's own comment is that `we decided this edge was wrong` is itself evidence.",
  },

  dedupeMatches: {
    class: 'pair',
    columnA: 'identity_a',
    columnB: 'identity_b',
    writer: {
      by: 'nobody',
      why: 'NEITHER PARTY AUTHORS A BIOMETRIC MATCH, AND THE ENFORCEMENT WEIGHT IS WHY THE ANSWER IS NOT MILDER HERE THAN ON `identity_links`. ADR-022 makes a dedupe hit a HARD LINK THAT AUTO-ENFORCES, so the row bans an account before a human has looked; a subject who could write one could ban somebody, and a subject who could write their own could write it at a strength that clears. The author is the provider, through the KYC path, and `disposition` starts at `open` precisely because no party has yet been believed.',
    },
    why: "THE AUTHORITATIVE BIOMETRIC DEDUPE LINK (0003_kyc.sql, SD-M19-04, ADR-029), and 0003's own header states the shape this class exists for: `A match is a RELATIONSHIP BETWEEN TWO IDENTITIES, not a property of one`. `identity_a` and `identity_b` are both `uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` under `dedupe_matches_canonical_order`, which is `identity_links`' shape exactly, so the same ordering accident decides the same wrong answer. THE ENFORCEMENT WEIGHT IS WHY THE REFUSAL IS NOT MILDER HERE: ADR-022 makes a dedupe hit a HARD LINK THAT AUTO-ENFORCES, so the row bans an account before a human has looked, and `disposition` starts at `open` precisely because the review has not happened. Returning that row to either party would hand a person the uuid of whoever a provider thought they were, with `match_strength` and `evidence_snapshot jsonb` beside it, before anyone has decided whether the match is real. `evidence_snapshot` holds the provider's decision metadata and NEVER images (AS-M19-07, VG-10), which is what makes the enforcement survive the provider relationship ending and is not a reason a trader may read it.",
  },

  attributions: {
    class: 'pair',
    columnA: 'buyer_identity_id',
    columnB: 'affiliate_identity_id',
    writer: {
      by: 'party',
      column: 'buyer_identity_id',
      why: "THE BUYER, BECAUSE THE BUYER IS THE ONE WHOSE ACT CREATES THE ROW. M08 section 3.1 rules that `RESOLUTION HAPPENS AT CHECKOUT START, in the same step that pins the plan version` and that `IT HAPPENS ONCE`, so this row is written inside one identity's checkout transaction and by nothing else in the estate: the affiliate is asleep, and a row written when they were not is not theirs to author. THE AFFILIATE HALF IS NOT A SECOND AUTHOR AND MUST NOT BECOME ONE -- an affiliate who could write this row could mint a referral over somebody else's purchase, which is the fraud `purchase_id uuid NOT NULL UNIQUE` (`0012_disputes_and_affiliate_settlement.sql:77`) and `INV-M8-01` bound from the other direction, one sale at a time. WHAT THE BUYER LEARNS BY WRITING IS NOTHING THEY DID NOT BRING: the affiliate identity in the row comes out of `resolveAttribution`, whose inputs are the coupon the buyer typed and the click token the buyer presented, and the door builds no `RETURNING`, so the transaction hands back no column at all. THE SELF-DEAL ROW IS WRITABLE AND THAT IS DELIBERATE: `attributions_literal_self_deal_is_void` permits the two columns to name one person on a voided row, so the door must not refuse a counterparty equal to the writer, and it does not.",
    },
    why: "WHO REFERRED WHOM, AT THE MOMENT OF PURCHASE (0012_disputes_and_affiliate_settlement.sql, SD-M8-05). Both columns are `uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT`, and 0012's own comment says why both are STORED rather than joined: the row is a statement about the two of them at that moment, and an affiliate can be reassigned or an identity merged afterwards. Naming the buyer hides the referral from the affiliate who earned it; naming the affiliate returns a buyer's own purchase attribution to somebody else, which returns rows, raises nothing, and is ADR-008's BOLA failure. THE PAIR MAY COLLAPSE HERE AND IT DOES NOT ON THE OTHER TWO, WHICH IS THE ONE PER-TABLE DIFFERENCE THIS CLASS HAS: `attributions_literal_self_deal_is_void` is `buyer_identity_id <> affiliate_identity_id OR voided = true`, so the two columns MAY name one person on a voided row -- and that row is the self-deal the constraint exists to record rather than an exception to the class. THE CONTRACT ALREADY REFUSES THE ROW-LEVEL READ THIS CLASS REFUSES: `GET /affiliate/stats` returns counts and cents -- `clicks_30d`, `conversions_30d`, `earned_cents_lifetime`, `payable_cents` -- and no referral row and no buyer, so nothing in API_CONTRACT wants the disjunction. `affiliate_id` IS THE AVAILABLE MISTAKE AND ADR-101 CLAUSE 1 REFUSES IT MECHANICALLY: it is `uuid NOT NULL REFERENCES affiliates(id)` and `affiliates` carries the identity, so a `derived` hop through it resolves and terminates -- and it stands on a row that declares its own identity columns, which is the shape that clause was written for.",
  },

  otpChallenges: {
    class: 'firm',
    why: "A CHALLENGE ISSUED BEFORE ANYBODY IS ANYBODY (0002_identity.sql, 0029_phone_identity_and_auth.sql SD-M16-05). There is no identity column and there is no correct one: `POST /auth/otp` is the only endpoint in API_CONTRACT that runs at required factor `none`, so the row is written for a caller this database holds no identity for, and 0002's own comment says the table keys off the normalized address `rather than a user_id` because a user MAY NOT EXIST YET. IT IS THE FIRST `firm` ROW WHOSE REASON IS TIMING RATHER THAN OWNERSHIP, and the distinction is stated here rather than left to be re-derived: every other firm table holds a row no identity will EVER own, and this one holds a row whose identity does not exist YET. CONSUMING A CHALLENGE DOES NOT RETROACTIVELY MAKE THE ROW THAT PERSON'S: `consumed_at` is a timestamp and there is nowhere to write an identity, so a session tempted to scope this table is proposing a MIGRATION and not a re-classification. WHAT IT HOLDS IS IDENTITY-SHAPED AND NAMES NO IDENTITY, which is ADR-102 foreclosure 4 touched and not tripped: `email_normalized citext` is the address a person is reached at and `destination_hash bytea` is the SMS destination hashed, and neither addresses a row in this database. `email_normalized` IS NULLABLE AS OF 0029 and that is ADR-103's fold doing its job: 0002 made it NOT NULL when no other channel existed, `ALTER COLUMN email_normalized DROP NOT NULL` relaxed it for SMS, and `otp_challenges_exactly_one_destination` is what keeps exactly one destination on every row. `code_hash` IS `bytea` BECAUSE THE CODE IS NEVER STORED, and `attempts` is on the CHALLENGE rather than on the account so a locked-out attacker learns nothing about whether the address exists.",
  },
  paymentDisputes: {
    class: 'derived',
    via: 'purchases',
    localColumn: 'purchase_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "A DISPUTE IS A STATEMENT ABOUT A PURCHASE AND THE PURCHASE IS WHAT CARRIES THE PERSON (0012_disputes_and_affiliate_settlement.sql, SD-M8-01). The row declares NO column against `identities(id)` at all, so ADR-101 clause 1 is satisfied by the DDL rather than by a judgement, and `purchase_id uuid NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT` satisfies clause 2: the edge is NOT NULL, so there is no row that reaches no identity and none returned in silence. `hop` RATHER THAN `semi-join` BECAUSE THE REFERENCE IS SINGLE-VALUED IN THE DIRECTION TRAVERSED: a dispute names ONE purchase and `purchases.id` is that table's primary key, so the traversal cannot multiply this row -- a purchase may carry several disputes and that is the other direction, which this rule never walks. THE CHAIN TERMINATES ONE HOP OUT: `purchases` is `owned` on `identity_id`, `nullable: false`. `ledger_transaction_id` IS THE AVAILABLE MISTAKE AND IT IS REFUSED HERE RATHER THAN IN REVIEW, because it is session 202's `wallet_entries` trap in a second dress: it is `uuid NULL REFERENCES ledger_transactions(id)`, `ledger_transactions` is registered `derived` rather than `firm`, so a rule through it TERMINATES and every mechanical check passes -- and it is wrong twice. The column is NULLABLE, so it would return a person only the disputes that already moved money and drop every OPEN one, which is the population a chargeback window is about; and it answers a DIFFERENT QUESTION besides, whose ledger accounts appear on the compensating reversal rather than whose purchase was disputed, and those agree only while no transaction touches two identities' accounts, which nothing enforces and double entry makes ordinary. WHAT A SCOPED READ RETURNS IS THE PERSON'S OWN DISPUTE HISTORY INCLUDING THE ONES MERIT WON, and that is deliberate: `payment_disputes_resolved_has_outcome` keeps `resolved_at` and `outcome` NULL together, so an open dispute is readable while it is still open, which is what a chargeback window is computed over. THE ROW IS ABOUT THE BUYER AND NEVER ABOUT THE COUNTERPARTY: unlike `attributions`, declared in this same migration and registered `pair`, this table names exactly one person's purchase and hands the reader no second identity's uuid, which is why `derived` is available here and a disjunction is not needed.",
  },
  payoutDestinations: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0051_payout_destinations.sql), where it is also the FIRST HALF of the primary key `(identity_id, destination_ref)`. A DESTINATION BELONGS TO A HUMAN AND NEVER TO AN ACCOUNT, which is the reading `wallet_withdrawals` already carries under SD-M5-06: the external leg has no `account_id` because the money is the person's by the time it is there, and the destination it moves to is the person's for the same reason. THE ROW REACHES EXACTLY ONE IDENTITY AND CARRIES NO SECOND PATH TO ANYBODY: `destination_ref` is a PROVIDER-SIDE id and never bank details, so it names a row in a vendor's database rather than one in this one, and `first_seen_at`, `cooling_until` and `created_at` are timestamps. There is nothing here for ADR-101 clause 1 to refuse and nothing for a `derived` rule to reach through, which makes this the rare registration whose available mistake is not a second column but a second TABLE. THE AFFILIATE RAIL SHARES THIS TENANCY RATHER THAN NEEDING ITS OWN, and that is the table's own property rather than a reader's use: C-24 requires affiliate destination changes to carry the same 48 hour window as trader destinations, and `affiliates.identity_id uuid NOT NULL REFERENCES identities(id)` (0005_affiliate_program.sql) makes an affiliate an identity -- so ADR-017's one rail, one destination table is expressible here with no discriminator column and no disjunction. WHAT A SCOPED READ RETURNS IS THE PERSON'S WHOLE DESTINATION HISTORY INCLUDING THE WINDOWS THAT HAVE ELAPSED, and that is deliberate: the row is never deleted (0051 REVOKEs DELETE from merit_app and PUBLIC) and `cooling_until` moves only forward under PAYOUT-DEST-C1, so a contested refusal is explicable months later out of the rows themselves. THE SCOPE RULE AND THE GRANT ANSWER DIFFERENT QUESTIONS HERE, which is 0050's lesson on a table that is readable rather than one that is not: a correctly scoped DELETE through this rule still fails, because merit_app holds SELECT, INSERT and UPDATE on this table and nothing else.",
  },

  events: {
    class: 'either',
    column: 'identity_id',
    via: 'accounts',
    localColumn: 'account_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "THE ROW REACHES AN IDENTITY TWO DIFFERENT WAYS AND WHICH WAY IS A FACT ABOUT THE ROW (ADR-191). `identity_id uuid NULL REFERENCES identities(id) ON DELETE RESTRICT` and `account_id uuid NULL REFERENCES accounts(id) ON DELETE RESTRICT` (0017_events_and_audit.sql), with NO CHECK tying them and neither one required, so one row is reached the `owned` way, the next the `derived` way, and a third by neither. BOTH HALVES ARE READ ON ONE SCREEN, which is what makes the disjunction the ruling rather than a convenience: EVENTS.md section 2 rows the `TL` consumer as a PER-ACCOUNT chronological view and M04 section 5 consumes `phone.verified` and `phone.change_requested`, which carry no account at all. An `owned` rule on `identity_id` COMPILES and drops every account-level row; a `derived` hop through `account_id` is refused twice by ADR-101, by clause 1 because this row carries its own identity column and by clause 2 because the edge is nullable, and would drop every identity-level row if it were written. `hop` RATHER THAN `semi-join`: an event names ONE account and `accounts.id` is that table's primary key, so the traversal cannot multiply this row. THE CHAIN TERMINATES ONE HOP OUT: `accounts` is `owned` on `identity_id`, `nullable: false`. `subject_kind`/`subject_id` ARE THE AVAILABLE MISTAKE AND ARE REFUSED HERE RATHER THAN IN REVIEW: 0017 calls the pair a polymorphic subject and not a foreign key, `subject_id uuid NOT NULL` is on every row including the firm ones, and a plan version and a payout request are subjects, so a rule reading it hands every event ever written to whoever's uuid happens to match. THE PAYLOAD IS NOT THIS RULE'S BUSINESS AND THE DISTINCTION IS RULED RATHER THAN WAVED: `idempotency_keys`, out of this same migration set, says a scope rule states which ROWS reach an identity and nothing about what is inside one; what is different here is that `kyc.dedupe_hit` and `identity.merged` carry a THIRD PARTY's uuid in `jsonb`, and ADR-191 section 6 rules that registering the table makes it readable and nothing else, exactly as `evidence_packs` says about its own redaction profile. WHAT A SCOPED READ RETURNS IS THIS PERSON'S EVENTS BY EITHER PATH AND THE FIRM ROWS BY NEITHER, and what it still cannot return is a MERGED identity's identity-level history: this table is APPEND-ONLY so `identity_id` is never repointed into the survivor, `identity_merges` is not registered, and ADR-191 section 8 registers the gap rather than closing it with a rule no class can write.",
  },
  tradingCalendar: {
    class: 'firm',
    why: "THE EXCHANGE'S SESSION CALENDAR, ONE ROW PER TRADING DAY, AND A DAY BELONGS TO NOBODY (0004_catalog.sql, relaxed by 0032_trading_calendar_holidays_coverage_revisions.sql, ADR-042). THE CLASS IS THE READING OF THE DDL AND NOT A DEFAULT: the primary key is `trading_day date`, the row declares NO foreign key at all, and no column is declared against `identities(id)` or `accounts(id)` -- so `owned`, `pair` and `either` have no column to name, `derived` has no edge to traverse, and `root` is `identities`' alone. Its two satellites are firm on the same reading and each was derived separately, which is what this file means by per-table. THE REFUSAL THIS TABLE CARRIED WAS STALE AND IT IS DISCHARGED RATHER THAN OVERTURNED. 0032's `ALTER TABLE trading_calendar ALTER COLUMN session_open_at DROP NOT NULL` and its `session_close_at` twin were refused by ADR-094's one-member fold, and ADR-103 CLAUSE 2 SUPERSEDED THAT CLAUSE AND ONLY THAT CLAUSE: the vocabulary gained `ALTER COLUMN <name> DROP NOT NULL` as a second member and the entry names this table as one of the two the widening makes REGISTRABLE. Clause 3 keeps the sub-vocabulary closed at that one shape with a default of FAIL, and this table asks for nothing else: every `ALTER TABLE trading_calendar` in the tree is one of those two statements or a CONSTRAINT statement the fold passes over, so the registration rests on a reading of 0032 rather than on a permission the ruling hands out. A HOLIDAY IS A NULL AND NEVER AN ABSENT ROW, which is what the two relaxed columns are for: `trading_calendar_holiday_has_no_session` CHECKs `is_holiday = (session_open_at IS NULL)` in both directions, so a sessionless row MUST be a holiday and a holiday MUST have no session, and R-01's containment lookup stops meeting the fabricated interval a fill could fall inside. WHAT THE TABLE DOES NOT SAY IS WHICH DAYS IT KNOWS ABOUT: coverage is `trading_calendar_loads`', and a day outside it is UNKNOWN rather than a holiday (ADR-042 F-4), which is what makes an exhausted calendar an answer instead of an unbroken silent holiday. A READER MUST THEREFORE CONSULT BOTH TABLES and the scope class is the same on each, so nothing in this registry is what keeps them apart. REGISTERING IT MAKES IT READABLE AND NOTHING ELSE, and here that sentence has three triggers behind it rather than a grant: 0026 grants `merit_app` all four verbs on this table and 0032 revokes them only on the two satellites, so what stands between a row and a rewrite is CALENDAR-C1 (an UPDATE without a prior image in `trading_calendar_revisions` is refused, 0033), CALENDAR-C2 (a row is corrected, never deleted or truncated, 0033) and CALENDAR-C3 (a retroactive INSERT must be recorded, 0048). 0033's own reason for preferring a trigger is that \"a revoke does not bind the table owner and a trigger does\". This rule states which rows reach an identity and none of it is implemented here.",
  },

  reserveCoverageSnapshots: {
    class: 'firm',
    why: "THE FIRM'S RESERVE AGAINST THE FIRM'S OWN FLOOR (0049_reserve_coverage_snapshots.sql, ADR-128, ADR-199). `reserve / CVaR99 at rho = 0.30`, the ratio that pauses NEW SALES below 1.0 and never pauses payouts, and it is `liability_snapshots`' reason arriving on a different surface: a per-identity slice of a firm-wide coverage RATIO is not a smaller version of it, because the denominator is one CVaR99 computed over the whole book and dividing a person's share by it produces a number nothing in the corpus defines. THE CLASS IS SETTLED BY THE DDL RATHER THAN BY THAT ARGUMENT: the row declares NO column against `identities(id)` at all, which is what the suite's own firm assertion reads, so `owned`, `pair` and `either` have no column to name and `root` is `identities`' alone. `treasury_account_code`/`treasury_as_of` ARE THE AVAILABLE MISTAKE AND THEY ARE REFUSED THREE TIMES OVER. They are the only edge off this row, and a `derived` rule through them CANNOT BE WRITTEN, because `reserve_coverage_snapshots_anchor_fk` is COMPOSITE -- `(treasury_account_code, treasury_as_of)` against `treasury_balances(account_code, as_of)` -- and `DerivedRule` names ONE `localColumn` against ONE `foreignColumn`, which is `correlation_groups`' `uuid[]` objection arriving from the other direction. Naming the code alone would compile and MULTIPLY ROWS, since `account_code` is one half of that table's key and repeats once per attestation instant. And it would terminate nowhere in any case: `treasury_balances` is itself `firm`, so the chain ends at a table with no identity, which is `affiliate_commissions`' refusal in a second dress. REGISTERING THE TABLE MAKES IT READABLE AND NOTHING ELSE, which is `events`' sentence on the first table whose content is a DISCLOSURE hazard rather than a tenancy one: M12's `AS-M12-04` rules the coverage ratio unpublishable because a falling RCR is a bank-run mechanic, and that is a PROJECTION and never this rule, exactly as ADR-191 section 6 divides them. WHAT `firmDb()` READS IT WITH IS NARROWER THAN THE RULE, and 0050's lesson applies to a table that IS readable: `0049` REVOKEs UPDATE and DELETE from `merit_app` and PUBLIC, so the role holds SELECT and INSERT and a correctly classed DELETE still fails at the database; `merit_analytics` is deliberately granted nothing, so the firm's reserve position is off M13's surface until a consumer names itself.",
  },

  operators: {
    class: 'firm',
    why: "MERIT'S RECORD OF ITS OWN OPERATORS, ONE ROW PER PERSON WHO MAY ACT ON THE ADMIN SURFACE (0073_operator_directory.sql, ADR-237). The DDL settles the class and no judgement is added to it: the row declares NO column against `identities(id)` and none against `accounts(id)`, so `owned`, `pair` and `either` have nothing to name and `root` is `identities`' alone. THE ROW IS ABOUT AN EMPLOYEE OF THE FIRM AND NEVER ABOUT A TRADER, which is `admin_actions`' own rule one table over: the audience for a record of who Merit let act is an auditor, and a scoped read that returned an operator to the identity they acted upon would answer a question nobody asked with a name nobody may have. THE AVAILABLE MISTAKE IS `derived` VIA `users` AND `0042` IS WHAT SUGGESTS IT: `impersonation_sessions.admin_user_id uuid NOT NULL REFERENCES users(id)` already models an operator as a trader-side row, so a reader arriving from that table expects the same edge here. IT IS REFUSED IN THE DDL RATHER THAN IN REVIEW: `0073` declares no `user_id`, ADR-237 section 6 states why (a `users` row is authenticable by an emailed OTP, which is a login this deployable can mint at the C-08 door), and `DerivedRule` therefore has no edge to name. `idp_issuer` and `idp_subject` reach a provider rather than a person in this schema, and `actor` is the string `admin_actions` carries, not a key into any identity table.",
  },

  operatorSessions: {
    class: 'firm',
    why: "ONE OPERATOR SESSION, AND IT REACHES THE FIRM'S OWN DIRECTORY RATHER THAN ANY IDENTITY (0073_operator_directory.sql, ADR-237). `operator_id uuid NOT NULL REFERENCES operators(id)` is the only foreign key on the row and `operators` is FIRM, so a `derived` rule through it would compile at every call site -- `DerivedRule.via` is `TableKey` and includes every firm key -- and throw the first time anybody read the table, which is `raw_ingest_rows`' trap on a second estate. The row declares no column against `identities(id)` or `accounts(id)` at all. THE SHAPE IS `sessions`' AND THE CLASS IS THE OPPOSITE ONE, which is the distinction worth writing down: `sessions` is `derived` via `users` because a trader session belongs to a login that belongs to a person, and an operator session belongs to an employee, so the identical column layout carries opposite tenancy. NOTHING IN THIS REPOSITORY WRITES A ROW HERE and registering the relation does not change that: the minter needs the C-08 identity provider, and a registration makes a table READABLE rather than fillable.",
  },
} as const satisfies { readonly [K in TableKey]: ScopeRule };

/** Tables that belong to no identity. The scoped accessor REFUSES these. */
export type FirmTableKey = {
  [K in TableKey]: (typeof SCOPE_RULES)[K]['class'] extends 'firm' ? K : never;
}[TableKey];

/**
 * Tables that belong to TWO identities. ADR-106.
 *
 * REFUSED BY BOTH NARROW DOORS AND SERVED BY THE ONE THAT TAKES A REASON. These
 * keys are excluded from `ScopedTableKey` because returning the row to either
 * party discloses the other, and they are excluded from `FirmTableKey` because
 * `firmDb()` takes no reason on the ground that no identity is at risk, which is
 * false here twice over. `systemDb(reason)` is generic over `TableKey` and is
 * the only door left FOR A READ, which is the whole of what this type governs.
 *
 * ADR-230 DOES NOT MOVE THIS TYPE AND ADDS A WRITE BESIDE IT. `insertAsParty` on
 * a scoped handle can INSERT one row of a `pair` table whose rule declares
 * `writer.by === 'party'`, stamping the writer's own identity into the column
 * that rule names. It builds no `RETURNING`, so nothing this type exists to
 * withhold comes back through it, and every membership above is unchanged: these
 * keys are still absent from `ScopedTableKey` and from `FirmTableKey`, and
 * `scopePredicate` still throws on all of them.
 */
export type PairTableKey = {
  [K in TableKey]: (typeof SCOPE_RULES)[K]['class'] extends 'pair' ? K : never;
}[TableKey];

/**
 * Tables the scoped accessor will serve.
 *
 * A `firm` table passed to `scopedDb` is a COMPILE ERROR because it is not a
 * member of this type. That refusal is watched failing to compile in
 * `scripts/ci/falsify-ci.mjs` at stage CI-01: vitest cannot see a type error at
 * all, because it runs transpiled code and the error is gone by then.
 *
 * A `pair` table is excluded for a DIFFERENT reason and by the same mechanism
 * (ADR-106). `firm` is excluded because no identity owns the row; `pair` is
 * excluded because two do, and a scoped read is a filter rather than a
 * projection, so the counterparty's identity uuid comes back with every row it
 * would return. The two exclusions are not interchangeable and the classes are
 * not merged: `firmDb()` serves the first and refuses the second.
 */
export type ScopedTableKey = Exclude<TableKey, FirmTableKey | PairTableKey>;

/** Every table in the registry. Used by the totality assertion in the suite. */
export const TABLE_KEYS = Object.keys(TABLES) as readonly TableKey[];
