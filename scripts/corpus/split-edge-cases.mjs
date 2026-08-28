#!/usr/bin/env node
// =============================================================================
// scripts/corpus/split-edge-cases.mjs
// =============================================================================
// Stage 2 of ADR-043: docs/EDGE_CASES.md becomes docs/edge-cases/.
//
//   node scripts/corpus/split-edge-cases.mjs split
//
// SAME RULE AS STAGE 1, DIFFERENT SHAPE. Split what is appended to, keep together
// what is closed, never split a table a gate reads as a table:
//
//   * 119 block-form entries -> one file each. This is the appended registry.
//   * The Appendix B4 battery -> ONE file. It is 22 TABLE ROWS under a single
//     heading, mapping B4 item n to EC-(011+n) and GS-(029+n). A row is not a
//     document, the mapping only means anything read together, and CI-06e parses
//     the row form specifically. This is the same ruling ADR-043 makes for
//     GOLDEN_SCENARIOS sections, applied to the one battery living here.
//
// The battery is why this is not a loop over `## EC-nnn:`. A naive split on that
// heading produces a file for the battery HEADING and silently drops 22 entries
// into it, which reads as 120 files and one very large one.
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = 'docs/EDGE_CASES.md';
const OUT = 'docs/edge-cases';
const MAP = 'docs/edge-cases/.map.json';

// Copied from gates.mjs on 2026-08-15, deliberately, for the reason stage 1
// records: this must compute the anchor a link USED to resolve against.
function slug(heading) {
  return heading
    .replace(/<[^>]+>/g, '')
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/ /g, '-');
}

