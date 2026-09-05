// =============================================================================
// apps/worker/test/schedule.test.ts
// =============================================================================
// **THE ASSERTIONS ADR-326 EXISTS TO LEAVE BEHIND. EVERY NUMBER HERE IS READ OFF
// THE TREE AT THE MOMENT IT IS ASSERTED, AND NONE OF THEM IS TYPED.**
//
// The row that produced this file was dispatched over a comment in
// `src/index.ts` that said the job store was "still not installed" three days
// after `0079_pgboss_job_store.sql` merged, and that named FIVE unscheduled jobs
// while enumerating SIX, in a file whose cited inventory marked FEWER rows than
// either number, about a deployable that had since built one more. **NOT ONE OF
// THOSE FOUR DISAGREEMENTS TURNED ANYTHING RED**, because a count in prose is
// asserted by nothing.
//
// So the cases below derive each of the four:
//
//   1. THE JOB STORE, from `packages/db/migrations`;
//   2. THE JOB LIST, from the exported entry points under `apps/worker/src`;
//   3. THE DISPOSITIONS, from a caller census over that same tree;
//   4. THE INVENTORY'S MARKERS, from `CRON_INVENTORY` itself,
//
// and each retired sentence is asserted ABSENT rather than deleted quietly,
// which is `RI-14`: what was corrected is kept where a reader meets it.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { stripComments } from '../../../packages/tooling/checks/strip-comments.mjs';

import {
  SCHEDULED_JOB_ENTRY_POINTS,
  UNSCHEDULED_CRON_ROWS,
  UNSCHEDULED_JOB_ENTRY_POINTS,
  WORKER_JOB_ENTRY_POINTS,
} from '../src/index.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const WORKER_SRC = join(ROOT, 'apps/worker/src');
const BARREL = readFileSync(join(WORKER_SRC, 'index.ts'), 'utf8');
const CRON = readFileSync(join(ROOT, 'docs/ops/runbooks/CRON_INVENTORY.md'), 'utf8');
const MANIFEST = readFileSync(join(ROOT, 'apps/worker/package.json'), 'utf8');

/** Every `.ts` module under `apps/worker/src`, by the specifier the barrel uses. */
function workerModules(): readonly string[] {
  const out: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(WORKER_SRC, relative), { withFileTypes: true })) {
      const next = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith('.ts')) out.push(`./${next}`);
    }
  };
  walk('');
  return out.sort();
}

