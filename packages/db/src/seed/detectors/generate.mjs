// =============================================================================
// packages/db/src/seed/detectors/generate.mjs
// =============================================================================
// THE GENERATOR. It turns the cited transcription of M07 section 3.2 into the
// `detector_definitions` rows, and it is `P7-d` on `packages/db/src/seed/
// calendars`' shape: a hand-written source file holding the values, a
// generator that REFUSES rather than guesses, and a generated artifact that is
// committed and reviewed.
//
// WHAT THIS FILE IS NOT: it is not the loader. It opens no database
// connection, imports no client, writes no row, and imports `pg` nowhere. The
// same division `calendars/generate.mjs` states about itself, one seed over.
//
// -----------------------------------------------------------------------------
// THE ONE CLASS OF ERROR THIS FILE EXISTS TO REMOVE
// -----------------------------------------------------------------------------
// The calendars generator names DST, because a session written 22:00Z when it
// should be 23:00Z looks exactly like a session written correctly.
//
// THE ANALOGUE HERE IS A THRESHOLD NOBODY CAN POINT AT. A row reading
// `correlation_floor_bp: -8000` looks exactly like a row reading
// `correlation_floor_bp: -7500`, on a page of eighteen of them, and the first
// thing that could falsify the wrong one is a ring that was not flagged.
// Judgment and transcription are indistinguishable once they are both JSON.
//
// So no value in this seed is accepted without a `cite` of the form
// `<path>:<line>` and a `quote`, and `checkCitations` OPENS THAT FILE AT THAT
// LINE AND REQUIRES THE QUOTE TO OCCUR IN IT VERBATIM. A paraphrase fails. A
// drifted line number fails. A number somebody supplied fails, because there
// is no line to point it at. This is the one check that makes
// `status: "transcribed"` mean something rather than being a word the
// transcriber typed.
//
// AND THE AUTHORITY ITSELF IS DIGESTED, because a cite that resolves against a
// DIFFERENT M07 has silently changed meaning: `authority_sha256` is re-derived
// on every run and a disagreement is a rejection.
//
// -----------------------------------------------------------------------------
// WHY THE CITATION TRAVELS INTO THE ROW RATHER THAN STAYING IN THE FILE
// -----------------------------------------------------------------------------
// `0008_risk.sql`'s own header says a threshold tuned by deploy is a threshold
// "whose 'why did this not fire in March' answer is an archaeology exercise".
// A threshold whose PROVENANCE lives in a JSON file in git and whose VALUE
// lives in the database is the same archaeology one layer in. So the row's
// `parameters` jsonb carries `{state, value, unit, cite, quote}` per parameter
// rather than a bare number, and INV-M7-04 is answerable from the row alone.
//
// The wrapper also makes the three-valued case unmissable. `null` under a bare
// number reads as zero to a careless consumer; `{state: "unstated", value:
// null}` cannot. That is M07 section 3.2's own `footprint_present` lesson,
// applied to the file that stores the parameter rather than to the column the
// detector reads.
// =============================================================================

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve, dirname, join } from 'node:path';

export const GENERATOR_VERSION = 1;

/** Repository root, from this file's own location. No cwd is read. */
const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../../../../..');

/**
 * The authority. M07 section 3.2 and the sections it names. Declared here
 * rather than taken from the source file, because a source file that could
 * name its own authority could cite a file it wrote itself.
 */
export const AUTHORITY = 'docs/plans/M07-risk-abuse.md';

/**
 * The columns of `detector_definitions` as `0008_risk.sql` declares them,
 * minus `created_at`, which the table defaults. A generated row has exactly
 * these keys, and `checkRows` refuses any other, because a row carrying a key
 * no column accepts is a row that fails at the loader rather than here.
 */
export const ROW_COLUMNS = [
  'detector',
  'version',
  'parameters',
  'description',
  'effective_from',
  'effective_to',
  'is_sensitive',
];

/**
 * The four states a transcribed value may hold, and the distinction is the
 * whole design.
 *
 *   stated          M07 gives this value, at the cite, in the quote
 *   unstated        M07 NAMES this knob and gives it NO number. `value` is null
 *   not_applicable  the knob cannot exist for this detector. Carries a `reason`
 *   contextual      M07 states it per-CONDITION rather than per-detector, which
 *                   is section 3.2's own posture on severity. Carries `cases`
 *
 * `unstated` and `not_applicable` are NOT interchangeable and conflating them
 * is the defect this vocabulary exists to prevent: `unstated` sends a later
 * session to find the number M07 owes, and `not_applicable` tells them there
 * was never one to find.
 */
