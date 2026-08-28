#!/usr/bin/env node
// =============================================================================
// scripts/corpus/split-decisions.mjs
// =============================================================================
// Stage 1 of the directory-per-entry conversion (ADR-043): DECISIONS.md becomes
// docs/decisions/.
//
//   node scripts/corpus/split-decisions.mjs split     write the directory
//   node scripts/corpus/split-decisions.mjs map       print the id -> path map
//
// THE SPLIT IS NOT UNIFORM, AND THE DOCUMENT'S OWN STRUCTURE IS WHY.
// DECISIONS.md is three kinds of thing wearing one filename:
//
//   1. ADRs, at `##`. A live registry, appended on almost every branch. This is
//      the collision surface the change exists to remove, so: ONE FILE EACH.
//   2. Gate closures, at `#`. Five of them, each grouping the rulings and ADRs
//      that closed one gate. A closed gate record is not appended to after the
//      gate closes, so it carries no collision risk: ONE FILE PER CLOSURE, with
//      its `##` rulings kept inside it. Splitting these per-ruling would scatter
//      nine rulings that only mean anything as "what the Wave 3 batch 1 gate
//      decided".
//   3. The three allocation tables. READ AS TABLES by CI-06f and CI-06h through
//      one shared parser over the first cell of each row. A table split into a
//      file per row is not a table, which is the same reason DELTA_MANIFEST
//      stays single: ONE FILE, ALLOCATION.md.
//
// So the rule is SPLIT WHAT IS APPENDED TO, KEEP TOGETHER WHAT IS CLOSED. An ADR
// nested under a gate-closure H1 still gets its own file, because it is appended
// to the ADR registry; the closure keeps a link to it rather than the text.
//
// WHAT IT DOES NOT DO. It does not rewrite a single inbound link. That is
// rewrite-links.mjs, driven by the map this emits, so that "what moved" and
// "what pointed at it" are two separately reviewable diffs.
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = 'docs/DECISIONS.md';
const OUT = 'docs/decisions';
const MAP = 'docs/decisions/.map.json';

// GitHub's heading-to-anchor slug. IDENTICAL to gates.mjs's `slug`, and the
// duplication is deliberate rather than an oversight: this script must compute
// the anchor a link USED to resolve against, using the rules in force when the
// link was written. Importing the live one would make this script's output move
// if that function is ever corrected, silently remapping links already rewritten.
// Copied on 2026-08-15 and left alone.
function slug(heading) {
  return heading
    .replace(/<[^>]+>/g, '')
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/ /g, '-');
}

const ALLOCATION_HEADINGS = [
  'Number allocation, and why this table exists',
  'Migration number allocation, and why there is more than one table',
  'CI gate identifier allocation, and why there are now three tables',
];

// -----------------------------------------------------------------------------
// Parse into a flat, ordered list of blocks, fence-aware from line 0.
// -----------------------------------------------------------------------------
// ONE fence-aware pass, and a guard caught why it must be. Finding the preamble
// with a plain findIndex(/^## /) lands on the ADR TEMPLATE inside the fence at
// the top of the file, so the scan starts mid-fence with `fenced` false, flips
// to true on the CLOSING backticks, and inverts every fence below it. It parsed
// zero ADRs and said so rather than writing 43 wrong files.
function parse() {
  const lines = readFileSync(join(ROOT, SRC), 'utf8').split('\n');
  const blocks = [];
  let cur = null;
  let fenced = false;
  let titleSeen = false;
  let preambleEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      if (cur) cur.lines.push(line);
      continue;
    }
    if (!fenced) {
      const h1 = /^# (.*)$/.exec(line);
      const h2 = /^## (.*)$/.exec(line);
      if (h1 && !titleSeen) {
        // `# DECISIONS (ADR registry)` is the document title, not a closure.
        titleSeen = true;
        if (cur) cur.lines.push(line);
        continue;
      }
      if (h1 || h2) {
        if (preambleEnd === -1) preambleEnd = i;
        if (cur) blocks.push(cur);
        cur = { level: h1 ? 1 : 2, heading: (h1 ?? h2)[1], lines: [] };
        continue;
      }
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) blocks.push(cur);
  if (preambleEnd === -1) throw new Error('DECISIONS.md has no headings outside a fence');
  return { preamble: lines.slice(0, preambleEnd).join('\n'), blocks };
}

