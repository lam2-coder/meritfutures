// =============================================================================
// packages/tooling/checks/generated-column-writes.mjs
// =============================================================================
// NO STATEMENT THIS TREE BUILDS NAMES A STORED GENERATED COLUMN, ASSERTED OVER
// THE STATEMENTS THEMSELVES.
//
//   node packages/tooling/checks/generated-column-writes.mjs
//
// Exit code is 0 only when all four legs below pass. There is no partial mode
// and no leg that can be skipped: half of this check silently passing is how
// the property it names becomes false while it is green.
//
// -----------------------------------------------------------------------------
// WHAT A STORED GENERATED COLUMN IS HERE, BECAUSE THE PHRASE IS AMBIGUOUS
// -----------------------------------------------------------------------------
// PostgreSQL spells two unrelated features with the words `GENERATED ALWAYS AS`.
//
//   1. `<col> <type> GENERATED ALWAYS AS (<expr>) STORED` is a GENERATED COLUMN.
//      The value is computed from the row and a statement that names it in an
//      INSERT column list or an UPDATE `SET` is refused outright, `42601`.
//   2. `<col> bigint GENERATED ALWAYS AS IDENTITY` is an IDENTITY COLUMN. It is
//      a sequence default with a lock on it, refused with `428C9` unless the
//      statement carries `OVERRIDING SYSTEM VALUE`.
//
// LEGS A TO C TAKE THE FIRST AND ONLY THE FIRST, which is the one PostgreSQL's
// own documentation calls a generated column and the one `ADR-443` section 11
// item 3 names. The second is DERIVED ANYWAY, on every run, and for one reason:
// the fold below has to tell the two apart to count either, and a classifier
// that discards what it classified cannot be audited.
//
// THE IDENTITY COUNT IS NOW ASSERTED ON, AND WHAT STOOD HERE IS FALSE. It read:
// *THE IDENTITY COUNT IS REPORTED AND NOT ASSERTED ON*, and the measured
// obstacle was four cases in `packages/db/test/write-accessor.test.ts` and
// `packages/db/test/keyed-accessor.test.ts` that drove an UPDATE naming `id`.
// `ADR-451` corrected those four and `ADR-452` took the widening and this leg in
// one commit, so leg D now REFUSES every `always` identity column on the
// registry BY NAME and the number it once only reported is an assertion.
// `RI-14` is why the sentence is quoted here rather than deleted. The UPDATE
// half is closed on both column kinds; THE INSERT HALF IS STILL OPEN.
//
// -----------------------------------------------------------------------------
// THE FOUR LEGS, AND WHAT EACH ONE'S POPULATION ACTUALLY IS
// -----------------------------------------------------------------------------
// A. THE SET. Folded out of the DDL under `packages/db/migrations/` on every
//    run, never listed here. `ADR-445` section 4 is why that is a hard
//    requirement rather than a preference: the sibling row transcribing
//    `live_account_state` adds a sixth member in this same wave, and a check
//    holding a list of five would go red the day that lands while the property
//    it names stayed true.
//
//    THE FOLD IS AUDITED AGAINST ITS OWN INPUT. Every `GENERATED ALWAYS AS` in
//    the DDL must be CONSUMED by the fold, as an identity column or as a
//    generated one, and an occurrence the fold walked past is a FINDING. That
//    is what stops the leg failing in the direction an absence check fails in:
//    a DDL form the parser does not model would otherwise shrink the set
//    silently and take legs B and C green with it.
//
// B. THE BUILT STATEMENTS. `unscopedInsertStatement` is called for EVERY key in
//    `packages/db/src/scope.ts`'s registry, through a driverless Drizzle handle
//    that records what the accessor sends, and the emitted column list is read
//    off the statement. It is not an approximation of the statement, it IS the
//    statement, which is `ADR-435`'s reason for comparing against a Vitest
//    report rather than against the test sources, one layer down.
//
//    THE VALUES OBJECT NAMES EVERY COLUMN THE TABLE DECLARES, and that is the
//    point rather than an overreach. `WriteValues` is
//    `Readonly<Record<string, unknown>>` at `packages/db/src/scoped-db.ts:507`,
//    so NO type refuses a caller that names a generated column, and what this
//    leg asks is the only question worth asking of a builder: handed the most a
//    caller could hand it, does the statement it builds name one? For an INSERT
//    the answer is structural. Drizzle's insert dialect takes its column list
//    from the TABLE and drops what `shouldDisableInsert()` reports, so a value
//    for a generated column is discarded before a column list exists.
//
// C. THE SQL LITERALS. Every string and template literal in shipped source that
//    carries a DML verb must not mention a member of the set. This leg exists
//    because leg B is blind by construction to a statement that never reaches a
//    Drizzle builder, and this tree has one: `LIVE_CACHE_UPSERT_SQL` at
//    `apps/worker/src/live/ports.ts:302` is a hand-written upsert into the very
//    table that carries `intraday_movement_cents`, and its docblock's claim
//    that the column "is named nowhere" was held by prose and by nothing else
//    until this leg.
//
// D. THE REFUSAL. `unscopedUpdateStatement` is called for every STORED GENERATED
//    column AND every `always` IDENTITY column on the registry, through the same
//    driverless handle, and the accessor must REFUSE each one by name. This is
//    the only leg whose subject is a guard rather than a statement, because the
//    UPDATE half is the only property here held by a guard rather than
//    structurally. The identity half asserts rather than counts as of `ADR-452`,
//    and its discriminator is the QUALIFIED name because every one is an `id`.
//
// -----------------------------------------------------------------------------
// THE HALF THIS FILE DID NOT ASSERT, AND WHAT CLOSING IT CHANGED
// -----------------------------------------------------------------------------
// **WHAT STOOD HERE WAS TRUE WHEN WRITTEN AND IS FALSE NOW.** It read: *THE
// UPDATE PATH DOES NOT HOLD THE PROPERTY AND THIS FILE DOES NOT PRETEND IT
// DOES.* `updateStatementOn` passed the caller's values straight to Drizzle's
// `.set()`, which maps over THE CALLER'S KEYS rather than over the table's
// columns, so an UPDATE built for a caller that named a generated column named
// it too. `ADR-445` section 8 item 1 priced the repair; `ADR-448` took it.
//
// The paragraph is kept above rather than deleted because `RI-14` keeps what was
// corrected beside its correction. The sentence it recorded is now held by
// `refuseDatabaseWrittenColumn` in `packages/db/src/scoped-db.ts`, and leg D is
// the leg that watches it, so the demonstration this file used to point at is
// gone from the suite beside it in the same commit that made it false.
//
// **THE IDENTITY HALF IS CLOSED ON THE UPDATE PATH AND STILL OPEN ON THE
// INSERT PATH.** What stood here read *THE IDENTITY HALF IS STILL OPEN, ON BOTH
// STATEMENT KINDS*, and half of that is now false. `ADR-445` section 8 item 2
// priced the widening at "the same guard, widened, plus one leg"; `ADR-448`
// SEEDED it and found the rest of the price was two test helpers, each of which
// skips the TENANCY columns and takes the first column left, which on
// `ledger_entries` and `liability_snapshots` is `id`. `ADR-451` paid that and
// `ADR-452` took the widening. `RI-14` keeps the sentence beside its correction.
// On the INSERT side the widening costs more still: leg B's probe names every
// non-tenancy column, so a guard on the insert builders would refuse the probe
// and leg B's own generated-column assertion would go vacuous to accommodate it.
// That remains a trade rather than a transcription, and `ADR-448` section 8
// item 3 records it with its price instead of taking it inside a money-path
// diff. `ADR-452` leaves it exactly where it found it.

