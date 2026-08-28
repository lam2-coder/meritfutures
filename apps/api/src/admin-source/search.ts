// =============================================================================
// apps/api/src/admin-source/search.ts
// =============================================================================
// `AdminReadSource.searchAccounts`, WHICH IS SIX TERMS FANNING IN AND ELEVEN
// TABLES FANNING OUT, AND NEITHER HALF IS A JOIN.
//
// `routes/admin-reads.ts`'s port header says of this method that
// "`AdminAccountSearchItem` joins accounts to identities to flags to
// reconciliation state" and that "there is no join and no aggregate to reach
// for". BOTH SENTENCES ARE TRUE AND NEITHER IS A BLOCKER, which is the same
// thing `listFlags`, `readIdentityGraph`, `listEvents` and `readAccount` each
// turned out to be. ADR-157 section 5 already ruled what a caller does about a
// missing join: pull the rows through `rowsWhere` and do the join in the runner,
// paying for every row that crosses the boundary. This module is that, and
// {@link AccountSearchCost} is the payment stated rather than hidden.
//
// -----------------------------------------------------------------------------
// SIX TERMS, AND EVERY ONE OF THEM IS AN EQUALITY ON A DECLARED COLUMN
// -----------------------------------------------------------------------------
// ADR-194 clause 1 ruled that a search term is A VALUE THE ESTATE HOLDS and
// never a pattern the operator composed, and removed the seventh form from
// API_CONTRACT rather than leaving it unimplemented. That ruling is what makes
// this module writable at all, and its section 9 says so in its own words: what
// changed is "the affordability of the work", because the fan-out under an exact
// subject is bounded and the fan-out under a fragment is bounded by nothing.
//
// SO NOTHING BELOW COMPOSES A PATTERN, and there is no `contains`, no `LIKE`, no
// prefix and no second door. ADR-157's refusal is untouched and no
// `SqlExecutorReason` member is added.
//
//   account id     `accounts.id`                     equality on a primary key
//   platform ref   `accounts.platform_account_ref`   equality, AND the history
//                  `platform_account_refs`           table, see below
//   email          `users.email` (citext)            equality, case-free
//                  `users.email_normalized` (citext) equality, the resolution key
//   identity id    `accounts.identity_id`            equality on a foreign key
//   coupon         `coupons.code` (citext)           equality, then redemptions
//   payout id      `payout_requests.id`              equality on a primary key
//
// **THE EMAIL TERM RESOLVES AGAINST BOTH COLUMNS AND ADR-194 SECTION 12 LEFT
// THAT TO THIS FILE IN TERMS**: "whether the adapter resolves `email` against
// `email`, against `email_normalized`, or against both is the adapter's latitude
// inside a term the contract already grants". Both, because they answer
// different questions with the same value. `users.email` is what the person
// typed and is `UNIQUE`. `email_normalized` is `0002_identity.sql:254`'s
// "dots and plus-tags stripped: the entity-resolution key ... deliberately NOT
// unique", so an operator holding `jo@example.com` out of a support thread
// reaches an account opened as `j.o+news@example.com`, which the first column
// cannot do. Two equalities on one table, and the second is the affordance
// ADR-194 section 8 names as the estate's real answer to "I know who but not
// which row".
//
// **A NON-UUID TERM IS NOT OFFERED TO A `uuid` COLUMN, AND THAT IS A TYPE CHECK
// RATHER THAN THE SUBJECT CHECK ADR-194 CLAUSE 5 REFUSES.** Postgres answers
// `invalid input syntax for type uuid` (22P02) to `id = 'jo'`, so a term that is
// not a uuid would turn every search for a coupon code into a 500. What is
// tested is whether the VALUE can address the COLUMN, which every one of these
// reads has to answer before it can run; what is NOT tested is whether the term
// names a subject, which clause 5 says only a lookup answers. `jo` is a
// legitimate exact coupon code and it reaches the coupon term untouched.
//
// **THE PLATFORM REF READS TWO TABLES BECAUSE ONE OF THEM IS THE HISTORY.**
// ADR-194 section 3 records that a ref is unique among LIVE accounts only:
// `0007_accounts.sql`'s index is partial, and `platform_account_refs` carries
// the burn history under `PRIMARY KEY (platform, platform_account_ref)`. Reading
// only `accounts` would lose the retired ref an operator is holding precisely
// because something went wrong on it, which is the search that matters most.
//
// **AND A PLATFORM REF THAT REACHES MORE THAN ONE ACCOUNT IS A PAGE AND NOT AN
// ERROR.** ADR-194 section 9's last paragraph left that choice here. It is a
// page for the reason clause 3 admits a coupon: `M06:435` rules that naming a
// signal and listing what shares it IS a specific-subject query, and the subject
// here is the ref itself. An error would refuse real work on the exact input an
// operator uses during an incident, and the response is already an `AdminPage`
// with `INV-M6-10`'s cap on it.
//
// -----------------------------------------------------------------------------
// THE ORDER IS `(identity_id, account_id)` ASCENDING, AND BOTH KEYS ARE IMMUTABLE
// -----------------------------------------------------------------------------
// API_CONTRACT section 8 states no sort for this row, so the direction is stated
// here out loud rather than left to be inferred, which is `flags.ts`'s choice
// for `flags.ts`'s reason.
//
//   1. IDENTITY ID, ascending. An identity may hold many accounts (ADR-041), and
//      an operator reading a result set is looking at a PERSON, so one person's
//      accounts are contiguous on the screen rather than interleaved with
//      somebody else's.
//   2. ACCOUNT ID, ascending. Not a tie-break anybody reads, and present because
//      a cursor needs a TOTAL order: two accounts of one identity are otherwise
//      unordered, and an unordered pair either repeats or DROPS across a page
//      boundary.
//
// **NEITHER KEY EVER CHANGES, WHICH IS THE PROPERTY THE CURSOR NEEDS AND WHICH
// THE FLAG QUEUE CANNOT HAVE.** `readFlagQueue` pages on a corroboration depth
// that moves when a detector fires, and its header prices that: it may repeat a
// row rather than drop one. Here both components are primary keys, so a page
// boundary cannot move under a concurrent write at all, and an account that
// appears while a caller is paging appears in its own place rather than shifting
// everything after it.
//
// **AND THE ORDER IS WHAT MAKES THE WIDEST TERM AFFORDABLE**, which is section 3
// below and is the one place this module does something an obvious
// implementation would not.
//
// -----------------------------------------------------------------------------
// ADR-194 SECTION 9's AFFORDABILITY CLAIM IS TRUE OF FIVE TERMS AND NOT OF THE
// COUPON, AND THIS FILE DOES NOT PRETEND OTHERWISE
// -----------------------------------------------------------------------------
// That section reads: "Under an exact subject that price is bounded by the page
// limit `INV-M6-10` already caps." **The page limit caps what is RETURNED and
// caps nothing that is READ**, and the coupon is the term where those two
// diverge without bound: the same entry's clause 3 defends a coupon precisely
// BECAUSE many accounts share one, and `coupons.redemption_count` is a counter
// over every identity that ever used the code. A launch code with five thousand
// redemptions fans out to five thousand identities, and the accessor has no `IN`
// (ADR-157 keeps `OR` and `IN` refused), so a naive expansion is five thousand
// round trips to serve twenty-five rows.
//
// **SO THE EXPANSION WALKS IDENTITIES IN THE PAGE'S OWN ORDER AND STOPS AS SOON
// AS THE PAGE IS DECIDED**, which is correct rather than approximate: the
// ordering's FIRST key is `identity_id`, identities are walked ascending, and
// every identity not yet walked sorts strictly after every row already
// collected. Once more than `limit` collected rows sit at or before the identity
// just walked, no unread identity can insert ahead of them, so both the window
// and `next_cursor` are already determined. A cursor skips whole identities the
// same way, for the same reason.
//
// **THIS IS NOT A CAP AND NOTHING IS TRUNCATED.** `graph.ts` refuses a silent
// truncation by name and so does this: every account that matches is still
// reachable, page after page, and what the early stop removes is work rather
// than rows. {@link AccountSearchCost} reports how many identities were actually
// expanded so the saving is a number rather than a claim.
//
// -----------------------------------------------------------------------------
// TWELVE FIELDS, AND FOUR OF THEM ARE NOT ON `accounts`
// -----------------------------------------------------------------------------
// `email`, `plan_code`, `open_flags` and the pair `balance_cents` /
// `withdrawable_cents` each reach another table, and every one of them is read
// for the WINDOW ONLY. That is what the ordering above buys: the fan-in is over
// keys and the fan-out is over a page.
//
//   `email` IS THE LOGIN'S AND NOT THE PERSON'S. `accounts.user_id` is
//   `NOT NULL` and names the login the account was opened under; an identity may
//   hold more than one login (ADR-041), so "the identity's email" is a question
//   with more than one answer and `user_id` is the column that has one.
//
//   `plan_code` IS `plans.code`, TWO HOPS OUT. `accounts.plan_version_id` names
//   the version an account was bought under and the version names its plan.
//   Both tables are `firm` and both reads are addressed, and both are memoised
//   per page because a page of one plan's accounts is the ordinary case.
//
//   `open_flags` COUNTS THE OWNER'S FLAGS THAT REACH THIS ACCOUNT, and the rule
//   is `account.ts`'s verbatim rather than a second reading of the same
//   question: `risk_flags.identity_id` is `NOT NULL` and `account_id` is
//   NULLABLE, so a flag is about the PERSON and MAY be about one account, and
//   the drill-down keeps the person's identity-level flags beside this account's.
//   A count on the search row that disagreed with the list on the drill-down
//   would be two answers to one question. **OPEN MEANS `status = 'open'` AND
//   NOTHING ELSE**, which is `routes/admin-writes.ts`'s own reading where a
//   freeze "cites no flag that is still open": `investigating` is a flag
//   somebody is already working.
//
//   `payouts_frozen` IS THE ACCOUNT'S **OR** THE IDENTITY'S, AND THAT IS THE
//   MONEY PATH'S OWN DEFINITION RATHER THAN THIS MODULE'S CHOICE.
//   `packages/rules-engine/src/types.ts`'s `ExternalGates.payoutsFrozen` is
//   "account level OR identity level, RESOLVED BY THE CALLER", transcribed from
//   `M01` section 2.1, and `payout/evaluate.ts` refuses to guess which level
//   because "inventing 'account' here would be a wrong word on a support
//   screen". `M06` section 3.3 is where the two meet: entering `investigating`
//   sets `payouts_frozen` on the IDENTITY, so an account rendered `false` while
//   its owner is frozen would be a search row saying this account can be paid
//   when the engine will refuse it. `recon_blocked` beside it has no identity
//   half and is `accounts.recon_blocked` alone.
//
// -----------------------------------------------------------------------------
// AN ACCOUNT THE ENGINE HAS NOT EVALUATED HAS NO BALANCE IN THIS ESTATE, AND
// THAT IS A MEASUREMENT WITH A CLEARING CONDITION RATHER THAN A ZERO NOBODY SAID
// -----------------------------------------------------------------------------
// `balance_cents` and `withdrawable_cents` are one row of `rule_states`, the
// account's LATEST trading day, and they are read as a pair from one row because
// they are a pair: `0015_rule_states.sql` is "the engine's own record, one row
// per account per trading day", and taking the two numbers from two days would
// report a withdrawable that the balance beside it never produced.
//
// **NOTHING IN THIS TREE WRITES A `rule_states` ROW YET**, so an account with
// none is not a hypothetical, and API_CONTRACT types both members `number` with
// no null. Three answers were available and two of them are worse:
//
//   A THROW is `FM-17`'s shape arriving on a console, and `0015`'s own header is
//   where that failure mode is written down: a check that fires on an ordinary
//   state is a check somebody disables. An account provisioned this morning is
//   an ordinary state, and a search that 500s on it also loses every OTHER
//   account of the same person on the same page.
//
//   `accounts.size_cents` AS A STAND-IN would assert that a funded account's
//   trading balance equals its size, which is a rules-engine claim and this
//   module may not make one. `M06` section 3.2 refuses a recomputation on the
//   drill-down for the same reason: a recomputation is an assertion and the
//   stored row is a record.
//
//   SO BOTH ARE ZERO AND THE REASON IS ON THE LINE. `withdrawable_cents` is
//   exactly right at zero: `0015` CHECKs it `>= 0`, and an account no gate has
//   passed has no claim. `balance_cents` at zero is the weaker half and it is
//   the honest reading of an absent record rather than a number this module
//   invented. **`test/admin-source-search.test.ts` pins it with a stated
//   clearing condition**, session 363's shape, so the day a row is written at
//   account open or the contract admits a null, a case goes red and names the
//   choice instead of the next session re-deriving it.
//
// -----------------------------------------------------------------------------
// WHAT THIS MODULE MAY NOT DO, KEPT SHORT BECAUSE EVERY LINE OF IT IS A FENCE
// -----------------------------------------------------------------------------
// No `pg` import, no `@merit/db` import, no `sqlExecutor` (it is not on
// {@link SearchTx} to reach), no write method on the handle at all, no ledger
// account named, no cast past a key type, and no `SystemReason` or
// `SqlExecutorReason` member. The handle is `FlagsTx`'s shape for `FlagsTx`'s
// reason: `SystemTx` satisfies it structurally and the widest fan-out in the
// console cannot write through it.
// =============================================================================