export const PARAMETER_STATES = ['stated', 'unstated', 'not_applicable', 'contextual'];

/** Units. `bp` and `cents` are the only two a quantity of money or ratio may take. */
export const UNITS = [
  'bp',
  'cents',
  'seconds',
  'trading_days',
  'days',
  'count',
  'boolean',
  'text',
  'severity',
  'sql',
  'list',
];

/**
 * ADR-155, INV-M7-02, and P7 rule 11. NO DETECTOR WRITES A `risk_flags.status`
 * OTHER THAN `open`, AND NOTHING SEEDED MAY IMPLY AN AUTOMATIC PATH TO
 * `enforced`.
 *
 * This is enforced mechanically rather than trusted to a comment, because P7
 * is the phase whose temptation is a Behavior column in an accepted entry, and
 * M07 carries that column twice: D-16's own cell says "Hard links
 * auto-enforce" and section 7.9's Hard row says "Auto-enforce.". A
 * transcription that is faithful to those two sentences is a seed that
 * forecloses OQ-M7-05 by being written.
 *
 * So: any parameter value spelling an enforcement outcome is rejected, and
 * `flag_status` is `open` or `not_applicable` and nothing else.
 */
const ENFORCEMENT_WORDS = [
  'enforced',
  'enforce',
  'auto-enforce',
  'auto_enforce',
  'autoenforce',
  'ban',
  'banned',
  'restricted',
  'closure_for_cause',
];

/** The one value `flag_status` may hold where it applies at all. */
const ONLY_FLAG_STATUS = 'open';

/**
 * `IS NOT TRUE` is the expression that turns a vendor outage into a flood of
 * flags against real customers, and M07 names it as the trap a reader would
 * build wrong. The seed carries `IS FALSE` as DATA so this check can exist;
 * a detector whose test lives only in code has nothing to check it against.
 */
const THREE_VALUED_TRAP = 'IS NOT TRUE';

// -----------------------------------------------------------------------------
// Failure
// -----------------------------------------------------------------------------
// Every rule below fails through `reject`, and every rule ships with a seeded
// violation in `packages/db/test/seed-detectors.test.ts` that must fail ON ITS
// OWN FINDING rather than merely throw. The `finding` string is part of the
// contract and not a diagnostic nicety: a check that passes for the wrong
// reason and a check that fails for the wrong reason are the same defect.
// This is `calendars/generate.mjs`'s `CalendarSourceError` idiom, unchanged.

export class DetectorSourceError extends Error {
  /** @param {string} finding @param {string} detail */
  constructor(finding, detail) {
    super(`${finding}: ${detail}`);
    this.name = 'DetectorSourceError';
    this.finding = finding;
    this.detail = detail;
  }
}

/** @returns {never} */
function reject(finding, detail) {
  throw new DetectorSourceError(finding, detail);
}

// -----------------------------------------------------------------------------
// No floats, anywhere
// -----------------------------------------------------------------------------
// Money is integer cents and thresholds are basis points or integer cents
// (constitution, and P7 rule 17). A correlation of -0.8 in M07's prose is
// -8000 bp here and never -0.8, and this is the check that makes that a rule
// rather than a habit. It runs over EVERY number in the generated artifact,
// not only over the ones a reader thought to look at.

