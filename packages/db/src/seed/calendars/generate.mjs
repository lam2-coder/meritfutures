// =============================================================================
// packages/db/src/seed/calendars/generate.mjs
// =============================================================================
// THE GENERATOR. It turns the hand-transcribed EXCEPTION list into the full set
// of trading_calendar rows, and it is P1 S-E section 3.1's mechanism:
//
//   "The file holds exceptions, not two hundred and fifty rows. Hand-
//    maintaining a full year is two hundred and fifty chances to be wrong."
//
// THIS DOES NOT VIOLATE B4 #1 and the distinction is worth stating where a
// future reader will meet it, because the rule and this file look alike at a
// glance. B4 #1 forbids the ENGINE deriving a trading day from a timestamp at
// RUNTIME. This is a build step whose output is committed, digest-pinned and
// thereafter read as data (ADR-042, and P1 S-E section 3.1 in the same words).
// Nothing here runs in a request. The engine never imports it. What the engine
// eventually reads is the committed JSON and the rows loaded from it.
//
// WHAT THIS FILE IS NOT: it is not the loader. It opens no database connection,
// imports no client, and writes no row. The loader is S-E4 and it lives beside
// this file for ADR-008's reason. This is S-E3.
//
// -----------------------------------------------------------------------------
// THE ONE CLASS OF ERROR THIS FILE EXISTS TO REMOVE
// -----------------------------------------------------------------------------
// P1 S-E section 3.2 names DST as "the one class a careful reader still gets
// wrong", and the reason is that it is invisible: a session written 22:00Z when
// it should be 23:00Z looks exactly like a session written correctly, on a page
// of two hundred and fifty of them, and it is wrong for roughly a third of the
// year rather than all of it.
//
// So no CT wall time in this repository is ever converted by hand. Every UTC
// instant below is produced by `ctWallToInstant`, which converts through `Intl`
// with `timeZone: 'America/Chicago'` (Node ships the IANA database with full
// ICU and `.nvmrc` pins the Node version and therefore the tzdata) AND THEN
// RENDERS THE RESULT BACK AND REQUIRES AN EXACT MATCH. A conversion that cannot
// round-trip throws rather than returning its best guess.
//
// The generated file states BOTH the CT wall time and the UTC instant for every
// session, which is what lets the loader VERIFY rather than COMPUTE (S-E4).
// Two independent statements of one fact that must agree: this corpus's idiom,
// applied to the value it is hardest to eyeball.
// =============================================================================

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

export const GENERATOR_VERSION = 1;

/**
 * The exchange session timezone. ADR-042 and `0004_catalog`: "the exchange
 * session calendar (CT) is authoritative; storage is UTC". The IANA identifier
 * rather than `CST`/`CDT`, because the abbreviation is the half of the fact
 * that changes twice a year and the identifier is the half that does not.
 */
export const EXCHANGE_TZ = 'America/Chicago';

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// -----------------------------------------------------------------------------
// Failure
// -----------------------------------------------------------------------------
// Every rule below fails through `reject`, and every rule ships with a seeded
// violation in `packages/db/test/trading-calendar-generator.test.ts` that must
// fail ON ITS OWN FINDING rather than merely exit non-zero (P1 section 6). The
// `finding` string is what the test matches, so it is part of the contract and
// not a diagnostic nicety: a check that passes for the wrong reason and a check
// that fails for the wrong reason are the same defect.

export class CalendarSourceError extends Error {
  /** @param {string} finding @param {string} detail */
  constructor(finding, detail) {
    super(`${finding}: ${detail}`);
    this.name = 'CalendarSourceError';
    this.finding = finding;
    this.detail = detail;
  }
}

/** @returns {never} */
function reject(finding, detail) {
  throw new CalendarSourceError(finding, detail);
}

