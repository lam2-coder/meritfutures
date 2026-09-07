// -----------------------------------------------------------------------------
// HOW MANY SENTENCES IN THIS TREE SAY THAT NOTHING CHECKS SOMETHING
// -----------------------------------------------------------------------------
// ADR-442. THIS FILE EXISTS BECAUSE THREE ROWS IN A ROW REPAIRED A SENTENCE THAT
// SAID A CHECK DID NOT EXIST, EACH PRICED A CONTROL FOR THE CLASS, AND ALL THREE
// PRICED IT AGAINST A POPULATION NOBODY HAD DERIVED.
//
//   ADR-434 found two false claims on one barrel, priced a control at seven
//   register entries, and refused it.
//
//   ADR-436 found two port headers claiming to import nothing while importing,
//   priced a registry at six rows, and recommended a row for it. It asked, in
//   its own recommendation, whether the registry should be scoped to six files
//   or to "every header in the tree that claims something about its own
//   imports, which is a survey nobody has run".
//
//   ADR-440 found the same class a third time, priced ITS control at one
//   artifact and five claim sites, recommended it, and wrote down the question
//   under all three: nobody has surveyed how many sentences in this tree claim
//   that no check does X, and that survey decides whether the control is one
//   artifact or a family.
//
// **THE THREE PRICES ARE THE FINDING AND THEY ARE WHY THIS FILE IS NOT A GATE.**
// Each row counted the sites its own grep reached. A grep reaches a LINE, the
// claims are written in WRAPPED comments, and one claim in this tree is spelled
// at least six different ways. Every price was therefore a floor presented as a
// figure, and the entry that priced most carefully was short by the most.
//
// -----------------------------------------------------------------------------
// IT IS AN INSTRUMENT AND NOT A GATE
// -----------------------------------------------------------------------------
// It is registered in no GATES array, it mints no `CI-06` letter and no `RI-nn`,
// and it asserts nothing: there is no threshold at which a count of these
// sentences is wrong. A tree that says out loud what its checks do NOT do is a
// tree behaving well, and a runner that failed on the number of such sentences
// would be answering a question nobody asked.
//
// **AND IT CANNOT TELL A TRUE CLAIM FROM A FALSE ONE, WHICH IS THE WHOLE REASON
// IT MUST NOT BECOME ONE.** Deciding a claim needs a probe over the thing it
// names, one per claim, written by somebody who read the sentence. This file
// reads GRAMMAR. A gate built on grammar alone would be satisfied by rewording,
// which turns an honest sentence into a liability and teaches the next author to
// write the claim in a shape the scanner does not know. That is the failure
// ADR-429 section 10 names: a static check that approximates the property it
// names is worse than the hole reported plainly.
//
// -----------------------------------------------------------------------------
// WHY IT REPORTS TWO GRAMMARS AND NOT ONE NUMBER
// -----------------------------------------------------------------------------
// "Says that nothing checks something" is a judgement about English and a single
// figure hides it. This file follows `covers-census.mjs` exactly here.
//
// NARROW is the sentences whose SUBJECT is this tree's own verification
// machinery, negated: `no check`, `no gate`, `no test`, `no invariant`, `no
// suite`, `no runner`, `no probe`, `no leg`, `no linter`, `no assertion`, `no
// reader`. Those nouns name nothing else in this corpus, so a NARROW hit is
// almost always a claim about coverage and the count is a FLOOR.
//
// WIDE adds the UNIVERSAL negatives, `nothing`, `nobody`, `no one`, and the
// negated adjectives, `unchecked`, `uncompared`, `unenforced` and their
// siblings. Those reach the claims NARROW cannot see -- the three sentences this
// row was commissioned over are universals, not machinery -- and they also reach
// a large body of sentences about the DOMAIN rather than the suite: a rule that
// fires for nobody, a default that serves nothing, a port that reads nothing.
// So WIDE is a CEILING, its excess is real and large, and a row handed either
// figure alone is being handed the wrong end of an interval.
//
// -----------------------------------------------------------------------------
// THE SENTENCE IS THE UNIT AND THE LINE IS NOT, WHICH IS THE ONE THING A GREP
// CANNOT DO
// -----------------------------------------------------------------------------
// A block comment wraps at the file's margin, so a claim's subject lands on one
// line and its verb on the next, and a line-oriented search sees neither half.
// Every price in the three entries above was taken with a line-oriented search.
// This file joins a contiguous comment run into one text, splits it into
// sentences, and matches within a sentence. THAT DIFFERENCE IS NOT COSMETIC: the
// entry that priced the class counted the live copies of one claim with a
// line-oriented search on one substring and reached well under half of them, and
// some of what it missed carried that exact substring, wrapped. ADR-442 section
// 4 is the derivation and the figures, because it is a dated record and this is
// not.
//
// -----------------------------------------------------------------------------
// WHAT IT CANNOT SEE, STATED RATHER THAN IMPLIED
// -----------------------------------------------------------------------------
//   1. A claim written with no negation word at all. "The suite stops at the
//      table name" says exactly what "no check reads a column" says and carries
//      none of this vocabulary.
//   2. A claim whose subject is a NAMED check rather than a category, where the
//      name is a spelling this file does not carry: `RI-14 does not read a
//      default` matches through `does not` and not through the subject.
//   3. A claim split across two sentences, where one carries the subject and the
//      next carries the verb.
//   4. A claim in a file this walk does not read: an image, a spreadsheet, a
//      fixture that is not UTF-8.
//   5. THE DIFFERENCE BETWEEN A CLAIM AND A QUOTATION OF ONE. A repair written
//      on `RI-14`'s idiom keeps the superseded sentence beside its correction,
//      so the corrected file still matches. `correctionFramed` below names the
//      two frames that idiom uses and is the only judgement in this file; it is
//      reported as a separate bucket rather than deducted, because a frame this
//      file did not know would otherwise silently shrink the population.
//
// -----------------------------------------------------------------------------
// NO COUNT IS WRITTEN INTO THIS FILE
// -----------------------------------------------------------------------------
// ADR-383 section 8 and ADR-386 section 7 rule that a live cardinal in prose is
// a claim that decays at the rate the tree moves, and `covers-census.mjs` obeys
// the same ruling one directory over. The figures this instrument produced on
// the day it was written live in ADR-442, which is a dated record, and are
// reproduced by running this file rather than by reading it.
//
// **AND IT PARSES NO CODE, SO IT IMPORTS NO COMMENT STRIPPER.** `RI-30` binds
// every file that parses source to the shared stripper. This file reads comments
// as its SUBJECT: a stripped file is a file with the subject removed, which is
// the reason `absence-claims.mjs` gives for the half of its own header that was
// right. It removes a leading marker by slicing past a match and carries no
// `.replace()` over a comment pattern, so it declares no second stripper under
// any spelling.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isDatedRecord, population, REPO_ROOT } from './dependants.mjs';

