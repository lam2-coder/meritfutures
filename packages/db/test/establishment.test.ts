// =============================================================================
// packages/db/test/establishment.test.ts
// =============================================================================
// ADR-126. THE TWO ACTS THAT CREATE A SCOPE RATHER THAN EXERCISE ONE.
//
// ADR-120 measured that ADR-112 unblocked everything a session can DO and
// nothing that MAKES one, and left two constructions as rulings: minting a
// session and resolving a person from the address they typed. ADR-126 rules
// them, and it rules that the vocabulary which moves is the TABLE and never the
// REASON. This suite is what that ruling has to survive.
//
// -----------------------------------------------------------------------------
// THE LOAD-BEARING ASSERTION IS `ledgerEntries`
// -----------------------------------------------------------------------------
// `insertUnder` reads naturally as a method over the `derived` CLASS, and the
// first draft of ADR-126's section had it that way. `ledger_entries` is
// `derived` with `traversal: 'hop'`, so the generic version hands a scoped
// request handler ONE LEG of a double-entry posting under its own ledger
// account, which is money creation behind a handle every authenticated request
// already holds. The case below fails on the day somebody generalises the method
// back, and it fails naming that table.
//
// -----------------------------------------------------------------------------
// NOTHING HERE EXECUTES A WRITE AND THE SUITE SAYS SO
// -----------------------------------------------------------------------------
// `ci.yml`'s `integration` job runs on bare `ubuntu-latest` with no services
// block, so there is no Postgres in CI -- the absence ADR-102 section 16,
// ADR-112 section 9 and ADR-120 section 7 all name, and which is now `VG-3` and
// `VG-6`'s registered artifact. Every statement assertion reads the SQL the
// accessor BUILDS over a driverless Drizzle handle that records what it is asked
// to run, so what is asserted is what `insertUnder` actually sends.
//
// AND THE ONE PROPERTY A RECORDER GENUINELY PROVES HERE IS THE ORDER. The parent
// proof is a SELECT and the mint is an INSERT, and the refusal is that the
// second statement is never sent when the first answers nothing. That is a fact
// about the sequence of calls rather than about what a database did with them,
// which is exactly what a recorder can see.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pg-proxy';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { PoolClient } from 'pg';
import { describe, expect, test } from 'vitest';

import { SCOPE_RULES, TABLES, TABLE_KEYS, type TableKey } from '../src/scope.ts';
import {
  IdentityAlreadyEstablished,
  RESOLUTION_ADDRESS,
  establishmentTx,
  insertUnderStatement,
  normalizedEmail,
  resolutionPredicate,
  scopedTx,
  uniqueKeys,
  type IdentityId,
  type ResolvableTableKey,
  type StatementSource,
} from '../src/scoped-db.ts';

const IDENTITY = 'i-1' as IdentityId;

/** The one member of `ParentedTableKey`, spelled once so the cases read. */
const PARENTED: TableKey = 'sessions';

/** A `sessions` row a minter would write. `userId` is the parent it must name. */
const MINT = {
  userId: 'u-1',
  refreshTokenHash: Buffer.from([1, 2, 3]),
  expiresAt: new Date(0),
  authFactor: 'email_otp',
};

interface Sent {
  readonly sql: string;
  readonly params: unknown[];
}

/**
 * A driverless handle that records every statement and answers a fixed number of
 * rows to the SELECT that proves the parent.
 *
 * The row width is the VIA table's, because that is what the proving select
 * reads. Only the count matters; the values are nulls.
 */
function proving(
  parents: number,
  via: TableKey = 'users',
): { source: StatementSource; sent: Sent[] } {
  const sent: Sent[] = [];
  const width = Object.keys(getTableColumns(TABLES[via] as PgTable)).length;
  const source = drizzle(async (sql: string, params: unknown[]) => {
    sent.push({ sql, params });
    if (/^\s*select/i.test(sql)) {
      return {
        rows: Array.from({ length: parents }, () => new Array(width).fill(null) as unknown[]),
      };
    }
    return { rows: [] };
  }) as StatementSource;
  return { source, sent };
}

function stubConn(): PoolClient {
  return { query: async () => ({ rows: [] as unknown[] }) } as unknown as PoolClient;
}