// -----------------------------------------------------------------------------
// Dates, held as components rather than as instants
// -----------------------------------------------------------------------------
// A `trading_day` is "the exchange CT trading day, never a UTC calendar date
// derived from a timestamp" (DATA_MODEL, B4 #1). So the day arithmetic here
// runs on year/month/day components and touches no timezone at all. `Date.UTC`
// is used as a calendar, never as a clock: it is the only correct arithmetic
// available for "the calendar day before this one" and it cannot be affected by
// the process timezone, which is what makes the TZ=Asia/Kolkata suite pass.

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const CT_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** @param {string} s @param {string} where */
export function parseDay(s, where) {
  const m = typeof s === 'string' && ISO_DAY.exec(s);
  if (!m) reject('day-not-iso', `${where} is ${JSON.stringify(s)}, expected YYYY-MM-DD`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Round-trip, because `2026-02-30` matches the pattern and is not a day.
  // `Date.UTC` normalises silently, which is exactly how a typo survives.
  if (toDayString({ y, mo, d }) !== s)
    reject('day-not-a-date', `${where} is ${s}, which is not a calendar date`);
  return { y, mo, d };
}

/** @param {{y:number,mo:number,d:number}} day */
export function toDayString(day) {
  const ms = Date.UTC(day.y, day.mo - 1, day.d);
  const dt = new Date(ms);
  const p = (n, w) => String(n).padStart(w, '0');
  return `${p(dt.getUTCFullYear(), 4)}-${p(dt.getUTCMonth() + 1, 2)}-${p(dt.getUTCDate(), 2)}`;
}

/** @param {{y:number,mo:number,d:number}} day @param {number} n */
export function addDays(day, n) {
  const dt = new Date(Date.UTC(day.y, day.mo - 1, day.d + n));
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** 0 = Sunday. Derived from the calendar, not from a clock or a locale. */
export function dayOfWeek(day) {
  return new Date(Date.UTC(day.y, day.mo - 1, day.d)).getUTCDay();
}

// -----------------------------------------------------------------------------
// CT wall time to UTC instant, converted through IANA and then PROVEN
// -----------------------------------------------------------------------------

const CT_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: EXCHANGE_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** The CT wall clock at a UTC instant. */
function ctWallAt(ms) {
  const p = {};
  for (const part of CT_PARTS.formatToParts(ms)) p[part.type] = part.value;
  return {
    y: Number(p.year),
    mo: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour),
    mi: Number(p.minute),
    s: Number(p.second),
  };
}

/**
 * The UTC offset of CT at a given instant, in milliseconds: CT wall clock minus
 * UTC, so it is NEGATIVE west of Greenwich and reads the same way round as the
 * `-06:00` in an ISO timestamp. -6h under CST, -5h under CDT, and the spring
 * forward is therefore an INCREASE.
 */
function ctOffsetMsAt(ms) {
  const w = ctWallAt(ms);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - ms;
}

/**
 * A CT wall time to the UTC instant it names.
 *
 * TWO PASSES AND THEN A PROOF. The first pass guesses the offset from the
 * pretend-it-is-UTC instant; on a DST transition day that guess can be an hour
 * out, and the second pass settles it. NEITHER PASS IS TRUSTED: the result is
 * rendered back into CT and required to equal the requested wall time exactly.
 *
 * The failure this refuses to paper over is a wall time that does not exist
 * (02:30 on a spring-forward Sunday) or names two instants (01:30 on a
 * fall-back Sunday). Neither 17:00 nor any close time this calendar uses is
 * near 02:00, so this cannot fire today; it is here because "cannot fire today"
 * is a fact about the current exception list and not about the function.
 *
 * @param {{y:number,mo:number,d:number}} day
 * @param {string} ctTime `HH:MM`, 24 hour
 * @param {string} where
 */
export function ctWallToInstant(day, ctTime, where) {
  const m = CT_TIME.exec(ctTime);
  if (!m)
    reject('ct-time-malformed', `${where} is ${JSON.stringify(ctTime)}, expected HH:MM (24 hour)`);
  const h = Number(m[1]);
  const mi = Number(m[2]);

  const asIfUtc = Date.UTC(day.y, day.mo - 1, day.d, h, mi, 0);
  let ms = asIfUtc - ctOffsetMsAt(asIfUtc);
  ms = asIfUtc - ctOffsetMsAt(ms);

  const back = ctWallAt(ms);
  if (
    back.y !== day.y ||
    back.mo !== day.mo ||
    back.d !== day.d ||
    back.h !== h ||
    back.mi !== mi ||
    back.s !== 0
  ) {
    reject(
      'ct-wall-time-does-not-round-trip',
      `${where}: ${toDayString(day)} ${ctTime} CT resolved to ${new Date(ms).toISOString()}, ` +
        `which renders back as ${toDayString(back)} ${String(back.h).padStart(2, '0')}:${String(back.mi).padStart(2, '0')} CT. ` +
        `A wall time that does not round-trip either does not exist or names two instants`,
    );
  }
  return ms;
}

/** `2026-11-01T17:00:00` — the CT wall time, stated so the loader can verify rather than compute. */
function ctWallString(day, ctTime) {
  return `${toDayString(day)}T${ctTime}:00`;
}

/** `2026-11-01T22:00:00Z`. Always `Z`, never a local rendering. */
function utcString(ms) {
  return new Date(ms).toISOString().replace(/\.000Z$/, 'Z');
}

/** `-06:00` / `-05:00`, for the DST block a reviewer reads. */
function offsetString(ms) {
  const off = ctOffsetMsAt(ms) / 60000;
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

// -----------------------------------------------------------------------------
// The source file
// -----------------------------------------------------------------------------

/**
 * Read and validate the hand-transcribed exception file.
 *
 * NULL IS NOT THE EMPTY LIST, and that distinction is the whole reason this
 * function refuses an untranscribed file loudly. `holidays: []` asserts that
 * the exchange closes on no day of the year; `holidays: null` asserts that
 * nobody has looked yet. The first is a wrong calendar that loads clean and
 * makes every counter advance through Christmas. The second cannot be loaded at
 * all. This is F-1's own lesson (a holiday is a POSITIVE FACT rather than an
 * absence) and F-4's (an uncovered day is UNKNOWN rather than a holiday),
 * applied one layer earlier, to the file.
 */
export function readSource(text, where = 'source') {
  let src;
  try {
    src = JSON.parse(text);
  } catch (e) {
    reject('source-not-json', `${where}: ${e.message}`);
  }
  if (src === null || typeof src !== 'object' || Array.isArray(src)) {
    reject('source-not-an-object', `${where} is ${Array.isArray(src) ? 'an array' : String(src)}`);
  }

  if (typeof src.id !== 'string' || src.id.trim() === '') {
    reject('source-id-missing', `${where} has no non-blank \`id\``);
  }

  if (src.status !== 'transcribed') {
    reject(
      'source-not-transcribed',
      `${where} declares status ${JSON.stringify(src.status)}. The generator runs only against ` +
        `\`"status": "transcribed"\`, which is the transcriber's positive statement that every ` +
        `exception below was read off the named publication. Any other status means the file is a ` +
        `shape awaiting its values`,
    );
  }

  for (const field of ['holidays', 'early_closes']) {
    if (src[field] === null || src[field] === undefined) {
      reject(
        'exception-list-not-transcribed',
        `${where}.${field} is ${String(src[field])}. NULL IS NOT THE EMPTY LIST: null says nobody ` +
          `has read the publication, [] asserts the publication lists none. If the exchange really ` +
          `publishes none, write [] and say so in \`notes\``,
      );
    }
    if (!Array.isArray(src[field]))
      reject('exception-list-not-an-array', `${where}.${field} is not an array`);
  }

  const provenance = readProvenance(src.provenance, `${where}.provenance`);
  const coverage = readCoverage(src.coverage, `${where}.coverage`);
  const rule = readSessionRule(src.session_rule, `${where}.session_rule`);

  const holidays = readHolidays(src.holidays, coverage, `${where}.holidays`);
  const earlyCloses = readEarlyCloses(
    src.early_closes,
    coverage,
    holidays,
    rule,
    `${where}.early_closes`,
  );

  return {
    id: src.id,
    provenance,
    coverage,
    rule,
    holidays,
    earlyCloses,
    declared: src.declared ?? null,
    raw: src,
  };
}

/**
 * The provenance block, ADR-042 verbatim: "source URL, retrieval date, the
 * retrieved artifact committed beside it, and its SHA-256".
 *
 * THE DIGEST HERE IS NOT THE DIGEST IN `trading_calendar_loads`, and confusing
 * the two is easy enough to be worth a paragraph. This one is the SHA-256 of
 * the RETRIEVED ARTIFACT, the bytes the exchange served, and it answers "is the
 * committed copy of the publication the one that was read". The one the loader
 * writes to `trading_calendar_loads.source_digest` is the SHA-256 of THIS FILE,
 * and it answers "are the rows in the database the ones this transcription
 * produced". Both are needed and neither substitutes for the other.
 */
function readProvenance(p, where) {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) {
    reject('provenance-missing', `${where} is absent or not an object`);
  }
  const out = {};
  for (const field of [
    'source_url',
    'retrieved_at',
    'artifact',
    'artifact_sha256',
    'retrieved_by',
  ]) {
    const v = p[field];
    if (typeof v !== 'string' || v.trim() === '') {
      reject(
        'provenance-field-missing',
        `${where}.${field} is ${JSON.stringify(v)}. TR-01: every value is transcribed from the ` +
          `named authority and never from an implementation, and a transcription that cannot name ` +
          `what it read is not a transcription`,
      );
    }
    out[field] = v;
  }
  if (!/^[0-9a-f]{64}$/.test(out.artifact_sha256)) {
    reject(
      'artifact-digest-not-sha256',
      `${where}.artifact_sha256 is not 64 lowercase hex characters`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.retrieved_at)) {
    reject(
      'retrieval-date-not-iso',
      `${where}.retrieved_at is ${JSON.stringify(out.retrieved_at)}`,
    );
  }
  return out;
}

/** Inclusive bounds, in the same date domain as `trading_calendar.trading_day`. */
function readCoverage(c, where) {
  if (c === null || typeof c !== 'object') reject('coverage-missing', `${where} is absent`);
  const from = parseDay(c.from, `${where}.from`);
  const to = parseDay(c.to, `${where}.to`);
  if (Date.UTC(to.y, to.mo - 1, to.d) < Date.UTC(from.y, from.mo - 1, from.d)) {
    reject('coverage-inverted', `${where} runs ${toDayString(from)} to ${toDayString(to)}`);
  }
  return { from, to };
}

/**
 * The session rule, held as DATA rather than as a constant in this file.
 *
 * P1 S-E section 3.1 states it: "every weekday inside coverage that is not a
 * holiday, 17:00 CT on the prior calendar day to 16:00 CT on the trading day".
 * It lives in the source file because the source file is what a reviewer reads
 * and what git diffs, and because a rule that changes (the exchange moves an
 * open) should move as a reviewed data change rather than as a code change that
 * silently rewrites every historical row on the next regeneration.
 */
function readSessionRule(r, where) {
  if (r === null || typeof r !== 'object') reject('session-rule-missing', `${where} is absent`);
  if (r.timezone !== EXCHANGE_TZ) {
    reject(
      'session-rule-timezone',
      `${where}.timezone is ${JSON.stringify(r.timezone)}, expected ${EXCHANGE_TZ}`,
    );
  }
  if (r.open_day_offset !== -1) {
    reject(
      'session-rule-open-offset',
      `${where}.open_day_offset is ${JSON.stringify(r.open_day_offset)}, expected -1. The session ` +
        `opens on the PRIOR CALENDAR DAY, which is why Monday's session opens on Sunday evening`,
    );
  }
  if (!CT_TIME.test(r.open_ct ?? ''))
    reject('ct-time-malformed', `${where}.open_ct is ${JSON.stringify(r.open_ct)}`);
  if (!CT_TIME.test(r.close_ct ?? ''))
    reject('ct-time-malformed', `${where}.close_ct is ${JSON.stringify(r.close_ct)}`);
  return { open_ct: r.open_ct, close_ct: r.close_ct, open_day_offset: -1, timezone: EXCHANGE_TZ };
}

function readHolidays(list, coverage, where) {
  const byDay = new Map();
  list.forEach((h, i) => {
    const at = `${where}[${i}]`;
    if (h === null || typeof h !== 'object') reject('holiday-not-an-object', at);
    const day = parseDay(h.day, `${at}.day`);
    const key = toDayString(day);
    if (byDay.has(key)) reject('holiday-duplicated', `${at}: ${key} is listed twice`);
    if (typeof h.name !== 'string' || h.name.trim() === '') {
      reject(
        'holiday-unnamed',
        `${at} has no non-blank \`name\`. The name is what the second reader diffs against`,
      );
    }
    requireInCoverage(day, coverage, at);
    const dow = dayOfWeek(day);
    if (dow === 0 || dow === 6) {
      reject(
        'holiday-on-a-weekend',
        `${at}: ${key} is a ${WEEKDAY_NAMES[dow]}. A weekend day already carries no session, so a ` +
          `holiday row for it is either a transcription slip or a claim the generator would silently ` +
          `drop. Neither is loadable`,
      );
    }
    byDay.set(key, { day, name: h.name, notes: typeof h.notes === 'string' ? h.notes : null });
  });
  return byDay;
}

/**
 * The early-close list. Each entry carries the day, the CT close time that
 * lands in `session_close_at`, and the per-group times that land in `notes`.
 *
 * ADR-042 F-3, and the two halves of it are enforced separately here because
 * they fail differently. `close_ct` is THE LATEST CLOSE across the product
 * groups `contract_specs` lists, and `notes` carries the per-group times. The
 * `notes` requirement mirrors `0032`'s
 * `trading_calendar_half_day_records_group_closes`, which "ASSERTS PRESENCE,
 * NEVER CONTENT: it cannot tell per-group close times from the word yes". This
 * function is no cleverer, and says so rather than implying more.
 */
function readEarlyCloses(list, coverage, holidays, rule, where) {
  const byDay = new Map();
  list.forEach((e, i) => {
    const at = `${where}[${i}]`;
    if (e === null || typeof e !== 'object') reject('early-close-not-an-object', at);
    const day = parseDay(e.day, `${at}.day`);
    const key = toDayString(day);
    if (byDay.has(key)) reject('early-close-duplicated', `${at}: ${key} is listed twice`);
    requireInCoverage(day, coverage, at);

    const dow = dayOfWeek(day);
    if (dow === 0 || dow === 6) {
      reject(
        'early-close-on-a-weekend',
        `${at}: ${key} is a ${WEEKDAY_NAMES[dow]} and carries no session to shorten`,
      );
    }
    if (holidays.has(key)) {
      reject(
        'early-close-on-a-holiday',
        `${at}: ${key} is also listed as a holiday (${holidays.get(key).name}). A holiday has no ` +
          `session (ADR-042 F-1), so it has no close to bring forward. If the exchange trades a ` +
          `shortened session that day it is an EARLY CLOSE and not a holiday, and the two lists ` +
          `disagree about which`,
      );
    }
    if (!CT_TIME.test(e.close_ct ?? ''))
      reject('ct-time-malformed', `${at}.close_ct is ${JSON.stringify(e.close_ct)}`);
    if (e.close_ct >= rule.close_ct) {
      reject(
        'early-close-not-early',
        `${at}: ${key} closes at ${e.close_ct} CT, which is not before the regular ${rule.close_ct} CT. ` +
          `An "early" close at or after the regular close is a transcription slip, and it would set ` +
          `is_half_day on a full day`,
      );
    }
    if (typeof e.notes !== 'string' || e.notes.trim() === '') {
      reject(
        'early-close-notes-blank',
        `${at}.notes is blank. ADR-042 F-3: session_close_at carries the LATEST close across ES, ` +
          `MES, NQ, MNQ, CL and GC, and the PER-GROUP times go in notes, because session_close_at ` +
          `carries only one of them. 0032's trading_calendar_half_day_records_group_closes rejects ` +
          `the row at the database anyway; failing here says why`,
      );
    }
    byDay.set(key, { day, close_ct: e.close_ct, notes: e.notes });
  });
  return byDay;
}

function requireInCoverage(day, coverage, where) {
  const ms = Date.UTC(day.y, day.mo - 1, day.d);
  const lo = Date.UTC(coverage.from.y, coverage.from.mo - 1, coverage.from.d);
  const hi = Date.UTC(coverage.to.y, coverage.to.mo - 1, coverage.to.d);
  if (ms < lo || ms > hi) {
    reject(
      'exception-outside-coverage',
      `${where}: ${toDayString(day)} is outside coverage ${toDayString(coverage.from)}..${toDayString(coverage.to)}. ` +
        `An exception the generator never reaches is a transcribed value that silently does nothing`,
    );
  }
}

// -----------------------------------------------------------------------------
// DST, discovered from IANA rather than recalled
// -----------------------------------------------------------------------------

/**
 * Every day inside coverage on which the CT offset changes, found by walking
 * the coverage window and asking `Intl` what the offset is. THE TRANSITIONS ARE
 * DISCOVERED, NEVER LISTED: a hand-written list of transition dates is one more
 * hand-maintained calendar, which is the drift class this whole session exists
 * to remove.
 *
 * The offsets are sampled at 06:00 CT, which is after the 02:00 transition on
 * both the spring-forward and the fall-back day and before it on the day
 * before, so a change between consecutive samples locates the transition on the
 * later day exactly.
 */
export function findDstTransitions(coverage) {
  const out = [];
  const last = addDays(coverage.to, 0);
  let day = coverage.from;
  let prevOffset = ctOffsetMsAt(Date.UTC(day.y, day.mo - 1, day.d, 12));

  for (;;) {
    day = addDays(day, 1);
    if (Date.UTC(day.y, day.mo - 1, day.d) > Date.UTC(last.y, last.mo - 1, last.d)) break;
    const sample = Date.UTC(day.y, day.mo - 1, day.d, 12);
    const offset = ctOffsetMsAt(sample);
    if (offset !== prevOffset) {
      out.push({
        day: toDayString(day),
        weekday: WEEKDAY_NAMES[dayOfWeek(day)],
        from_offset: offsetString(Date.UTC(day.y, day.mo - 1, day.d - 1, 12)),
        to_offset: offsetString(sample),
        // The offset is CT minus UTC, so springing forward RAISES it: -06:00
        // becomes -05:00. Written out because the arithmetic reads backwards to
        // anyone holding the other sign convention in their head.
        kind: offset > prevOffset ? 'spring_forward' : 'fall_back',
      });
      prevOffset = offset;
    }
  }
  return out;
}

/**
 * The transitions IANA reports, checked against the rule the United States
 * publishes: DST begins on the SECOND SUNDAY IN MARCH and ends on the FIRST
 * SUNDAY IN NOVEMBER.
 *
 * TWO INDEPENDENT STATEMENTS OF ONE FACT THAT MUST AGREE, which is this
 * corpus's idiom and is the only form of DST check that can fail. Asserting
 * that `Intl` agrees with itself proves nothing. This fires the day tzdata
 * changes underneath a pinned Node, which is not hypothetical: permanent-DST
 * legislation has been introduced repeatedly, and the failure mode without this
 * check is that a `pnpm install` moves two hundred and fifty session boundaries
 * by an hour and every test still passes because every side of the comparison
 * moved together.
 */
export function checkDstTransitions(transitions, coverage) {
  for (const t of transitions) {
    const day = parseDay(t.day, 'dst transition');
    if (t.weekday !== 'Sunday') {
      reject('dst-transition-not-on-a-sunday', `${t.day} is a ${t.weekday}`);
    }
    const expected =
      t.kind === 'spring_forward'
        ? nthWeekdayOfMonth(day.y, 3, 0, 2)
        : nthWeekdayOfMonth(day.y, 11, 0, 1);
    if (t.day !== expected) {
      reject(
        'dst-transition-off-the-published-rule',
        `IANA puts the ${t.kind.replace('_', ' ')} on ${t.day}; the published United States rule ` +
          `(second Sunday in March, first Sunday in November) puts it on ${expected}. One of the two ` +
          `has moved and a human has to say which`,
      );
    }
    if (t.kind === 'spring_forward' && !(t.from_offset === '-06:00' && t.to_offset === '-05:00')) {
      reject(
        'dst-offset-unexpected',
        `${t.day} springs forward ${t.from_offset} -> ${t.to_offset}, expected -06:00 -> -05:00`,
      );
    }
    if (t.kind === 'fall_back' && !(t.from_offset === '-05:00' && t.to_offset === '-06:00')) {
      reject(
        'dst-offset-unexpected',
        `${t.day} falls back ${t.from_offset} -> ${t.to_offset}, expected -05:00 -> -06:00`,
      );
    }
  }

  // Exactly two per calendar year FULLY inside coverage. A year with one is a
  // partial window read as a whole one; a year with three is tzdata disagreeing
  // with itself. Years clipped by the coverage bounds are skipped rather than
  // guessed at.
  const counts = new Map();
  for (const t of transitions)
    counts.set(t.day.slice(0, 4), (counts.get(t.day.slice(0, 4)) ?? 0) + 1);
  for (let y = coverage.from.y; y <= coverage.to.y; y++) {
    const whole =
      Date.UTC(coverage.from.y, coverage.from.mo - 1, coverage.from.d) <= Date.UTC(y, 0, 1) &&
      Date.UTC(coverage.to.y, coverage.to.mo - 1, coverage.to.d) >= Date.UTC(y, 11, 31);
    if (!whole) continue;
    const n = counts.get(String(y)) ?? 0;
    if (n !== 2)
      reject(
        'dst-transition-count',
        `${y} is fully inside coverage and has ${n} CT offset changes, expected 2`,
      );
  }
  return transitions;
}

/** `nth` is 1-based. `weekday` is 0 = Sunday. */
function nthWeekdayOfMonth(year, month, weekday, nth) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
  return toDayString({ y: year, mo: month, d: day });
}

