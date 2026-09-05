// =============================================================================
// packages/queue/test/surface.test.ts
// =============================================================================
// ADR-006 CLOSED WITH A REVIEW CRITERION AND NOT A DESIGN NOTE: "The job
// interface stays narrow enough that a later move to BullMQ is a contained
// change, and that narrowness is now a review criterion on M2 and M5, not an
// aspiration." A criterion a person applies by reading is an aspiration wearing
// a different word, so this file applies it by running.
//
// THREE THINGS, AND EACH IS THE OTHERS' COMPLEMENT.
//
//   1. THE INTERFACE IS FIVE METHODS, and the adapter implements exactly those
//      five. A sixth method is a diff somebody has to defend.
//   2. THE VENDOR IS NAMED IN ONE MODULE, over the whole tree. "A contained
//      change" is a fact about how many files import `pg-boss`, and it is a fact
//      that decays silently: the second import is always added in a session with
//      a deadline, and nothing else in this repository would notice it.
//   3. THE PACKAGE EXPORTS NO pg-boss TYPE, so a caller receives a `JobQueue`
//      and can name nothing else. ADR-084's `index.ts` makes the same move about
//      `client()` and for the same reason: the boundary is only a boundary while
//      nothing crosses it.
//
// IT READS THE TREE RATHER THAN A LIST OF FILES. A registry of "files allowed to
// import pg-boss" is a second statement of the containment, maintained by hand,
// and ADR-034 is this corpus's record of what hand-maintained lists do.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { JOB_QUEUE_METHODS } from '../src/job-queue.ts';
import * as queuePackage from '../src/index.ts';
import { QUEUE_SCHEMA, pgBossQueue } from '../src/pg-boss-queue.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Directories that are not this repository's source, whatever they contain. */
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);

/** Every TypeScript file under the workspace's two source roots. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts') || entry.endsWith('.mts')) out.push(full);
    }
  };
  walk(join(ROOT, 'apps'));
  walk(join(ROOT, 'packages'));
  return out;
}

/**
 * Files that IMPORT the vendor, by every route the module system offers.
 *
 * Matched on the specifier and not on the word, so this file, `index.ts`'s
 * header and every comment that explains the choice are not findings. The same
 * four forms `merit/no-raw-db-client` reads, for the same reason it reads four:
 * a re-export and a dynamic import are the same import with the binding
 * forwarded.
 */