// A `###` or deeper heading is a live link target: the corpus cites
// `DECISIONS.md#m1-gate-closure-2026-08-13` and others that are nested headings.
// They keep resolving after the move because the heading travels with its text,
// so the FILE changes and the fragment does not. A collision throws rather than
// last-write-wins: two sections sharing a sub-anchor resolved to one target in
// the old single file, so the old link was already ambiguous, and silently
// picking one would freeze the wrong resolution into hundreds of rewrites.
function subAnchors(blockLines, file, map) {
  let fenced = false;
  for (const line of blockLines) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = /^#{3,6}\s+(.*?)\s*$/.exec(line);
    if (!m) continue;
    const a = slug(m[1]);
    if (map.anchors[a] && map.anchors[a] !== file) {
      throw new Error(`sub-anchor "${a}" claimed by both ${map.anchors[a]} and ${file}`);
    }
    map.anchors[a] = file;
  }
}

function split() {
  const { preamble, blocks } = parse();
  const map = { anchors: {}, ids: {} };
  const adrs = [];
  const closures = [];
  const allocation = [];
  let openClosure = null;

  const claim = (anchor, file) => {
    if (map.anchors[anchor] && map.anchors[anchor] !== file) {
      throw new Error(`anchor "${anchor}" claimed by both ${map.anchors[anchor]} and ${file}`);
    }
    map.anchors[anchor] = file;
  };

  for (const b of blocks) {
    const anchor = slug(b.heading);
    const text = `${'#'.repeat(b.level)} ${b.heading}\n${b.lines.join('\n')}`.replace(/\n+$/, '');

    if (b.level === 1) {
      openClosure = {
        heading: b.heading,
        anchor,
        file: `${OUT}/gates/${anchor}.md`,
        lead: text,
        rulings: [],
        records: [],
      };
      closures.push(openClosure);
      claim(anchor, openClosure.file);
      subAnchors(b.lines, openClosure.file, map);
      continue;
    }

    const adr = /^ADR-(\d{3}|D1):/.exec(b.heading);
    if (adr) {
      const id = `ADR-${adr[1]}`;
      const file = `${OUT}/${id}.md`;
      adrs.push({ id, heading: b.heading, file, text: text + '\n' });
      claim(anchor, file);
      map.ids[id] = file;
      subAnchors(b.lines, file, map);
      // The closure keeps the LINK rather than the text, so "what this gate
      // decided" survives the split without duplicating an ADR into two files.
      if (openClosure) openClosure.records.push({ id, heading: b.heading });
      continue;
    }

    if (ALLOCATION_HEADINGS.includes(b.heading)) {
      allocation.push(text);
      claim(anchor, `${OUT}/ALLOCATION.md`);
      subAnchors(b.lines, `${OUT}/ALLOCATION.md`, map);
      continue;
    }

    if (!openClosure) {
      throw new Error(
        `"${b.heading}" is a ruling with no enclosing gate closure. Every non-ADR ` +
          'section in this document sat under a `#` closure when it was written; a new ' +
          'shape needs a ruling here rather than a guess.',
      );
    }
    openClosure.rulings.push(text);
    claim(anchor, openClosure.file);
    subAnchors(b.lines, openClosure.file, map);
  }

  if (adrs.length === 0) throw new Error('no ADR sections parsed; refusing to split');
  if (allocation.length !== ALLOCATION_HEADINGS.length) {
    throw new Error(
      `expected ${ALLOCATION_HEADINGS.length} allocation tables, got ${allocation.length}`,
    );
  }
  if (closures.length === 0) throw new Error('no gate closures parsed; refusing to split');

  const write = (rel, content) => {
    mkdirSync(join(ROOT, dirname(rel)), { recursive: true });
    writeFileSync(join(ROOT, rel), content.replace(/\n*$/, '\n'));
  };

  // Entry files carry NO frontmatter. Under ADR-043 an entry is a FRAGMENT of a
  // registry rather than a document with its own status; the registry README is
  // the corpus document that carries status for the set, and the registry-index
  // gate is what keeps a fragment from going missing.
  for (const a of adrs) write(a.file, a.text);
  for (const c of closures) {
    const records = c.records.length
      ? '\n\n## Architecture decision records closed at this gate\n\n' +
        c.records
          .map(
            (r) => `- [${r.id}](../${r.id}.md): ${r.heading.split(':').slice(1).join(':').trim()}`,
          )
          .join('\n')
      : '';
    write(
      c.file,
      [c.lead, records.replace(/^\n\n/, ''), ...c.rulings].filter(Boolean).join('\n\n'),
    );
  }

  write(
    `${OUT}/ALLOCATION.md`,
    '---\nstatus: approved\ndepends_on: [README.md]\nlast_updated: 2026-08-15\n---\n\n' +
      '# Number allocation\n\n' +
      'The three allocation registries, kept in one document because each is read AS A\n' +
      'TABLE: `CI-06f` and `CI-06h` call one shared parser over the first cell of every\n' +
      'row. A table split into a file per row is not a table, which is the same reason\n' +
      '`DELTA_MANIFEST` stays single under [ADR-043](ADR-043.md).\n\n' +
      allocation.join('\n\n'),
  );

  write(
    `${OUT}/README.md`,
    '---\nstatus: approved\ndepends_on: []\nlast_updated: 2026-08-15\n---\n\n' +
      '# DECISIONS (ADR registry)\n\n' +
      preamble
        .replace(/^---\n[\s\S]*?\n---\n/, '')
        .replace(/^\s*# DECISIONS[^\n]*\n/m, '')
        .trim() +
      '\n\nSplit to a file per entry on 2026-08-15 by [ADR-043](ADR-043.md). The number\n' +
      'allocation tables live in [ALLOCATION.md](ALLOCATION.md); the gate closures that\n' +
      'grouped these rulings live in [gates/](gates/).\n\n' +
      '## Architecture decision records\n\n| ADR | Title |\n|---|---|\n' +
      adrs
        .map((a) => `| [${a.id}](${a.id}.md) | ${a.heading.split(':').slice(1).join(':').trim()} |`)
        .join('\n') +
      '\n\n## Gate closures\n\n| Closure | Rulings | ADRs |\n|---|---|---|\n' +
      closures
        .map(
          (c) =>
            `| [${c.heading}](gates/${c.anchor}.md) | ${c.rulings.length} | ${c.records.length} |`,
        )
        .join('\n'),
  );

  write(MAP, JSON.stringify(map, null, 2) + '\n');

  console.log(
    `${adrs.length} ADR files, ${closures.length} gate-closure files ` +
      `(${closures.reduce((n, c) => n + c.rulings.length, 0)} rulings kept inside them), ` +
      'ALLOCATION.md, README.md',
  );
  console.log(
    `map: ${Object.keys(map.anchors).length} anchors, ${Object.keys(map.ids).length} ids`,
  );
  return 0;
}

function main() {
  const cmd = process.argv[2];
  if (cmd === 'split') return split();
  if (cmd === 'map') {
    if (!existsSync(join(ROOT, MAP))) {
      console.error('no map yet; run `split` first');
      return 2;
    }
    process.stdout.write(readFileSync(join(ROOT, MAP), 'utf8'));
    return 0;
  }
  console.error('usage: node scripts/corpus/split-decisions.mjs split | map');
  return 2;
}

process.exit(main());
