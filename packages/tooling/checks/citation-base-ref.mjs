// =============================================================================
// packages/tooling/checks/citation-base-ref.mjs
// =============================================================================
// AN ENTRY THAT PUBLISHES A SOURCE `file:line` NAMES THE TREE IT READ, AND THIS
// ASSERTS IT FORWARD ONLY.
//
//   node packages/tooling/checks/citation-base-ref.mjs
//
// `ADR-473` section 10 item 3 is the whole of the motivation and it is quoted
// rather than paraphrased:
//
//   "A PUBLISHED LIST THAT DOES NOT NAME ITS TREE IS A LIST NOBODY CAN
//    CLASSIFY, AND 228 OF 280 ENTRIES ARE IN THAT STATE. Price: an entry
//    publishing a `file:line` list names the ref the list was compiled against,
//    beside the list."
//
// A published `file:line` is a claim about a file at an instant. Read against a
// later worktree it lands wherever the edits since put it, and the reader has no
// way to tell which reading the author meant. `ADR-473` section 5 measured the
// cost on the only sub-population where both readings are available: 80 of 718
// sites, 11.1 percent, classify differently at the entry's own ref than at the
// worktree, and the disagreement runs in both directions.
//
// -----------------------------------------------------------------------------
// WHY THIS IS A GATE WHERE `ADR-473` SECTION 4 REFUSED ONE
// -----------------------------------------------------------------------------
// That entry refused a gate that would CLASSIFY published sites. This one
// asserts only that the author said which tree they read. The two refusals do
// not transfer, and each is worth stating separately:
//
//   ADR-473's FIRST GROUND was that a path-keyed harvester sees `ADR-469`
//   section 10 item 1's thirteen sites as ONE, because the corpus writes a path
//   once and then a run of bare `:NNN` tokens. That is fatal to ENUMERATING a
//   list and harmless to DETECTING that an entry published one. This check needs
//   one site per entry and the dominant form supplies it.
//
//   ADR-473's SECOND GROUND was that a gate has no ref to read at. This check
//   opens no source file and resolves no ref. It reads `docs/decisions/` and
//   nothing else, so the ground has nothing to bite on.
//
//   ADR-473's THIRD GROUND was scale: 1,678 undischargeable findings inside
//   dated records. Keyed forward, this check's finding count inside dated
//   records is zero by construction, and `legGrandfatheredIsPinned` is what
//   makes that a measured claim rather than a hope.
//
// -----------------------------------------------------------------------------
// THE KEY IS THE ADR NUMBER, AND GIT HISTORY WAS REFUSED ON A MEASUREMENT
// -----------------------------------------------------------------------------
// The obvious key for "newer than a stated ref" is the file's add-commit. IT IS
// NOT AVAILABLE AND IT FAILS SILENTLY, WHICH IS WORSE THAN BEING UNAVAILABLE.
//
//   `.github/workflows/ci.yml` runs this repository's suites in CI-02 under a
//   bare `actions/checkout@v4`, which is a clone one commit deep. Only CI-05
//   asks for `fetch-depth: 0`, and its own comment says why: "a shallow clone
//   has no history to scan. The gate would pass by being unable" to read it.
//
//   In a shallow clone `git log --diff-filter=A` does not fail. It answers with
//   the graft. Measured in the session that wrote this file, on a clone 567
//   commits deep, `ADR-001.md` and `ADR-100.md` both reported an add-commit
//   dated 2026-09-05, which is the shallow boundary and not their date. 457 of
//   457 entries got an answer and every answer older than the graft was wrong.
//
// SO THE KEY IS THE NUMBER IN THE FILENAME. It costs no history, it is the same
// on every clone, and this corpus already spends real effort keeping it monotone
// and unique: `ALLOCATION.md`, `ADR-034` and `CI-06f` exist for that and nothing
// else. An entry's number IS its position in the sequence, already enforced.
//
// A COROLLARY THAT IS DELIBERATE: THIS CHECK'S VERDICT MUST NOT DEPEND ON HOW
// CI CLONED. It would be one cheap line to resolve a named base with
// `git cat-file -e` and report the ones that do not resolve. That is refused.
// Two of the entries above the cutoff name a base this session's clone cannot
// resolve, and a red that appears on a shallow clone and vanishes on a deep one
// is a red about the runner.
//
// -----------------------------------------------------------------------------
// THE CUTOFF IS DERIVED FROM THE TREE, NOT CHOSEN
// -----------------------------------------------------------------------------
// `CUTOFF` is one above the highest-numbered entry that publishes a source
// `file:line` and names no base. That entry is `ADR-416`, which publishes one
// site, and `legCutoffIsTightest` asserts it is still there so the cutoff cannot
// be raised to walk away from a finding.
//
// WHAT THAT BUYS IS THE ONLY REASON THIS IS WORTH MINTING. Above the cutoff the
// practice is already universal and nothing enforces it: at the base this landed
// on, every one of the 45 publishing entries from `ADR-417` up names a base, 45
// of 45, over 57 consecutive numbers. THIS CHECK INVENTS NO PRACTICE. It pins one
// the corpus arrived at on its own and has never been told to keep.
//
// -----------------------------------------------------------------------------
// WHY THE GRANDFATHERED COUNTS ARE PINNED
// -----------------------------------------------------------------------------
// Every finding this check can raise is an ABSENCE, and an absence check whose
// population has quietly emptied reports PASS in silence. That is the defect
// `strip-comments.mjs`'s header names and `ADR-274` warns about, and a
// forward-keyed check is the easiest place in this corpus to commit it: break
// the harvest and the forward population becomes zero and everything is green.
//
// `legGrandfatheredIsPinned` is the answer and its shape is taken rather than
// invented, from `tree-input-budget.mjs`, which asserts the budgeted cases AND
// the unbudgeted ones. Below the cutoff every entry is a dated record that no
// commit may edit (`ADR-386`:169), so the two numbers are frozen for good. If
// the harvest breaks, they move, and this check goes red on the half of the
// population that cannot change rather than on the half that can.
//
// -----------------------------------------------------------------------------
// WHAT THIS DOES NOT ASSERT, WRITTEN DOWN BEFORE ANYBODY ASKS
// -----------------------------------------------------------------------------
// IT DOES NOT ASSERT `ADR-473` SECTION 10 ITEM 1's SPLIT. `ADR-475` section 6
// refuses that gate and prices what would make it mintable. Nothing here reads a
// verdict, calls `repairable-sites.mjs`, or opens a source file.
//
// IT DOES NOT ASSERT ITEM 3's STRONGER FORM, WHICH IS "BESIDE THE LIST". Every
// entry above the cutoff names its base in its OPENING LINES and not one names
// it beside a list, so a gate on the stronger form would be red on 45 entries
// that cannot be edited. What is enforced here is the practice that exists.
//
// IT CANNOT TELL A REAL BASE FROM A PLAUSIBLE ONE. A commit-shaped token behind
// one of `NAMING`'s words passes, whether or not it is the tree the author read,
// and no test over one file's text can do better. That is `write-guard-set.mjs`
// leg D's limit arriving here in the same words: this converts an unwritten
// convention into a written one with a tripwire on it, and that is the whole of
// the claim. WHAT THE ADJACENCY TEST DOES BUY IS MEASURED RATHER THAN CLAIMED:
// it is the difference between crediting `ADR-228`'s `9223372036854775807` as a
// base and not.
//
// IT SEES ONLY WHAT THE HARVEST SEES. `sitesIn` reads the three shapes this
// corpus writes. An entry publishing a source pointer in a fourth shape is
// invisible, and would escape the forward leg. `legDerivationIsReal` bounds that
// by refusing to run on a harvest that found nothing.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { READABLE } from './repairable-sites.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The corpus this check reads, and the only directory it opens. */
export const DECISIONS = resolve(HERE, '../../../docs/decisions');