function importsPgBoss(): string[] {
  const specifier = /(?:from|import|require)\s*\(?\s*['"]pg-boss(?:\/[^'"]*)?['"]/;
  return sourceFiles()
    .filter((file) => specifier.test(readFileSync(file, 'utf8')))
    .map((file) => relative(ROOT, file));
}

describe('the interface is as narrow as ADR-006 requires', () => {
  test('the adapter implements exactly the five declared methods, in both directions', () => {
    // Built with a throwaway executor, because constructing the queue must not
    // touch a database: `pgBossQueue` is handed a connection rather than opening
    // one, which is what this line proves in passing.
    const queue = pgBossQueue({ executeSql: async () => ({ rows: [] }) });

    const implemented = Object.keys(queue).sort();
    const declared = [...JOB_QUEUE_METHODS].sort();

    // BOTH DIRECTIONS IN ONE EQUALITY. A method on the object that is not on the
    // interface is a vendor primitive that leaked; a method on the interface
    // that is not on the object cannot happen at compile time and is asserted
    // anyway, because a compile-time guarantee nobody re-derives is a guarantee
    // that survives its own deletion.
    expect(implemented).toEqual(declared);
    expect(declared).toHaveLength(5);
    for (const method of declared) {
      expect(typeof queue[method as keyof typeof queue]).toBe('function');
    }
  });

  test('the package publishes three values, and no pg-boss type among them', () => {
    // TYPES ARE ERASED, so this is the value surface. It is pinned rather than
    // described: ADR-084's index.ts keeps `client()` off its own export list on
    // the same argument, that a boundary is only a boundary while nothing
    // crosses it.
    expect(Object.keys(queuePackage).sort()).toEqual([
      'JOB_QUEUE_METHODS',
      'QUEUE_SCHEMA',
      'pgBossQueue',
    ]);
  });
});

describe('the vendor is contained', () => {
  test('exactly one module in the workspace imports pg-boss', () => {
    // THE WHOLE OF "a later move to BullMQ is a contained change", AS A NUMBER.
    // The day this list has two entries the move stops being contained, and this
    // is the only thing in the repository that would say so.
    expect(importsPgBoss()).toEqual(['packages/queue/src/pg-boss-queue.ts']);
  });

  test('the scan is not vacuous: it finds this workspace and it finds the import', () => {
    // A WALK THAT FOUND NOTHING WOULD PASS THE CASE ABOVE IF THE FILE MOVED, and
    // an empty scan reporting green is the failure mode STATE records for the
    // corpus gates: "two of the eleven once failed on a truncated tree copy and
    // would have been scored as working."
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(50);
    expect(files.map((f) => relative(ROOT, f))).toContain('packages/queue/src/pg-boss-queue.ts');
  });

  test('exactly one manifest in the workspace declares pg-boss', () => {
    // THE OTHER HALF OF CONTAINMENT, AND THE ONE AN IMPORT SCAN CANNOT SEE.
    // `node-linker=isolated` means a package that does not declare pg-boss
    // cannot resolve it, so the manifest list is what makes the import list
    // enforceable rather than merely true today.
    const manifests: string[] = [];
    for (const parent of ['apps', 'packages']) {
      for (const entry of readdirSync(join(ROOT, parent)).sort()) {
        const rel = `${parent}/${entry}/package.json`;
        const body = readFileSync(join(ROOT, rel), 'utf8');
        const manifest: unknown = JSON.parse(body);
        const fields = manifest as Record<string, Record<string, string> | undefined>;
        const declares = ['dependencies', 'devDependencies', 'peerDependencies'].some((field) =>
          Object.keys(fields[field] ?? {}).includes('pg-boss'),
        );
        if (declares) manifests.push(rel);
      }
    }
    expect(manifests).toEqual(['packages/queue/package.json']);
  });
});

// =============================================================================
// The header's claim about `packages/db/migrations`, derived from that directory
// =============================================================================
// ADR-327, on ADR-326 section 8 finding 1 and ADR-324.
//
// `pg-boss-queue.ts`'s header said "THAT MIGRATION DOES NOT EXIST YET" for three
// days after `0079_pgboss_job_store.sql` merged, and NOTHING WENT RED, because
// nothing derived the claim from the directory it was about. That is the fourth
// recorded site of one defect: ADR-324 repaired one, ADR-326 repaired the worker
// barrel's, ADR-326 section 8 named this one, and each repair before this one was
// a wording change that the next migration could stale again.
//
// SO THE REPAIR IS THIS BLOCK AND NOT THE SENTENCE. Both halves are read out of
// `packages/db/migrations` at the moment the case runs: a migration installs the
// schema, and a migration grants the application role USAGE on it. A file
// superseding either one turns these red rather than leaving a comment behind.
describe("the header's migration claims are read from packages/db/migrations", () => {
  /**
   * Every migration's STATEMENTS, keyed by filename, comments excluded.
   *
   * IT KEEPS THE LINES THAT START A STATEMENT RATHER THAN STRIPPING COMMENTS.
   * Every `GRANT`, `REVOKE` and `CREATE SCHEMA` in this directory begins at
   * column zero and every comment line begins with `--`, so a line filter
   * separates them exactly. The alternative is a fourth comment stripper, which
   * `RI-30` refuses by name and by idiom, and it would be one written for SQL by
   * a file whose subject is a queue. An empty result is a failure and not a pass.
   */
  function statements(): Map<string, string> {
    const dir = join(ROOT, 'packages/db/migrations');
    const out = new Map<string, string>();
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith('.sql')) continue;
      const kept = readFileSync(join(dir, f), 'utf8')
        .split('\n')
        .filter((line) => /^(GRANT|REVOKE|CREATE SCHEMA)\b/i.test(line));
      out.set(f, kept.join('\n'));
    }
    if (out.size === 0) throw new Error('no migrations found; the case cannot run');
    return out;
  }

  test('a migration installs the schema this file names, and the header no longer denies it', () => {
    const installs = [...statements()]
      .filter(([, body]) =>
        new RegExp(`^CREATE SCHEMA IF NOT EXISTS ${QUEUE_SCHEMA}\\b`, 'm').test(body),
      )
      .map(([name]) => name);
    expect(
      installs,
      `no migration creates the ${QUEUE_SCHEMA} schema. Either one was superseded or this ` +
        "package's header is right again and should say so",
    ).toEqual(['0079_pgboss_job_store.sql']);

    // THE RETIRED WORDING, ASSERTED IN THE DIRECTION THAT KEEPS RI-14 TRUE: the
    // claim must not stand on its own, and the block that marks it as history
    // must be present. A file that deletes the false sentence outright leaves the
    // next reader nothing to check.
    const header = readFileSync(join(ROOT, 'packages/queue/src/pg-boss-queue.ts'), 'utf8');
    const retired = header.indexOf('THIS PARAGRAPH READ');
    expect(retired, 'the paragraph retiring the stale claim is gone').toBeGreaterThan(-1);
    expect(
      header.slice(0, retired),
      'the header states THAT MIGRATION DOES NOT EXIST YET as a live claim again, and ' +
        `${installs[0]} is on disk`,
    ).not.toContain('THAT MIGRATION DOES NOT EXIST YET');
  });

  test('a migration grants the application role USAGE on it, and never CREATE', () => {
    // THE SECOND HALF, AND THE ONE THAT MATTERS TO A RUNNING DEPLOYABLE. `0079`
    // installed the schema and granted nothing, so every method below threw
    // `permission denied for schema pgboss` for three days while the header said
    // the store was the problem. ADR-327 ruled the grant and `0082` writes it.
    const bodies = [...statements()];
    const grants = bodies
      .filter(([, body]) =>
        new RegExp(`^GRANT[^;]*\\bUSAGE ON SCHEMA ${QUEUE_SCHEMA}\\b`, 'im').test(body),
      )
      .map(([name]) => name);
    expect(
      grants,
      `no migration grants USAGE ON SCHEMA ${QUEUE_SCHEMA}, so every method of the queue ` +
        'this file returns throws for the role the application connects as',
    ).toEqual(['0082_pgboss_app_grants.sql']);

    // AND THE REFUSAL, WHICH IS THE RULING RATHER THAN THE WIRING. ADR-326
    // section 3.3 ruled that the application role must never hold CREATE on a
    // schema inside the ledger's restore boundary, and `create_queue` needs it
    // only for a PARTITIONED queue, which `declareQueue` below never asks for.
    const creates = bodies
      .filter(([, body]) =>
        new RegExp(`^GRANT[^;]*\\bCREATE\\b[^;]*\\bON SCHEMA ${QUEUE_SCHEMA}\\b`, 'im').test(body),
      )
      .map(([name]) => name);
    expect(
      creates,
      'a migration grants CREATE on the queue schema. ADR-326 section 3.3 refuses it: that is ' +
        "DDL inside the ledger's PITR boundary, held by the role 0026 revokes it from on public",
    ).toEqual([]);
  });
});