function assertNoFloats(value, where) {
  if (typeof value === 'number') {
    if (!Number.isInteger(value))
      reject(
        'float-in-seed',
        `${where} is ${value}. Money is integer cents and thresholds are basis points or ` +
          `integer cents; a ratio M07 writes as a decimal is carried in bp`,
      );
    if (!Number.isSafeInteger(value))
      reject('float-in-seed', `${where} is ${value}, which is not a safe integer`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoFloats(v, `${where}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertNoFloats(v, `${where}.${k}`);
  }
}

// -----------------------------------------------------------------------------
// Citations
// -----------------------------------------------------------------------------
// THE CHECK THAT MAKES `transcribed` MEAN SOMETHING. Every `{cite, quote}` pair
// anywhere in the source is resolved against the file at the line, and the
// quote must occur in that line verbatim.
//
// Reading the file rather than trusting the string is the whole point: this is
// the mechanical assertion CLAUDE.md asks for in place of a bigger model, and
// the class of error it removes is precisely the one the reconciliation
// session's three worst errors belonged to, a claim never checked against its
// primary source.

const CITE = /^([A-Za-z0-9_./-]+):(\d+)$/;

/**
 * Walks any value and yields every `{cite, quote}` pair, plus the
 * `refused_cite`/`refused_quote` and `authority_cite`/`authority_quote` pairs
 * the `refusals` block uses. A pair anywhere is checked; there is no opt-out
 * and no exempt subtree.
 */
export function collectCitations(node, path = '$', out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectCitations(v, `${path}[${i}]`, out));
    return out;
  }
  for (const [prefix, citeKey, quoteKey] of [
    ['', 'cite', 'quote'],
    ['refused ', 'refused_cite', 'refused_quote'],
    ['authority ', 'authority_cite', 'authority_quote'],
  ]) {
    if (typeof node[citeKey] === 'string') {
      if (typeof node[quoteKey] !== 'string')
        reject('cite-without-quote', `${path} carries ${citeKey} and no ${quoteKey}`);
      out.push({ where: `${prefix}${path}`, cite: node[citeKey], quote: node[quoteKey] });
    } else if (typeof node[quoteKey] === 'string') {
      reject('quote-without-cite', `${path} carries ${quoteKey} and no ${citeKey}`);
    }
  }
  for (const [k, v] of Object.entries(node)) collectCitations(v, `${path}.${k}`, out);
  return out;
}

/**
 * @param {{where:string,cite:string,quote:string}[]} citations
 * @param {(path:string)=>string} readFile injected so the test can drive it
 */
export function checkCitations(citations, readFile) {
  if (citations.length === 0)
    reject('no-citations', 'the source carries no citation at all, so nothing is transcribed');
  const lines = new Map();
  for (const { where, cite, quote } of citations) {
    const m = CITE.exec(cite);
    if (!m) reject('cite-not-a-location', `${where} cites ${JSON.stringify(cite)}, expected <path>:<line>`);
    const [, path, lineNo] = m;
    if (path !== AUTHORITY)
      reject(
        'cite-outside-the-authority',
        `${where} cites ${path}. Every value in this seed is cited to ${AUTHORITY}, because a ` +
          `seed that may cite anywhere may cite a file it wrote itself`,
      );
    if (!lines.has(path)) lines.set(path, readFile(path).split('\n'));
    const text = lines.get(path)[Number(lineNo) - 1];
    if (text === undefined)
      reject('cite-past-end-of-file', `${where} cites ${cite} and that file has no such line`);
    if (quote.length === 0) reject('quote-empty', `${where} cites ${cite} with an empty quote`);
    if (!text.includes(quote))
      reject(
        'quote-not-at-the-cite',
        `${where} cites ${cite} for ${JSON.stringify(quote)} and that line does not contain it. ` +
          `The line reads ${JSON.stringify(text.slice(0, 200))}`,
      );
  }
  return citations.length;
}

// -----------------------------------------------------------------------------
// The source
// -----------------------------------------------------------------------------

export function readSource(text, where, { readFile } = {}) {
  let source;
  try {
    source = JSON.parse(text);
  } catch (e) {
    reject('source-not-json', `${where}: ${e.message}`);
  }
  if (!source || typeof source !== 'object') reject('source-not-json', `${where} is not an object`);

  // `status` is the transcriber's positive statement, and it is checked first
  // for the calendars file's reason: a file that satisfies every structural
  // rule and was never read against the authority passes everything else.
  if (source.status !== 'transcribed')
    reject(
      'source-not-transcribed',
      `${where} has status ${JSON.stringify(source.status)}. "transcribed" is the transcriber's ` +
        `positive statement that every value below was read off ${AUTHORITY}`,
    );

  if (typeof source.id !== 'string' || source.id.length === 0)
    reject('source-has-no-id', `${where} has no id`);

  const read = readFile ?? ((p) => readFileSync(join(REPO_ROOT, p), 'utf8'));

  checkProvenance(source.provenance, read);
  const defaults = readRowDefaults(source.row_defaults);
  checkPosture(source.posture);
  checkRefusals(source.refusals);

  if (!Array.isArray(source.detectors) || source.detectors.length === 0)
    reject(
      'detector-list-not-transcribed',
      `${where} carries no detector list. NULL IS NOT THE EMPTY LIST: an empty list asserts that ` +
        `M07 section 3.2 names no detector, which would load clean and seed nothing`,
    );

  const citationCount = checkCitations(collectCitations(source), read);
  assertNoFloats(source, where);

  return { source, defaults, citationCount };
}

function checkProvenance(p, readFile) {
  if (!p || typeof p !== 'object') reject('provenance-not-transcribed', 'no provenance block');
  for (const k of ['authority', 'authority_sha256', 'read_at', 'read_by']) {
    if (typeof p[k] !== 'string' || p[k].length === 0)
      reject('provenance-not-transcribed', `provenance.${k} is not stated`);
  }
  if (p.authority !== AUTHORITY)
    reject('provenance-names-another-authority', `provenance.authority is ${p.authority}`);
  const actual = createHash('sha256').update(readFile(AUTHORITY)).digest('hex');
  if (p.authority_sha256 !== actual)
    reject(
      'authority-digest-disagrees',
      `provenance.authority_sha256 is ${p.authority_sha256} and ${AUTHORITY} digests to ${actual}. ` +
        `Every cite in this file was resolved against a DIFFERENT ${AUTHORITY}, so every line ` +
        `number in it is a claim about a file that no longer exists. Re-read and re-cite`,
    );
}

/**
 * The three `NOT NULL` columns M07 does not give values for. A `chosen` value
 * is not a cited value and this refuses to let the two wear the same clothes:
 * `chosen` must carry a reason and must NOT carry a cite.
 */
function readRowDefaults(d) {
  if (!d || typeof d !== 'object') reject('row-defaults-not-transcribed', 'no row_defaults block');
  const out = {};
  for (const k of ['version', 'effective_from', 'effective_to']) {
    const entry = d[k];
    if (!entry || typeof entry !== 'object')
      reject('row-defaults-not-transcribed', `row_defaults.${k} is not stated`);
    if (entry.state !== 'chosen' && entry.state !== 'stated')
      reject('row-default-state-unknown', `row_defaults.${k}.state is ${JSON.stringify(entry.state)}`);
    if (typeof entry.reason !== 'string' || entry.reason.length === 0)
      reject(
        'chosen-value-without-a-reason',
        `row_defaults.${k} states no reason. A value M07 does not give is declared as a CHOICE ` +
          `with its reason, or it is a number nobody can point at wearing a transcription's clothes`,
      );
    if (entry.state === 'chosen' && 'cite' in entry)
      reject(
        'chosen-value-carries-a-cite',
        `row_defaults.${k} is chosen and carries a cite. A citation attached to a choice is the ` +
          `defect this whole file exists to prevent`,
      );
    out[k] = entry.value;
  }
  if (typeof out.version !== 'string' || out.version.length === 0)
    reject('row-defaults-not-transcribed', 'row_defaults.version has no value');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.effective_from ?? ''))
    reject('effective-from-not-a-date', `row_defaults.effective_from is ${out.effective_from}`);
  if (out.effective_to !== null)
    reject(
      'effective-to-not-null-on-a-seed',
      `row_defaults.effective_to is ${JSON.stringify(out.effective_to)}. 0008_risk.sql indexes ` +
        `detector_definitions (detector) WHERE effective_to IS NULL, so null IS current, and ` +
        `nothing supersedes a row that has just been written`,
    );
  return out;
}