const sourceOf = (module: string): string =>
  readFileSync(join(WORKER_SRC, module.replace(/^\.\//, '')), 'utf8');

/**
 * The rows of `CRON_INVENTORY`'s scheduled table, first cell and whole line.
 *
 * THE SECTION IS BOUNDED THE WAY `gates.mjs` BOUNDS IT, for the reason that
 * runner states: unbounded, the scan runs on into the coverage table and starts
 * reading rows that answer a different question.
 */
function scheduledRows(): readonly { readonly job: string; readonly line: string }[] {
  const start = CRON.indexOf('## Scheduled work');
  expect(start, 'CRON_INVENTORY no longer has a "## Scheduled work" section').toBeGreaterThan(-1);
  const after = CRON.slice(start + '## Scheduled work'.length);
  const end = after.search(/\n## /);
  const rows: { job: string; line: string }[] = [];
  for (const line of (end === -1 ? after : after.slice(0, end)).split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    if (cells.every((c) => /^:?-+:?$/.test(c.trim()))) continue;
    const job = (cells[0] ?? '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*`]/g, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (job === 'job') continue; // the header row
    rows.push({ job, line });
  }
  return rows;
}

// =============================================================================
// 1. The job store, derived from the migration directory
// =============================================================================

test('1.1 the job store is installed, and the sentence that said it was not is gone', () => {
  // THE CLAIM AND ITS DERIVATION IN ONE CASE. `ADR-324` repaired this defect
  // class at a different site one row before this one: a refusal quoting an
  // obstruction that had been discharged, pinned by assertions that matched the
  // WORDS rather than the FACTS. So the fact is read first and the words second.
  //
  // **AND IT READ THE FILENAME UNTIL ADR-327, WHICH IS THE SAME DEFECT ONE TURN
  // SMALLER.** The filter was `/pgboss/i` over the DIRECTORY LISTING with a
  // length of exactly one, so `0082_pgboss_app_grants.sql` turned it red by
  // landing beside `0079`: a case about whether a schema is INSTALLED was
  // reading how a file is NAMED. It reads the statement now, so a third pgboss
  // file changes nothing and a superseded install changes everything.
  const dir = join(ROOT, 'packages/db/migrations');
  const migrations = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  expect(
    migrations.length,
    'the migration walk found nothing; the case cannot run',
  ).toBeGreaterThan(50);
  const bodies = new Map(
    migrations.sort().map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const),
  );
  const store = [...bodies]
    .filter(([, body]) => /^CREATE SCHEMA IF NOT EXISTS pgboss\b/m.test(body))
    .map(([name]) => name);
  expect(
    store,
    'no migration in packages/db/migrations installs the pg-boss job store. If 0079 was ' +
      'superseded, this case and the barrel paragraph it guards both move with it',
  ).toEqual(['0079_pgboss_job_store.sql']);

  for (const retired of [
    'The job store is still not installed',
    "pg-boss's schema is not in `packages/db/migrations`",
    'THE INTERFACE NOW EXISTS AND THE JOB STORE DOES NOT',
  ])
    expect(
      BARREL.split('THIS PARAGRAPH READ')[0],
      `apps/worker/src/index.ts asserts "${retired}" outside the paragraph that retires it, and ` +
        `${store[0] ?? ''} is on disk. That is the sentence ADR-326 was dispatched to repair`,
    ).not.toContain(retired);
});

test('1.2 the barrel names the migration that made the old sentence false', () => {
  // KEPT RATHER THAN DELETED, which is RI-14. A reader who met the old claim
  // should find out what replaced it in the place they met it.
  expect(BARREL).toContain('0079_pgboss_job_store.sql');
  expect(BARREL).toContain('THIS PARAGRAPH READ');
});

// =============================================================================
// 2. The job list, derived from the tree in both directions
// =============================================================================

test('2.1 every registered entry point names a module and an export the tree carries', () => {
  const modules = new Set(workerModules());
  for (const job of WORKER_JOB_ENTRY_POINTS) {
    expect(
      modules,
      `${job.module} is registered in WORKER_JOB_ENTRY_POINTS and does not exist`,
    ).toContain(job.module);
    const declared = new RegExp(`^export (?:async )?function ${job.entryPoint}\\b`, 'm');
    expect(
      declared.test(sourceOf(job.module)),
      `${job.module} no longer exports \`${job.entryPoint}\`. A registry entry naming an export ` +
        'that is gone is how a list stays complete-looking while the job it named was renamed',
    ).toBe(true);
  }
});

test('2.2 every job-shaped export under src/ is registered, so a new job is a decision', () => {
  // THE DIRECTION THAT CATCHES THE FAILURE NOBODY IS LOOKING FOR, and it is the
  // one the replaced prose had no answer to at all: a job somebody builds and
  // nobody dispositions.
  //
  // **THE SHAPE IS `run*`, `start*` OR `main`, AND THE RESIDUE IS STATED RATHER
  // THAN HIDDEN.** `evaluateBreaker` and `findUndeliveredWindows` are job entry
  // points that this pattern does not match; both are registered, and 2.1 holds
  // them in the other direction. A future job named neither `run*` nor `start*`
  // slips this case exactly as those two would have, which is why 2.1 exists and
  // why the pattern is written here rather than described.
  const registered = new Set(WORKER_JOB_ENTRY_POINTS.map((job) => job.entryPoint));
  const found: string[] = [];
  for (const module of workerModules()) {
    for (const match of sourceOf(module).matchAll(
      /^export async function (run[A-Z]\w*|start[A-Z]\w*|main)\b/gm,
    )) {
      const name = match[1] ?? '';
      found.push(name);
      expect(
        registered,
        `${module} exports \`${name}\`, which is a job entry point by shape and is not in ` +
          'WORKER_JOB_ENTRY_POINTS. A job the registry has never met is a job nobody has ' +
          'dispositioned, which is ADR-239 one file over',
      ).toContain(name);
    }
  }
  expect(
    found.length,
    'the job-entry-point scan matched nothing, so it is asserting nothing',
  ).toBeGreaterThan(5);
});

// =============================================================================
// 3. The dispositions, derived from a caller census
// =============================================================================

test('3.1 an entry point has a caller under src/ if and only if it is scheduled', () => {
  // **THE DISPOSITION IS NOT A LABEL SOMEBODY TYPED, IT IS A FACT ABOUT THE
  // TREE.** A job with no caller cannot be running whatever a document says, and
  // a job with a caller that is marked unscheduled is a claim this case refuses.
  // Comments are stripped first: this very repository's headers quote these
  // names constantly, and a docblock naming a function is not a call site.
  const bodies = workerModules().map((module) => stripComments(sourceOf(module)));
  const calls = (name: string): number => {
    let total = 0;
    for (const body of bodies)
      for (const match of body.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))) {
        void match;
        total += 1;
      }
    // Every entry point is declared exactly once and the declaration's own
    // `name(` reads as a call to this counter. One occurrence is therefore the
    // declaration and nothing else.
    return total - 1;
  };

  for (const job of WORKER_JOB_ENTRY_POINTS) {
    const called = calls(job.entryPoint) > 0;
    expect(
      called,
      `${job.entryPoint} is registered as ${job.disposition} and ` +
        `${called ? 'has' : 'has no'} caller under apps/worker/src`,
    ).toBe(job.disposition === 'scheduled');
  }

  expect(
    SCHEDULED_JOB_ENTRY_POINTS.length,
    'no job in this deployable is scheduled, which would make ADR-241 false',
  ).toBeGreaterThan(0);
  expect(
    UNSCHEDULED_JOB_ENTRY_POINTS.length,
    'nothing is unscheduled, so this whole file has nothing left to guard and should be read ' +
      'again rather than deleted',
  ).toBeGreaterThan(0);
});

test('3.2 every unscheduled job states its blocker at length', () => {
  // An unscheduled job with a blank reason is a job left unscheduled in
  // SILENCE, which is the outcome ADR-305 slice 8 forbids while permitting the
  // decision itself.
  for (const job of WORKER_JOB_ENTRY_POINTS)
    expect(
      job.why.trim().length,
      `${job.entryPoint} is ${job.disposition} with no reason stated`,
    ).toBeGreaterThan(80);
});

// =============================================================================
// 4. The inventory, derived against the registry in both directions
// =============================================================================

test('4.1 every registered cron row is a row of the inventory scheduled table', () => {
  const rows = new Set(scheduledRows().map((row) => row.job));
  expect(rows.size, 'the scheduled table parsed to nothing').toBeGreaterThan(10);
  for (const job of WORKER_JOB_ENTRY_POINTS)
    expect(
      rows,
      `${job.entryPoint} answers to the CRON_INVENTORY row "${job.cronRow}", and no row of the ` +
        'scheduled table normalizes to that. "A job in this table without a dead-man switch is ' +
        'a job that does not exist"',
    ).toContain(job.cronRow);
});

test('4.2 the inventory marks exactly the rows whose job is built and unwired', () => {
  // **THIS IS THE RECONCILIATION THE ROW WAS DISPATCHED FOR.** Three counts
  // disagreed: a comment said five, its own enumeration said six, and
  // `grep -c "NOT YET WIRED OR SCHEDULED"` over the inventory said three. None
  // of the three was derived from anything. The registry is now the authority
  // and the marker is asserted against it in BOTH directions, so a job that
  // gets wired and a row that loses its marker are each a failure rather than a
  // smaller number nobody counted.
  const marked = new Set(
    scheduledRows()
      .filter((row) => row.line.includes('NOT YET WIRED OR SCHEDULED'))
      .map((row) => row.job),
  );
  const expected = new Set(UNSCHEDULED_CRON_ROWS);

  for (const row of expected)
    expect(
      marked,
      `the inventory row "${row}" carries a job this deployable has built and left unwired, and ` +
        'the row does not say so. Leaving a job unscheduled is a decision; leaving it ' +
        'unscheduled in silence is the defect',
    ).toContain(row);
  for (const row of marked)
    expect(
      expected,
      `the inventory row "${row}" is marked NOT YET WIRED OR SCHEDULED and no unscheduled entry ` +
        'point in WORKER_JOB_ENTRY_POINTS answers to it. A stale marker is how a page silently ' +
        'reports more absence than it has',
    ).toContain(row);
  expect(marked.size).toBe(expected.size);
});

test('4.3 the withdrawal driver has its own row and its own dead-man switch', () => {
  // ADR-305 section 7 slice 8's stop condition, asserted rather than described.
  const row = scheduledRows().find((entry) => entry.job === 'withdrawal approval sweep');
  expect(row, 'the withdrawal approval sweep has no row in CRON_INVENTORY').toBeDefined();
  const line = row?.line ?? '';
  // The switch is a QUERY over the estate, which is this page's idiom for a job
  // whose success signal cannot be trusted to prove the work happened.
  expect(line).toContain('wallet_withdrawals');
  expect(line).toContain('NOT YET WIRED OR SCHEDULED');
  // And the blocker is the rail rather than an adapter, which is what separates
  // this row from every other unwired row on the page.
  expect(line).toContain('packages/rail');
});

// =============================================================================
// 5. The manifest line, and the door that is still owed under it
// =============================================================================

test('5.1 the worker declares @merit/queue, and no module of it imports the package', () => {
  // **BOTH CASES IN THIS SECTION WENT RED BY ADR-327 SUCCEEDING, AND BOTH ARE
  // REWRITTEN RATHER THAN DELETED.** 5.1 asserted the manifest did NOT declare
  // `@merit/queue` and named the blocker under it; the blocker is gone and the
  // line is here, so the case now asserts the line AND the half that is still
  // missing. A case that only asserted the line would go green on a manifest
  // entry nothing uses, which is exactly the state this deployable is in.
  const manifest = JSON.parse(MANIFEST) as { dependencies?: Record<string, string> };
  const deps = Object.keys(manifest.dependencies ?? {}).sort();
  expect(
    deps,
    'apps/worker no longer declares @merit/queue. Under node-linker=isolated an undeclared ' +
      'import does not resolve at all, so removing this line makes every queue door in this ' +
      'deployable unwritable again (ADR-327)',
  ).toContain('@merit/queue');

  // THE RETIRED SENTENCE, ASSERTED IN THE DIRECTION THAT KEEPS THE HISTORY
  // READABLE: the paragraph marking it as retired is present, and the claim does
  // not stand on its own above it.
  expect(BARREL).not.toContain('IT IS OWED BY A DIFFERENT SESSION THAN THIS ONE');
  const retired = BARREL.indexOf('THIS PARAGRAPH READ "NOTHING HERE IMPORTS');
  expect(
    retired,
    'the paragraph retiring the grant blocker is gone from the barrel',
  ).toBeGreaterThan(-1);
  expect(
    BARREL.slice(0, retired),
    'the barrel states the grant blocker as a live claim again, and 0082 is on disk',
  ).not.toContain('every one of `JobQueue`');

  // AND THE DOOR. `@merit/ledger` reaches exactly `src/sweeps/ledger.ts` and
  // `@merit/db` exactly `src/db.ts`, on ADR-165's ONE-DOOR pattern. A third
  // capability with no door is a manifest line nobody can point at, so it is
  // asserted rather than described: the day somebody writes the door, this case
  // and the barrel paragraph it guards move together.
  const modules = workerModules();
  expect(modules.length, 'the module walk found nothing; the case cannot run').toBeGreaterThan(10);
  const importers = modules.filter((module) =>
    /from\s+'@merit\/queue'/.test(stripComments(sourceOf(module))),
  );
  expect(
    importers,
    'a module of apps/worker now imports @merit/queue. That is the ONE-DOOR file ADR-327 ' +
      'said the next row owes: name it in package.json beside @merit/db and @merit/ledger, ' +
      'and repair the barrel paragraph that says no module imports the package',
  ).toEqual([]);
});

test('5.2 the grant 0079 left out is in, it is exactly what was ruled, and it is not CREATE', () => {
  // READ AT THE MIGRATIONS RATHER THAN AT THE COMMENT THAT DESCRIBES THEM. This
  // case asserted that NO migration granted on the pgboss schema, and it was the
  // assertion that made the barrel's blocker paragraph falsifiable. `0082` made
  // it red, so it is rewritten to the other side of the same fact: the grant is
  // here, and the one privilege ADR-326 section 3.3 refused is still refused.
  //
  // IT READS THE STATEMENT LINES AND NOT THE FILE. Every GRANT and REVOKE in
  // that directory starts at column zero and every comment line starts with
  // `--`, and `0082`'s header discusses CREATE at length in prose. A whole-file
  // regex would read the argument for refusing the privilege as the privilege.
  const dir = join(ROOT, 'packages/db/migrations');
  const statements = new Map<string, string>();
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.sql')) continue;
    statements.set(
      f,
      readFileSync(join(dir, f), 'utf8')
        .split('\n')
        .filter((line) => /^(GRANT|REVOKE)\b/i.test(line))
        .join('\n'),
    );
  }
  expect(statements.size).toBeGreaterThan(50);

  const granted = [...statements]
    .filter(([, body]) => /^GRANT[^;]*\bUSAGE ON SCHEMA pgboss\b/im.test(body))
    .map(([name]) => name);
  expect(
    granted,
    'no migration grants USAGE ON SCHEMA pgboss any more. The barrel says the blocker is ' +
      'gone and the manifest line stands on that; if the grant was superseded, both move',
  ).toEqual(['0082_pgboss_app_grants.sql']);

  const create = [...statements]
    .filter(([, body]) => /^GRANT[^;]*\bCREATE\b[^;]*\bON SCHEMA pgboss\b/im.test(body))
    .map(([name]) => name);
  expect(
    create,
    'a migration grants CREATE on the pgboss schema. ADR-326 section 3.3 refuses it: that is ' +
      "DDL inside the ledger's PITR boundary, held by the role 0026:64 revokes it from on " +
      'public, and pgboss.create_queue needs it only for a partitioned queue nothing declares',
  ).toEqual([]);
});