// -----------------------------------------------------------------------------
// Generation
// -----------------------------------------------------------------------------

/**
 * One `trading_calendar` row, as `0032` defines it, plus the CT wall times.
 *
 * The four session fields are ALL-OR-NOTHING, and the type says so the same way
 * `trading_calendar_session_ordered` does: a holiday carries four nulls, a
 * session carries four strings. `0032`'s header calls the half-populated state
 * the most dangerous line in that file, and a shape that admits it here is how
 * one reaches the loader.
 *
 * Declared as a typedef rather than left to inference because the loader (S-E4)
 * and the test suite both consume it, and an inferred `any[]` is a contract
 * nobody can typecheck against.
 *
 * @typedef {object} CalendarRow
 * @property {string} trading_day
 * @property {boolean} is_holiday
 * @property {boolean} is_half_day
 * @property {boolean} halted
 * @property {string|null} session_open_ct  CT wall time, `YYYY-MM-DDTHH:MM:SS`
 * @property {string|null} session_open_at  the UTC instant it names
 * @property {string|null} session_close_ct
 * @property {string|null} session_close_at
 * @property {string|null} notes
 */

/**
 * The exception list to the full row set.
 *
 * Every row carries BOTH the CT wall time and the UTC instant, per P1 S-E
 * section 3.2, so that the loader verifies rather than computes and a reviewer
 * reading the committed file can see the hour the exchange means beside the
 * hour the database will hold.
 *
 * @returns {CalendarRow[]}
 */
