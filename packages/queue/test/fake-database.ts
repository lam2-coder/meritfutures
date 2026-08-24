// =============================================================================
// packages/queue/test/fake-database.ts
// =============================================================================
// A FAKE POSTGRES AT EXACTLY ONE RESOLUTION: which connection a statement went
// to, and whether that connection ever committed. That is the whole subject of
// ADR-006's central consequence -- "enqueue participates in the same transaction
// as the state change that caused it" -- and a transaction is per-connection, so
// the connection a statement lands on IS the property.
//
// IT IS A MODEL AND IT IS NAMED AS ONE. It does not parse SQL, does not enforce
// a constraint and does not know what a row is. What it does is refuse to make
// a statement durable unless the connection that ran it committed, which is the
// one behaviour of a real database this suite asserts against. `CI-04`'s second
// leg (a real database, STRATEGY section 4.1, still dated) is what will assert
// the rest; this model runs on a laptop and in every CI job today, which is why
// the enqueue path is watched on every push rather than at a stage that has
// never run.
//
// WHY THE SUITE DOES NOT TAKE ITS EXPECTATION FROM THE ADAPTER. ADR-084 section
// 7 is the precedent and it is the most expensive lesson in this package's
// neighbourhood: a suite whose expected value is read out of the code under test
// passes against a seeded violation. So the statements here are the ones
// **pg-boss** emitted, captured verbatim, and every assertion below reads them
// rather than anything `pg-boss-queue.ts` believes about them.

import type { JobTransaction } from '../src/job-queue.js';

/** One statement, as the connection saw it. */
export interface Statement {
  readonly text: string;
  readonly values: readonly unknown[];
}

/** What a connection answers with. Keyed on the statement text, like a database. */
export type Responder = (text: string, values: readonly unknown[]) => unknown[];

/** A connection that buffers until it is told which way it ended. */
export interface FakeTransaction extends JobTransaction {
  /** Everything this connection ran, committed or not. */
  readonly statements: readonly Statement[];
  commit(): void;
  rollback(): void;
}

/** A connection with no transaction around it. Every statement is durable at once. */
export interface FakeConnection extends JobTransaction {
  readonly statements: readonly Statement[];
}

export interface FakeDatabase {
  /**
   * The durable ledger: statements that reached the database AND stayed there.
   *
   * A statement run on an autocommit connection is here immediately. A statement
   * run inside a transaction is here only after `commit()`, and never after
   * `rollback()`. That single rule is what makes the rollback assertion mean
   * something.
   */
  readonly committed: readonly Statement[];
  autocommit(respond: Responder): FakeConnection;
  begin(respond: Responder): FakeTransaction;
}

export function fakeDatabase(): FakeDatabase {
  const committed: Statement[] = [];

  return {
    committed,

    autocommit(respond: Responder): FakeConnection {
      const ran: Statement[] = [];
      return {
        statements: ran,
        async executeSql(text: string, values: unknown[] = []): Promise<{ rows: unknown[] }> {
          const statement: Statement = { text, values };
          ran.push(statement);
          // NO TRANSACTION AROUND IT, so it is durable the moment it runs. This
          // is what an enqueue on the queue's own connection would be, and it is
          // the failure direction the rollback case exists to catch.
          committed.push(statement);
          return { rows: respond(text, values) };
        },
      };
    },

    begin(respond: Responder): FakeTransaction {
      // TWO ARRAYS, AND THE SECOND ONE IS NOT AN OPTIMISATION. `ran` is the
      // audit trail and survives the outcome; `pending` is what commit makes
      // durable and rollback discards. One array serving both would empty the
      // audit trail on rollback, which is the exact case the suite has to be
      // able to read afterwards.
      const ran: Statement[] = [];
      let pending: Statement[] = [];
      return {
        statements: ran,
        async executeSql(text: string, values: unknown[] = []): Promise<{ rows: unknown[] }> {
          const statement: Statement = { text, values };
          ran.push(statement);
          pending.push(statement);
          return { rows: respond(text, values) };
        },
        commit(): void {
          committed.push(...pending);
          pending = [];
        },
        rollback(): void {
          // THE WHOLE POINT, IN ONE LINE. Nothing this connection ran reaches
          // the durable ledger, so an enqueue that rode on it is gone with the
          // state change that caused it, and an enqueue that reached any other
          // connection is not.
          pending = [];
        },
      };
    },
  };
}

/**
 * The answers a queue's own connection needs to get through `send`.
 *
 * pg-boss reads the queue's row before it inserts, on the connection it was
 * constructed with rather than on the caller's transaction. That read is
 * deliberate and is asserted separately: it is a cached lookup of a row the
 * enqueue does not write, and pulling it into a money-path transaction would
 * lengthen that transaction for nothing.
 */
export function queueMetadata(name: string, table = 'j'): Responder {
  return (text) => {
    if (text.includes('q.name')) return [{ name, policy: 'standard', table, notify: false }];
    return [];
  };
}

/** The answer a transaction gives to `insertJobs`: one row means one job created. */
export function insertAccepted(id: string): Responder {
  return () => [{ id }];
}

/** The answer that means "a job with that key is already queued". pg-boss returns no row. */
export const insertDeduplicated: Responder = () => [];

/** Statements that write a job. Matched on pg-boss's own emitted SQL, not on ours. */
export function jobInserts(statements: readonly Statement[]): readonly Statement[] {
  return statements.filter((s) => /INSERT INTO\s+\w+\.\w+/i.test(s.text));
}
