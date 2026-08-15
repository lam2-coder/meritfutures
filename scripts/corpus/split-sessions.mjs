#!/usr/bin/env node
// =============================================================================
// scripts/corpus/split-sessions.mjs
// =============================================================================
// Stages 4 and 5 of ADR-043, in one script because they are one shape:
//
//   node scripts/corpus/split-sessions.mjs sessions   SESSION_LOG.md   -> docs/sessions/
//   node scripts/corpus/split-sessions.mjs golden     GOLDEN_SCENARIOS -> docs/testing/golden-scenarios/
//
// BOTH SPLIT ON `## ` AND NEITHER HAS A SECOND SHAPE INSIDE IT, which is what
// makes one script honest here and made three scripts necessary before. The
// earlier registries each carried a structure the others did not (gate closures,
// a table battery, a table-record predicate a gate also owns); these two do not.
//
// SESSION_LOG is per entry. It is the purest append-only registry in the corpus:
// every session adds exactly one entry at the end, so every session collides.
//
// GOLDEN_SCENARIOS is PER SECTION, per ADR-043. 257 identifiers live as 301 TABLE
// ROWS across 33 sections. A row is not a document; per-entry would produce 257
// files whose whole content is one row, and the batteries (GS-030 to GS-051, the
// Appendix B4 set; GS-246 to GS-255, the D0 attack set) only mean anything read
// together. Sections are also the boundary at which sessions actually append.
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const CONFIG = {
  sessions: {
    src: 'docs/SESSION_LOG.md',
    out: 'docs/sessions',
    title: 'SESSION LOG',
    lead:
      'Append-only handoff journal (C3 ritual), one file per session since\n' +
      '[ADR-043](../decisions/ADR-043.md). Newest entry last. A session that dies mid-task\n' +
      'must be recoverable from its own file alone.',
    depends: '[]',
    // `## 2026-08-13 - Session 1: skeleton (section 0.5)`
    name: (h) => {
      const m = /^(\d{4}-\d{2}-\d{2})\s*-\s*Session\s+(\d+)\b/.exec(h);
      if (!m) return null;
      return `${m[1]}-session-${m[2].padStart(2, '0')}`;
    },
    id: (h) => {
      const m = /Session\s+(\d+)\b/.exec(h);
      return m ? `Session ${Number(m[1])}` : null;
    },
  },
  golden: {
    src: 'docs/testing/GOLDEN_SCENARIOS.md',
    out: 'docs/testing/golden-scenarios',
    title: 'GOLDEN SCENARIOS',
    lead:
      'The fixture registry, one file per SECTION since [ADR-043](../../decisions/ADR-043.md).\n' +
      'Per section rather than per entry because 257 identifiers live as 301 table rows: a\n' +
      'row is not a document, and the batteries only mean anything read together.',
    depends: '[../../decisions/README.md, ../../edge-cases/README.md]',
    // `## 4. GS-030 to GS-051: the Appendix B4 battery`
    name: (h) => {
      const m = /^(\d+)\.\s*(.*)$/.exec(h);
      if (!m) return null;
      const rest = m[2]
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 60)
        .replace(/-+$/, '');
      return `${m[1].padStart(2, '0')}-${rest}`;
    },
    id: () => null,
    // Per-section files still resolve a PER-ENTRY citation, and they have to:
    // the corpus writes `[GS-179](../testing/GOLDEN_SCENARIOS.md)`, and under
    // ADR-043 there is no GS-179.md to point at. Every GS identifier appearing in
    // a section maps to that section's file, so a link to one entry lands on the
    // table that defines it rather than on a README the reader must then search.
    // This is what makes "per section" a filing decision rather than a loss of
    // resolution.
    ids: (text) => [...text.matchAll(/\b(GS-\d{3})\b/g)].map((m) => m[1]),
  },
};

function slug(heading) {
  return heading
    .replace(/<[^>]+>/g, '')
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/ /g, '-');
}