import { AdminReadError } from '../routes/admin-reads.ts';
import type {
  AccountSearchQuery,
  AdminAccountSearchItem,
  AdminPage,
} from '../routes/admin-reads.ts';
import type { AdminRowFilter } from './flags.ts';

// -----------------------------------------------------------------------------
// The port onto the database
// -----------------------------------------------------------------------------

/**
 * The tables this module reads, and no others.
 *
 * ELEVEN, WHICH IS SIX TERMS FANNING IN AND TWELVE FIELDS FANNING OUT. Every one
 * is a registered `TableKey`; a name that is not is `TS2322` against
 * `TABLE_KEYS` at the composition, which is session 349's refusal on `events`
 * and took ADR-191 to clear.
 */
export const SEARCH_READ_TABLES = [
  'accounts',
  'couponRedemptions',
  'coupons',
  'identities',
  'payoutRequests',
  'planVersions',
  'plans',
  'platformAccountRefs',
  'riskFlags',
  'ruleStates',
  'users',
] as const;

/** One of {@link SEARCH_READ_TABLES}. */
export type SearchReadTable = (typeof SEARCH_READ_TABLES)[number];

/**
 * ADR-112's keyed accessor, READ HALF ONLY, over this module's eleven tables.
 *
 * `FlagsTx`'s shape and `FlagsTx`'s reason: `insert`, `updateAt`, `deleteAt` and
 * `sqlExecutor` are ABSENT rather than unused, and `SystemTx` satisfies this
 * structurally. `rows` is absent as well and that one is this module's own: a
 * whole-table read is the enumeration `FM-M6-10` refuses, and a search that
 * could reach for one would be a bulk surface behind a text box.
 */