/**
 * The files this census reads.
 *
 * Source carries the claims that decide what a session builds; documents carry
 * the claims a session reads to decide what to believe. Both are in, and the
 * report separates them rather than folding them, because a claim in a dated
 * record is history and a claim in live source is an instruction.
 */
const CORPUS = /\.(ts|tsx|mts|mjs|js|sql|yml|yaml|json|md)$/;

/** Documents. Everything else in `CORPUS` is source. */
const DOCUMENT = /\.md$/;

/** Directories no walk enters. The same set `repo-invariants.mjs` skips. */
const SKIP = ['node_modules/', 'dist/', 'build/', 'coverage/', '.next/'];

/**
 * The negated subjects whose noun names a checking mechanism and nothing else.
 *
 * `case` and `rule` are DELIBERATELY ABSENT. This corpus calls a business rule a
 * rule and a golden fixture a case, so both nouns are ambiguous in the direction
 * that inflates a floor, and a floor that is not a floor is worse than a wider
 * ceiling.
 */
const MACHINERY =
  /\bno (check|gate|test|invariant|suite|runner|probe|leg|linter|assertion|checker|reader)s?\b/gi;

/** The universal negatives, which reach the claims `MACHINERY` cannot see. */
const UNIVERSAL = /\b(nothing|nobody|no one)\b/gi;

/** A claim spelled as an adjective, which carries its own subject and verb. */
const NEGATED = /\b(unchecked|uncompared|unenforced|ungated|unverified|unasserted|unpoliced)\b/i;

/**
 * What the subject is said not to do.
 *
 * The list is OBSERVATION and VERIFICATION verbs together, because this corpus
 * writes "no gate can SEE it" as often as "no gate CHECKS it" and the two
 * sentences make the same claim.
 */
const VERIFICATION =
  /\b(check|compare|enforce|assert|verify|verifies|validate|guard|catch|police|audit|forbid|reject|block|prevent|require|prove|constrain|cover|detect|notice|flag|read|measure|watch|examine|inspect|see|tell|know|distinguish|resolve|parse|evaluate|report|bind|survey|settle|reach|touch|derive|count|link|track)(s|es|ed)?\b/i;