/** A numbered decision entry. `ADR-D1.md` and the registries are not entries. */
export const ENTRY = /^ADR-(\d+)\.md$/;

/**
 * The first entry number the forward leg judges.
 *
 * DERIVED AND NOT CHOSEN: one above `ADR-416`, the highest-numbered entry that
 * publishes a source site and names no base. `legCutoffIsTightest` holds it
 * there.
 */
export const CUTOFF = 417;

/**
 * How much of an entry counts as its opening.
 *
 * The corpus's shape is a title line, a blank, then a bolded provenance
 * paragraph naming the branch, the base and the session. Six lines covers it
 * with room and stops short of the first section.
 */
export const OPENING_LINES = 6;

/** A commit-shaped token. Abbreviations in this corpus run from 7 characters. */
export const COMMITISH = /[0-9a-f]{7,40}/g;

/**
 * The words this corpus puts in front of the base it read.
 *
 * DERIVED AND NOT IMAGINED. Over the 53 entries whose opening lines carry a
 * commit-shaped token at the base this landed on, the word immediately before it
 * is `at` 40 times, `off` 9 times, and `commit` and `from` once each. The two
 * remaining entries are `ADR-217`, whose token follows `since`, and `ADR-228`,
 * whose token is `9223372036854775807` following `naming`, which is a `bigint`
 * ceiling and not a commit at all.
 *
 * SO THE ADJACENCY TEST IS WHAT SEPARATES A BASE FROM A CARDINAL, and this is
 * `ADR-467` section 9's ruling taken rather than re-argued: "What IS
 * mechanically decidable is adjacency, whether a number sits against its
 * filename ... The productive line is not use against mention. It is adjacent
 * against non-adjacent." A hex-shaped token alone is not a claim about a tree. A
 * hex-shaped token behind `off` is.
 *
 * THE COST IS STATED: an entry writing "based on `abc1234`" gets a red, and the
 * repair is one word. That is a red every commit it can judge is able to
 * discharge, which is the whole test this check was minted against.
 */
