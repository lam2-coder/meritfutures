// =============================================================================
// apps/site/src/content/lint-cli.ts
// =============================================================================
// VG-M9-2, RUNNABLE, AND IT WATCHES ITSELF FAIL BEFORE IT REPORTS A PASS.
//
// [DELIVERY_PLAN section 4](docs/DELIVERY_PLAN.md) states P4's done-condition
// for this slice in five words: "GS-143 and GS-144 failing the build on a
// SEEDED VIOLATION". Not "a lint exists". Not "a lint reports nothing". The
// condition is that a known-bad input is refused, which is the only form of the
// claim that distinguishes a working lint from a lint whose needle stopped
// matching.
//
// So this runner does two things and reports both counts:
//
//   1. It lints every `.mdx` under `apps/site/content/`, the authored corpus.
//      That directory is EMPTY TODAY and the runner says so rather than
//      implying coverage it does not have. M9's content is
//      `content_documents.body_mdx` and arrives over HTTP ([ADR-096](ADR-096)),
//      so an on-disk corpus is the exception here rather than the rule.
//
//   2. It runs the seeded specimens BOTH WAYS. A lint tested only where it
//      refuses is indistinguishable from a lint that refuses everything, and
//      the second one is worse than none: it gets disabled in its first week by
//      a reviewer who is right. Every clean specimen must pass and every seeded
//      one must be refused, by the RULE the specimen names, and a specimen that
//      is refused for the wrong reason is a failure here.
//
// LEG 2 IS WHY THIS STEP CANNOT GO VACUOUS. `repo-invariants.mjs` rule 2 states
// the principle this file is built on: a check that cannot run is not a check
// that passed. Leg 1 can legitimately read zero files today; leg 2 asserts
// sixteen outcomes on every invocation and fails the step if it reads none.
// =============================================================================

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { ContentRule } from './lint.ts';
import { lintAuthoredContent } from './lint.ts';

/** Where the authored corpus lives, relative to the repository root. */
const CONTENT_DIR = 'apps/site/content';

/** One seeded input and the outcome it must produce. */
interface Specimen {
  readonly name: string;
  readonly source: string;
  /** `null` means the specimen must be CLEAN. */
  readonly refusedBy: ContentRule | null;
}

const FRONTMATTER = [
  '---',
  'title: A post',
  'og_title: Merit',
  'og_description: How Merit states a figure.',
  '---',
  '',
].join('\n');

const withBody = (body: string): string => `${FRONTMATTER}\n${body}\n`;

const withOg = (description: string): string =>
  [
    '---',
    'title: A post',
    'og_title: Merit',
    `og_description: ${description}`,
    '---',
    '',
    'The cap is set per plan.',
    '',
  ].join('\n');

/**
 * The seeded violations and their clean twins, in matched pairs.
 *
 * EVERY REFUSAL HAS A TWIN THAT PASSES, and they are adjacent on purpose: the
 * pair is the control, and either half alone is a claim.
 */