export function generate(source) {
  const { coverage, rule, holidays, earlyCloses } = source;
  /** @type {CalendarRow[]} */
  const rows = [];
  const seenHolidays = new Set();
  const seenEarlyCloses = new Set();

  const hi = Date.UTC(coverage.to.y, coverage.to.mo - 1, coverage.to.d);
  for (let day = coverage.from; Date.UTC(day.y, day.mo - 1, day.d) <= hi; day = addDays(day, 1)) {
    const key = toDayString(day);
    const dow = dayOfWeek(day);

    // Saturday and Sunday carry no row at all. Sunday is not a trading day: the
    // Sunday 17:00 CT open is MONDAY's session opening on the prior calendar
    // day, which is the whole reason `open_day_offset` is -1.
    if (dow === 0 || dow === 6) continue;

    const holiday = holidays.get(key);
    if (holiday) {
      seenHolidays.add(key);
      // F-1. A holiday is a POSITIVE FACT with no session, never a fabricated
      // interval, because R-01 is a containment lookup and a fabricated
      // interval is an interval a fill can fall inside.
      rows.push({
        trading_day: key,
        is_holiday: true,
        is_half_day: false,
        halted: false,
        session_open_ct: null,
        session_open_at: null,
        session_close_ct: null,
        session_close_at: null,
        notes: holiday.notes ? `${holiday.name}. ${holiday.notes}` : holiday.name,
      });
      continue;
    }

    const early = earlyCloses.get(key);
    if (early) seenEarlyCloses.add(key);
    const closeCt = early ? early.close_ct : rule.close_ct;
    const openDay = addDays(day, rule.open_day_offset);

    rows.push({
      trading_day: key,
      is_holiday: false,
      is_half_day: Boolean(early),
      halted: false,
      session_open_ct: ctWallString(openDay, rule.open_ct),
      session_open_at: utcString(ctWallToInstant(openDay, rule.open_ct, `${key} open`)),
      session_close_ct: ctWallString(day, closeCt),
      session_close_at: utcString(ctWallToInstant(day, closeCt, `${key} close`)),
      notes: early ? early.notes : null,
    });
  }

  // An exception inside coverage that produced no row is a transcribed value
  // that did nothing, and it is the failure a reader cannot see by looking at
  // the output: the output looks exactly like a calendar with one fewer
  // holiday. `requireInCoverage` catches the out-of-range case; this catches
  // the in-range case the generation loop never reached.
  for (const key of holidays.keys()) {
    if (!seenHolidays.has(key))
      reject('holiday-produced-no-row', `${key} is inside coverage and generated nothing`);
  }
  for (const key of earlyCloses.keys()) {
    if (!seenEarlyCloses.has(key))
      reject('early-close-produced-no-row', `${key} is inside coverage and generated nothing`);
  }

  return rows;
}

