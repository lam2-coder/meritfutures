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
  const migrations = readdirSync(join(ROOT, 'packages/db/migrations')).filter((f) =>
    f.endsWith('.sql'),
  );
  const store = migrations.filter((f) => /pgboss/i.test(f));
  expect(
    store,
    'no migration in packages/db/migrations installs the pg-boss job store. If 0079 was ' +
      'superseded, this case and the barrel paragraph it guards both move with it',
  ).toHaveLength(1);

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
// 5. The manifest line, and why it is still absent
// =============================================================================

test('5.1 the worker declares no @merit/queue, and the barrel names the blocker under it', () => {
  // **THE SENTENCE THIS REPLACES SAID THE LINE WAS "OWED BY A DIFFERENT SESSION
  // THAN THIS ONE", WHICH IS A DEFERRAL AND NOT A FINDING**: it is true on every
  // tree, before and after the work, so nothing can ever make it false. ADR-326
  // measured a blocker under it instead, and this case pins both halves.
  const manifest = JSON.parse(MANIFEST) as { dependencies?: Record<string, string> };
  const deps = Object.keys(manifest.dependencies ?? {}).sort();
  expect(
    deps,
    'apps/worker now declares @merit/queue. The grant that makes the pgboss schema reachable ' +
      'has to land with it, and this case plus the barrel paragraph it guards move together',
  ).not.toContain('@merit/queue');

  expect(BARREL).not.toContain('IT IS OWED BY A DIFFERENT SESSION THAN THIS ONE');
  expect(BARREL).toContain('permission denied for schema pgboss');

  // AND THE MANIFEST SENTENCE IN THE HEADER IS NO LONGER A TYPED LIST. It went
  // stale twice, once when @merit/db landed and once when @merit/ledger did.
  for (const dep of deps) expect(BARREL, `the barrel does not name ${dep}`).toContain(dep);
});

test('5.2 the grant 0079 left out is still left out, so the blocker is real', () => {
  // READ AT THE MIGRATION RATHER THAN AT THE COMMENT THAT DESCRIBES IT. If a
  // later migration grants USAGE on pgboss, the barrel's blocker paragraph and
  // ADR-326 section 3 both stop being true and this case says so first.
  const dir = join(ROOT, 'packages/db/migrations');
  const granted = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => /GRANT[^;]*\bON SCHEMA pgboss\b/i.test(readFileSync(join(dir, f), 'utf8')));
  expect(
    granted,
    'a migration now grants on the pgboss schema. ADR-326 ruled what that grant must be and ' +
      'must not be, and the barrel paragraph naming the blocker is due for its own repair',
  ).toHaveLength(0);
});
