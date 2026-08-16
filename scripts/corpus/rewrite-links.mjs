#!/usr/bin/env node
// =============================================================================
// scripts/corpus/rewrite-links.mjs
// =============================================================================
// The other half of ADR-043's stage 1: every link that pointed INTO DECISIONS.md
// is repointed at the file that now holds the text, and every link that pointed
// OUT of it is re-based for its new depth.
//
//   node scripts/corpus/rewrite-links.mjs plan     report, write nothing
//   node scripts/corpus/rewrite-links.mjs apply    rewrite in place
//
// BOTH DIRECTIONS, AND THE SECOND ONE IS THE ONE THAT GETS FORGOTTEN. 50 files
// moved from docs/ to docs/decisions/ and docs/decisions/gates/, so a link inside
// them that read `plans/M01-rules-engine.md` is now one or two directories wrong.
// Nothing about the inbound rewrite would reveal that; CI-06a is what reveals it,
// and it reveals it for every one of them at once.
//
// IT IS DRIVEN BY THE MAP split-decisions.mjs DERIVED, never by a hand-typed
// table. The one exception is NAMED_TARGETS below, which is 20-odd links whose
// text names a ruling rather than an ADR, and every one of them is listed with
// the reason a machine could not resolve it.
// =============================================================================

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// THE OLD BASE IS PER REGISTRY, not a constant. DECISIONS.md and EDGE_CASES.md
// sat at docs/, so their links resolved from there. DATA_MODEL.md sat at
// docs/architecture/, one level down, and re-basing its outbound links against
// docs/ silently finds nothing to fix: `../decisions/ADR-026.md` resolves from
// neither the old nor the new location, so `existsSync` on the wrong base returns
// false and the link is left broken. It reported `outbound: 0` on a registry with
// 96 files, which is the number that gave it away.

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir, out = []) {
  for (const e of readdirSync(join(ROOT, dir))) {
    if (e === 'node_modules' || e === '.git') continue;
    const rel = join(dir, e);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (rel.endsWith('.md')) out.push(rel);
  }
  return out;
}

// Link text that names a ruling rather than an ADR. A machine cannot resolve
// these because the text is prose, so each is listed with where it goes and why.
// The gate-closure files are the targets: these rulings live INSIDE a closure
// under ADR-043, so the anchor still resolves once the file is right.
const G = 'docs/decisions/gates';
const NAMED_TARGETS = {
  // Rows of the batch 2 gate closure table.
  'OQ-M18-01': `${G}/consolidated-founder-addendum-and-batch-2-gate-closure-2026-08-14.md`,
  'OQ-M12-01': `${G}/consolidated-founder-addendum-and-batch-2-gate-closure-2026-08-14.md`,
  'OQ-M12-04': `${G}/consolidated-founder-addendum-and-batch-2-gate-closure-2026-08-14.md`,
  'OQ-M20-04': `${G}/consolidated-founder-addendum-and-batch-2-gate-closure-2026-08-14.md`,
  'counsel packet item 3': `${G}/consolidated-founder-addendum-and-batch-2-gate-closure-2026-08-14.md`,
  // A row of the M1 gate closure table.
  'OQ-10 ruling': `${G}/m1-gate-closure-2026-08-13.md`,
  // `## Where conservatism lives` sits inside the Wave 3 batch 1 closure.
  "batch 1 gate's conservatism ruling": `${G}/wave-3-batch-1-gate-closure-2026-08-14.md`,
  'parameter-status ruling': `${G}/parameter-status-launch-candidates-versus-structural-rulings-founder-ruling-2026-08-14.md`,
  // LEDGER-C2 is defined inside ADR-027's invariant table.
  'LEDGER-C2': 'docs/decisions/ADR-027.md',
  'Merit Wallet': 'docs/decisions/ADR-019.md',
  // THE WAVE 2 GATE HAS NO RECORD IN THIS REGISTRY, and three links cite it.
  // Every other wave closed with a `#` gate-closure section; Wave 2 did not, so
  // these links resolved to the top of a 1,537-line file and named nothing. The
  // split cannot invent the record, so they point at the registry README, which
  // is the honest target, and the missing closure is an EDGE_CASES entry rather
  // than something this rewriter papers over.
  'Wave 2 gate': 'docs/decisions/README.md',
};