/** The leading keyword of every statement sent, in order. What a recorder can see. */
function verbs(sent: readonly Sent[]): string[] {
  return sent.map((s) => (/^\s*(\w+)/.exec(s.sql)?.[1] ?? '').toLowerCase());
}

// =============================================================================
// RESOLVE: the pre-identity read, where the address is the WHOLE predicate
// =============================================================================

describe('the resolution door reaches one table by one column and nothing else', () => {
  test('it renders `users"."email = $1` and names no other table', async () => {
    const { source, sent } = proving(1);
    await source
      .select()
      .from(TABLES['users'] as PgTable)
      .where(resolutionPredicate('users', { email: 'a@example.com' }));
    const statement = sent[0] as Sent;
    expect(statement.sql).toMatch(/"users"\."email" = \$1/);
    expect(statement.params).toEqual(['a@example.com']);
    // NO TENANCY, NO EXISTS, NO SECOND TABLE IN THE PREDICATE, and the
    // predicate is where it is asserted rather than the whole statement. The
    // PROJECTION returns `identity_id` and must: that column is the answer this
    // door exists to fetch. What the door must not carry is a tenancy narrowing,
    // because there is no identity to narrow BY -- which is the sentence that
    // makes this an authority and not a predicate.
    const where = statement.sql.slice(statement.sql.indexOf(' where '));
    expect(where).not.toMatch(/exists/i);
    expect(where).not.toMatch(/identity_id/);
    expect(statement.sql).toMatch(/select "id", "identity_id"/);
  });

  test('a column outside the vocabulary is refused BY NAME, even though it is a unique key', () => {
    // `users.id` IS unique, so `refuseUnaddressed` would honour it. The
    // vocabulary is what refuses it, and this case is the difference between a
    // table-only list and the two-part one ADR-126 clause 4 rules.
    expect(() =>
      resolutionPredicate('users', { id: 'u-1' } as unknown as { email: unknown }),
    ).toThrow(/"id" is not a resolution address on users/);
    expect(uniqueKeys('users').map((k) => k.join(','))).toContain('id');
  });

  test('an address that omits the declared column is refused rather than widened', () => {
    expect(() => resolutionPredicate('users', {} as unknown as { email: unknown })).toThrow(
      /must name "email"/,
    );
  });

  test('a null address value is refused, because equality against NULL names no row', () => {
    expect(() => resolutionPredicate('users', { email: null })).toThrow(/is null in a filter/);
  });

  // -------------------------------------------------------------------------
  // The vocabulary itself, asserted mechanically so a later member is re-ruled
  // rather than discovered
  // -------------------------------------------------------------------------

  test('every resolvable table is registered and none of them is reachable without this door', () => {
    for (const key of Object.keys(RESOLUTION_ADDRESS) as ResolvableTableKey[]) {
      expect(TABLE_KEYS, `${key} is not a registry row`).toContain(key);
      const rule = SCOPE_RULES[key as TableKey];
      // A `firm` member would be a door duplicating `firmDb()`, which already
      // reaches rows that belong to nobody with no identity and no reason. The
      // vocabulary is for tables an identity OWNS, which is the boundary being
      // crossed.
      expect(rule.class, `${key} is ${rule.class} and firmDb() already reaches it`).not.toBe(
        'firm',
      );
    }
  });

  test('every column in the vocabulary exists on its table AND is declared unique in schema.ts', () => {
    for (const [key, columns] of Object.entries(RESOLUTION_ADDRESS)) {
      const table = TABLES[key as TableKey] as PgTable;
      const properties = getTableColumns(table) as unknown as Record<string, { name: string }>;
      const sqlNames: string[] = [];
      for (const property of columns) {
        const column = properties[property];
        expect(column, `${key}.${property} is not a column of that table`).toBeDefined();
        sqlNames.push((column as { name: string }).name);
      }
      // THE FOLD. `refuseUnaddressed` reads `schema.ts`, so a vocabulary member
      // over a non-unique column would be a MANY-ROW read at an authority that
      // carries no tenancy at all. Asserted here as well as run there, because
      // the day it fails there is a request in production.
      const keys = uniqueKeys(key as TableKey).map((k) => [...k].sort().join(','));
      expect(keys, `${key} does not declare (${sqlNames.join(', ')}) unique`).toContain(
        [...sqlNames].sort().join(','),
      );
    }
  });

  test('the fold to schema.ts is CALLED, and this is a source assertion because the vocabulary cannot reach it', () => {
    // HONEST ABOUT WHAT THIS CASE IS. `RESOLUTION_ADDRESS` declares one column
    // and that column is unique, so `refuseUnaddressed` inside
    // `resolutionPredicate` CANNOT FIRE on today's vocabulary: deleting the call
    // was seeded and turned nothing red. That is ADR-112 section 8's own warning
    // arriving in this file -- a guard with nothing to find looks exactly like a
    // guard finding nothing wrong -- so the CALL SITE is asserted where the
    // behaviour cannot be, and the case above asserts the property the guard
    // exists to check. The day a second member lands, both halves matter.
    const source = readAccessor();
    const at = source.indexOf('export function resolutionPredicate');
    expect(at, 'resolutionPredicate is no longer declared here').toBeGreaterThan(0);
    const body = source.slice(at, source.indexOf('\n}', at));
    expect(body).toMatch(/refuseUnresolvableAddress\(key, address\)/);
    expect(body).toMatch(/refuseUnaddressed\(key, address\)/);
  });

  test('the vocabulary is exactly `users` by `email`, so growing it is a re-ruling', () => {
    // THE ASSERTION THAT FAILS ON GOOD NEWS. A second member is legitimate and
    // it is a decision somebody takes with an argument attached, which is the
    // whole control ADR-126 clause 2 substitutes for a third `SystemReason`.
    expect(RESOLUTION_ADDRESS).toEqual({ users: ['email'] });
  });
});

