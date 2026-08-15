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
const MAP = 'docs/decisions/.map.json';
const MOVED_FROM = 'docs'; // every split file used to resolve links from here

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

const rel = (from, to) => {
  const r = relative(dirname(join(ROOT, from)), join(ROOT, to));
  return r.startsWith('.') ? r : `./${r}`.replace(/^\.\//, '');
};

function main() {
  const cmd = process.argv[2];
  if (cmd !== 'plan' && cmd !== 'apply') {
    console.error('usage: node scripts/corpus/rewrite-links.mjs plan | apply');
    return 2;
  }
  if (!existsSync(join(ROOT, MAP))) {
    console.error(`no ${MAP}; run split-decisions.mjs split first`);
    return 2;
  }
  const map = JSON.parse(read(MAP));
  const files = walk('docs').concat(walk('research'), walk('packages').filter((f) => f.endsWith('.md')));

  const stats = { anchored: 0, byId: 0, named: 0, generic: 0, rebased: 0 };
  const unresolved = [];
  let touched = 0;

  for (const file of files) {
    const before = read(file);
    let body = before;
    const moved = file.startsWith('docs/decisions/');

    // -------------------------------------------------------------------------
    // 1. Inbound: anything pointing at DECISIONS.md.
    // -------------------------------------------------------------------------
    body = body.replace(
      /\[([^\]]*)\]\(((?:\.\.\/)*(?:docs\/)?DECISIONS\.md)(#[A-Za-z0-9._-]+)?\)/g,
      (whole, text, _path, frag) => {
        let target = null;
        let bucket = null;
        if (frag) {
          target = map.anchors[frag.slice(1).toLowerCase()] ?? null;
          bucket = 'anchored';
        }
        if (!target) {
          // The overwhelmingly common case: the link TEXT is the identifier.
          // 732 links read `[ADR-nnn](../DECISIONS.md)`.
          const id = /\b(ADR-(?:\d{3}|D1))/.exec(text);
          if (id && map.ids[id[1]]) {
            target = map.ids[id[1]];
            bucket = 'byId';
          }
        }
        if (!target) {
          // `ADR-019a` is a sub-designation of ADR-019, not an ADR of its own.
          const sub = /\bADR-(\d{3})[a-z]\b/.exec(text);
          if (sub && map.ids[`ADR-${sub[1]}`]) {
            target = map.ids[`ADR-${sub[1]}`];
            bucket = 'byId';
          }
        }
        if (!target) {
          for (const [needle, dest] of Object.entries(NAMED_TARGETS)) {
            if (text.includes(needle)) {
              target = dest;
              bucket = 'named';
              break;
            }
          }
        }
        if (!target) {
          // Text that names the document itself rather than an entry.
          if (/^\**\s*`?(docs\/)?DECISIONS(\.md)?`?\s*\**$/.test(text.trim())) {
            target = 'docs/decisions/README.md';
            bucket = 'generic';
          }
        }
        if (!target) {
          unresolved.push(`${file}: [${text}](...DECISIONS.md${frag ?? ''})`);
          return whole;
        }
        stats[bucket]++;
        return `[${text}](${rel(file, target)})`;
      },
    );

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
        if (path.startsWith('docs/decisions/') || existsSync(resolve(ROOT, dirname(file), path))) {
          return whole; // already correct from the new location
        }
        const old = resolve(ROOT, MOVED_FROM, path);
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
          const id = /\b(ADR-(?:\d{3}|D1))/.exec(text);
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