// ONE REWRITER, A CONFIG PER REGISTRY (ADR-043). Stage 1 shipped this hard-wired
// to DECISIONS.md; stage 2 is the event that would have produced a second copy of
// it, which is OQ-P1-04's defect and the exact thing ADR-043's own gates exist to
// stop. Two expressions of "repoint a link at the file that now holds the text"
// would agree for as long as nothing about the second registry differed.
const REGISTRIES = {
  decisions: {
    from: 'docs',
    map: 'docs/decisions/.map.json',
    dir: 'docs/decisions/',
    readme: 'docs/decisions/README.md',
    // Matches a link target of DECISIONS.md at any relative depth.
    target: /((?:\.\.\/)*(?:docs\/)?DECISIONS\.md)/,
    // The link TEXT is the identifier in the overwhelming majority of cases.
    id: /\b(ADR-(?:\d{3}|D\d+))/,
    // `ADR-019a` is a sub-designation of ADR-019, not an ADR of its own.
    sub: /\bADR-(\d{3})[a-z]\b/,
    self: /^\**\s*`?(docs\/)?DECISIONS(\.md)?`?\s*\**$/,
    named: NAMED_TARGETS,
  },
  'data-model': {
    from: 'docs/architecture',
    map: 'docs/architecture/data-model/.map.json',
    dir: 'docs/architecture/data-model/',
    readme: 'docs/architecture/data-model/README.md',
    target: /((?:\.\.\/)*(?:docs\/)?(?:architecture\/)?DATA_MODEL\.md)/,
    // A link whose text is a bare `table_name`, or `table_name.column`, resolves
    // to that table's record. Backticks and bold markers are stripped first
    // because the corpus writes ``[`ledger_entries`](../architecture/DATA_MODEL.md)``
    // and ``[`affiliate_commissions.payable_after`](...)``. The column half is
    // dropped deliberately: a column is documented inside its table's record, so
    // the record is the correct target and there is nothing finer to point at.
    id: /^[\s*`]*([a-z][a-z0-9_]*)(?:\.[a-z][a-z0-9_]*)?[\s*`]*$/,
    sub: null,
    // `DATA_MODEL section 8` and `DATA_MODEL sections 4 and 5` point at the
    // numbered domain sections, and ADR-043 keeps those in the README: they are
    // groupings of tables rather than tables. 22 links take this branch.
    self: /^\**\s*`?(docs\/)?(architecture\/)?DATA_MODEL(\.md)?`?(\s+sections?\b.*)?\s*\**$/,
    named: {},
  },
  sessions: {
    from: 'docs',
    map: 'docs/sessions/.map.json',
    dir: 'docs/sessions/',
    readme: 'docs/sessions/README.md',
    target: /((?:\.\.\/)*(?:docs\/)?SESSION_LOG\.md)/,
    id: /\b(Session\s+\d+)\b/,
    sub: null,
    self: /^\**\s*`?(docs\/)?SESSION_LOG(\.md)?`?\s*\**$/,
    named: {},
  },
  golden: {
    from: 'docs/testing',
    map: 'docs/testing/golden-scenarios/.map.json',
    dir: 'docs/testing/golden-scenarios/',
    readme: 'docs/testing/golden-scenarios/README.md',
    target: /((?:\.\.\/)*(?:docs\/)?(?:testing\/)?GOLDEN_SCENARIOS\.md)/,
    // A GS-nnn in link text resolves to the SECTION FILE that defines it. The
    // splitter builds that mapping, so per-section filing costs no resolution.
    id: /\b(GS-\d{3})\b/,
    sub: null,
    // `GOLDEN_SCENARIOS section 2` is a numbered section, and under ADR-043 a
    // section IS the unit here, so these could resolve to a section file. They
    // point at the README instead and the reason is the ruling: the numbering map
    // and the fixture format (sections 1 to 3) are the README's own prose, which
    // is what every one of these links is citing.
    self: /^\**\s*`?(docs\/)?(testing\/)?GOLDEN_SCENARIOS(\.md)?`?(\s+sections?\b.*)?\s*\**$/,
    named: {},
  },
  'edge-cases': {
    from: 'docs',
    map: 'docs/edge-cases/.map.json',
    dir: 'docs/edge-cases/',
    readme: 'docs/edge-cases/README.md',
    target: /((?:\.\.\/)*(?:docs\/)?EDGE_CASES\.md)/,
    id: /\b(EC-\d{3})/,
    sub: null,
    self: /^\**\s*`?(docs\/)?EDGE_CASES(\.md)?`?\s*\**$/,
    named: {},
  },
};