/**
 * The structural layer of P1 S-E section 3.2, run over the generated rows
 * rather than over the source, because it is the ROWS that reach the database.
 *
 * The last check is the one that matters most and is the least obvious. R-01 is
 * a containment lookup, so the property the calendar owes the engine is that no
 * instant falls inside two sessions. Asserting `next.open > prev.close` over
 * consecutive rows proves it for the whole file in one pass, and it is what
 * makes F-3's "the latest close cannot orphan a fill" checkable rather than
 * argued: bring a close time forward and nothing breaks, push one past the
 * following 17:00 open and this fires.
 *
 * @param {CalendarRow[]} rows
 * @returns {CalendarRow[]}
 */
export function checkRows(rows, source) {
  /** @type {CalendarRow|null} */
  let prev = null;
  for (const row of rows) {
    const day = parseDay(row.trading_day, 'generated row');
    const dow = dayOfWeek(day);
    if (dow === 0 || dow === 6)
      reject('session-on-a-weekend', `${row.trading_day} is a ${WEEKDAY_NAMES[dow]}`);

    if (row.is_holiday) {
      if (row.session_open_at !== null || row.session_close_at !== null) {
        reject(
          'holiday-carries-a-session',
          `${row.trading_day} is a holiday and carries session instants (0032 F-1)`,
        );
      }
      if (row.is_half_day)
        reject(
          'holiday-is-also-a-half-day',
          `${row.trading_day} (0004's trading_calendar_holiday_not_half_day)`,
        );
    } else {
      if (row.session_open_at === null || row.session_close_at === null) {
        reject(
          'session-missing-instants',
          `${row.trading_day} is not a holiday and carries no session`,
        );
      }
      if (!(Date.parse(row.session_close_at) > Date.parse(row.session_open_at))) {
        reject(
          'session-not-ordered',
          `${row.trading_day}: close ${row.session_close_at} is not after open ${row.session_open_at}`,
        );
      }
      // The CT/UTC pair, re-derived. The loader will do this again against the
      // database; doing it here means a bad pair never reaches a review.
      for (const [ctField, utcField] of [
        ['session_open_ct', 'session_open_at'],
        ['session_close_ct', 'session_close_at'],
      ]) {
        const [dayPart, timePart] = row[ctField].split('T');
        const expect = utcString(
          ctWallToInstant(
            parseDay(dayPart, ctField),
            timePart.slice(0, 5),
            `${row.trading_day} ${ctField}`,
          ),
        );
        if (expect !== row[utcField]) {
          reject(
            'ct-and-utc-disagree',
            `${row.trading_day}: ${row[ctField]} CT is ${expect}, but ${utcField} says ${row[utcField]}. ` +
              `This is the DST class P1 S-E section 3.2 names, and it is why both are stated`,
          );
        }
      }
      if (row.is_half_day && (row.notes === null || row.notes.trim() === '')) {
        reject(
          'half-day-records-no-group-closes',
          `${row.trading_day} (0032's trading_calendar_half_day_records_group_closes)`,
        );
      }
      if (prev && !(Date.parse(row.session_open_at) > Date.parse(prev.session_close_at))) {
        reject(
          'sessions-overlap',
          `${row.trading_day} opens ${row.session_open_at}, which is not after ${prev.trading_day}'s close ` +
            `${prev.session_close_at}. R-01 is a containment lookup and an overlap puts one fill in two sessions`,
        );
      }
      prev = row;
    }
  }

  const declared = source.declared;
  if (declared) {
    const actual = {
      holiday_count: rows.filter((r) => r.is_holiday).length,
      early_close_count: rows.filter((r) => r.is_half_day).length,
      session_count: rows.filter((r) => !r.is_holiday).length,
    };
    for (const k of Object.keys(actual)) {
      if (declared[k] !== undefined && declared[k] !== null && declared[k] !== actual[k]) {
        reject(
          'declared-count-disagrees',
          `\`declared.${k}\` is ${declared[k]} and the file generates ${actual[k]}. Two independent ` +
            `statements of one number that must agree, which is the point of stating it twice`,
        );
      }
    }
  }
  return rows;
}