export interface SearchTx {
  rowsWhere(key: SearchReadTable, where: AdminRowFilter): Promise<unknown[]>;
  rowAt(key: SearchReadTable, at: AdminRowFilter): Promise<unknown>;
}

// -----------------------------------------------------------------------------
// The columns, read defensively
// -----------------------------------------------------------------------------

function field(row: unknown, name: string): unknown {
  if (typeof row !== 'object' || row === null)
    throw new AdminReadError(
      `the accessor returned a ${typeof row} where a row was expected. A search result built out ` +
        'of that is an operator being told an account exists that does not',
    );
  return (row as Record<string, unknown>)[name];
}

function text(row: unknown, name: string, at: string): string {
  const value = field(row, name);
  if (typeof value !== 'string' || value === '')
    throw new AdminReadError(
      `${at} carries no \`${name}\`, and the column is \`NOT NULL\` in the schema. That is the ` +
        'transcription disagreeing with the database rather than a row to render',
    );
  return value;
}

function boolean(row: unknown, name: string, at: string): boolean {
  const value = field(row, name);
  if (typeof value !== 'boolean')
    throw new AdminReadError(
      `${at} carries \`${name}\` as ${JSON.stringify(value)}, and the column is ` +
        '`boolean NOT NULL`. A guessed boolean on this screen is a frozen account rendered as a ' +
        'live one',
    );
  return value;
}