/**
 * The posture is OQ-M7-02's and it is recorded rather than applied. Its second
 * half is CONTESTED by four other places in M07, so the source states it as
 * contested with its counter-cites and writes no value; a posture block that
 * quietly resolved it would be this seed ruling a money question.
 */
function checkPosture(p) {
  if (!p || typeof p !== 'object') reject('posture-not-recorded', 'no posture block');
  if (!p.recommendation || typeof p.recommendation.cite !== 'string')
    reject('posture-not-recorded', 'posture.recommendation is not cited');
  const r = p.routing;
  if (!r || typeof r !== 'object') reject('posture-not-recorded', 'posture.routing is not recorded');
  if (r.state !== 'contested')
    reject(
      'contested-posture-resolved',
      `posture.routing.state is ${JSON.stringify(r.state)}. OQ-M7-02's routing half is answered ` +
        `both ways inside M07 and this seed writes neither reading`,
    );
  if (r.value !== null)
    reject(
      'contested-posture-resolved',
      `posture.routing.value is ${JSON.stringify(r.value)}. A contested reading with a value is a ` +
        `ruling, and this one bears on whether a high-severity flag reaches a human before ADR-040 ` +
        `auto-releases the payout`,
    );
  if (!Array.isArray(r.counter_cites) || r.counter_cites.length === 0)
    reject('contested-posture-unsupported', 'posture.routing states no counter_cites');
}

/**
 * The two sentences of M07 that are read, named and deliberately not encoded.
 * Requiring the block to exist is what stops the refusal being invisible: a
 * seed that merely omitted them is indistinguishable from one whose author
 * never read them, and the next session encodes them.
 */
function checkRefusals(r) {
  if (!r || typeof r !== 'object') reject('refusals-not-recorded', 'no refusals block');
  if (!Array.isArray(r.auto_enforce) || r.auto_enforce.length === 0)
    reject('refusals-not-recorded', 'refusals.auto_enforce names nothing');
  for (const [i, entry] of r.auto_enforce.entries()) {
    if (typeof entry.reason !== 'string' || entry.reason.length === 0)
      reject('refusal-without-a-reason', `refusals.auto_enforce[${i}] states no reason`);
  }
}