const rel = (from, to) => {
  const r = relative(dirname(join(ROOT, from)), join(ROOT, to));
  return r.startsWith('.') ? r : `./${r}`.replace(/^\.\//, '');
};

function main() {
  const cmd = process.argv[2];
  const name = process.argv[3];
  const reg = REGISTRIES[name];
  if ((cmd !== 'plan' && cmd !== 'apply') || !reg) {
    console.error(
      `usage: node scripts/corpus/rewrite-links.mjs plan|apply <${Object.keys(REGISTRIES).join('|')}>`,
    );
    return 2;
  }
  if (!existsSync(join(ROOT, reg.map))) {
    console.error(`no ${reg.map}; run the splitter for "${name}" first`);
    return 2;
  }
  const map = JSON.parse(read(reg.map));
  const LINK = new RegExp(`\\[([^\\]]*)\\]\\(${reg.target.source}(#[A-Za-z0-9._-]+)?\\)`, 'g');
  const files = walk('docs').concat(walk('research'), walk('packages').filter((f) => f.endsWith('.md')));

  const stats = { anchored: 0, byId: 0, named: 0, generic: 0, rebased: 0 };
  const unresolved = [];
  let touched = 0;

  for (const file of files) {
    const before = read(file);
    let body = before;
    const moved = file.startsWith(reg.dir);

    // -------------------------------------------------------------------------
    // 1. Inbound: anything pointing at DECISIONS.md.
    // -------------------------------------------------------------------------
    body = body.replace(LINK, (whole, text, _path, frag) => {
        let target = null;
        let bucket = null;
        if (frag) {
          target = map.anchors[frag.slice(1).toLowerCase()] ?? null;
          bucket = 'anchored';
        }
        if (!target) {
          // The overwhelmingly common case: the link TEXT is the identifier.
          // 732 links read `[ADR-nnn](../DECISIONS.md)`.
          const id = reg.id.exec(text.trim());
          if (id && map.ids[id[1]]) {
            target = map.ids[id[1]];
            bucket = 'byId';
          }
        }
        if (!target && reg.sub) {
          const sub = reg.sub.exec(text);
          if (sub && map.ids[`ADR-${sub[1]}`]) {
            target = map.ids[`ADR-${sub[1]}`];
            bucket = 'byId';
          }
        }
        if (!target) {
          for (const [needle, dest] of Object.entries(reg.named)) {
            if (text.includes(needle)) {
              target = dest;
              bucket = 'named';
              break;
            }
          }
        }
        if (!target) {
          // Text that names the document itself rather than an entry.
          if (reg.self.test(text.trim())) {
            target = reg.readme;
            bucket = 'generic';
          }
        }
        if (!target) {
          unresolved.push(`${file}: [${text}](...${name}${frag ?? ''})`);
          return whole;
        }
        stats[bucket]++;
      return `[${text}](${rel(file, target)})`;
    });

    // -------------------------------------------------------------------------
    // 2. Outbound: links INSIDE the moved files, re-based for their new depth.
    // -------------------------------------------------------------------------
    // Every split file used to resolve relative links from docs/. Resolve each
    // target against the OLD location and re-express it from the NEW one.
    // Same-directory decision links (ADR-027.md) already resolve and are skipped
    // by the existsSync check on the old base.
    if (moved) {
      body = body.replace(/\[([^\]]*)\]\(([^)\s#]+)(#[A-Za-z0-9._-]+)?\)/g, (whole, text, path, frag) => {
        if (/^(https?:|mailto:|#)/.test(path)) return whole;
        if (path.startsWith(reg.dir) || existsSync(resolve(ROOT, dirname(file), path))) {
          return whole; // already correct from the new location
        }
        const old = resolve(ROOT, reg.from, path);
        if (!existsSync(old)) return whole; // not a path this move broke
        stats.rebased++;
        return `[${text}](${rel(file, relative(ROOT, old))}${frag ?? ''})`;
      });

      // Self-links inside the old single file: `[ADR-034](#)` placeholders and
      // `[LEDGER-C2](#adr-027-...)` same-file anchors. Both resolved to somewhere
      // in DECISIONS.md and now have a real file to point at.
      body = body.replace(/\[([^\]]*)\]\(#([A-Za-z0-9._-]*)\)/g, (whole, text, frag) => {
        let target = frag ? map.anchors[frag.toLowerCase()] : null;
        if (!target) {
          const id = reg.id.exec(text.trim());
          if (id && map.ids[id[1]]) target = map.ids[id[1]];
        }
        if (!target || target === file) return whole;
        stats.rebased++;
        return `[${text}](${rel(file, target)})`;
      });
    }

    if (body !== before) {
      touched++;
      if (cmd === 'apply') writeFileSync(join(ROOT, file), body);
    }
  }

  console.log(
    `inbound: ${stats.anchored} by anchor, ${stats.byId} by identifier, ` +
      `${stats.named} by name, ${stats.generic} to the registry README`,
  );
  console.log(`outbound: ${stats.rebased} re-based inside the moved files`);
  console.log(`${touched} file(s) ${cmd === 'apply' ? 'rewritten' : 'would change'}`);
  if (unresolved.length) {
    console.log(`\n${unresolved.length} UNRESOLVED, each needs a decision:`);
    for (const u of unresolved) console.log(`  ${u}`);
  }
  return 0;
}

process.exit(main());