/**
 * A `bigint` money column as the contract's JSON integer.
 *
 * `account.ts`'s `cents`, for `account.ts`'s reason: API_CONTRACT section 1
 * types every `*_cents` member a JSON integer, `assertContractScalars` refuses
 * the response otherwise, and a value past 2^53 silently rounded is wrong in its
 * low digits and right in every digit an operator reads.
 */
function cents(value: unknown, at: string): number {
  const asNumber =
    typeof value === 'bigint'
      ? Number(value)
      : typeof value === 'number'
        ? value
        : typeof value === 'string' && /^-?\d+$/.test(value)
          ? Number(value)
          : Number.NaN;
  if (!Number.isSafeInteger(asNumber))
    throw new AdminReadError(
      `${at} is ${JSON.stringify(typeof value === 'bigint' ? value.toString() : value)}, which ` +
        'is not a safe integer number of cents. API_CONTRACT section 1 types every `_cents` ' +
        'member as a JSON integer and a rounded one is wrong where it is hardest to notice',
    );
  return asNumber;
}

/** A `date NOT NULL` column as the exchange trading day, for comparison only. */
function dayOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return '';
}

// -----------------------------------------------------------------------------
// The terms
// -----------------------------------------------------------------------------

/**
 * Whether a term can address a `uuid` column at all.
 *
 * SEE THE HEADER: A TYPE CHECK AND NOT A SUBJECT CHECK. Postgres answers
 * `invalid input syntax for type uuid` to a term that is not one, so without
 * this every coupon search is a 500. ADR-194 clause 5's refusal is of a check
 * that guesses whether a term NAMES a subject, and this one asks only whether
 * the value is of the column's type, which is a question the database asks
 * anyway and answers by failing the whole request.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** {@link resolveTerm}'s answer: keys, never rows. */