// -----------------------------------------------------------------------------
// Parameters
// -----------------------------------------------------------------------------

function checkParameter(detector, key, p) {
  const where = `${detector}.parameters.${key}`;
  if (!p || typeof p !== 'object' || Array.isArray(p))
    reject('parameter-not-an-entry', `${where} is not a {state, value, unit, cite, quote} entry`);
  if (!PARAMETER_STATES.includes(p.state))
    reject(
      'parameter-state-unknown',
      `${where}.state is ${JSON.stringify(p.state)}, expected one of ${PARAMETER_STATES.join(', ')}`,
    );
  if (!UNITS.includes(p.unit))
    reject('parameter-unit-unknown', `${where}.unit is ${JSON.stringify(p.unit)}`);
  if (!('value' in p)) reject('parameter-has-no-value-key', `${where} has no value key`);

  // The three-state discipline, enforced. `unstated` and `not_applicable` are
  // both null and they are not the same statement, so the one that claims M07
  // owes nothing must say WHY.
  if (p.state === 'stated' && p.value === null)
    reject(
      'stated-parameter-is-null',
      `${where} is stated and null. "stated" means M07 gives the value at the cite; a null value ` +
        `is "unstated" or "not_applicable" and the two are different statements`,
    );
  if (p.state === 'unstated' && p.value !== null)
    reject(
      'unstated-parameter-has-a-value',
      `${where} is unstated and carries ${JSON.stringify(p.value)}. A number M07 does not give is ` +
        `the finding, not a judgment call to make quietly`,
    );
  if (p.state === 'not_applicable') {
    if (p.value !== null)
      reject('not-applicable-parameter-has-a-value', `${where} is not_applicable and carries a value`);
    if (typeof p.reason !== 'string' || p.reason.length === 0)
      reject(
        'not-applicable-without-a-reason',
        `${where} is not_applicable and states no reason. "unstated" sends a later session to find ` +
          `the number M07 owes; "not_applicable" tells them there was never one. Say which`,
      );
  }
  if (p.state === 'contextual') {
    if (p.value !== null)
      reject('contextual-parameter-has-a-scalar', `${where} is contextual and carries a scalar value`);
    if (!Array.isArray(p.cases) || p.cases.length === 0)
      reject(
        'contextual-parameter-without-cases',
        `${where} is contextual and names no cases. M07 says severity is contextual, not ` +
          `per-detector, so a contextual entry with no case states nothing at all`,
      );
    for (const [i, c] of p.cases.entries()) {
      if (typeof c.cite !== 'string' || typeof c.quote !== 'string')
        reject('contextual-case-uncited', `${where}.cases[${i}] is not cited`);
      if (p.unit === 'severity') checkSeverity(`${where}.cases[${i}]`, c.value);
    }
  }
  if (p.unit === 'severity' && p.state === 'stated') checkSeverity(where, p.value);

  // ADR-155. Nothing seeded may imply an automatic path to `enforced`.
  assertNoEnforcement(where, p.value);
  if (key === 'flag_status') {
    if (p.state === 'stated' && p.value !== ONLY_FLAG_STATUS)
      reject(
        'flag-status-other-than-open',
        `${where} is ${JSON.stringify(p.value)}. ADR-155 and INV-M7-02: no detector transitions a ` +
          `flag past ${ONLY_FLAG_STATUS}, and no slice adds an automatic path to enforced`,
      );
    if (p.state === 'unstated' || p.state === 'contextual')
      reject(
        'flag-status-not-settled',
        `${where} is ${p.state}. The status a detector writes is settled by INV-M7-02 for every ` +
          `detector at once; it is "open" where a flag exists and "not_applicable" where none does`,
      );
  }
  if (key === 'auto_enforce' && p.value === true)
    reject(
      'parameter-implies-enforcement',
      `${where} is true. OQ-M7-05 is open and ADR-155 forecloses the true half regardless; a seed ` +
        `row is not where that ruling gets made`,
    );
  if (key === 'footprint_present_test' && String(p.value).toUpperCase().includes(THREE_VALUED_TRAP))
    reject(
      'three-valued-trap',
      `${where} is ${JSON.stringify(p.value)}. A detector written against ${THREE_VALUED_TRAP} ` +
        `scores every vendor timeout as a fleet member, which converts a supplier outage into a ` +
        `flood of flags against real customers. The test is IS FALSE`,
    );
}