// =============================================================================
// MINT: the parent is PROVED and never stamped
// =============================================================================

describe('insertUnder proves the parent before it writes the row', () => {
  test('the proving SELECT carries the via table scope predicate and the caller value', async () => {
    const { source, sent } = proving(1);
    await insertUnderStatement(source, PARENTED as 'sessions', IDENTITY, MINT);
    const proof = sent[0] as Sent;
    expect(proof.sql).toMatch(/^select/i);
    expect(proof.sql).toMatch(/from "users"/);
    expect(proof.sql).toMatch(/"users"\."id" = \$1/);
    expect(proof.sql).toMatch(/"users"\."identity_id" = \$2/);
    expect(proof.params).toEqual(['u-1', IDENTITY]);
  });

  test('with the parent proved, the INSERT is sent and carries exactly the caller values', async () => {
    const { source, sent } = proving(1);
    await insertUnderStatement(source, PARENTED as 'sessions', IDENTITY, MINT);
    expect(sent).toHaveLength(2);
    const written = sent[1] as Sent;
    expect(written.sql).toMatch(/^insert into "sessions"/i);
    expect(written.sql).toMatch(/"user_id"/);
    // NO TENANCY STAMP. `scopedInsertStatement` appends the identity to an
    // `owned` insert; a `derived` row has no column to append it to, and the
    // identity is present in this unit of work only as the thing the proof was
    // run against. A stamped `identity_id` here would be a column `sessions`
    // does not have.
    expect(written.sql).not.toMatch(/identity_id/);
    expect(written.params).toContain('u-1');
  });

  test('THE PARENT NOT BEING THIS IDENTITY IS A THROW AND NO INSERT IS SENT', async () => {
    // THE CONTROL, AND THE STATEMENT LIST IS ASSERTED BEFORE THE EXCEPTION IS.
    // Zero proving rows means the named `user_id` is not one of this identity's
    // logins, and a session minted there is somebody else's account. A refusal
    // that raised AFTER writing the row would satisfy every `rejects.toThrow`
    // in this file, so the ORDER of these two assertions is itself the control:
    // this case has to fail on the recorder rather than on the missing throw.
    const { source, sent } = proving(0);
    const outcome = await insertUnderStatement(source, PARENTED as 'sessions', IDENTITY, MINT).then(
      () => 'resolved' as unknown,
      (error: unknown) => error,
    );
    expect(verbs(sent), 'an INSERT was sent for a parent that was not proved').toEqual(['select']);
    expect(outcome).toBeInstanceOf(Error);
    expect(String(outcome)).toMatch(/cannot be proved/);
  });

  test('a proof that matched more than one row is a hop drift and writes nothing', async () => {
    const { source, sent } = proving(2);
    const outcome = await insertUnderStatement(source, PARENTED as 'sessions', IDENTITY, MINT).then(
      () => 'resolved' as unknown,
      (error: unknown) => error,
    );
    expect(verbs(sent)).toEqual(['select']);
    expect(String(outcome)).toMatch(/matched 2 rows of users/);
  });

  test('a caller that does not name the parent is refused, because the handle cannot stamp it', async () => {
    const { source, sent } = proving(1);
    const { userId, ...withoutParent } = MINT;
    void userId;
    await expect(
      insertUnderStatement(source, PARENTED as 'sessions', IDENTITY, withoutParent),
    ).rejects.toThrow(/must name "userId"/);
    expect(sent).toHaveLength(0);
  });

  test('the SQL spelling is refused rather than silently dropped from the INSERT', async () => {
    // Drizzle keys a values object by PROPERTY name, so `user_id` would be
    // dropped from the statement and the parent proved against a value the row
    // never carried. That is a session minted with a NULL parent on a NOT NULL
    // column, which the database refuses -- and the refusal a reviewer can read
    // belongs here rather than in a constraint violation.
    const { source, sent } = proving(1);
    await expect(
      insertUnderStatement(source, PARENTED as 'sessions', IDENTITY, {
        user_id: 'u-1',
        refreshTokenHash: Buffer.from([1]),
      }),
    ).rejects.toThrow(/Name "userId" instead/);
    expect(sent).toHaveLength(0);
  });

  test('a null parent is refused, because equality against NULL proves nothing', async () => {
    const { source, sent } = proving(1);
    await expect(
      insertUnderStatement(source, PARENTED as 'sessions', IDENTITY, { ...MINT, userId: null }),
    ).rejects.toThrow(/A NULL parent proves nothing/);
    expect(sent).toHaveLength(0);
  });

  test('the proof and the write are on ONE source, so the parent cannot vanish between them', async () => {
    const { source, sent } = proving(1);
    await scopedTx(source, stubConn(), IDENTITY).insertUnder('sessions', MINT);
    expect(sent).toHaveLength(2);
    expect((sent[0] as Sent).sql).toMatch(/^select/i);
    expect((sent[1] as Sent).sql).toMatch(/^insert/i);
  });

  test('the identity in the proof comes from the HANDLE and never from the values', async () => {
    const { source, sent } = proving(1);
    await scopedTx(source, stubConn(), IDENTITY).insertUnder('sessions', {
      ...MINT,
      // A caller cannot smuggle a scope in: `sessions` has no identity column,
      // and the proof reads the one the handle was opened with.
      authFactor: 'email_otp',
    });
    expect((sent[0] as Sent).params).toEqual(['u-1', IDENTITY]);
  });
});