// =============================================================================
// WHICH SIDE FLATTENS A MULTI-STATEMENT RESULT, read out of the installed vendor
// =============================================================================
// ADR-331, and it is here rather than in `packages/db` because this is the only
// package in the workspace permitted to know the vendor's name at all.
//
// THE QUESTION THIS BLOCK ANSWERS IS "WHOSE JOB IS THE FLATTENING". `pg`
// resolves a MULTI-STATEMENT string to a `Result[]`, and every plan pg-boss
// wraps in its own `locked()` helper is one. pg-boss's built-in driver hands
// that array back untouched and unwraps it internally, which it can do because
// it IS `pg`. Every ADAPTER the library ships instead NORMALISES to `{ rows }`,
// and each of them flattens on the way: an adapter that normalises is the side
// that destroyed the array, so it is the only side that still can.
//
// `packages/db`'s `sqlExecutorOn` is an adapter of exactly that kind and it did
// not flatten. It read `.rows` off the array, which is `undefined`, and returned
// it past a type declaring `unknown[]`; pg-boss's supervisor then died on
// `undefined.filter` and took the whole supervise pass with it, maintenance
// included. That is ADR-327 section 9 finding 1 and this block is what makes the
// repair falsifiable from the side that owns the contract.
//
// BOTH FACTS ARE READ OUT OF THE INSTALLED PACKAGE AND NEITHER IS RESTATED. A
// pg-boss upgrade that changed either one would make `packages/db`'s flattening
// wrong, and nothing else in this repository would say so.
describe('the executor contract is the vendor`s, read from the installed pg-boss', () => {
  /** A file of the installed library, or a failure. An unreadable check is not a check. */
  function vendorFile(name: string): string {
    const path = join(ROOT, 'packages/queue/node_modules/pg-boss', name);
    try {
      return readFileSync(path, 'utf8');
    } catch {
      throw new Error(`pg-boss is not installed at ${path}; this case cannot run`);
    }
  }

  test('pg-boss asks its adapters for a NORMALISED answer and not for the driver`s', () => {
    // `IDatabase` is the type `ConstructorOptions.db` takes, which is what
    // `pgBossQueue` supplies. Its one required method returns `{ rows }`, a
    // single object, so an adapter answering with an array of results is
    // answering off contract however faithfully it copies the driver.
    const types = vendorFile('dist/types.d.ts');
    const declared =
      /export interface IDatabase \{\s*executeSql\([^)]*\): Promise<\{\s*rows: any\[\];\s*\}>;/.test(
        types,
      );
    expect(
      declared,
      'pg-boss`s IDatabase.executeSql no longer returns Promise<{ rows: any[] }>. ' +
        '`packages/db`s sqlExecutorOn is written to that shape and has to follow it',
    ).toBe(true);
  });

  test('pg-boss`s own helper flattens the array, which is the semantics packages/db reproduces', () => {
    // `unwrapSQLResult` is not on this package`s public entry point, so it cannot
    // be imported without a second module naming the vendor, which the case above
    // this block forbids. It is read instead, and what is read is the property
    // rather than the spelling: the array branch concatenates each element`s
    // `rows`, so a RETURNING in the middle of a plan is not lost behind the
    // trailing COMMIT.
    const tools = vendorFile('dist/tools.js');
    const body = tools.slice(tools.indexOf('function unwrapSQLResult'));
    expect(body, 'unwrapSQLResult is gone from pg-boss/dist/tools.js').not.toBe('');
    expect(body.slice(0, body.indexOf('\n}'))).toContain('flatMap(i => i.rows)');
  });

  test('`packages/db`s executor carries both of `pg`s answers, in ONE place, for BOTH producers', () => {
    // THE MERIT HALF, BOUND TO THE TWO ABOVE SO THE THREE FAIL TOGETHER. Read
    // rather than imported, for the reason `write-accessor.test.ts` states from
    // the other direction: neither package declares a dependency on the other,
    // and structural typing is what binds them.
    //
    // ADR-332 GAVE `packages/db` A SECOND PRODUCER OF THIS SHAPE and this case
    // moved with it rather than being left asserting one of the two. The
    // transaction-bound `sqlExecutorOn` and the pool-bound `poolSqlExecutor`
    // answer the SAME vendor contract, so a tree where one flattens and the
    // other does not is the ADR-331 defect surviving on the half nobody looked
    // at. The normalisation is therefore ONE function and this case asserts that
    // both producers route through it, which is a stronger property than the
    // branch being present twice.
    const executor = readFileSync(join(ROOT, 'packages/db/src/scoped-db.ts'), 'utf8');
    const open = executor.indexOf('function oneResultFrom(');
    expect(open, 'packages/db no longer declares oneResultFrom').toBeGreaterThan(-1);
    const declaration = executor.slice(open, executor.indexOf('\n}', open));
    expect(
      declaration,
      'oneResultFrom does not branch on the array `pg` returns for a multi-statement plan',
    ).toContain('Array.isArray(result)');
    expect(declaration).toContain('flatMap((one) => one.rows)');

    for (const producer of ['function sqlExecutorOn(', 'export function poolSqlExecutor(']) {
      const at = executor.indexOf(producer);
      expect(at, `packages/db no longer declares ${producer}`).toBeGreaterThan(-1);
      expect(
        executor.slice(at, executor.indexOf('\n}\n', at)),
        `${producer} does not normalise through oneResultFrom`,
      ).toContain('oneResultFrom(');
    }
  });
});