interface Resolution {
  /** Accounts named directly, by id. */
  readonly accountIds: readonly string[];
  /** Identities whose accounts all match, expanded in page order later. */
  readonly identityIds: readonly string[];
  /** How many reads it took. */
  readonly reads: number;
}

/**
 * The six terms, fanned in to keys.
 *
 * EVERY TERM IS TRIED, ALWAYS, and the union is the answer. A term that names an
 * account id AND a coupon code is not a case this module has to rule on: both
 * reach rows the estate holds, both are the subject the operator typed, and
 * ranking one above the other would be this module deciding which of two true
 * answers an operator meant.
 */
async function resolveTerm(tx: SearchTx, term: string): Promise<Resolution> {
  const accountIds = new Set<string>();
  const identityIds = new Set<string>();
  let reads = 0;

  // 1. ACCOUNT ID, and 4. IDENTITY ID, and 6. PAYOUT ID. All three are `uuid`
  //    columns, so all three are behind the one type check.
  if (UUID.test(term)) {
    const account = await tx.rowAt('accounts', { id: term });
    reads += 1;
    if (account !== undefined && account !== null)
      accountIds.add(text(account, 'id', 'an account'));

    // The identity term reads `accounts` rather than `identities`, because an
    // identity with no accounts and an identity that is not there produce the
    // same empty page and the second read would decide nothing.
    for (const row of await tx.rowsWhere('accounts', { identityId: term }))
      accountIds.add(text(row, 'id', 'an account'));
    reads += 1;

    const payout = await tx.rowAt('payoutRequests', { id: term });
    reads += 1;
    if (payout !== undefined && payout !== null)
      accountIds.add(text(payout, 'accountId', `payout request \`${term}\``));
  }

  // 2. PLATFORM REF, live and retired. See the header: two tables, and the
  //    second is the burn history a live index cannot answer.
  for (const row of await tx.rowsWhere('accounts', { platformAccountRef: term }))
    accountIds.add(text(row, 'id', 'an account'));
  reads += 1;
  for (const row of await tx.rowsWhere('platformAccountRefs', { platformAccountRef: term }))
    accountIds.add(text(row, 'accountId', `platform ref \`${term}\``));
  reads += 1;

  // 3. EMAIL, against the login and against the resolution key. `citext` on both
  //    columns is what makes casing free rather than a normalisation this module
  //    would have to get right.
  const login = await tx.rowAt('users', { email: term });
  reads += 1;
  if (login !== undefined && login !== null)
    identityIds.add(text(login, 'identityId', `user \`${term}\``));
  for (const row of await tx.rowsWhere('users', { emailNormalized: term }))
    identityIds.add(text(row, 'identityId', `user \`${term}\``));
  reads += 1;

  // 5. COUPON. `rowsWhere` AND NOT `rowAt`, and the reason is a finding rather
  //    than a preference: `0006_commerce.sql:38` declares `code citext NOT NULL
  //    UNIQUE` and `packages/db/src/schema.ts` transcribes the column without
  //    `.unique()`, so `refuseUnaddressed` reads no unique key over it and an
  //    addressed read the database would honour is refused at run time. The
  //    filter is the same equality and needs no repair here; the transcription
  //    is `packages/db`'s and is reported rather than edited.
  for (const coupon of await tx.rowsWhere('coupons', { code: term })) {
    const couponId = text(coupon, 'id', `coupon \`${term}\``);
    for (const redemption of await tx.rowsWhere('couponRedemptions', { couponId }))
      // A RELEASED REDEMPTION IS STILL A REDEMPTION. `released_at` is written
      // rather than the row being deleted, precisely so claim-and-abandon stays
      // visible (`0006_commerce.sql`), and an operator asking who used a code is
      // asking about exactly that.
      identityIds.add(text(redemption, 'identityId', `redemption of \`${term}\``));
    reads += 1;
  }
  reads += 1;

  return { accountIds: [...accountIds], identityIds: [...identityIds], reads };
}