// =============================================================================
// THE VOCABULARY, WHICH IS THE WHOLE OF ADR-126 CLAUSE 2
// =============================================================================

describe('the vocabulary that moves is the table and never the reason', () => {
  test('`ledgerEntries` IS derived and hop, and it is NOT in the parented vocabulary', () => {
    // THE ASSERTION THIS SUITE EXISTS FOR. Both halves matter: the first is why
    // a class-generic `insertUnder` looks correct, and the second is why this
    // one is not. If the first half ever fails, the registry moved and the
    // second half stopped being the thing protecting the ledger.
    const rule = SCOPE_RULES['ledgerEntries'];
    expect(rule.class).toBe('derived');
    expect(rule.class === 'derived' && rule.traversal).toBe('hop');

    const source = readAccessor();
    const declared = /export type ParentedTableKey = Extract<DerivedTableKey,([^>]+)>/.exec(source);
    expect(
      declared,
      'ParentedTableKey is no longer an Extract over the derived class',
    ).not.toBeNull();
    const members = [...(declared?.[1] ?? '').matchAll(/'([a-zA-Z]+)'/g)].map(
      (m) => m[1] as string,
    );
    expect(members).toEqual(['sessions']);
    expect(members).not.toContain('ledgerEntries');
  });

  test('every parented member is `derived` with a `hop` traversal', () => {
    for (const key of parentedMembers()) {
      const rule = SCOPE_RULES[key as TableKey];
      expect(rule.class, `${key} is not derived`).toBe('derived');
      expect(rule.class === 'derived' && rule.traversal, `${key} is not a hop`).toBe('hop');
    }
  });

  test('the derived class is WIDER than the vocabulary, which is the fact the ruling rests on', () => {
    const derived = TABLE_KEYS.filter((k) => SCOPE_RULES[k].class === 'derived');
    // 19 at this commit, and the figure is COMPUTED rather than stated: what the
    // case asserts is the RELATION, because a count is a fact about a tree at a
    // commit and eight approval clauses in this corpus have drifted on one.
    expect(derived.length).toBeGreaterThan(parentedMembers().length);
  });

  test('`SystemReason` is still exactly two members and no ESTABLISHMENT reason was minted', () => {
    // ADR-126 clause 2 keeps both closed and says so in the entry. Watched here
    // as well as in `packages/ledger/test/accessor-bind.test.ts`, because this
    // is the entry that had a live argument for widening one of them.
    //
    // THE SECOND HALF ASSERTED `SqlExecutorReason` AT ONE MEMBER UNTIL ADR-332,
    // which minted a second for the pool-shaped producer that constructs the job
    // queue. That is not the widening this file was written against: the one it
    // refused was a member for an ESTABLISHMENT handler, a caller holding a
    // transaction. So the assertion follows the property rather than the count,
    // and reads the member a transaction handle may write.
    const source = readAccessor();
    const reasons = /export type SystemReason =([^;]+);/.exec(source)?.[1] ?? '';
    expect([...reasons.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort()).toEqual([
      'nightly-batch',
      'operator-console',
    ]);
    const raw =
      /export type TransactionSqlExecutorReason = Extract<SqlExecutorReason,([^>]+)>;/.exec(
        source,
      )?.[1] ?? '';
    expect([...raw.matchAll(/'([a-z-]+)'/g)].map((m) => m[1])).toEqual(['job-enqueue']);
  });

  test('the resolution door declares no write verb and no transaction', () => {
    // ADR-126 clause 4. `packages/ledger/test/accessor-bind.test.ts` asserts the
    // same property of the other three read handles and does not know this one
    // exists, so it is asserted here rather than left to the day that file is
    // widened.
    const source = readAccessor();
    const at = source.indexOf('export interface ResolutionDb {');
    expect(at, 'ResolutionDb is no longer declared here').toBeGreaterThan(0);
    const body = source.slice(at, source.indexOf('\n}', at));
    for (const verb of ['insert', 'update', 'delete', 'transaction', 'rows', 'sqlExecutor']) {
      expect(body, `ResolutionDb carries ${verb}`).not.toMatch(new RegExp(`\\b${verb}\\b`));
    }
    expect(body).toMatch(/\browAt\b/);
  });
});

/** The accessor's own source, read rather than restated. */
function readAccessor(): string {
  return readFileSync(fileURLToPath(new URL('../src/scoped-db.ts', import.meta.url)), 'utf8');
}

/** The members of `ParentedTableKey`, read off the type rather than listed here. */
function parentedMembers(): string[] {
  const declared = /export type ParentedTableKey = Extract<DerivedTableKey,([^>]+)>/.exec(
    readAccessor(),
  );
  return [...(declared?.[1] ?? '').matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1] as string);
}