import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from './strip-comments.mjs';

/** The repository root, from this file's own location. */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The DDL. The one input leg A has, and the one this repository forward-applies. */
const MIGRATIONS = 'packages/db/migrations';

/**
 * The two modules leg B calls, by path rather than through `@merit/db`.
 *
 * `packages/tooling` does not depend on `@merit/db` and this file does not add
 * the edge: a manifest is not in this row's fence, and a workspace dependency
 * is a `VG-12` admission rather than an import. Node resolves a path with no
 * manifest involved, and `packages/db` is where these two files are.
 */
const ACCESSOR = 'packages/db/src/scoped-db.ts';
const REGISTRY = 'packages/db/src/scope.ts';

/** Directory names the source walk never descends into. */
const NOT_SOURCE = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
]);

/** Extensions leg C reads. Every JavaScript-family file this workspace ships. */
const SOURCE_EXTENSION = /\.(?:ts|tsx|mts|cts|mjs|cjs|js)$/;

/**
 * A DML verb, matched inside literal text.
 *
 * `UPDATE` alone is not one. The word is a noun in half the prose in this tree
 * and a column name in some of it, so the shape that makes it a statement is
 * required: a table reference and its `SET`.
 */
const DML_VERB = /\b(?:insert\s+into|merge\s+into|update\s+(?:only\s+)?[A-Za-z_"][\w."]*\s+set)\b/i;

/** `GENERATED ALWAYS AS`, in either of its two unrelated senses. */
const GENERATED_ALWAYS = /\bGENERATED\s+ALWAYS\s+AS\b/gi;

/**
 * One capture group of a match that has already succeeded.
 *
 * Every call site below reads a group its own pattern makes mandatory, so the
 * throw is unreachable. It is written rather than asserted away because a
 * `String(undefined)` in a table name is a finding about a table called
 * "undefined", which is the kind of quiet wrongness this whole file is against.
 *
 * @param {RegExpMatchArray | RegExpExecArray} match
 * @param {number} index
 * @returns {string}
 */
function captured(match, index) {
  const value = match[index];
  if (value === undefined) {
    throw new Error(`the pattern that matched ${match[0]} captured no group ${String(index)}`);
  }
  return value;
}

/**
 * Postgres source with every comment and every quoted body replaced by spaces.
 *
 * LENGTH AND NEWLINES ARE PRESERVED EXACTLY, because leg A's audit reports a
 * `file:line` and compares character offsets between this text and itself.
 *
 * BOTH ARE BLANKED RATHER THAN ONLY COMMENTS. `0079_pgboss_job_store.sql:511`
 * carries `format('DROP TABLE IF EXISTS pgboss.%I', v_table)`, which is DDL
 * inside a string, addressed to a schema this registry does not hold. A scanner
 * that read it would report a table drop that no migration performs. Dynamic
 * DDL is out of this file's reach either way and blanking says so honestly.
 *
 * This is a character scanner rather than a pair of replacements for the reason
 * `ADR-279` gives about the JavaScript idiom: a `--` inside a dollar-quoted
 * body opens a phantom comment, and `0027`'s RAISE messages are full of them.
 *
 * @param {string} sql
 * @returns {string}
 */