// -----------------------------------------------------------------------------
// The cursor
// -----------------------------------------------------------------------------

const CURSOR_SEPARATOR = ' ';

/** The page boundary, as the ordering's own key. See the header: both immutable. */
function cursorOf(item: AdminAccountSearchItem): string {
  return Buffer.from([item.identity_id, item.account_id].join(CURSOR_SEPARATOR), 'utf8').toString(
    'base64url',
  );
}

interface Position {
  readonly identityId: string;
  readonly accountId: string;
}

function decodeCursor(cursor: string): Position {
  const parts = Buffer.from(cursor, 'base64url').toString('utf8').split(CURSOR_SEPARATOR);
  if (parts.length !== 2)
    throw new AdminReadError(
      `the account search was handed a cursor carrying ${String(parts.length)} components where ` +
        'the ordering has two. A cursor from a different ordering would page through this one at ' +
        'a position that means nothing',
    );
  const [identityId, accountId] = parts;
  if (identityId === undefined || identityId === '' || accountId === undefined || accountId === '')
    throw new AdminReadError(
      'the account search was handed a cursor with an empty component, so the position it names ' +
        'is not one this ordering has',
    );
  return { identityId, accountId };
}

/** Strictly after `at` in `(identity_id, account_id)` ascending. */
function isAfter(candidate: Position, at: Position): boolean {
  if (candidate.identityId !== at.identityId) return candidate.identityId > at.identityId;
  return candidate.accountId > at.accountId;
}

function comparePosition(a: Position, b: Position): number {
  if (a.identityId !== b.identityId) return a.identityId < b.identityId ? -1 : 1;
  if (a.accountId === b.accountId) return 0;
  return a.accountId < b.accountId ? -1 : 1;
}

// -----------------------------------------------------------------------------
// The read
// -----------------------------------------------------------------------------

/**
 * What one search cost.
 *
 * THE FAN-IN AND THE FAN-OUT ARE SEPARATE NUMBERS because they grow with
 * different things. `termReads` is fixed by the six terms plus one per coupon
 * matched; `identitiesExpanded` is the number the early stop exists to keep
 * below `identitiesResolved`, and the gap between those two is the whole of what
 * the ordering bought.
 *
 * `ruleStateRows` IS THE ONE THAT GROWS WITH TIME RATHER THAN WITH ANYTHING A
 * CALLER CHOSE. `0015_rule_states.sql` is "roughly 250 rows per funded account
 * per year", and the latest one is read by pulling the account's rows and taking
 * the greatest trading day, because the accessor has no aggregate and this
 * module does not widen one to get it.
 */
export interface AccountSearchCost {
  readonly termReads: number;
  readonly identitiesResolved: number;
  readonly identitiesExpanded: number;
  readonly candidateAccounts: number;
  readonly ruleStateRows: number;
  readonly flagRows: number;
  readonly planReads: number;
}

/** {@link readAccountSearch}'s answer, plus what it cost. */
export interface AccountSearchResult {
  readonly page: AdminPage<AdminAccountSearchItem>;
  readonly cost: AccountSearchCost;
}

/** One candidate, before the fan-out that turns it into a wire row. */
interface Candidate extends Position {
  readonly row: unknown;
}

function candidateOf(row: unknown): Candidate {
  return {
    accountId: text(row, 'id', 'an account'),
    identityId: text(row, 'identityId', 'an account'),
    row,
  };
}

/**
 * `AdminReadSource.searchAccounts`, with the cost attached.
 *
 * AN EMPTY PAGE IS AN ANSWER AND NEVER A 404. ADR-194 clause 6 of section 10
 * says so in the contract's own voice: an operator who types something the
 * estate does not hold gets "the ordinary shape of a search that found nothing",
 * and the route has no not-found branch on this row to reach for anyway.
 *
 * THE LIMIT IS OBEYED HERE AND ASSERTED AGAIN AT THE ROUTE, and the two are
 * independent on purpose: `INV-M6-10` caps this result set, `routes/admin-reads.ts`
 * throws if the source returns more rows than it was asked for, and "a cap the
 * source may exceed is not a cap" is that file's own sentence.
 */