// =============================================================================
// ESTABLISH: the write sibling, where the constraint is the arbiter (ADR-197)
// =============================================================================

/**
 * A recorder that answers an `INSERT ... RETURNING` with one row carrying `id`.
 *
 * `proving` above answers SELECTs and returns no rows to a write, which is what
 * `insertUnder` needs. Establishment reads its own `RETURNING`, so this one
 * answers writes instead, and `fail` lets a case make the second insert raise
 * the way `users_email_key` raises.
 */
function establishing(options: { readonly fail?: unknown } = {}): {
  source: StatementSource;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const ids = ['i-established', 'u-established'];
  const source = drizzle(async (sql: string, params: unknown[]) => {
    sent.push({ sql, params });
    if (/into "users"/.test(sql) && options.fail !== undefined) throw options.fail;
    return { rows: [[ids[sent.length - 1] ?? 'x']] };
  }) as StatementSource;
  return { source, sent };
}

/** A `pg` unique violation, wrapped the way Drizzle actually wraps one. */
function wrappedViolation(constraint: string): Error {
  const driver = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint,
  });
  return new Error('Failed query: insert into "users" ...', { cause: driver });
}

describe('the establishment door writes two rows or none', () => {
  test('it sends the identities insert first and the users insert second', async () => {
    const { source, sent } = establishing();
    const out = await establishmentTx(source).establish({ email: 'New.Person@Example.COM' });
    expect(verbs(sent)).toEqual(['insert', 'insert']);
    expect(sent[0]?.sql).toMatch(/into "identities"/);
    expect(sent[1]?.sql).toMatch(/into "users"/);
    expect(out).toEqual({ identityId: 'i-established', userId: 'u-established' });
  });

  test('the identities insert names EVERY column `default` and carries no parameter', async () => {
    // ADR-196 CLAUSE 3, AS A PROPERTY OF THE STATEMENT RATHER THAN OF A CALLER.
    // `establish` takes no `identities` values, so there is no parameter through
    // which `display_name`, `max_accounts_override` or `support_contact_ref`
    // could arrive. An empty parameter list is that fact, measured.
    const { source, sent } = establishing();
    await establishmentTx(source).establish({ email: 'a@example.com' });
    const first = sent[0] as Sent;
    expect(first.params).toEqual([]);
    const columns = Object.keys(getTableColumns(TABLES['identities'] as PgTable)).length;
    expect(first.sql.match(/\bdefault\b/g) ?? []).toHaveLength(columns);
  });

  test('the users insert carries the identity the FIRST statement returned', async () => {
    const { source, sent } = establishing();
    await establishmentTx(source).establish({ email: 'Someone@Example.com' });
    expect(sent[1]?.params).toContain('i-established');
    // AS TYPED IN `email`, NORMALIZED IN `email_normalized`. Two columns, one
    // address, and the pair is written by one statement so it cannot drift.
    expect(sent[1]?.params).toContain('Someone@Example.com');
    expect(sent[1]?.params).toContain('someone@example.com');
  });

  test('it shares the resolution door’s address vocabulary and both of its refusals', async () => {
    const { source } = establishing();
    const tx = establishmentTx(source);
    await expect(tx.establish({ id: 'u-1' } as unknown as { email: string })).rejects.toThrow(
      /"id" is not a resolution address on users/,
    );
    await expect(tx.establish({} as unknown as { email: string })).rejects.toThrow(
      /must name "email"/,
    );
    await expect(tx.establish({ email: '   ' })).rejects.toThrow(/non-empty `email`/);
  });

  test('a unique violation on `users_email_key` is TYPED, through the wrapper Drizzle throws', async () => {
    // THE `cause` CHAIN IS THE WHOLE OF THIS CASE. Drizzle does not re-raise the
    // driver's error, it throws its own with the driver's one in `cause`, so a
    // translator reading only the top level matches nothing -- and fails
    // invisibly, because the rollback still refunds the rows and only the TYPE
    // is wrong. A handler branching on that type would answer 500 where
    // ADR-196 clause 4 requires `is_new: false`.
    const { source } = establishing({ fail: wrappedViolation('users_email_key') });
    await expect(establishmentTx(source).establish({ email: 'taken@example.com' })).rejects.toThrow(
      IdentityAlreadyEstablished,
    );
  });

  test('a unique violation on any OTHER constraint is NOT translated', async () => {
    // `users` carries two unique keys and `23505` on `users_pkey` is a uuid
    // collision rather than a race. Answering `is_new: false` to it would report
    // an address as taken that nobody holds.
    const { source } = establishing({ fail: wrappedViolation('users_pkey') });
    const failed = establishmentTx(source).establish({ email: 'a@example.com' });
    await expect(failed).rejects.toThrow(/Failed query/);
    await expect(failed).rejects.not.toThrow(IdentityAlreadyEstablished);
  });

  test('the translation re-RAISES, because the throw is what rolls the transaction back', async () => {
    // IF THIS EVER RETURNS INSTEAD OF THROWING, the identities row and the three
    // ledger_accounts rows 0054's trigger wrote COMMIT with no users row, which
    // is clause 2's forbidden state and is permanent under ON DELETE RESTRICT.
    const { source } = establishing({ fail: wrappedViolation('users_email_key') });
    let threw = false;
    try {
      await establishmentTx(source).establish({ email: 'taken@example.com' });
    } catch {
      threw = true;
    }
    expect(threw, 'establish resolved on a taken address instead of throwing').toBe(true);
  });

  test('`EstablishmentTx` carries ONE verb, and the absence of the others is the control', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/scoped-db.ts', import.meta.url)),
      'utf8',
    );
    const at = source.indexOf('export interface EstablishmentTx {');
    expect(at, 'EstablishmentTx is no longer declared here').toBeGreaterThan(0);
    const body = source.slice(at, source.indexOf('\n}', at));
    for (const verb of ['insert', 'updateAt', 'deleteAt', 'rowAt', 'rows', 'sqlExecutor', 'lockAt'])
      expect(body, `EstablishmentTx carries ${verb}`).not.toMatch(new RegExp(`\\b${verb}\\b`));
    expect(body).toMatch(/\bestablish\b/);
  });

  test('`ON CONFLICT` is refused by name and appears nowhere on this path', () => {
    // THE LENIENT SPELLING DOES NOT RAISE, so the transaction commits with an
    // identity nobody can reach, delete or explain. Measured against PostgreSQL
    // 16 in ADR-197 section 6: the strict spelling costs a racing loser ZERO
    // permanent rows and the lenient one costs FOUR.
    const source = readFileSync(
      fileURLToPath(new URL('../src/scoped-db.ts', import.meta.url)),
      'utf8',
    );
    const at = source.indexOf('export function establishmentTx(');
    const body = source.slice(at, source.indexOf('\n}\n', at));
    expect(body).not.toMatch(/onConflict/i);
  });
});