export const NAMING = ['at', 'off', 'from', 'commit'];

/**
 * The base an entry names, or `null`.
 *
 * @param {string} opening
 * @returns {string | null}
 */
export function baseNamedIn(opening) {
  for (const match of opening.matchAll(COMMITISH)) {
    const before = opening.slice(0, match.index);
    const word = /([A-Za-z]+)[^A-Za-z]*$/.exec(before)?.[1];
    if (word !== undefined && NAMING.includes(word.toLowerCase())) return match[0];
  }
  return null;
}

/**
 * The population below `CUTOFF`, pinned.
 *
 * Every member is a dated record that `ADR-386`:169 forbids repairing, so both
 * numbers are frozen. They are here to make an emptied harvest go red rather
 * than green.
 */
export const GRANDFATHERED = { publishing: 239, unnamed: 233 };

/**
 * @typedef {{ path: string, line: number }} Site
 * @typedef {{ number: number, file: string, sites: number, base: string | null }} Entry
 */

/**
 * Blank every fenced block, keeping every offset.
 *
 * A QUOTATION OF A POINTER IS NOT A PUBLICATION OF ONE, which is
 * `price-register.mjs`'s ruling about its own idiom applied to this population.
 * THE MASK IS DELIBERATELY NARROWER THAN THAT ONE and the difference is the
 * point: it blanks fences and leaves inline code spans alone, because this
 * corpus writes almost every pointer it publishes inside backticks. Masking
 * those would leave a harvest of nearly nothing.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function maskedLines(text) {
  let fenced = false;
  return text.split('\n').map((line) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return ' '.repeat(line.length);
    }
    return fenced ? ' '.repeat(line.length) : line;
  });
}

/**
 * A path as an entry writes it, resolved repo-relative, or `null`.
 *
 * TWO SPELLINGS AND THEY ARE NOT THE SAME PATH. A LINK TARGET is relative to
 * the entry, which sits two directories down, so `../../packages/x.ts` is
 * `packages/x.ts`. A BARE POINTER IS ALREADY REPO-RELATIVE: this corpus writes
 * `apps/api/test/wiring.test.ts:434` meaning that path from the root, and
 * resolving it against `docs/decisions/` would invent
 * `docs/decisions/apps/api/...`, which is a path no entry meant and no file is.
 * Both readings pass an extension test, so the error is invisible to every leg
 * here and would surface only in a later reader that opened the file. This
 * suite's `a bare repo-relative path:line is a site` is what found it.
 *
 * An absolute path or a URL is not a site.
 *
 * @param {string} target
 * @param {{ relativeToEntry?: boolean }} [options]
 * @returns {string | null}
 */
export function repoRelative(target, options = {}) {
  const clean = target.replace(/^<|>$/g, '').split('#')[0] ?? '';
  if (clean === '' || /^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith('/')) return null;
  if (options.relativeToEntry !== true && !clean.startsWith('.')) return clean;
  const full = resolve('/-/docs/decisions', clean);
  return full.startsWith('/-/') ? full.slice(3) : null;
}

/**
 * Every source `file:line` on one line of prose.
 *
 * THE THREE SHAPES ARE THE ONES THE CORPUS ACTUALLY WRITES, which is
 * `ADR-473` section 5's population taken rather than re-derived:
 *
 *   A  a markdown link whose target is the path and whose label carries the
 *      line, or whose target carries a `#Lnnn`
 *   B  a markdown link followed by a backticked `:NNN`
 *   C  a bare repo-relative `path.ext:NNN`
 *
 * `READABLE` is imported from `repairable-sites.mjs` rather than restated. The
 * population this check guards has to be the population that instrument reads,
 * and two copies of that extension list is how they stop being the same thing.
 *
 * @param {string} line
 * @returns {Site[]}
 */