export async function readAccountSearch(
  tx: SearchTx,
  query: AccountSearchQuery,
): Promise<AccountSearchResult> {
  // `INV-M6-10` again, from this side. The route makes an absent `?query=` a
  // validation failure, and a source that answered an empty term with the whole
  // estate would be the same bulk surface reached by a different door.
  if (query.query.trim() === '')
    throw new AdminReadError(
      'the account search was handed an empty term. `INV-M6-10` grants trader-identifying data ' +
        'only where the query names a specific subject, so an empty term is not a wider search: ' +
        'it is the enumeration `FM-M6-10` refuses',
    );
  if (!Number.isSafeInteger(query.limit) || query.limit < 1)
    throw new AdminReadError(
      `the account search was handed a limit of ${JSON.stringify(query.limit)}, which is not a ` +
        'page size. The route validates this and a source that trusted it would page on nothing',
    );

  const after = query.cursor === null ? null : decodeCursor(query.cursor);
  const resolution = await resolveTerm(tx, query.query);

  // 1. THE ACCOUNTS NAMED DIRECTLY. Bounded by the estate's platform count plus
  //    two, so they are all read before the walk and none of them is deferred.
  const collected = new Map<string, Candidate>();
  for (const accountId of [...resolution.accountIds].sort()) {
    const row = await tx.rowAt('accounts', { id: accountId });
    // A ROW THAT VANISHED BETWEEN THE TWO READS IS A SMALLER PAGE AND NOT A
    // THROW. `platform_account_refs` and `payout_requests` both reference
    // `accounts` with `ON DELETE RESTRICT`, so this cannot happen while the
    // constraints hold, and one absent row must not empty an operator's search.
    if (row === undefined || row === null) continue;
    const candidate = candidateOf(row);
    collected.set(candidate.accountId, candidate);
  }

  // 2. THE IDENTITIES, WALKED IN THE PAGE'S OWN ORDER. See the header: the early
  //    stop is what makes a launch code affordable, and it removes work rather
  //    than rows.
  let identitiesExpanded = 0;
  for (const identityId of [...resolution.identityIds].sort()) {
    // Every account of an identity below the cursor sorts before it, so the
    // whole identity is skipped rather than read and discarded.
    if (after !== null && identityId < after.identityId) continue;
    if (settled(collected, after, query.limit, identityId)) break;
    identitiesExpanded += 1;
    for (const row of await tx.rowsWhere('accounts', { identityId })) {
      const candidate = candidateOf(row);
      collected.set(candidate.accountId, candidate);
    }
  }

  const eligible = [...collected.values()]
    .filter((candidate) => after === null || isAfter(candidate, after))
    .sort(comparePosition);
  const window = eligible.slice(0, query.limit);
  const more = eligible.length > window.length;

  // 3. THE FAN-OUT, OVER THE WINDOW AND NEVER OVER THE CANDIDATES. Four reads
  //    per row before memoisation, and every one of them is addressed or keyed.
  const identityRows = new Map<string, unknown>();
  const planCodes = new Map<string, string>();
  const data: AdminAccountSearchItem[] = [];
  let ruleStateRows = 0;
  let flagRows = 0;
  let planReads = 0;

  for (const candidate of window) {
    const at = `account \`${candidate.accountId}\``;
    const row = candidate.row;

    let identity = identityRows.get(candidate.identityId);
    if (identity === undefined) {
      identity = await tx.rowAt('identities', { id: candidate.identityId });
      // `accounts.identity_id` REFERENCES `identities(id)`, so this cannot
      // happen while the constraint holds. It is a throw and not a skipped row
      // for `account.ts`'s reason: the estate and the database disagreeing is
      // not a search result.
      if (identity === undefined || identity === null)
        throw new AdminReadError(
          `${at} names identity \`${candidate.identityId}\`, which has no \`identities\` row. ` +
            '`accounts.identity_id` references that table, so the estate and the database ' +
            'disagree and this result cannot be built',
        );
      identityRows.set(candidate.identityId, identity);
    }

    const userId = text(row, 'userId', at);
    const user = await tx.rowAt('users', { id: userId });
    if (user === undefined || user === null)
      throw new AdminReadError(
        `${at} names user \`${userId}\`, which has no \`users\` row. \`accounts.user_id\` is ` +
          '`NOT NULL` and a search row without an email is the one field an operator matches ' +
          'against what they were sent',
      );

    const planVersionId = text(row, 'planVersionId', at);
    let planCode = planCodes.get(planVersionId);
    if (planCode === undefined) {
      const version = await tx.rowAt('planVersions', { id: planVersionId });
      planReads += 1;
      if (version === undefined || version === null)
        throw new AdminReadError(
          `${at} names plan version \`${planVersionId}\`, which has no \`plan_versions\` row`,
        );
      const planId = text(version, 'planId', `plan version \`${planVersionId}\``);
      const plan = await tx.rowAt('plans', { id: planId });
      planReads += 1;
      if (plan === undefined || plan === null)
        throw new AdminReadError(
          `plan version \`${planVersionId}\` names plan \`${planId}\`, which has no \`plans\` row`,
        );
      planCode = text(plan, 'code', `plan \`${planId}\``);
      planCodes.set(planVersionId, planCode);
    }

    // THE LATEST STATE, AS ONE ROW. See the header: the pair comes off one day
    // or it is a withdrawable the balance beside it never produced.
    const states = await tx.rowsWhere('ruleStates', { accountId: candidate.accountId });
    ruleStateRows += states.length;
    const latest = latestState(states);

    // The owner's flags, kept where they are this account's or the person's.
    // `account.ts`'s rule verbatim, and `open` means `open`.
    const flags = await tx.rowsWhere('riskFlags', { identityId: candidate.identityId });
    flagRows += flags.length;
    const openFlags = flags.filter((flag) => {
      const on = field(flag, 'accountId');
      if (on !== null && on !== undefined && on !== candidate.accountId) return false;
      return field(flag, 'status') === 'open';
    }).length;

    data.push({
      account_id: candidate.accountId,
      identity_id: candidate.identityId,
      email: text(user, 'email', `user \`${userId}\``),
      plan_code: planCode,
      size_cents: cents(field(row, 'sizeCents'), `${at}'s \`size_cents\``),
      phase: text(row, 'phase', at),
      status: text(row, 'status', at),
      balance_cents: latest === null ? 0 : cents(field(latest, 'balanceCents'), `${at}'s balance`),
      withdrawable_cents:
        latest === null ? 0 : cents(field(latest, 'withdrawableCents'), `${at}'s withdrawable`),
      open_flags: openFlags,
      // The money path's own definition, resolved across both levels. See the
      // header: the engine refuses to guess which level and so does this.
      payouts_frozen:
        boolean(row, 'payoutsFrozen', at) || boolean(identity, 'payoutsFrozen', 'the identity'),
      recon_blocked: boolean(row, 'reconBlocked', at),
    });
  }

  const last = data.at(-1);
  return {
    page: {
      data,
      next_cursor: more && last !== undefined ? cursorOf(last) : null,
    },
    cost: {
      termReads: resolution.reads,
      identitiesResolved: resolution.identityIds.length,
      identitiesExpanded,
      candidateAccounts: collected.size,
      ruleStateRows,
      flagRows,
      planReads,
    },
  };
}