function checkSeverity(where, value) {
  if (!Number.isInteger(value) || value < 1 || value > 5)
    reject(
      'severity-out-of-scale',
      `${where} is ${JSON.stringify(value)}. M07 section 3.3's scale is 1 to 5, and severity is ` +
        `read as money: moving a detector's output from 3 to 4 changes who gets held`,
    );
}

function assertNoEnforcement(where, value) {
  if (typeof value !== 'string') return;
  const v = value.toLowerCase();
  for (const word of ENFORCEMENT_WORDS) {
    // Whole-token match, so a reason mentioning enforcement in prose is fine
    // and a VALUE that spells one is not. The value is what a runner reads.
    if (new RegExp(`(^|[^a-z_-])${word}([^a-z_-]|$)`).test(v))
      reject(
        'parameter-implies-enforcement',
        `${where} has the value ${JSON.stringify(value)}, which spells the enforcement outcome ` +
          `"${word}". P7 rule 11: no detector writes a risk_flags.status other than open, and ` +
          `nothing seeded may imply an automatic path to enforced`,
      );
  }
}

// -----------------------------------------------------------------------------
// Rows
// -----------------------------------------------------------------------------

export function generate(source, defaults) {
  const rows = [];
  const seen = new Set();

  for (const d of source.detectors) {
    if (typeof d.detector !== 'string' || !/^D-\d{2}$/.test(d.detector))
      reject('detector-id-malformed', `${JSON.stringify(d.detector)} is not a D-nn identifier`);
    if (seen.has(d.detector)) reject('detector-seeded-twice', `${d.detector} appears twice`);
    seen.add(d.detector);

    for (const k of ['name', 'input', 'evidence_of']) {
      if (!d[k] || typeof d[k].cite !== 'string' || typeof d[k].quote !== 'string')
        reject('detector-field-uncited', `${d.detector}.${k} is not cited`);
    }
    if (typeof d.m07_row !== 'string' || !CITE.test(d.m07_row))
      reject('detector-row-not-located', `${d.detector} does not name its M07 row as <path>:<line>`);

    // `is_sensitive` is P7-j's strip list and every value is a security
    // decision, so a row that states one without saying why is refused. The
    // DDL defaults it true; a seed that leaned on the default would leave the
    // reason nowhere.
    const s = d.is_sensitive;
    if (!s || typeof s !== 'object' || typeof s.value !== 'boolean')
      reject('is-sensitive-not-stated', `${d.detector}.is_sensitive is not stated`);
    if (typeof s.reason !== 'string' || s.reason.length < 40)
      reject(
        'is-sensitive-without-a-reason',
        `${d.detector}.is_sensitive states no reason. Under INV-M7-10 this column IS the trader ` +
          `profile's strip list, so a row marked wrong leaks a detector internal to a trader; ` +
          `every value is the security decision it is and says why`,
      );

    const params = d.parameters;
    if (!params || typeof params !== 'object' || Array.isArray(params))
      reject('detector-has-no-parameters', `${d.detector} carries no parameters object`);
    const keys = Object.keys(params).filter((k) => !k.startsWith('_'));
    if (keys.length === 0)
      reject(
        'detector-has-no-parameters',
        `${d.detector} carries an empty parameters object. INV-M7-04: a run that cannot record ` +
          `the parameters it ran under cannot answer "why did this not fire in March"`,
      );
    if (!keys.includes('flag_status'))
      reject(
        'detector-does-not-state-its-flag-status',
        `${d.detector} states no flag_status. INV-M7-02 binds every detector and a row that is ` +
          `silent about it is a row the next reader may read either way`,
      );
    for (const k of keys) checkParameter(d.detector, k, params[k]);

    const counts = { stated: 0, unstated: 0, not_applicable: 0, contextual: 0 };
    for (const k of keys) counts[params[k].state] += 1;

    rows.push({
      detector: d.detector,
      version: defaults.version,
      parameters: {
        _meta: {
          name: d.name.quote,
          m07_row: d.m07_row,
          input: d.input,
          evidence_of: d.evidence_of,
          is_sensitive_reason: s.reason,
          parameter_counts: counts,
        },
        ...Object.fromEntries(keys.map((k) => [k, params[k]])),
      },
      description: describe(d),
      effective_from: defaults.effective_from,
      effective_to: defaults.effective_to,
      is_sensitive: s.value,
    });
  }
  return rows;
}

/**
 * `description` is `NOT NULL` and M07 gives no description field, so it is
 * COMPOSED from two cells M07 does give: the detector's name and what it is
 * evidence OF. Composition of quoted text is transcription; a sentence written
 * fresh would be this seed describing a detector in its own words, which is
 * the one thing a registry of somebody else's thresholds must not do.
 */