/**
 * How far after the subject the verb may sit and still be its verb.
 *
 * TWELVE WORDS IS MEASURED AND NOT CHOSEN. The claims these three entries
 * repaired put between two and nine words between the subject and the verb
 * ("no check in this tree compares", "nothing in this repository reads"), and a
 * window under nine misses the longest of them. Above about fifteen the window
 * starts crossing a clause boundary and binds a subject to a verb belonging to
 * something else, which inflates WIDE without adding a claim.
 */
export const WORD_WINDOW = 12;

/**
 * The two frames `RI-14`'s repair idiom uses to quote a sentence it is retiring.
 *
 * A file repaired on that idiom still carries the false sentence, deliberately,
 * beside the correction. Counting those as live claims would make every repair
 * look like a new defect, which is the mechanism running backwards.
 */
const CORRECTION_FRAMES = [/\bthis read\b/i, /\bFALSE when written\b/i, /\bused to read\b/i];

/**
 * WHERE A SENTENCE ENDS, WHICH IS NOT WHEREVER A FULL STOP IS.
 *
 * This corpus writes `schema.ts`, `RI-14`, `0.5` and `apps/worker/src/db.ts`
 * inside prose constantly, and a splitter that cuts at every `.` cuts a claim in
 * half at its own subject: "nothing in this tree compares a `schema." and "ts`
 * column type against the DDL." A naive split therefore drops the claims whose
 * verb sits after a filename, which is most of them in this tree. The terminator
 * has to be FOLLOWED BY WHITESPACE OR THE END OF THE TEXT to end a sentence.
 */
const SENTENCE = /[^.!?]+(?:[.!?]+(?!\s|$)[^.!?]*)*[.!?]*/g;

/**
 * @typedef {object} Site
 * @property {string} file
 * @property {number} line     where the prose unit carrying the sentence begins
 * @property {'machinery' | 'universal' | 'negated-adjective'} grammar
 * @property {boolean} framed  the sentence sits inside a correction frame
 * @property {boolean} dated   the file is a dated record, so the claim is history
 * @property {string} sentence
 */

/**
 * @typedef {object} Unit
 * @property {number} line
 * @property {string} text
 */

/**
 * A line's comment marker, or `null` when the line is not a comment.
 *
 * MATCHED AND SLICED RATHER THAN REPLACED, so this file carries no `.replace()`
 * over a comment pattern and declares no second stripper. `RI-30`.
 *
 * @param {string} line
 * @returns {string | null}
 */
export function commentBody(line) {
  const marker = /^\s*(\/\/+|\/\*+|\*+\/|\*+|#+|--)[ \t]?/.exec(line);
  if (marker === null) return null;
  return line.slice(marker[0].length);
}

/**
 * The prose units of one file: paragraphs in a document, contiguous comment runs
 * in source, plus the long `"//key"` strings this workspace writes into
 * `package.json` to hold a ruling beside the setting it rules.
 *
 * @param {string} rel
 * @param {string} text
 * @returns {Unit[]}
 */
export function units(rel, text) {
  /** @type {Unit[]} */
  const out = [];
  const lines = text.split('\n');

  if (DOCUMENT.test(rel)) {
    /** @type {string[]} */
    let buffer = [];
    let start = 1;
    lines.forEach((line, index) => {
      if (line.trim() === '') {
        if (buffer.length > 0) out.push({ line: start, text: buffer.join(' ') });
        buffer = [];
        return;
      }
      if (buffer.length === 0) start = index + 1;
      buffer.push(line);
    });
    if (buffer.length > 0) out.push({ line: start, text: buffer.join(' ') });
    return out;
  }

  /** @type {string[]} */
  let buffer = [];
  let start = 1;
  lines.forEach((line, index) => {
    const body = commentBody(line);
    if (body !== null) {
      if (buffer.length === 0) start = index + 1;
      buffer.push(body);
      return;
    }
    if (buffer.length > 0) out.push({ line: start, text: buffer.join(' ') });
    buffer = [];

    const keyed = /"\/\/[^"]*":\s*"(.*)$/.exec(line);
    if (keyed !== null && (keyed[1] ?? '').length > 20) {
      out.push({ line: index + 1, text: keyed[1] ?? '' });
      return;
    }
    const trailing = /\/\/(.+)$/.exec(line);
    if (trailing !== null && (trailing[1] ?? '').length > 20) {
      out.push({ line: index + 1, text: trailing[1] ?? '' });
    }
  });
  if (buffer.length > 0) out.push({ line: start, text: buffer.join(' ') });
  return out;
}