/**
 * Whether the page is already decided, so the walk can stop.
 *
 * THE ARGUMENT IS THE ORDERING'S FIRST KEY AND NOTHING ELSE. Identities are
 * walked ascending, so every identity from `identityId` onward produces rows
 * that sort at or after it. If more than `limit` eligible rows already sit
 * STRICTLY BEFORE `identityId`, the window and its successor are fixed and no
 * unread row can reach either.
 *
 * `>` AND NOT `>=`, because `limit` rows fill the window and the `limit + 1`th
 * is what decides `next_cursor`. Stopping one row early would report
 * `next_cursor: null` on a search that has another page.
 */
function settled(
  collected: ReadonlyMap<string, Candidate>,
  after: Position | null,
  limit: number,
  identityId: string,
): boolean {
  let ahead = 0;
  for (const candidate of collected.values()) {
    if (candidate.identityId >= identityId) continue;
    if (after !== null && !isAfter(candidate, after)) continue;
    ahead += 1;
    if (ahead > limit) return true;
  }
  return false;
}

/**
 * The account's latest `rule_states` row, or `null` where it has none.
 *
 * GREATEST TRADING DAY, TIE-BROKEN ON THE ROW'S OWN `bigint` ID, which is the
 * only total order this table has. The tie-break is not decoration: `0015` keys
 * the table on `id` rather than on `(account_id, trading_day)`, so two rows for
 * one day are a shape the database permits and the later one is the one the
 * engine wrote last.
 */
function latestState(rows: readonly unknown[]): unknown {
  let best: unknown = null;
  let bestDay = '';
  let bestId = -1n;
  for (const row of rows) {
    const day = dayOf(field(row, 'tradingDay'));
    const rawId = field(row, 'id');
    const id = typeof rawId === 'bigint' ? rawId : BigInt(String(rawId ?? '0'));
    if (best === null || day > bestDay || (day === bestDay && id > bestId)) {
      best = row;
      bestDay = day;
      bestId = id;
    }
  }
  return best;
}