function parse() {
  const lines = readFileSync(join(ROOT, SRC), 'utf8').split('\n');
  const blocks = [];
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
    // The entry TEMPLATE lives inside a fence in the preamble. Splitting on it
    // makes a file called EC-NNN and takes the format documentation out of the
    // README that explains the format.
    if (!fenced && /^## /.test(line)) {
      if (first === -1) first = i;
      if (cur) blocks.push(cur);
      cur = { heading: line.replace(/^## /, ''), lines: [] };
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) blocks.push(cur);
  if (first === -1) throw new Error('EDGE_CASES.md has no ## sections outside a fence');
  return { preamble: lines.slice(0, first).join('\n'), blocks };
}

function split() {
  const { preamble, blocks } = parse();
  const map = { anchors: {}, ids: {} };
  const entries = [];
  const groups = [{ heading: null, lead: '', entries: [] }];
  let openGroup = groups[0];

  const claim = (a, f) => {
    if (map.anchors[a] && map.anchors[a] !== f) {
      throw new Error(`anchor "${a}" claimed by both ${map.anchors[a]} and ${f}`);
    }
    map.anchors[a] = f;
  };

  for (const b of blocks) {
    const anchor = slug(b.heading);
    const text = `## ${b.heading}\n${b.lines.join('\n')}`.replace(/\n+$/, '') + '\n';

    // The battery heading is matched BEFORE the single-entry form, because
    // `## EC-012 to EC-033: ...` also matches /^EC-(\d{3})/.
    const range = /^EC-(\d{3}) to EC-(\d{3}):/.exec(b.heading);
    if (range) {
      const file = `${OUT}/EC-${range[1]}-to-${range[2]}-appendix-b4-battery.md`;
      const ids = [];
      for (let n = Number(range[1]); n <= Number(range[2]); n++) {
        const id = `EC-${String(n).padStart(3, '0')}`;
        ids.push(id);
        map.ids[id] = file;
      }
      // Every row identifier resolves to the battery file, so a link to EC-020
      // lands on the table that defines it rather than on a file that does not
      // exist. THE ROWS ARE VERIFIED PRESENT rather than assumed: a range heading
      // whose table has lost rows would otherwise map identifiers to a file that
      // does not define them, which is exactly the silent-pass class.
      const present = new Set([...text.matchAll(/^\|\s*(EC-\d{3})\s*\|/gm)].map((m) => m[1]));
      const missing = ids.filter((id) => !present.has(id));
      if (missing.length) {
        throw new Error(
          `the battery heading claims ${ids[0]} to ${ids[ids.length - 1]} but its table has no ` +
            `row for: ${missing.join(', ')}`,
        );
      }
      const e = { kind: 'battery', file, heading: b.heading, ids, text };
      entries.push(e);
      openGroup.entries.push(e);
      claim(anchor, file);
      continue;
    }

    const one = /^EC-(\d{3}):/.exec(b.heading);
    if (!one) {
      // A PROVENANCE DIVIDER, e.g. `## Entries from M05 (payout system)`. Eight of
      // them, seven bare labels and one carrying a paragraph. They are not entries
      // and they are not containers either: the entries below them sit at the SAME
      // heading level, so the grouping is editorial rather than structural.
      //
      // It still carries real information (which module discovered this entry), so
      // it moves into the README index as a GROUP HEADING with its prose intact,
      // and the entries below it are listed under it. Dropping the headings and
      // keeping only a flat table would lose the one paragraph and the provenance
      // both; keeping them as files would create eight documents whose whole
      // content is a label.
      openGroup = { heading: b.heading, lead: b.lines.join('\n').trim(), entries: [] };
      groups.push(openGroup);
      claim(anchor, `${OUT}/README.md`);
      continue;
    }
    const id = `EC-${one[1]}`;
    const file = `${OUT}/${id}.md`;
    const e = { kind: 'entry', file, heading: b.heading, ids: [id], text };
    entries.push(e);
    openGroup.entries.push(e);
    claim(anchor, file);
    map.ids[id] = file;
  }

  const blockCount = entries.filter((e) => e.kind === 'entry').length;
  const batteries = entries.filter((e) => e.kind === 'battery');
  if (blockCount === 0) throw new Error('no EC entries parsed; refusing to split');
  if (batteries.length !== 1) {
    throw new Error(`expected exactly 1 Appendix B4 battery, parsed ${batteries.length}`);
  }

  const write = (rel, content) => {
    mkdirSync(join(ROOT, dirname(rel)), { recursive: true });
    writeFileSync(join(ROOT, rel), content.replace(/\n*$/, '\n'));
  };
  for (const e of entries) write(e.file, e.text);

  write(
    `${OUT}/README.md`,
    '---\nstatus: approved\ndepends_on: [../plans/M01-rules-engine.md, ../testing/GOLDEN_SCENARIOS.md, ../GLOSSARY.md, ../decisions/README.md]\nlast_updated: 2026-08-15\n---\n\n' +
      '# EDGE CASES (living registry)\n\n' +
      preamble
        .replace(/^---\n[\s\S]*?\n---\n/, '')
        .replace(/^\s*# EDGE CASES[^\n]*\n/m, '')
        .trim() +
      '\n\nSplit to a file per entry on 2026-08-15 by [ADR-043](../decisions/ADR-043.md). The\n' +
      'Appendix B4 battery stays one file because it is 22 table rows mapping B4 items to\n' +
      'edge cases and golden scenarios, and a row is not a document.\n\n' +
      groups
        .filter((g) => g.entries.length)
        .map((g) => {
          const row = (e) =>
            e.kind === 'battery'
              ? `| [${e.ids[0]} to ${e.ids[e.ids.length - 1]}](${e.file.replace(`${OUT}/`, '')}) | the Appendix B4 battery, 22 rows in one table |`
              : `| [${e.ids[0]}](${e.ids[0]}.md) | ${e.heading.split(':').slice(1).join(':').trim()} |`;
          return (
            `## ${g.heading ?? 'Entries'}\n\n` +
            (g.lead ? `${g.lead}\n\n` : '') +
            `| EC | Name |\n|---|---|\n${g.entries.map(row).join('\n')}`
          );
        })
        .join('\n\n'),
  );

  write(MAP, JSON.stringify(map, null, 2) + '\n');
  console.log(
    `${blockCount} entry files + 1 battery file (${batteries[0].ids.length} identifiers), README.md`,
  );
  console.log(
    `map: ${Object.keys(map.anchors).length} anchors, ${Object.keys(map.ids).length} ids`,
  );
  return 0;
}

process.exit(split());