/**
 * Whether a sentence quotes a claim rather than making one.
 *
 * @param {string} sentence
 * @returns {boolean}
 */
export function correctionFramed(sentence) {
  return CORRECTION_FRAMES.some((frame) => frame.test(sentence));
}

/**
 * The grammar one sentence uses to say that nothing checks something, or `null`.
 *
 * @param {string} sentence
 * @returns {'machinery' | 'universal' | 'negated-adjective' | null}
 */
export function grammarOf(sentence) {
  for (const [grammar, subject] of /** @type {const} */ ([
    ['machinery', MACHINERY],
    ['universal', UNIVERSAL],
  ])) {
    subject.lastIndex = 0;
    let hit = subject.exec(sentence);
    while (hit !== null) {
      const after = sentence.slice(hit.index + hit[0].length);
      const window = after
        .split(/\s+/)
        .slice(0, WORD_WINDOW + 1)
        .join(' ');
      if (VERIFICATION.test(window)) {
        subject.lastIndex = 0;
        return grammar;
      }
      hit = subject.exec(sentence);
    }
  }
  if (NEGATED.test(sentence)) return 'negated-adjective';
  return null;
}

/**
 * Every sentence in `root` that says nothing checks something.
 *
 * @param {string} root
 * @returns {{ sites: Site[], files: number, method: 'git ls-files' | 'directory walk' }}
 */
export function census(root) {
  const { files, method } = population(root);
  /** @type {Site[]} */
  const sites = [];
  let read = 0;

  for (const rel of files) {
    if (!CORPUS.test(rel)) continue;
    if (SKIP.some((dir) => rel.includes(dir))) continue;
    /** @type {string} */
    let text;
    try {
      text = readFileSync(join(root, rel), 'utf8');
    } catch {
      continue;
    }
    read += 1;
    const dated = isDatedRecord(rel);
    for (const unit of units(rel, text)) {
      for (const raw of unit.text.match(SENTENCE) ?? []) {
        const sentence = raw.trim();
        if (sentence.length < 12) continue;
        const grammar = grammarOf(sentence);
        if (grammar === null) continue;
        sites.push({
          file: rel,
          line: unit.line,
          grammar,
          framed: correctionFramed(sentence),
          dated,
          sentence: sentence.replace(/\s+/g, ' '),
        });
      }
    }
  }

  return { sites, files: read, method };
}

/**
 * The report, which is two grammars and never one number.
 *
 * @param {string[]} argv
 * @param {(line: string) => void} emit
 * @param {string} root
 * @returns {number}
 */
export function main(argv, emit = console.log, root = REPO_ROOT) {
  const { sites, files, method } = census(root);
  const wantList = argv.includes('--list');
  const source = sites.filter((site) => !DOCUMENT.test(site.file));
  const docs = sites.filter((site) => DOCUMENT.test(site.file));
  const narrow = sites.filter((site) => site.grammar === 'machinery');

  /**
   * @param {string} label
   * @param {Site[]} group
   */
  const line = (label, group) => {
    const live = group.filter((site) => !site.dated && !site.framed);
    emit(
      `${label.padEnd(34)} ${String(group.length).padStart(6)} sentence(s)  ` +
        `${String(new Set(group.map((site) => site.file)).size).padStart(5)} file(s)  ` +
        `${String(live.length).padStart(6)} live and unframed`,
    );
  };

  emit(`population: ${String(files)} file(s), by ${method}`);
  emit('');
  emit('NARROW  the subject is a checking mechanism, negated. A FLOOR.');
  line(
    '  narrow, source',
    narrow.filter((site) => !DOCUMENT.test(site.file)),
  );
  line(
    '  narrow, documents',
    narrow.filter((site) => DOCUMENT.test(site.file)),
  );
  emit('');
  emit('WIDE    NARROW plus universal negatives and negated adjectives. A CEILING.');
  line('  wide, source', source);
  line('  wide, documents', docs);
  emit('');
  emit(
    'Neither figure is a verdict. This instrument reads GRAMMAR and cannot tell a TRUE ' +
      'claim from a FALSE one; deciding a claim needs a probe over the thing it names.',
  );

  if (wantList) {
    emit('');
    for (const site of sites) {
      emit(
        `${site.file}:${String(site.line)}\t${site.grammar}\t` +
          `${site.dated ? 'dated' : 'live'}\t${site.framed ? 'framed' : 'asserted'}\t` +
          site.sentence.slice(0, 240),
      );
    }
  }
  return 0;
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('absence-grammar-census.mjs')) {
  process.exitCode = main(process.argv.slice(2));
}