function ddlSkeleton(sql) {
  let out = '';
  let i = 0;
  /** @param {number} from @param {number} to */
  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) out += sql[k] === '\n' ? '\n' : ' ';
  };
  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const nl = sql.indexOf('\n', i);
      const stop = nl === -1 ? sql.length : nl;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (sql[i] === "'") {
      const end = sql.indexOf("'", i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += "'";
      blank(i + 1, stop - 1 >= i + 1 ? stop - 1 : i + 1);
      out += stop - 1 > i ? "'" : '';
      i = stop;
      continue;
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 40));
    if (dollar !== null) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      blank(i, stop);
      i = stop;
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

/**
 * `file:line` for an offset into a skeleton, which is the only address a
 * finding about DDL can carry that a reader can act on.
 *
 * @param {string} file
 * @param {string} skeleton
 * @param {number} offset
 * @returns {string}
 */
function at(file, skeleton, offset) {
  return `${file}:${String(skeleton.slice(0, offset).split('\n').length)}`;
}

/**
 * The top-level items of a parenthesised body, with their offsets.
 *
 * @param {string} skeleton
 * @param {number} open Offset of the opening parenthesis.
 * @returns {{ items: { text: string, start: number, end: number }[], close: number }}
 */
function commaItems(skeleton, open) {
  let depth = 0;
  let close = skeleton.length;
  for (let i = open; i < skeleton.length; i += 1) {
    if (skeleton[i] === '(') depth += 1;
    else if (skeleton[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  /** @type {{ text: string, start: number, end: number }[]} */
  const items = [];
  let d = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i += 1) {
    const ch = skeleton[i];
    if (ch === '(') d += 1;
    else if (ch === ')') d -= 1;
    else if (ch === ',' && d === 0) {
      items.push({ text: skeleton.slice(start, i), start, end: i });
      start = i + 1;
    }
  }
  items.push({ text: skeleton.slice(start, close), start, end: close });
  return { items, close };
}

/** Words that open a table constraint rather than a column. */
const NOT_A_COLUMN = new Set([
  'constraint',
  'primary',
  'unique',
  'check',
  'foreign',
  'exclude',
  'like',
  'partition',
]);

/**
 * @typedef {object} DerivedSet
 * @property {Map<string, Set<string>>} generated Table to its stored generated columns.
 * @property {number} identityOccurrences How many `GENERATED ALWAYS AS IDENTITY` the DDL declares.
 * @property {number} generatedOccurrences How many stored generated columns it declares.
 * @property {number} files How many `.sql` files were folded.
 * @property {string[]} findings Empty when the fold accounted for its whole input.
 */

/**
 * Every stored generated column in the DDL, folded forward in file order.
 *
 * @param {string} [root]
 * @returns {DerivedSet}
 */
export function derivedSet(root = REPO_ROOT) {
  const dir = join(root, MIGRATIONS);
  /** @type {Map<string, Set<string>>} */
  const generated = new Map();
  /** @type {string[]} */
  const findings = [];
  let identityOccurrences = 0;
  let generatedOccurrences = 0;

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    findings.push(
      `${MIGRATIONS} holds no .sql file. Zero is what an empty set and a broken walk both ` +
        'look like, and the legs below would be green over nothing',
    );
  }

  for (const file of files) {
    const rel = `${MIGRATIONS}/${file}`;
    const skeleton = ddlSkeleton(readFileSync(join(dir, file), 'utf8'));
    /** @type {{ from: number, to: number }[]} */
    const consumed = [];

    // CREATE TABLE. Every top-level item of the body is a column or a table
    // constraint, and a column carrying an expression is a member of the set.
    for (const m of skeleton.matchAll(
      /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(/gi,
    )) {
      const table = captured(m, 1).toLowerCase();
      const { items } = commaItems(skeleton, m.index + m[0].length - 1);
      for (const item of items) {
        const first = item.text.trim().split(/\s/)[0] ?? '';
        if (first === '' || NOT_A_COLUMN.has(first.toLowerCase())) continue;
        if (!/^[a-z_][a-z0-9_]*$/i.test(first)) continue;
        classify(rel, skeleton, item, table, first.toLowerCase());
      }
    }

    // ALTER TABLE. The statement runs to the first `;` at depth zero, and its
    // top-level commas separate the actions, which is what a five-column
    // `ADD COLUMN a, ADD COLUMN b` needs and what `gates.mjs:2131` records
    // getting wrong until 2026-08-16.
    for (const m of skeleton.matchAll(/\bALTER\s+TABLE\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)/gi)) {
      const table = captured(m, 1).toLowerCase();
      let depth = 0;
      let end = skeleton.length;
      for (let i = m.index + m[0].length; i < skeleton.length; i += 1) {
        if (skeleton[i] === '(') depth += 1;
        else if (skeleton[i] === ')') depth -= 1;
        else if (skeleton[i] === ';' && depth === 0) {
          end = i;
          break;
        }
      }
      const bodyStart = m.index + m[0].length;
      let d = 0;
      let start = bodyStart;
      /** @type {{ text: string, start: number, end: number }[]} */
      const actions = [];
      for (let i = bodyStart; i < end; i += 1) {
        const ch = skeleton[i];
        if (ch === '(') d += 1;
        else if (ch === ')') d -= 1;
        else if (ch === ',' && d === 0) {
          actions.push({ text: skeleton.slice(start, i), start, end: i });
          start = i + 1;
        }
      }
      actions.push({ text: skeleton.slice(start, end), start, end });
      for (const action of actions) {
        const add = /^\s*ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s/i.exec(
          action.text,
        );
        if (add !== null) {
          classify(rel, skeleton, action, table, captured(add, 1).toLowerCase());
          continue;
        }
        // The three forms that would REMOVE or RENAME a member. None is modelled
        // and none has to be: the fold reports the statement rather than
        // guessing at it, and the set stays derived from what it did read.
        const drop = /^\s*DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/i.exec(
          action.text,
        );
        if (drop !== null && generated.get(table)?.has(captured(drop, 1).toLowerCase()) === true) {
          findings.push(
            `${at(rel, skeleton, action.start)}: drops ${table}.${captured(drop, 1).toLowerCase()}, which ` +
              'this fold added to the set and does not model removing. Teach the fold before ' +
              'this column leaves the DDL',
          );
        }
        const rename =
          /^\s*RENAME\s+(?:COLUMN\s+)?([a-z_][a-z0-9_]*)\s+TO\s+([a-z_][a-z0-9_]*)/i.exec(
            action.text,
          );
        if (
          rename !== null &&
          generated.get(table)?.has(captured(rename, 1).toLowerCase()) === true
        ) {
          findings.push(
            `${at(rel, skeleton, action.start)}: renames ${table}.${captured(rename, 1).toLowerCase()}, ` +
              'which this fold added to the set and does not model renaming',
          );
        }
      }
    }

    // THE AUDIT. Every occurrence in this file must sit inside something the
    // fold classified. One that does not is a DDL form the parser walked past,
    // and a set that quietly lost a member takes both other legs green with it.
    GENERATED_ALWAYS.lastIndex = 0;
    for (let m = GENERATED_ALWAYS.exec(skeleton); m !== null; m = GENERATED_ALWAYS.exec(skeleton)) {
      const inside = consumed.some((s) => m.index >= s.from && m.index < s.to);
      if (!inside) {
        findings.push(
          `${at(rel, skeleton, m.index)}: \`GENERATED ALWAYS AS\` that this fold did not read as ` +
            'a column definition. The parser has met a DDL form it does not model, so the set ' +
            'below is not the set the DDL declares',
        );
      }
    }

    /**
     * One column definition, classified and recorded as consumed.
     *
     * @param {string} relFile
     * @param {string} text The whole file's skeleton, for addresses.
     * @param {{ text: string, start: number, end: number }} item
     * @param {string} table
     * @param {string} column
     */
    function classify(relFile, text, item, table, column) {
      const found = /\bGENERATED\s+ALWAYS\s+AS\b/i.exec(item.text);
      if (found === null) return;
      consumed.push({ from: item.start, to: item.end });
      const tail = item.text.slice(found.index + found[0].length).trimStart();
      if (/^IDENTITY\b/i.test(tail)) {
        identityOccurrences += 1;
        return;
      }
      if (tail.startsWith('(')) {
        generatedOccurrences += 1;
        if (!generated.has(table)) generated.set(table, new Set());
        /** @type {Set<string>} */ (generated.get(table)).add(column);
        return;
      }
      findings.push(
        `${at(relFile, text, item.start)}: ${table}.${column} declares \`GENERATED ALWAYS AS\` ` +
          'followed by neither `IDENTITY` nor an expression. This fold cannot tell which ' +
          'feature it is and refuses to guess',
      );
    }
  }

  return { generated, identityOccurrences, generatedOccurrences, files: files.length, findings };
}

/**
 * @typedef {object} BuiltStatements
 * @property {string[]} findings
 * @property {number} tables How many registry keys had an INSERT built for them.
 * @property {number} covered How many of them carry a member of the derived set.
 */

/**
 * Leg B. Every INSERT the accessor builds, read off the statement it sends.
 *
 * THE HANDLE IS DRIVERLESS AND NOTHING IS EXECUTED. `drizzle-orm/pg-proxy`
 * takes a callback instead of a connection, so the accessor builds and sends
 * and this function reads what arrived. `packages/db/test/write-accessor.test.ts:111`
 * is the same machinery and states the same thing about itself.
 *
 * DRIZZLE IS RESOLVED FROM `packages/db` DELIBERATELY. It has to be the copy the
 * accessor itself imports, because Drizzle brands its values with module-scoped
 * symbols and a second copy would make every `is(value, SQL)` in the builder
 * false. Resolving it here is therefore narrower than a dependency edge rather
 * than a way around one.
 *
 * @param {Map<string, Set<string>>} generated
 * @param {string} [root]
 * @returns {Promise<BuiltStatements>}
 */
export async function builtStatements(generated, root = REPO_ROOT) {
  const require_ = createRequire(join(root, 'packages/db/package.json'));
  const { drizzle } = await import(require_.resolve('drizzle-orm/pg-proxy'));
  const { getTableColumns, getTableName, sql } = await import(require_.resolve('drizzle-orm'));
  const accessor = await import(join(root, ACCESSOR));
  const registry = await import(join(root, REGISTRY));

  /** @type {string[]} */
  const sent = [];
  const source = drizzle(
    /** @param {string} text */ async (text) => {
      sent.push(text);
      return { rows: [] };
    },
  );

  /** @type {string[]} */
  const findings = [];
  let tables = 0;
  let covered = 0;

  for (const key of registry.TABLE_KEYS) {
    const table = registry.TABLES[key];
    const name = String(getTableName(table));
    const members = generated.get(name) ?? new Set();

    // THE TENANCY COLUMNS ARE THE ONE OMISSION AND THE ACCESSOR ASKED FOR IT.
    // `refuseTenancyColumn` throws when a caller names one, so a values object
    // that carried them would be refused before a statement existed and this
    // leg would assert nothing. The set omitted is the accessor's own answer,
    // read back through `tenancyColumns`, rather than a guess.
    const pinned = new Set(accessor.tenancyColumns(key));
    /** @type {Record<string, unknown>} */
    const values = {};
    for (const [property, column] of Object.entries(getTableColumns(table))) {
      const columnName = String(/** @type {{ name: unknown }} */ (column).name);
      if (pinned.has(columnName)) continue;
      // A SQL FRAGMENT RATHER THAN A VALUE, so that no column type's driver
      // mapping can refuse the probe. A `timestamptz` column asked to bind the
      // string `x` throws inside Drizzle before a statement is built, and this
      // leg would then be silent about that table for a reason that has nothing
      // to do with its subject.
      values[property] = sql`'merit-generated-column-probe'`;
    }

    sent.length = 0;
    try {
      await accessor.unscopedInsertStatement(source, key, values);
    } catch (err) {
      findings.push(
        `${key}: the accessor refused to build an INSERT (${
          err instanceof Error ? err.message.split('\n')[0] : String(err)
        }). A key with no built statement is a key this leg is not asserting anything about`,
      );
      continue;
    }
    const statement = sent.find((s) => /^insert\s+into/i.test(s));
    if (statement === undefined) {
      findings.push(`${key}: built no INSERT, so this leg is not asserting anything about it`);
      continue;
    }
    const columnList = /^insert\s+into\s+"[^"]+"\s*\(([^)]*)\)/i.exec(statement);
    if (columnList === null) {
      findings.push(
        `${key}: the built statement is not a shape this check can read a column list off. ` +
          `It refuses to pass over it: ${statement.slice(0, 120)}`,
      );
      continue;
    }
    tables += 1;
    if (members.size > 0) covered += 1;
    const written = captured(columnList, 1)
      .split(',')
      .map((c) => c.trim().replace(/"/g, ''));
    for (const column of written) {
      if (members.has(column)) {
        findings.push(
          `${key}: the INSERT the accessor builds names ${name}.${column}, which the DDL ` +
            'declares `GENERATED ALWAYS AS (...) STORED`. PostgreSQL refuses that statement ' +
            'with 42601. Either the DDL stopped generating the column or `schema.ts` declares ' +
            'it without `.generatedAlwaysAs(...)`',
        );
      }
    }
  }

  if (tables === 0) {
    findings.push(
      'no INSERT was built for any registry key, so this leg asserted nothing. Zero is what ' +
        'a green run and a broken import both look like',
    );
  }
  return { findings, tables, covered };
}

/**
 * LEG D: EVERY STORED GENERATED COLUMN ON THE REGISTRY IS REFUSED BY THE
 * ACCESSOR'S UPDATE BUILDER, WATCHED FIRING RATHER THAN ARGUED.
 *
 * This replaces the helper `ADR-445` shipped to hold its own finding open. That
 * helper derived the columns the UPDATE builder WOULD put in a `SET`, and the
 * last `describe` block of the suite beside this file asserted the list was
 * non-empty: a demonstration of a hole, green only while the hole was open.
 * `ADR-448` closed the hole with `refuseGeneratedColumn` in
 * `packages/db/src/scoped-db.ts`, so the demonstration is deleted in the same
 * commit and this leg stands where it stood. **THE SUBJECT IS INVERTED AND THE
 * MACHINERY IS NOT**: the same registry, the same driverless handle, the same
 * real builder, asserting the refusal instead of the reach.
 *
 * **THE IDENTITY COLUMNS ARE REACHED, COUNTED AND NOT ASSERTED ON, AND THAT IS
 * A NARROWER STATEMENT THAN IT WAS.** `ADR-445` section 8 item 2 left them out
 * because the accessor let a caller name one. It still does, and `ADR-448`
 * section 8 item 2 recorded why the widening did not land: seeded and measured,
 * it turned four cases red across `packages/db/test/write-accessor.test.ts` and
 * `packages/db/test/keyed-accessor.test.ts`, which drove an UPDATE naming `id`
 * on `ledger_entries` and `liability_snapshots`. `ADR-451` corrected all four,
 * and `ADR-452` took the widening and this leg in ONE commit because the two
 * are the same claim: the clause alone lands a refusal nothing watches.
 *
 * THE IDENTITY HALF IS GATED ON `always` AND THE GATE IS THE POINT.
 * `GeneratedIdentityConfig.type` is `'always' | 'byDefault'`, and PostgreSQL
 * ACCEPTS a write naming a `GENERATED BY DEFAULT AS IDENTITY` column. A leg
 * demanding a refusal for every identity column would demand a refusal of a
 * statement the database allows, which is the error `ADR-448` section 8 item 1
 * made in the other direction and `ADR-451` spent a row discharging. All 20 on
 * the registry are `always` today, so the gate changes no number here and
 * changes the answer on the column nobody has added yet.
 *
 * THE QUALIFIED NAME IS THE DISCRIMINATOR FOR THE IDENTITY HALF AND THE BARE
 * ONE WOULD NOT DO. The stored half can ask for `delta_cents` in the message
 * and be sure of what it read. Every identity column on this registry is named
 * `id`, and `includes('id')` is satisfied by the words "identity" and "invalid",
 * so the identity half requires `${key}.${columnName}` instead, which is the
 * form the guard itself writes.
 *
 * THE PREDICATE IS SYNTHETIC AND THAT IS DELIBERATE. `updateStatementOn` runs
 * its guards on `values` before it consumes `where`, so the predicate is not
 * this leg's subject; building a real one from `uniqueKeys` would reach only the
 * addressable tables and would fail on a `bigint` identity column for a reason
 * that has nothing to do with the refusal being watched.
 *
 * A THROW IS NOT COUNTED AS A REFUSAL UNLESS IT NAMES THE COLUMN. A leg that
 * counted any exception would go green the day the builder started throwing for
 * an unrelated reason, which is the failure mode this whole file exists to
 * refuse.
 *
 * @param {string} [root]
 * @returns {Promise<{ findings: string[], refused: number, tables: number,
 *   identityReached: number, identityRefused: number, identityTables: number,
 *   addressed: number, sample: string | undefined,
 *   identitySample: string | undefined }>}
 */
export async function refusedWrites(root = REPO_ROOT) {
  const require_ = createRequire(join(root, 'packages/db/package.json'));
  const { drizzle } = await import(require_.resolve('drizzle-orm/pg-proxy'));
  const { getTableColumns, getTableName, sql } = await import(require_.resolve('drizzle-orm'));
  const accessor = await import(join(root, ACCESSOR));
  const registry = await import(join(root, REGISTRY));

  const source = drizzle(async () => ({ rows: [] }));

  /** @type {string[]} */
  const findings = [];
  let refused = 0;
  let identityReached = 0;
  let identityRefused = 0;
  let addressed = 0;
  /** @type {string | undefined} */
  let sample;
  /** @type {string | undefined} */
  let identitySample;
  const tables = new Set();
  const identityTables = new Set();

  /**
   * Drive the real UPDATE builder at one column and hand back what it threw.
   *
   * ONE PROBE SERVES BOTH HALVES SO THEY CANNOT DRIFT. The stored half and the
   * identity half must exercise the SAME builder through the SAME parameter for
   * the comparison between them to mean anything; two copies would let one be
   * quietly weakened while the other stayed honest.
   *
   * @param {string} key
   * @param {string} property
   * @returns {Promise<string | undefined>} The message, or `undefined` if it built.
   */
  const probe = async (key, property) => {
    try {
      await accessor.unscopedUpdateStatement(
        source,
        key,
        { [property]: sql`'merit-generated-column-probe'` },
        sql`true`,
      );
      return undefined;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  /**
   * Build an UPDATE that ADDRESSES a row by `property` and writes another
   * column, and report what it threw.
   *
   * THIS PREDICATE IS REAL WHERE THE REFUSAL PROBE'S IS SYNTHETIC, AND THE
   * DIFFERENCE IS THE POINT OF THE CASE. The refusal probe does not care what
   * the predicate is, because `updateStatementOn` runs its guards on `values`
   * before it consumes `where`. This one cares about nothing else: it goes
   * through `unscopedAddressPredicate`, which is what `updateAt` calls, so what
   * it exercises is the path `apps/worker/src/recon/sweep.ts` actually takes
   * when it addresses `reconciliations` by its identity `id`.
   *
   * THE VALUE COLUMN SKIPS THE TENANCY COLUMNS, because `refuseTenancyColumn`
   * would refuse those first and the probe would then report on another guard.
   *
   * @param {string} key
   * @param {string} property The identity column, used as the ADDRESS.
   * @param {Record<string, unknown>} columns
   * @returns {Promise<string | undefined>} The message, or `undefined` if it built.
   */
  const address = async (key, property, columns) => {
    const tenancy = new Set(accessor.tenancyColumns(key));
    let writable;
    for (const [candidate, column] of Object.entries(columns)) {
      const cc = /** @type {{ name: unknown, generated: unknown,
        generatedIdentity: { type?: unknown } | undefined }} */ (column);
      if (cc.generated !== undefined && cc.generated !== null) continue;
      if (cc.generatedIdentity?.type === 'always') continue;
      if (tenancy.has(candidate) || tenancy.has(String(cc.name))) continue;
      writable = candidate;
      break;
    }
    if (writable === undefined) return 'no non-tenancy writable column to set';
    try {
      await accessor.unscopedUpdateStatement(
        source,
        key,
        { [writable]: sql`'merit-generated-column-probe'` },
        accessor.unscopedAddressPredicate(key, { [property]: 1n }),
      );
      return undefined;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  for (const key of registry.TABLE_KEYS) {
    const table = registry.TABLES[key];
    const name = String(getTableName(table));
    const columns = getTableColumns(table);
    for (const [property, column] of Object.entries(columns)) {
      const c = /** @type {{ name: unknown, generated: unknown, generatedIdentity: unknown }} */ (
        column
      );
      const columnName = String(c.name);
      const identity = /** @type {{ type?: unknown } | undefined} */ (c.generatedIdentity);
      if (identity !== undefined && identity !== null && identity.type === 'always') {
        identityReached += 1;
        identityTables.add(name);
        const threw = await probe(key, property);
        if (threw === undefined) {
          findings.push(
            `${key}: the accessor built an UPDATE naming ${name}.${columnName}, which schema.ts ` +
              'declares `GENERATED ALWAYS AS IDENTITY`. PostgreSQL refuses that statement with ' +
              '428C9. `refuseGeneratedColumn` in packages/db/src/scoped-db.ts is the guard that ' +
              'should have refused it first',
          );
        } else if (!threw.includes(`${key}.${columnName}`)) {
          // THE QUALIFIED NAME IS THE DISCRIMINATOR HERE AND THE BARE ONE WOULD NOT
          // DO. Every identity column on this registry is called `id`, so a
          // `threw.includes('id')` would be satisfied by the words "identity" and
          // "invalid" and would count an unrelated failure as this refusal. The
          // guard writes `${key}.${column.name}`, so that is what is required.
          findings.push(
            `${key}: the accessor refused an UPDATE naming ${name}.${columnName}, but the ` +
              'message does not name the column, so this leg cannot tell the guard from an ' +
              `unrelated failure. It said: ${threw.split('\n')[0]}`,
          );
        } else {
          identityRefused += 1;
          identitySample ??= threw;
        }

        // AN ADDRESS IS A PREDICATE THAT READS THE COLUMN AND MUST KEEP WORKING.
        // Widening the guard to identity columns makes this SHARPER rather than
        // softer, because an identity column is exactly what an address is built
        // from: the day someone moves the guard off `values` and onto the
        // statement, every row addressed by its `id` stops being reachable, and
        // this is the leg that says so.
        const blocked = await address(key, property, columns);
        if (blocked === undefined) {
          addressed += 1;
        } else {
          findings.push(
            `${key}: ${name}.${columnName} is an identity column and an UPDATE ADDRESSED by ` +
              'it was refused. An address READS the column and only a write to it is refused, ' +
              `so this is a guard reaching a parameter it must not. It said: ${blocked.split('\n')[0]}`,
          );
        }
      }
      if (c.generated === undefined || c.generated === null) continue;

      tables.add(name);
      const threw = await probe(key, property);

      if (threw === undefined) {
        findings.push(
          `${key}: the accessor built an UPDATE naming ${name}.${columnName}, which schema.ts ` +
            'declares `GENERATED ALWAYS AS (...) STORED`. PostgreSQL refuses that statement ' +
            'with 42601. `refuseGeneratedColumn` in packages/db/src/scoped-db.ts is the guard ' +
            'that should have refused it first',
        );
        continue;
      }
      if (!threw.includes(columnName)) {
        findings.push(
          `${key}: the accessor refused an UPDATE naming ${name}.${columnName}, but the message ` +
            'does not name the column, so this leg cannot tell the guard from an unrelated ' +
            `failure. It said: ${threw.split('\n')[0]}`,
        );
        continue;
      }
      refused += 1;
      sample ??= threw;
    }
  }

  if (refused === 0) {
    findings.push(
      'no stored generated column on the registry was refused, so this leg asserted nothing. ' +
        'Zero is what a green run and a broken import both look like',
    );
  }
  if (identityRefused === 0) {
    findings.push(
      'no `GENERATED ALWAYS AS IDENTITY` column on the registry was refused, so the identity ' +
        'half of this leg asserted nothing. Zero is what a green run and a broken import both ' +
        'look like',
    );
  }
  return {
    findings,
    refused,
    tables: tables.size,
    identityReached,
    identityRefused,
    identityTables: identityTables.size,
    addressed,
    sample,
    identitySample,
  };
}

/**
 * Every source file this leg reads, which is the shipped tree and not the suite.
 *
 * THE SUITE IS EXCLUDED AND THE REASON IS NOT CONVENIENCE. A test that builds a
 * statement naming a generated column on purpose is the suite proving a
 * refusal, and this file's own test does exactly that. Folding the suite in
 * would make this leg red for the right reason in the wrong place.
 *
 * @param {string} root
 * @returns {string[]} Repository-relative paths.
 */
function shippedSource(root) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (NOT_SOURCE.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SOURCE_EXTENSION.test(entry.name)) out.push(relative(root, full));
    }
  };
  walk(root);
  return out.filter((rel) => {
    const parts = rel.split(sep);
    if (parts.some((p) => p === 'test' || p === 'tests' || p === 'e2e' || p === '__tests__')) {
      return false;
    }
    return !/\.(?:test|spec)\./.test(parts[parts.length - 1] ?? '');
  });
}

/**
 * The string-literal content of a file, line by line, with every other
 * character replaced by a space.
 *
 * IT IS A DIFFERENCE BETWEEN TWO STRIPPINGS RATHER THAN A SECOND SCANNER.
 * `stripComments` preserves literal content under `keep` and replaces it with
 * spaces under `blank`, and both preserve length and newlines, so a position
 * where the two disagree is literal content and a position where they agree is
 * not. `RI-30` is why this file does not carry a scanner of its own.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function literalLines(source) {
  const keep = stripComments(source, { literals: 'keep' });
  const blank = stripComments(source, { literals: 'blank' });
  let only = '';
  for (let i = 0; i < keep.length; i += 1) {
    if (keep[i] !== blank[i]) only += keep[i];
    else only += keep[i] === '\n' ? '\n' : ' ';
  }
  return only.split('\n');
}

/**
 * Leg C. The literal blocks in shipped source that carry a DML verb.
 *
 * THE UNIT IS A BLOCK OF CONSECUTIVE LINES CARRYING LITERAL CONTENT, and it is
 * a line block rather than a literal because this check does not attempt to
 * decide where a literal begins. A template with a substitution in it is two
 * literals to a scanner and one statement to PostgreSQL, and a unit that split
 * there would put the verb in one half and a column name in the other. The
 * block is coarser than the statement in the direction that makes somebody
 * look, which is the only direction an absence check may be wrong in.
 *
 * @param {Map<string, Set<string>>} generated
 * @param {string} [root]
 * @returns {{ findings: string[], files: number, blocks: number }}
 */
export function literalStatements(generated, root = REPO_ROOT) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const columns of generated.values()) for (const c of columns) names.add(c);

  /** @type {string[]} */
  const findings = [];
  const files = shippedSource(root);
  let blocks = 0;

  for (const rel of files) {
    const lines = literalLines(readFileSync(join(root, rel), 'utf8'));
    let i = 0;
    while (i < lines.length) {
      if ((lines[i] ?? '').trim() === '') {
        i += 1;
        continue;
      }
      let j = i;
      while (j < lines.length && (lines[j] ?? '').trim() !== '') j += 1;
      const text = lines.slice(i, j).join('\n');
      if (DML_VERB.test(text)) {
        blocks += 1;
        for (const name of names) {
          if (new RegExp(`\\b${name}\\b`).test(text)) {
            findings.push(
              `${rel}:${String(i + 1)}: a hand-written statement names ${name}, which the DDL ` +
                'declares `GENERATED ALWAYS AS (...) STORED`. PostgreSQL refuses a write to it ' +
                'with 42601. If this mention is a read rather than a write, it still has to ' +
                'move: this check does not parse the statement and will not guess',
            );
          }
        }
      }
      i = j;
    }
  }

  if (files.length === 0) {
    findings.push('the source walk found no file, so this leg asserted nothing');
  }
  return { findings, files: files.length, blocks };
}

/**
 * @param {string[]} argv
 * @param {(line: string) => void} emit
 * @returns {Promise<number>} Process exit code.
 */
export async function run(argv, emit = (line) => console.log(line)) {
  if (argv.length > 0) {
    emit('usage: node packages/tooling/checks/generated-column-writes.mjs');
    emit('');
    emit('It takes no argument. Every input it has is derived from the tree on the run.');
    return 2;
  }

  const set = derivedSet();
  const legC = literalStatements(set.generated);
  /** @type {BuiltStatements} */
  let legB;
  try {
    legB = await builtStatements(set.generated);
  } catch (err) {
    // A CHECK THAT CANNOT RUN IS NOT A CHECK THAT PASSED. Node strips types
    // from `.ts` on 22.18 and later, and `.nvmrc` reads 22, so this is what an
    // older Node in somebody's shell looks like rather than a code defect.
    emit(`ERROR  leg B could not build the accessor's statements: ${String(err)}`);
    emit('       It imports packages/db/src/*.ts directly, so it needs a Node that strips');
    emit('       types (22.18 or later) and an installed workspace.');
    return 2;
  }

  const legD = await refusedWrites();

  const findings = [...set.findings, ...legB.findings, ...legC.findings, ...legD.findings];
  const total = [...set.generated.values()].reduce((n, s) => n + s.size, 0);

  if (findings.length === 0) {
    emit(
      `PASS   ${String(total)} stored generated column(s) on ${String(set.generated.size)} ` +
        `table(s), folded from ${String(set.files)} migration(s) beside ` +
        `${String(set.identityOccurrences)} identity column(s); ` +
        `${String(legB.tables)} built INSERT(s) name none of them, of which ` +
        `${String(legB.covered)} are on a table that carries one; ` +
        `${String(legC.blocks)} hand-written statement(s) across ` +
        `${String(legC.files)} shipped source file(s) mention none of them; ` +
        `the UPDATE builder refuses ${String(legD.refused)} of them by name on ` +
        `${String(legD.tables)} table(s), and refuses ${String(legD.identityRefused)} of ` +
        `${String(legD.identityReached)} \`always\` identity column(s) by name on ` +
        `${String(legD.identityTables)} table(s) while still ADDRESSING a row by ` +
        `${String(legD.addressed)} of them`,
    );
    return 0;
  }

  emit(
    `FAIL   a statement in this tree writes a stored generated column (${String(findings.length)})`,
  );
  for (const f of findings) emit(`       ${f}`);
  emit('');
  emit(
    'THE SET IS DERIVED FROM THE DDL ON EVERY RUN AND IS NOT A LIST IN THIS FILE. If a ' +
      'finding names a column you did not expect, the DDL declares it generated and ' +
      '`packages/db/migrations/` is where that is settled.',
  );
  return 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(await run(process.argv.slice(2)));