export function sitesIn(line) {
  /** @type {Site[]} */
  const out = [];
  const link = /\[([^\]]*)\]\(([^)\s]+?)(?:#L(\d+))?\)(?:\s*`?:(\d+)`?)?/g;
  for (const match of line.matchAll(link)) {
    const label = (match[1] ?? '').replace(/`/g, '');
    const inLabel = /[:#]L?(\d+)\s*$/.exec(label);
    const found = match[3] ?? match[4] ?? inLabel?.[1];
    if (found === undefined) continue;
    const path = repoRelative(match[2] ?? '', { relativeToEntry: true });
    if (path !== null) out.push({ path, line: Number(found) });
  }
  const bare =
    /(?<![\w/.-])((?:\.\.\/)*[A-Za-z0-9_][A-Za-z0-9._/-]*\/[A-Za-z0-9._-]+\.[A-Za-z]+)[:#]L?(\d+)/g;
  for (const match of line.matchAll(bare)) {
    const path = repoRelative(match[1] ?? '');
    if (path !== null) out.push({ path, line: Number(match[2] ?? '0') });
  }
  // DEDUPED WITHIN THE LINE. A link written `path.ts#L473` matches shape A and
  // shape C at once, and one pointer counted twice is one pointer.
  const kept = out.filter((site) => READABLE.test(site.path) && site.line >= 1);
  return [...new Map(kept.map((site) => [`${site.path}:${String(site.line)}`, site])).values()];
}

/**
 * Every numbered entry, with how many source sites it publishes and the base it
 * names.
 *
 * TAKES A DIRECTORY SO THE SUITE CAN WATCH THIS RED. The default is the real
 * corpus; the suite hands it a fabricated one, which is the only way to seed a
 * missing base without editing a dated record.
 *
 * @param {string} [dir]
 * @returns {Entry[]}
 */
export function derive(dir = DECISIONS) {
  /** @type {Entry[]} */
  const entries = [];
  for (const name of readdirSync(dir).sort()) {
    const numbered = ENTRY.exec(name);
    if (numbered === null) continue;
    const text = readFileSync(resolve(dir, name), 'utf8');
    /** @type {Set<string>} */
    const sites = new Set();
    for (const line of maskedLines(text)) {
      for (const site of sitesIn(line)) sites.add(`${site.path}:${String(site.line)}`);
    }
    const opening = text.split('\n').slice(0, OPENING_LINES).join('\n');
    entries.push({
      number: Number(numbered[1]),
      file: name,
      sites: sites.size,
      base: baseNamedIn(opening),
    });
  }
  return entries;
}

/** The entries this check has an opinion about: the ones that publish. */
export const publishing = (/** @type {readonly Entry[]} */ entries) =>
  entries.filter((entry) => entry.sites > 0);

/**
 * LEG A THROWS RATHER THAN REPORTING, because every finding below is an ABSENCE
 * and an absence check over an empty scope reports PASS in silence.
 *
 * @param {readonly Entry[]} entries
 */
export function legDerivationIsReal(entries) {
  if (entries.length === 0) throw new Error(`no numbered entry found under ${DECISIONS}`);
  const publishers = publishing(entries);
  if (publishers.length === 0) {
    throw new Error(
      'no entry publishes a source file:line, so the harvest has stopped reading pointers ' +
        'and this check is asserting nothing (ADR-274)',
    );
  }
  if (publishers.every((entry) => entry.number < CUTOFF)) {
    throw new Error(
      `no publishing entry at or above ADR-${String(CUTOFF)}, so the forward leg has an empty ` +
        'population and passes by seeing nothing',
    );
  }
  if (publishers.every((entry) => entry.number >= CUTOFF)) {
    throw new Error(
      `no publishing entry below ADR-${String(CUTOFF)}, so the pin has an empty population and ` +
        'cannot catch an emptied harvest',
    );
  }
}

/**
 * LEG B. THE FORWARD ASSERTION, AND THE ONLY LEG A FUTURE ENTRY CAN BREAK.
 *
 * @param {readonly Entry[]} entries
 * @returns {string[]}
 */
export function legForwardNamesItsTree(entries) {
  return publishing(entries)
    .filter((entry) => entry.number >= CUTOFF && entry.base === null)
    .map(
      (entry) =>
        `${entry.file} publishes ${String(entry.sites)} source file:line site(s) and names no ` +
        `base commit in its first ${String(OPENING_LINES)} line(s), behind one of ` +
        `${NAMING.map((word) => `\`${word}\``).join(', ')}. A published pointer is a ` +
        'claim about a file at an instant, and 11.1 percent of them classify differently at the ' +
        "entry's own ref than at the worktree (ADR-473 section 5). Name the base you read",
    );
}

/**
 * LEG C. THE GRANDFATHERED POPULATION IS PINNED, so an emptied harvest is red.
 *
 * @param {readonly Entry[]} entries
 * @returns {string[]}
 */
export function legGrandfatheredIsPinned(entries) {
  const older = publishing(entries).filter((entry) => entry.number < CUTOFF);
  const unnamed = older.filter((entry) => entry.base === null).length;
  /** @type {string[]} */
  const out = [];
  if (older.length !== GRANDFATHERED.publishing) {
    out.push(
      `${String(older.length)} entry(ies) below ADR-${String(CUTOFF)} publish a source ` +
        `file:line and the pin says ${String(GRANDFATHERED.publishing)}. Every one of them is a ` +
        'dated record no commit may repair (ADR-386:169), so this number cannot move by an ' +
        'edit to the corpus. It moved because the harvest changed',
    );
  }
  if (unnamed !== GRANDFATHERED.unnamed) {
    out.push(
      `${String(unnamed)} of them name no base and the pin says ` +
        `${String(GRANDFATHERED.unnamed)}. Same reason, same conclusion`,
    );
  }
  return out;
}

/**
 * LEG D. THE CUTOFF IS THE TIGHTEST THE TREE SUPPORTS.
 *
 * Without this leg the cheapest way past leg B is to raise `CUTOFF` above the
 * entry that failed. With it, raising the cutoff requires the entry immediately
 * below the new one to publish and name nothing, which no entry above `ADR-416`
 * does or now can.
 *
 * @param {readonly Entry[]} entries
 * @returns {string[]}
 */
export function legCutoffIsTightest(entries) {
  const below = publishing(entries).find((entry) => entry.number === CUTOFF - 1);
  if (below !== undefined && below.base === null) return [];
  return [
    `ADR-${String(CUTOFF - 1)} is not a publishing entry that names no base, so ` +
      `ADR-${String(CUTOFF)} is not the tightest cutoff this tree supports. The cutoff is one ` +
      'above the highest-numbered entry that publishes a source site and names no tree, and it ' +
      'is derived rather than chosen so that it cannot be raised to walk away from a finding',
  ];
}

const emit = (/** @type {string} */ line) => {
  console.log(line);
};

/**
 * @param {string[]} [argv]
 * @returns {number} Process exit code.
 */
export function run(argv = []) {
  if (argv.length > 0) {
    emit('usage: node packages/tooling/checks/citation-base-ref.mjs');
    emit('It takes no argument. Every input it has is derived from the tree on the run.');
    return 2;
  }

  const entries = derive();
  legDerivationIsReal(entries);

  const findings = [
    ...legForwardNamesItsTree(entries),
    ...legGrandfatheredIsPinned(entries),
    ...legCutoffIsTightest(entries),
  ];

  const publishers = publishing(entries);
  const forward = publishers.filter((entry) => entry.number >= CUTOFF);
  const older = publishers.filter((entry) => entry.number < CUTOFF);

  if (findings.length === 0) {
    emit(
      `PASS   ${String(forward.length)} entry(ies) at or above ADR-${String(CUTOFF)} publish a ` +
        `source file:line and every one names its base; ${String(older.length)} below it publish ` +
        `one too and ${String(GRANDFATHERED.unnamed)} of those name none, which is the ` +
        'grandfathered population and it is pinned rather than repaired (ADR-386:169); ' +
        `ADR-${String(CUTOFF - 1)} still holds the cutoff down`,
    );
    return 0;
  }

  emit(`FAIL   a published list does not name its tree (${String(findings.length)})`);
  for (const finding of findings) emit(`       ${finding}`);
  emit('');
  emit(
    'THE POPULATION IS DERIVED FROM docs/decisions ON EVERY RUN AND THE KEY IS THE ENTRY ' +
      'NUMBER. Nothing below the cutoff is asked to change: those are dated records and ' +
      'ADR-386:169 rules that a pointer in one is NAMED rather than repaired. If a finding ' +
      'names your entry, the repair is one commit-shaped token in its opening lines.',
  );
  return 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(run(process.argv.slice(2)));