const SPECIMENS: readonly Specimen[] = [
  // GS-143: a bare parameter value in prose.
  {
    name: 'GS-143 seeded: a currency amount in prose',
    source: withBody('Our 50K plan pays up to $1,500 per payout.'),
    refusedBy: 'GS-143',
  },
  {
    name: 'GS-143 clean: the same sentence through <PlanValue>',
    source: withBody(
      'Our plan pays up to <PlanValue plan="core_eod" size="50K" field="payout_cap_cents"/> per payout.',
    ),
    refusedBy: null,
  },
  {
    name: 'GS-143 seeded: a percentage in prose',
    source: withBody('The profit split is 90%.'),
    refusedBy: 'GS-143',
  },
  {
    name: 'GS-143 clean: describing the mechanism rather than the value',
    source: withBody('The profit split is set per plan and shown on that plan rules page.'),
    refusedBy: null,
  },
  {
    name: 'GS-143 seeded: a day count in prose',
    source: withBody('You need 5 winning days before your first payout.'),
    refusedBy: 'GS-143',
  },
  {
    name: 'GS-143 clean: the same claim through <PlanValue>',
    source: withBody(
      'You need <PlanValue plan="core_eod" size="50K" field="win_days_required_count"/> before your first payout.',
    ),
    refusedBy: null,
  },
  {
    name: 'GS-143 seeded: <PlanValue> without the attributes that make it readable',
    source: withBody('The cap is <PlanValue field="payout_cap_cents"/>.'),
    refusedBy: 'GS-143',
  },

  // GS-144: a published statistic without its trailing window.
  {
    name: 'GS-144 seeded: a statistic stripped of its window',
    source: withBody('Our pass rate is <Statistic code="eval_pass_rate" value-only/>.'),
    refusedBy: 'GS-144',
  },
  {
    name: 'GS-144 clean: the sanctioned accessor',
    source: withBody('Our pass rate is <Statistic code="eval_pass_rate"/>.'),
    refusedBy: null,
  },
  {
    name: 'GS-144 seeded: an author-supplied window, which drifts from the computed one',
    source: withBody('Our pass rate is <Statistic code="eval_pass_rate" window="90 days"/>.'),
    refusedBy: 'GS-144',
  },
  {
    name: 'GS-144 clean: a figure that already carries its window, as statisticText emits it',
    source: withBody(
      'Our pass rate was 14.70% (2026-04-14 to 2026-08-20, as of 2026-08-20, n=2803).',
    ),
    refusedBy: null,
  },

  // GS-144 ON THE OG IMAGE PATH. The half a lint written in a hurry drops.
  {
    name: 'GS-144 seeded ON THE OG PATH: a bare figure in og_description, body clean',
    source: withOg('41% of evaluations pass.'),
    refusedBy: 'GS-143',
  },
  {
    name: 'GS-144 seeded ON THE OG PATH: a statistic stripped of its window in og_description',
    source: withOg('<Statistic code="eval_pass_rate" value-only/>'),
    refusedBy: 'GS-144',
  },
  {
    name: 'GS-144 clean ON THE OG PATH: the sanctioned accessor on the card',
    source: withOg('<Statistic code="eval_pass_rate"/>'),
    refusedBy: null,
  },

  // The carve-out, both ways.
  {
    name: 'clean: ADR-042 settlement window, which is a banking rail unit Merit quotes',
    source: withBody(
      'Payouts land in your Merit Wallet the same day you request them. Withdrawing from your wallet to your bank takes 2 to 3 business days.',
    ),
    refusedBy: null,
  },
  {
    name: 'seeded: a DIFFERENT day count in that sentence is a different sentence',
    source: withBody('Withdrawing from your wallet to your bank takes 5 to 7 business days.'),
    refusedBy: 'GS-143',
  },
];

function mdxFiles(root: string): readonly string[] {
  const dir = join(root, CONTENT_DIR);
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.mdx')) out.push(child);
    }
  };
  walk(CONTENT_DIR);
  return out;
}

function main(): number {
  const root = process.cwd();
  const failures: string[] = [];

  // Leg 1: the authored corpus.
  const files = mdxFiles(root);
  for (const file of files) {
    for (const finding of lintAuthoredContent(readFileSync(join(root, file), 'utf8'))) {
      failures.push(`${file} [${finding.surface}] ${finding.rule}: ${finding.message}`);
    }
  }

  // Leg 2: the seeded violations, both ways.
  for (const specimen of SPECIMENS) {
    const findings = lintAuthoredContent(specimen.source);
    if (specimen.refusedBy === null) {
      if (findings.length === 0) continue;
      failures.push(
        `SPECIMEN "${specimen.name}" must build and was refused: ` +
          findings.map((f) => `${f.rule} ${f.quote}`).join('; ') +
          '. A lint that refuses the correct case is a lint somebody disables, correctly.',
      );
      continue;
    }
    if (findings.length === 0) {
      failures.push(
        `SPECIMEN "${specimen.name}" must be REFUSED and was not. ` +
          `${specimen.refusedBy} is not asserted by this run, so the control is not a control.`,
      );
      continue;
    }
    if (!findings.some((f) => f.rule === specimen.refusedBy)) {
      failures.push(
        `SPECIMEN "${specimen.name}" was refused by ${findings.map((f) => f.rule).join(', ')} ` +
          `rather than by ${specimen.refusedBy}. A refusal for the wrong reason is not the ` +
          'assertion the row makes.',
      );
    }
  }

  const seeded = SPECIMENS.filter((s) => s.refusedBy !== null).length;
  const clean = SPECIMENS.length - seeded;

  if (SPECIMENS.length === 0) {
    console.error('VG-M9-2 read no specimen. A check that cannot run is not a check that passed.');
    return 1;
  }

  console.log(
    `VG-M9-2 note: ${files.length} authored .mdx file(s) under ${CONTENT_DIR}; ` +
      `${SPECIMENS.length} specimen(s) run, ${seeded} seeded violation(s) that must be refused ` +
      `and ${clean} clean input(s) that must build. GS-143 and GS-144 are asserted in BOTH ` +
      'directions, which is the only form of the claim that separates a working lint from one ' +
      'whose needle stopped matching.',
  );

  if (failures.length === 0) {
    console.log('PASS   VG-M9-2  MDX carrying a bare parameter value fails, and clean MDX builds');
    return 0;
  }

  console.error(`FAIL   VG-M9-2  (${failures.length})`);
  for (const failure of failures) console.error(`       ${failure}`);
  return 1;
}

process.exit(main());
