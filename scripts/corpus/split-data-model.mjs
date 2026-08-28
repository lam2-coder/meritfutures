#!/usr/bin/env node
// =============================================================================
// scripts/corpus/split-data-model.mjs
// =============================================================================
// Stage 3 of ADR-043: docs/architecture/DATA_MODEL.md becomes
// docs/architecture/data-model/. The second-worst collision surface, 96 tables.
//
//   node scripts/corpus/split-data-model.mjs
//
// SAME RULE, THIRD SHAPE. This document is a design record per table wrapped in
// ten domain sections and seven prose sections:
//
//   * `### <snake_case>` under sections 2 to 10 -> ONE FILE EACH. These are the
//     96 design records, one per table, and they are what every branch appends to.
//   * Sections 1 and 11 to 17 -> the README. Conventions, the plan-config schema,
//     the invariant table, migration policy, retention, founder rulings and delta
//     provenance are documents about the whole model rather than about a table.
//   * The domain sections' own prose -> the README, as the heading each group of
//     tables is indexed under, so "which tables are the spine" survives.
//
// WHAT DEFINES AN ENTRY IS CI-06i'S OWN REGEX, `^### ([a-z][a-z0-9_]*)$`, reused
// here verbatim. That gate asserts DATA_MODEL and the migrations name the same
// table set, so if this script's idea of "a table section" differed from the
// gate's by even one heading, the split would move a record the gate then reports
// as missing. Section 17's `### Verification performed` is exactly the heading
// that separates the two readings, and it stays in the README because it does not
// match.
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = 'docs/architecture/DATA_MODEL.md';
const OUT = 'docs/architecture/data-model';
const MAP = 'docs/architecture/data-model/.map.json';

// CI-06i's predicate, verbatim. See the header for why it is copied rather than
// approximated.
const TABLE_HEADING = /^### ([a-z][a-z0-9_]*)\s*$/;

function slug(heading) {
  return heading
    .replace(/<[^>]+>/g, '')
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/ /g, '-');
}

function split() {
  const lines = readFileSync(join(ROOT, SRC), 'utf8').split('\n');
  const map = { anchors: {}, ids: {} };
  const sections = [];
  const tables = [];
  let fenced = false;
  let preambleEnd = -1;
  let section = null;
  let table = null;

  const push = (l) => {
    if (table) table.lines.push(l);
    else if (section) section.lines.push(l);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      push(line);
      continue;
    }
    if (!fenced) {
      const h2 = /^## (.*)$/.exec(line);
      const t = TABLE_HEADING.exec(line);
      if (h2) {
        if (preambleEnd === -1) preambleEnd = i;
        table = null;
        section = { heading: h2[1], lines: [], tables: [] };
        sections.push(section);
        map.anchors[slug(h2[1])] = `${OUT}/README.md`;
        continue;
      }
      if (t) {
        if (!section) throw new Error(`table section "${t[1]}" appears before any ## section`);
        const file = `${OUT}/${t[1]}.md`;
        if (map.ids[t[1]]) {
          // CI-06i reports a duplicate `### <table>` as a finding. A splitter that
          // silently overwrote one with the other would REPAIR that defect by
          // deleting evidence of it, so it refuses instead.
          throw new Error(`two \`### ${t[1]}\` sections; CI-06i calls that a finding, not a merge`);
        }
        table = { name: t[1], file, lines: [] };
        tables.push(table);
        section.tables.push(table);
        map.anchors[slug(t[1])] = file;
        map.ids[t[1]] = file;
        continue;
      }
      // A non-table `###` (e.g. `### Verification performed`) belongs to its
      // section's prose, and closes any open table record.
      if (/^#{3,6} /.test(line)) {
        table = null;
        map.anchors[slug(line.replace(/^#+\s+/, ''))] = `${OUT}/README.md`;
      }
    }
    push(line);
  }

  if (tables.length === 0) throw new Error('no `### <table>` sections parsed; refusing to split');
  if (preambleEnd === -1) throw new Error('DATA_MODEL.md has no ## sections outside a fence');

  const write = (rel, content) => {
    mkdirSync(join(ROOT, dirname(rel)), { recursive: true });
    writeFileSync(join(ROOT, rel), content.replace(/\n*$/, '\n'));
  };
  for (const t of tables) {
    write(t.file, `### ${t.name}\n${t.lines.join('\n')}`.replace(/\n+$/, ''));
  }

  const preamble = lines.slice(0, preambleEnd).join('\n');
  write(
    `${OUT}/README.md`,
    '---\nstatus: approved\ndepends_on: [../../decisions/README.md, OVERVIEW.md]\nlast_updated: 2026-08-15\n---\n\n' +
      '# DATA MODEL\n\n' +
      preamble
        .replace(/^---\n[\s\S]*?\n---\n/, '')
        .replace(/^\s*# DATA MODEL[^\n]*\n/m, '')
        .trim() +
      '\n\nSplit to a file per table on 2026-08-15 by [ADR-043](../../decisions/ADR-043.md).\n' +
      'Each `### <table>` design record is its own file; the conventions, the plan-config\n' +
      'schema, the invariant table, migration policy, retention, the founder rulings and\n' +
      'the delta provenance stay here, because they are about the whole model rather than\n' +
      'about a table.\n\n' +
      sections
        .map((s) => {
          const prose = s.lines
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
          const index = s.tables.length
            ? `\n\n| Table | |\n|---|---|\n${s.tables.map((t) => `| [\`${t.name}\`](${t.name}.md) | |`).join('\n')}`
            : '';
          return `## ${s.heading}\n\n${prose}${index}`;
        })
        .join('\n\n'),
  );

  write(MAP, JSON.stringify(map, null, 2) + '\n');
  console.log(`${tables.length} table files across ${sections.length} sections, README.md`);
  console.log(
    `map: ${Object.keys(map.anchors).length} anchors, ${Object.keys(map.ids).length} ids`,
  );
  return 0;
}

process.exit(split());