function describe(d) {
  return `${d.name.quote}. Evidence of: ${d.evidence_of.quote} (${d.m07_row})`;
}

// -----------------------------------------------------------------------------
// The authority's own list, parsed
// -----------------------------------------------------------------------------
// BOTH DIRECTIONS, AND THE EXPECTED SET IS DERIVED RATHER THAN WRITTEN. A
// hand-kept list of the detectors M07 names is one more hand-maintained count,
// and it goes stale the day section 3.2 gains a row. So the section is PARSED:
// every table row of section 3.2 whose first cell is a `D-nn` is a detector
// M07 names, in the order it names them.
//
// The order matters and is checked, not merely the set. M07's table runs D-01
// to D-10, then D-15 to D-17, then D-11 to D-14 and D-18, which is a reading
// order a set comparison would silently let a seed reshuffle.

export function detectorsNamedByTheAuthority(authorityText) {
  const lines = authorityText.split('\n');
  const start = lines.findIndex((l) => /^###\s+3\.2\s/.test(l));
  if (start === -1)
    reject('authority-section-not-found', `${AUTHORITY} has no "### 3.2" heading to parse`);
  const found = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^###?\s/.test(line)) break; // the next heading ends section 3.2
    const cell = /^\|\s*\*{0,2}(D-\d{2})\*{0,2}\s*\|/.exec(line);
    if (cell) found.push({ detector: cell[1], line: i + 1 });
  }
  if (found.length === 0)
    reject('authority-names-no-detector', `${AUTHORITY} section 3.2 has no D-nn table row`);
  return found;
}

/**
 * The two-directional check. A detector M07 names and the seed forgot fails
 * here, and a detector the seed carries and M07 does not name fails here too.
 */
export function checkAgainstTheAuthority(rows, named) {
  const seeded = rows.map((r) => r.detector);
  const namedIds = named.map((n) => n.detector);

  const missing = namedIds.filter((d) => !seeded.includes(d));
  if (missing.length > 0)
    reject(
      'detector-named-by-m07-and-not-seeded',
      `${AUTHORITY} section 3.2 names ${missing.join(', ')} and the seed has no row for ` +
        `${missing.length === 1 ? 'it' : 'them'}. A detector with no row has no version, no ` +
        `effective date, and no answer to "why did this not fire in March"`,
    );

  const extra = seeded.filter((d) => !namedIds.includes(d));
  if (extra.length > 0)
    reject(
      'detector-seeded-and-not-named-by-m07',
      `the seed carries ${extra.join(', ')} and ${AUTHORITY} section 3.2 names ` +
        `${extra.length === 1 ? 'it' : 'them'} nowhere. Every value in this registry is cited to ` +
        `M07; a detector that is not in M07 has nothing to cite`,
    );

  for (let i = 0; i < namedIds.length; i += 1) {
    if (seeded[i] !== namedIds[i])
      reject(
        'seed-order-disagrees-with-m07',
        `row ${i + 1} of the seed is ${seeded[i]} and row ${i + 1} of M07 section 3.2 is ` +
          `${namedIds[i]}. The seed follows the authority's own reading order so the two diff`,
      );
  }

  // The row each detector cites must be the row M07 actually holds it on.
  const byId = new Map(named.map((n) => [n.detector, n.line]));
  for (const row of rows) {
    const cited = Number(CITE.exec(row.parameters._meta.m07_row)[2]);
    const actual = byId.get(row.detector);
    if (cited !== actual)
      reject(
        'detector-row-cite-disagrees',
        `${row.detector} names its M07 row at line ${cited} and section 3.2 holds it at ${actual}`,
      );
  }
  return namedIds.length;
}

// -----------------------------------------------------------------------------
// Rows, checked as a set
// -----------------------------------------------------------------------------