// =============================================================================
// THE PARAGRAPH THIS PACKAGE RETIRED, BOUND TO THE THING THAT RETIRED IT
// =============================================================================
// ADR-332. `src/index.ts` quotes ADR-331's refusal to publish a pool-shaped
// executor and says the row that published it is this one. Under `RI-14` a
// retired sentence is kept beside its correction, and under `RI-35` leg 3 a
// retired claim is only legitimate WHILE THE TREE FALSIFIES IT: an artifact that
// went away again leaves a correction asserting something untrue in the other
// direction.
//
// THE PRINCIPLED HOME FOR THIS IS `RI-35`'s REGISTER, AND **ADR-333 TOOK THE
// ENTRY ADR-332 LEFT OWED**, in the exact shape this comment specified: an
// artifact keyed `db-pool-sql-executor` on `packages/db` exporting
// `poolSqlExecutor`, with a `retired` claim at `packages/queue/src/index.ts`
// anchored on the quotation below, which is the shape
// `db-transaction-and-sql-executor` already has for ADR-102's pair. That row
// could take it because it was amending the register anyway: writing
// `apps/worker/src/queue.ts` flipped `queue-door` to `present` and turned three
// `live` claims red, so the register moved in the same commit and this entry
// moved with it.
//
// **THE CASE BELOW IS KEPT AND NOT DELETED**, because it asserts two things the
// register entry does not: that `packages/queue/src/index.ts` still carries the
// quotation at all, and that `pg-boss-queue.ts`'s `@param` still names the
// executor it requires. `RI-35` binds the disposition; this binds the two SITES.
// ADR-328's own header names one hand-built derivation for one site as the shape
// that does not scale, and the register is now carrying the half that scales.
describe('the correction packages/queue publishes is held to the door that justifies it', () => {
  test('the retired refusal stands only while `packages/db` exports the pool executor', () => {
    const quote =
      'That door is not published by `packages/db` and the\n// reason it would need is not a member of `SqlExecutorReason`';
    const barrel = readFileSync(join(ROOT, 'packages/queue/src/index.ts'), 'utf8');
    expect(
      barrel.includes(quote),
      'packages/queue/src/index.ts no longer quotes ADR-331`s refusal; move this case with it',
    ).toBe(true);

    const db = readFileSync(join(ROOT, 'packages/db/src/index.ts'), 'utf8');
    expect(
      /^\s*poolSqlExecutor,\s*$/m.test(db),
      'the paragraph above is quoted as HISTORY and `@merit/db` no longer exports ' +
        '`poolSqlExecutor`, so the refusal it retires is true again and the correction is not',
    ).toBe(true);

    // THE ADAPTER NAMES IT TOO, and that site is bound here rather than left to
    // rot on its own: `pg-boss-queue.ts` is the file a session writing the one
    // door opens first, so a name it carries has to be a name that exists.
    const adapter = readFileSync(join(ROOT, 'packages/queue/src/pg-boss-queue.ts'), 'utf8');
    expect(
      adapter.includes("`@merit/db`'s `poolSqlExecutor('job-supervisor')` IS THAT VALUE"),
      'the adapter no longer names the executor its `@param` requires; move this case with it',
    ).toBe(true);
  });
});