// -----------------------------------------------------------------------------
// OQ-SE-04: the second, blind transcription
// -----------------------------------------------------------------------------

/**
 * Diff two independent transcriptions of the same publication and require the
 * difference to be empty.
 *
 * ADR-042, OQ-SE-04, ruled: "second transcription, and THE BLINDNESS IS THE
 * CONDITION. A second reader who can see the first rationalises disagreements
 * rather than surfacing them. Transcribe independently, diff, require it
 * empty."
 *
 * THIS FUNCTION CANNOT ENFORCE THE BLINDNESS AND MUST NOT BE READ AS DOING SO.
 * It enforces the diff. The blindness is a property of how the second file came
 * to exist, and the only thing that can hold it is the procedure in README.md
 * plus a human who followed it. Saying so here is better than a green check
 * that implies more than it proved, which is `falsify.mjs`'s standing lesson:
 * a check that cannot fail is not a check.
 *
 * Provenance is compared on `source_url` and `artifact_sha256` only: the two
 * readers must have read the SAME BYTES, and they will differ on
 * `retrieved_at`, `retrieved_by` and `id`, which is what independence looks
 * like rather than a disagreement.
 */
export function diffTranscriptions(a, b) {
  const differences = [];

  if (a.provenance.artifact_sha256 !== b.provenance.artifact_sha256) {
    differences.push(
      `provenance.artifact_sha256: ${a.provenance.artifact_sha256} vs ${b.provenance.artifact_sha256}. ` +
        `The two readers did not read the same bytes, so an empty diff below would prove nothing`,
    );
  }
  if (a.provenance.source_url !== b.provenance.source_url) {
    differences.push(
      `provenance.source_url: ${a.provenance.source_url} vs ${b.provenance.source_url}`,
    );
  }
  for (const field of ['from', 'to']) {
    const [x, y] = [toDayString(a.coverage[field]), toDayString(b.coverage[field])];
    if (x !== y) differences.push(`coverage.${field}: ${x} vs ${y}`);
  }
  for (const field of ['open_ct', 'close_ct']) {
    if (a.rule[field] !== b.rule[field])
      differences.push(`session_rule.${field}: ${a.rule[field]} vs ${b.rule[field]}`);
  }

  // Holidays are compared on day AND name. The name is not decoration: two
  // readers agreeing that the exchange is shut on a day while disagreeing about
  // which holiday it is means at least one of them read a different row.
  diffMaps(differences, 'holiday', a.holidays, b.holidays, (h) => h.name);
  // Early closes are compared on day AND close time. `notes` is deliberately
  // NOT compared: it is per-group prose, F-3 requires its presence rather than
  // its wording, and requiring two readers to phrase it identically would push
  // the second reader toward copying the first, which is the one thing the
  // ruling forbids.
  diffMaps(differences, 'early close', a.earlyCloses, b.earlyCloses, (e) => e.close_ct);

  return differences;
}