describe('normalizedEmail is the column its own comment describes', () => {
  test('dots and plus-tags are stripped from the local part and case is folded', () => {
    expect(normalizedEmail('Bob.Smith+merit@Gmail.com')).toBe('bobsmith@gmail.com');
    expect(normalizedEmail('bobsmith@gmail.com')).toBe('bobsmith@gmail.com');
  });

  test('the domain keeps its dots, which is the half a naive strip gets wrong', () => {
    expect(normalizedEmail('a.b@mail.example.co.uk')).toBe('ab@mail.example.co.uk');
  });

  test('two distinct people CAN share a normalized form, which is why it is not unique', () => {
    // `0002_identity.sql:250-253`, in its own words: "Two people can legitimately
    // share a normalized form, so it is a SIGNAL, not a constraint, and making it
    // unique would refuse service to the second of them." This case is that
    // sentence, executed -- and it is the reason the OTP digest binds the address
    // AS TYPED rather than this value.
    expect(normalizedEmail('bob.smith@gmail.com')).toBe(normalizedEmail('bobsmith@gmail.com'));
  });

  test('a local part that is entirely a tag keeps its address rather than becoming a domain', () => {
    expect(normalizedEmail('+tag@example.com')).toBe('+tag@example.com');
  });

  test('a value that is not an address is folded and otherwise left alone', () => {
    expect(normalizedEmail('  NotAnAddress  ')).toBe('notanaddress');
  });
});

describe('the doors ADR-126 and ADR-197 built are REACHABLE from outside this package', () => {
  test('`index.ts` exports both, which is what ADR-196 measured to be missing', () => {
    // THE FINDING THIS CASE IS THE GUARD FOR. `resolutionDb` landed with ADR-126
    // and was never added to this list, so `apps/api` could not import it and
    // `auth-backend.ts`'s refusal citing a missing pre-identity read was true of
    // the package SURFACE while being false of the package. ADR-196 finding 3
    // measured "no caller anywhere in `apps/`"; the reason was that there could
    // not be one.
    const index = readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8');
    for (const name of ['resolutionDb', 'establishmentDb', 'normalizedEmail'])
      expect(index, `${name} is not exported from packages/db`).toMatch(
        new RegExp(`^\\s*${name},`, 'm'),
      );
  });
});