function split(cfg) {
  const lines = readFileSync(join(ROOT, cfg.src), 'utf8').split('\n');
  const map = { anchors: {}, ids: {} };
  const entries = [];
  let cur = null;
  let fenced = false;
  let first = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      if (cur) cur.lines.push(line);
      continue;
    }
    if (!fenced && /^## /.test(line)) {
      if (first === -1) first = i;
      if (cur) entries.push(cur);
      cur = { heading: line.replace(/^## /, ''), lines: [] };
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) entries.push(cur);
  if (first === -1) throw new Error(`${cfg.src} has no ## sections outside a fence`);
  if (entries.length === 0) throw new Error(`${cfg.src} parsed no entries; refusing to split`);

  const seen = new Set();
  for (const e of entries) {
    const base = cfg.name(e.heading);
    if (!base) {
      throw new Error(
        `"${e.heading}" does not match this registry's entry form. Every section matched ` +
          'when this was written; a new shape needs a ruling rather than a guess.',
      );
    }
    // A duplicate filename would silently drop one entry into another. Two
    // sections numbered `33.2` already exist inside GOLDEN_SCENARIOS, which is
    // the corpus demonstrating the failure mode at the level below this one.
    if (seen.has(base)) throw new Error(`two entries would both be written to ${base}.md`);
    seen.add(base);
    e.file = `${cfg.out}/${base}.md`;
    map.anchors[slug(e.heading)] = e.file;
    const id = cfg.id(e.heading);
    if (id) map.ids[id] = e.file;
    if (cfg.ids) {
      const body = `## ${e.heading}\n${e.lines.join('\n')}`;
      for (const x of cfg.ids(body)) {
        // First section wins: the numbering map in section 1 lists identifiers
        // that are DEFINED later, and pointing every citation at the map instead
        // of at the definition would be resolution lost for no reason.
        if (!map.ids[x]) map.ids[x] = e.file;
      }
    }
    // Sub-headings travel with their section, so the file changes and the
    // fragment does not.
    let f = false;
    for (const l of e.lines) {
      if (/^\s*```/.test(l)) {
        f = !f;
        continue;
      }
      if (f) continue;
      const m = /^#{3,6}\s+(.*?)\s*$/.exec(l);
      if (m) map.anchors[slug(m[1])] = e.file;
    }
  }

  const write = (rel, content) => {
    mkdirSync(join(ROOT, dirname(rel)), { recursive: true });
    writeFileSync(join(ROOT, rel), content.replace(/\n*$/, '\n'));
  };
  for (const e of entries) {
    write(e.file, `## ${e.heading}\n${e.lines.join('\n')}`.replace(/\n+$/, ''));
  }

  const preamble = lines.slice(0, first).join('\n');
  write(
    `${cfg.out}/README.md`,
    `---\nstatus: approved\ndepends_on: ${cfg.depends}\nlast_updated: 2026-08-15\n---\n\n` +
      `# ${cfg.title}\n\n` +
      preamble
        .replace(/^---\n[\s\S]*?\n---\n/, '')
        .replace(new RegExp(`^\\s*# ${cfg.title}[^\\n]*\\n`, 'm'), '')
        .trim() +
      `\n\n${cfg.lead}\n\n## Entries\n\n| | |\n|---|---|\n` +
      entries
        .map((e) => `| [${e.heading.split(':')[0]}](${e.file.replace(`${cfg.out}/`, '')}) | ${e.heading.includes(':') ? e.heading.split(':').slice(1).join(':').trim() : ''} |`)
        .join('\n'),
  );

  write(`${cfg.out}/.map.json`, JSON.stringify(map, null, 2) + '\n');
  console.log(`${entries.length} entry files, README.md`);
  console.log(`map: ${Object.keys(map.anchors).length} anchors, ${Object.keys(map.ids).length} ids`);
  return 0;
}

const which = process.argv[2];
if (!CONFIG[which]) {
  console.error(`usage: node scripts/corpus/split-sessions.mjs <${Object.keys(CONFIG).join('|')}>`);
  process.exit(2);
}
process.exit(split(CONFIG[which]));