function diffMaps(out, label, a, b, valueOf) {
  for (const [key, va] of a) {
    if (!b.has(key))
      out.push(`${label} ${key} (${valueOf(va)}) is in the first transcription and not the second`);
    else if (valueOf(va) !== valueOf(b.get(key))) {
      out.push(`${label} ${key}: first says ${valueOf(va)}, second says ${valueOf(b.get(key))}`);
    }
  }
  for (const [key, vb] of b) {
    if (!a.has(key))
      out.push(`${label} ${key} (${valueOf(vb)}) is in the second transcription and not the first`);
  }
}

// -----------------------------------------------------------------------------
// The whole build
// -----------------------------------------------------------------------------

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Source text to the committed generated file, every layer run.
 *
 * `source_sha256` is the digest of the SOURCE FILE, which is the value the
 * loader writes to `trading_calendar_loads.source_digest`. It is stated here so
 * the generated artifact names the exact input that produced it, and so a
 * generated file that has drifted from its source is a one-line check rather
 * than a re-run.
 */
export function build(sourceText, { sourceFile } = {}) {
  const source = readSource(sourceText, sourceFile ?? 'source');
  const rows = checkRows(generate(source), source);
  const transitions = checkDstTransitions(findDstTransitions(source.coverage), source.coverage);

  return {
    id: source.id,
    generated_by: 'packages/db/src/seed/calendars/generate.mjs',
    generator_version: GENERATOR_VERSION,
    note:
      'GENERATED, COMMITTED AND REVIEWED. Do not edit: edit the source file and regenerate. ' +
      'ADR-042 and P1 S-E section 3.1 hold the exceptions by hand and generate the sessions, because ' +
      'hand-maintaining a full year is two hundred and fifty chances to be wrong.',
    source_file: sourceFile ? basename(sourceFile) : null,
    source_sha256: sha256Hex(sourceText),
    provenance: source.provenance,
    coverage: { from: toDayString(source.coverage.from), to: toDayString(source.coverage.to) },
    session_rule: source.rule,
    counts: {
      holiday_count: rows.filter((r) => r.is_holiday).length,
      early_close_count: rows.filter((r) => r.is_half_day).length,
      session_count: rows.filter((r) => !r.is_holiday).length,
      row_count: rows.length,
    },
    dst_transitions: transitions,
    rows,
  };
}