export function checkRows(rows, source) {
  for (const row of rows) {
    const keys = Object.keys(row);
    const unexpected = keys.filter((k) => !ROW_COLUMNS.includes(k));
    if (unexpected.length > 0)
      reject(
        'row-has-a-column-detector_definitions-does-not',
        `${row.detector} carries ${unexpected.join(', ')}; 0008_risk.sql declares ` +
          `${ROW_COLUMNS.join(', ')} and created_at`,
      );
    for (const k of ROW_COLUMNS) {
      if (!keys.includes(k)) reject('row-is-missing-a-column', `${row.detector} has no ${k}`);
    }
    if (typeof row.description !== 'string' || row.description.length === 0)
      reject('row-has-no-description', `${row.detector} has an empty description`);
  }

  // `declared` is the transcriber's own counts, stated independently of the
  // rows so the two must agree. The check that catches a detector deleted
  // while editing.
  const d = source.declared;
  if (!d || typeof d !== 'object') reject('declared-counts-not-transcribed', 'no declared block');
  const actual = {
    detector_count: rows.length,
    rows_with_at_least_one_stated_number: rows.filter(hasAStatedNumber).length,
    rows_with_no_stated_number: rows.filter((r) => !hasAStatedNumber(r)).length,
    sensitive_row_count: rows.filter((r) => r.is_sensitive).length,
  };
  for (const [k, v] of Object.entries(actual)) {
    if (d[k] !== v)
      reject(
        'declared-count-disagrees',
        `declared.${k} is ${JSON.stringify(d[k])} and the rows give ${v}. Two independent ` +
          `statements of one number is the point of stating it twice`,
      );
  }
  return actual;
}

function hasAStatedNumber(row) {
  return Object.entries(row.parameters).some(
    ([k, p]) => !k.startsWith('_') && p.state === 'stated' && typeof p.value === 'number',
  );
}

// -----------------------------------------------------------------------------
// Build
// -----------------------------------------------------------------------------

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function build(sourceText, { sourceFile, readFile } = {}) {
  const read = readFile ?? ((p) => readFileSync(join(REPO_ROOT, p), 'utf8'));
  const { source, defaults, citationCount } = readSource(sourceText, sourceFile ?? 'source', {
    readFile: read,
  });
  const rows = generate(source, defaults);
  const named = detectorsNamedByTheAuthority(read(AUTHORITY));
  const namedCount = checkAgainstTheAuthority(rows, named);
  const counts = checkRows(rows, source);

  const generated = {
    id: source.id,
    generated_by: 'packages/db/src/seed/detectors/generate.mjs',
    generator_version: GENERATOR_VERSION,
    note:
      'GENERATED, COMMITTED AND REVIEWED. Do not edit: edit the source file and regenerate. ' +
      'These are detector_definitions rows as 0008_risk.sql declares the table, one per detector ' +
      'M07 section 3.2 names, and EVERY VALUE IN parameters CARRIES THE LINE OF M07 IT WAS READ ' +
      'FROM. INV-M7-04 is the reason the citation travels into the row rather than staying in the ' +
      'source file: a threshold whose provenance lives in git and whose value lives in the ' +
      'database cannot answer "why did this not fire in March" without an archaeology exercise.',
    source_file: sourceFile ? basename(sourceFile) : null,
    source_sha256: sha256Hex(sourceText),
    provenance: source.provenance,
    row_defaults: source.row_defaults,
    posture: source.posture,
    refusals: source.refusals,
    counts: {
      ...counts,
      detectors_named_by_the_authority: namedCount,
      citations_resolved: citationCount,
    },
    rows,
  };
  assertNoFloats(generated, 'generated');
  return generated;
}

export function serialize(generated) {
  return `${JSON.stringify(generated, null, 2)}\n`;
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------
//
//   node generate.mjs <source.json> --out <rows.json>
//   node generate.mjs <source.json> --check <rows.json>   regenerate and diff
//
// `--check` is the pattern `calendars/generate.mjs` uses and `corpus.yml`
// already uses for generated spans: regenerate and require no difference, so
// the committed artifact can never drift from its source.

function main(argv) {
  const sourceFile = argv[0];
  if (!sourceFile || sourceFile.startsWith('--'))
    fail('usage: generate.mjs <source.json> [--out <file> | --check <file>]');
  const sourceText = readFileSync(resolve(sourceFile), 'utf8');
  const out = serialize(build(sourceText, { sourceFile }));

  const outIdx = argv.indexOf('--out');
  const checkIdx = argv.indexOf('--check');
  if (outIdx !== -1) {
    const target = argv[outIdx + 1];
    if (!target) fail('--out needs a path');
    writeFileSync(resolve(target), out);
    process.stdout.write(`wrote ${target}\n`);
  } else if (checkIdx !== -1) {
    const target = argv[checkIdx + 1];
    if (!target) fail('--check needs a path');
    const existing = readFileSync(resolve(target), 'utf8');
    if (existing !== out) {
      fail(
        `${target} is not what ${sourceFile} generates. Regenerate it with --out and commit the result`,
      );
    }
    process.stdout.write(`${target} is up to date\n`);
  } else {
    process.stdout.write(out);
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    if (e instanceof DetectorSourceError) fail(`REJECTED [${e.finding}] ${e.detail}`);
    throw e;
  }
}