export function serialize(generated) {
  return `${JSON.stringify(generated, null, 2)}\n`;
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------
//
//   node generate.mjs <source.json> --out <generated.json>
//   node generate.mjs <source.json> --check <generated.json>   regenerate and diff
//   node generate.mjs --diff <first.json> <second.json>        OQ-SE-04
//
// `--check` is what CI-06m calls (S-E5): regenerate and require no difference,
// which is the pattern `corpus.yml` already uses for generated spans.

function main(argv) {
  if (argv[0] === '--diff') {
    const [, first, second] = argv;
    if (!first || !second) fail('usage: generate.mjs --diff <first.json> <second.json>');
    const a = readSource(readFileSync(resolve(first), 'utf8'), first);
    const b = readSource(readFileSync(resolve(second), 'utf8'), second);
    const differences = diffTranscriptions(a, b);
    if (differences.length > 0) {
      process.stderr.write(
        `OQ-SE-04: the two transcriptions disagree in ${differences.length} place(s). The ruling requires the diff to be EMPTY.\n\n` +
          differences.map((d) => `  - ${d}\n`).join('') +
          `\nResolve each against the publication itself, never by picking one reader.\n`,
      );
      process.exit(1);
    }
    process.stdout.write(
      `OQ-SE-04: the two transcriptions agree (${a.holidays.size} holidays, ${a.earlyCloses.size} early closes).\n` +
        `This proves the DIFF was empty. It does not prove the second reader was BLIND to the first;\n` +
        `only the procedure in README.md and the human who followed it can hold that.\n`,
    );
    return;
  }

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
    if (e instanceof CalendarSourceError) fail(`REJECTED [${e.finding}] ${e.detail}`);
    throw e;
  }
}
