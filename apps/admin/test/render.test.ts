import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { renderToStaticMarkup } from 'react-dom/server';

import LiabilityHomeRoute from '../src/app/page.tsx';
import {
  LiabilityHomeDocument,
  assertServedLiabilityHomeStrings,
  collectServedStrings,
  renderLiabilityHomeDocument,
  servedLiabilityHomeStrings,
} from '../src/app/liability-home.tsx';
import { TRUST_KEYS, type TrustSignal } from '../src/data-trust.ts';
import {
  type LiabilityHomeInput,
  type LiabilityHomePage,
  PageError,
  buildLiabilityHome,
  renderLiabilityHome,
} from '../src/page.ts';

// =============================================================================
// THE SERVED BYTES, WHICH IS THE SURFACE WAVE-06 SECTION 5.2 IS ABOUT
// =============================================================================
// "A React page renders a DOM, not a line array. If `W6-d` and `W6-f` build the
// document from the STRUCTURED value and leave the assertions reading the lines,
// the two controls stop covering the bytes an operator sees, and both suites
// stay green."
//
// So every assertion in this file reads the BYTES: `servedBytes` below is
// `renderToStaticMarkup` over the same element tree the framework renders. None
// of them reads `renderLiabilityHome`'s array except where the point is to
// COMPARE the two, and `test/page.test.ts` keeps the array's own cases.
//
// THE MARKUP RENDER LIVES HERE AND NOT IN THE SOURCE, WHICH IS THE FRAMEWORK'S
// RULING RATHER THAN A CHOICE. `next build` refuses `react-dom/server` inside a
// Server Component's import graph, naming this file and the trace through
// `src/app/page.tsx`, so the control that ships walks the element tree instead
// (`servedLiabilityHomeStrings`). This suite is a test file and is in no route
// graph, so it can render the real markup, and `M6-A-42` is what binds the two:
// every string the shipped walk collects is in the bytes this renderer emits.
//
// THE FIXTURE IS `test/page.test.ts`'s INPUT, DELIBERATELY. A second book here
// would be a second answer to "what does a coherent snapshot look like", and
// `M6-A-32` already owns the incoherent ones. The origin is a reserved
// `.invalid` host for the reason `test/surface.test.ts` permits exactly those:
// WAVE-06 rule 3 refuses a real hostname in a test fixture.

const RENDERED_AT = '2026-08-21T13:00:00.000Z';
const TRUST_AS_OF = { instant: '2026-08-21T12:30:00.000Z', source: 'M2 recon status' };
const ADMIN_ORIGIN = 'https://ops.example.invalid';

const green = (): TrustSignal[] =>
  TRUST_KEYS.map((key) => ({ key, state: 'ok', detail: '0', asOf: TRUST_AS_OF }));

const INPUT: LiabilityHomeInput = {
  env: {
    ADMIN_ORIGIN,
    SITE_ORIGIN: 'https://example.test',
    PORTAL_ORIGIN: 'https://app.example.test',
  },
  role: 'readonly',
  renderedAt: RENDERED_AT,
  snapshot: {
    asOfInstant: '2026-08-20T21:00:00.000Z',
    withdrawableAcrossFundedCents: 500_000n,
    walletBalancesCents: 250_000n,
    boundedNearTermCents: 150_000n,
    remainingLadderExposureCents: 900_000n,
  },
  absorbedCorrectionsCents: -1_250n,
  trustSignals: green(),
};

/**
 * The bytes a browser receives for this document.
 *
 * THE COMPONENT IS CALLED RATHER THAN WRITTEN AS AN ELEMENT because this file
 * is `.ts`: WAVE-06's `W6-d` row names `test/render.test.ts` and a `.tsx` suite
 * would be a second filename in a fence that spells one. `renderToStaticMarkup`
 * renders the returned tree either way, including the nested components.
 */
function servedBytes(page: LiabilityHomePage): string {
  return renderToStaticMarkup(LiabilityHomeDocument({ page }));
}

/**
 * Source with comments removed, so a needle named in prose is not a finding.
 *
 * `test/surface.test.ts` carries the same function and the same reason,
 * including the lookbehind: stripping `//` unconditionally deletes the second
 * half of a `https://host` before a sweep can read it.
 */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
    .replaceAll(/(?<!:)\/\/[^\n]*/g, ' ');
}

/**
 * The markup's text, with tags removed and the five entities React escapes
 * decoded.
 *
 * A LINE'S OWN CHARACTERS ARE NOT WHAT THE ASSERTIONS ARE ABOUT. `formatCents`
 * prints an apostrophe-free amount and a definition does not, so a raw
 * `includes` over markup would fail on the quoting rather than on the content.
 * The INV-M6-10 sweep below reads the RAW markup for the opposite reason: an
 * identifier in an attribute is served too.
 */
function text(markup: string): string {
  return markup
    .replaceAll(/<[^>]*>/g, '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

describe('M6-A-38: the document is the page VALUE, and P-M6-09 is above every number', () => {
  const page = buildLiabilityHome(INPUT);
  const markup = servedBytes(page);
  const body = text(markup);

  test('the trust banner is served before the first figure, in the bytes', () => {
    // THE ORDER IS ASSERTED OVER THE BYTES AND NOT OVER THE ELEMENT TREE,
    // because M06 section 3.1's requirement is about what an operator reads
    // first: "Rendering them adjacent, with the trust panel above, is the
    // difference between a dashboard and a dashboard that misleads."
    const banner = markup.indexOf(page.banner);
    const firstFigure = markup.indexOf('7500.00');
    expect(banner).toBeGreaterThanOrEqual(0);
    expect(firstFigure).toBeGreaterThanOrEqual(0);
    expect(banner).toBeLessThan(firstFigure);
  });

  test('the banner is printed once and not twice', () => {
    // `page.banner` and the trust panel's own statement are the same string,
    // so a document that rendered both would print one sentence twice.
    expect(body.split(page.banner).length - 1).toBe(1);
  });

  test('every panel is served, in page order, with its origin and title', () => {
    const positions = page.panels.map((panel) => markup.indexOf(`data-origin="${panel.origin}"`));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const panel of page.panels) expect(body).toContain(`[${panel.origin}] ${panel.title}`);
  });

  test('every line of every panel reaches the served text', () => {
    for (const panel of page.panels)
      for (const line of panel.lines) {
        if (line === page.banner) continue;
        expect(body).toContain(line);
      }
  });

  test('the five panels nobody fills are served as NOT BUILT with what blocks them', () => {
    for (const pending of page.pending)
      expect(body).toContain(
        `[${pending.origin}] ${pending.title}: NOT BUILT, blocked by ${pending.blockedBy}`,
      );
    expect(body.split('NOT BUILT').length - 1).toBe(page.pending.length);
  });

  test('the live figure is served as its stated suppression when nothing supplies it', () => {
    expect(markup).toContain('data-live="suppressed"');
    expect(body).toContain('Open liability, live: suppressed: no indicative feed reading');
  });

  test('THE RESOLVED ADMIN ORIGIN IS ON THE PAGE VALUE AND IS NOT IN THE BYTES', () => {
    // ADR-012 over the one artifact a console produces. `page.origin` is the
    // resolved value and the document renders nothing from it, so a screenshot
    // of this page carries no hostname.
    expect(page.origin.origin).toBe(ADMIN_ORIGIN);
    expect(markup).not.toContain('ops.example');
    expect(markup).not.toContain(ADMIN_ORIGIN);
  });
});

describe('M6-A-39: the trust verdict is INHERITED and never recomputed', () => {
  const red = buildLiabilityHome({
    ...INPUT,
    trustSignals: green().map((signal) =>
      signal.key === 'recon_mismatches_open'
        ? { ...signal, state: 'red' as const, detail: '3 mismatches open' }
        : signal,
    ),
  });
  const markup = servedBytes(red);

  test('the verdict the document serves is the verdict the read produced', () => {
    expect(red.dataTrust.verdict).toBe('red');
    expect(markup).toContain('data-trust="red"');
  });

  test('every number below a red board carries the word in the served text', () => {
    const body = text(markup);
    expect(body).toContain('DATA TRUST IS RED');
    for (const panel of red.panels.slice(1))
      for (const line of panel.lines) expect(body).toContain(line);
    expect(markup).toContain('data-suspect="true"');
  });

  test('the document module computes no verdict of its own, read from its source', () => {
    // THE MECHANICAL HALF OF "INHERITED RATHER THAN RECOMPUTED". A console that
    // called `assessDataTrust` on inputs of its own would be a second opinion
    // where M06 section 3.1 requires one, and the two would agree until the day
    // they did not.
    //
    // COMMENTS ARE STRIPPED FIRST, which is `test/surface.test.ts`'s rule and
    // the same one: a needle named in prose is not a finding, and this file's
    // header names it twice while arguing why it is absent.
    const source = code(join(import.meta.dirname, '..', 'src', 'app', 'liability-home.tsx'));
    expect(source).not.toContain('assessDataTrust');
    expect(source).not.toContain("from '../data-trust.ts'");
  });
});

describe('M6-A-40: INV-M6-10 is re-pointed at the served bytes', () => {
  // THE SEED IS A SUBJECT NAME ARRIVING THROUGH A FEED-SUPPLIED STRING, which
  // is the one shape that reaches an operator today without the builder's own
  // assertion seeing it. `liveOpenLiability` puts `movement.feed` into the live
  // figure's `asOf.source` (`src/live-liability.ts`), and `buildLiabilityHome`
  // applies `assertNamesNoSubject` to `panels.flatMap(lines)`, which is the
  // panels and not the live line.
  const SUBJECT = '0e9c0b3a-1f2d-4c5e-8a7b-9d0e1f2a3b4c';

  const seeded = (): LiabilityHomePage =>
    buildLiabilityHome({
      ...INPUT,
      live: {
        movement: {
          cents: 12_500n,
          asOfInstant: '2026-08-21T12:59:00.000Z',
          feed: `indicative feed for identity ${SUBJECT}`,
        },
        sameDayAdjustments: { cents: 0n, asOfInstant: '2026-08-21T12:00:00.000Z' },
      },
    });

  test('the builder assembles the page without catching it, which is the gap', () => {
    // NOT A COMPLAINT ABOUT `page.ts`, WHICH IS `P5-l`'s FILE AND NOT THIS
    // SLICE'S. It is the measurement that makes the re-point load bearing: the
    // control that runs inside the builder does not cover this string, and the
    // control that runs on the served bytes does.
    const page = seeded();
    expect(page.live.kind).toBe('indicative');
    expect(renderLiabilityHome(page).join('\n')).toContain(SUBJECT);
  });

  test('the served bytes refuse it', () => {
    expect(() => assertServedLiabilityHomeStrings(seeded())).toThrow(PageError);
  });

  test('the refusal is ON THE RENDER PATH and not only in this suite', () => {
    // `renderLiabilityHomeDocument` is what `src/app/page.tsx` calls, and the
    // component it wraps is what would render without it. Both are exercised so
    // the guard is proved to be the thing that fires.
    expect(() => renderLiabilityHomeDocument(seeded())).toThrow(PageError);
    expect(() => LiabilityHomeDocument({ page: seeded() })).not.toThrow();
  });

  test('the assembled page with no seed passes over its whole document', () => {
    expect(() => renderLiabilityHomeDocument(buildLiabilityHome(INPUT))).not.toThrow();
  });

  test('the sweep reads the raw markup, so an identifier in an attribute is in scope', () => {
    // WHAT THIS DOES AND DOES NOT PROVE, STATED RATHER THAN IMPLIED. The
    // assertion runs over the markup, so an attribute value is inside it. The
    // document as written today puts nothing in an attribute that is not also
    // in the text, so this case proves the SCOPE of the sweep rather than a
    // defect it alone can catch: the seeded id is in `data-origin` and in the
    // heading both. A screen that later renders a subject id on a link and
    // nowhere else is caught by this and by nothing else in the package.
    const page = buildLiabilityHome(INPUT);
    const first = page.panels[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const tampered = {
      ...page,
      panels: [{ ...first, origin: SUBJECT }, ...page.panels.slice(1)],
    };
    expect(servedBytes(tampered)).toContain(`data-origin="${SUBJECT}"`);
    expect(() => assertServedLiabilityHomeStrings(tampered)).toThrow(PageError);
  });
});

describe('M6-A-41: the transport narrowing reaches the files this slice added', () => {
  // `test/surface.test.ts` asserts exactly one `fetch(` in this package and its
  // own header names this slice: "`W6-d` adds `.tsx` ... All three are covered
  // on arrival by walking every file, and none of them would be covered by a
  // `.ts` filter." That is TRUE of its origin and prefix sweeps, which walk
  // every file in the package, and FALSE of its transport sweep, which walks
  // `sourceFiles()`: `.ts` only. So the `.tsx` this slice lands is outside the
  // one-`fetch` narrowing.
  //
  // THE REPAIR IS `W6-c`'s FILE AND THIS SLICE MAY NOT TAKE IT (WAVE-06 rule
  // 1), so the gap is reported in the pull request and this case covers the
  // directory this slice owns in the meantime. It is deliberately NOT a second
  // copy of that sweep: it is scoped to `src/app/`, where the answer is zero
  // for every needle and no exception exists to keep in step.
  const APP = join(import.meta.dirname, '..', 'src', 'app');

  const appFiles = (): string[] => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else files.push(path);
      }
    };
    walk(APP);
    return files;
  };

  test('no file under src/app performs a network call of any kind', () => {
    const needles = ['fetch' + '(', 'XMLHttp' + 'Request', 'Event' + 'Source', 'Web' + 'Socket'];
    const offences: string[] = [];
    for (const file of appFiles()) {
      const body = readFileSync(file, 'utf8').replaceAll(/(?<!:)\/\/[^\n]*/g, ' ');
      for (const needle of needles) if (body.includes(needle)) offences.push(`${file}: ${needle}`);
    }
    expect(offences).toEqual([]);
  });

  test('the sweep walks the files this slice added rather than an empty set', () => {
    const files = appFiles();
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.filter((file) => file.endsWith('.tsx')).length).toBeGreaterThanOrEqual(3);
  });
});

describe('M6-A-42: the shipped walk and the served bytes are the same surface', () => {
  // THE ONE CASE THAT MAKES THE OTHERS MEAN ANYTHING. The control that ships
  // walks the element tree, because `next build` refuses `react-dom/server` in
  // a Server Component's import graph. That is only as good as the claim that
  // the walk sees what the renderer emits, and this is where the claim is
  // checked rather than argued.
  const page = buildLiabilityHome(INPUT);
  const served = servedLiabilityHomeStrings(page);
  const markup = servedBytes(page);

  /** React escapes these five in text and in attribute values both. */
  const escaped = (value: string): string =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#x27;');

  test('every string the walk collects is in the bytes', () => {
    const missing = served.filter((value) => !markup.includes(escaped(value)));
    expect(missing).toEqual([]);
  });

  test('the walk collects the whole document rather than a corner of it', () => {
    // A FLOOR AND NOT A COUNT. An exact number here would be a second
    // transcription of the page's panel list, and `M6-A-38` already asserts the
    // panels one by one. What this refuses is the walk quietly returning almost
    // nothing, which is how a green sweep covers a page it never entered.
    expect(served.length).toBeGreaterThan(page.panels.length + page.pending.length);
    expect(served).toContain(page.banner);
    for (const pending of page.pending) expect(served.join('\n')).toContain(pending.blockedBy);
  });

  test('it collects attribute values and not only text', () => {
    // The width the header claims, checked. `data-testid` and `data-trust` are
    // served and are in no text node.
    expect(served).toContain('liability-home');
    expect(served).toContain(page.dataTrust.verdict);
  });

  test('it REFUSES a node it cannot resolve rather than skipping it', () => {
    // Both shapes the walk throws on, watched throwing. A skip would be the
    // failure this control is written against: a screen that grows a node kind
    // nobody taught the sweep about would stop being covered, silently.
    expect(() => collectServedStrings(Symbol('an unrenderable node'), [])).toThrow(PageError);
    expect(() => collectServedStrings({ type: 'section', props: { children: 'x' } }, [])).toThrow(
      PageError,
    );
  });
});

// =============================================================================
// ADR-190: A STATUS THIS CONSOLE DID NOT RECEIVE IS A STATUS IT MAY NOT NAME
// =============================================================================
// `W6-d` shipped `const NOT_YET: AdminErrorKind = toAdminErrorKind(503)` in
// `src/app/page.tsx`, on WAVE-06 section 4.1's sentence *"every one of the 26
// operator routes above answers 503 today"*. Session 336 reported that sentence
// false, session 344 measured the two answers this page's own endpoint really
// gives, and neither could repair the file. ADR-190 rules it and these two
// suites are what stop the number coming back.
//
// THE RULE IS NARROWER THAN "503 WAS WRONG". An `AdminErrorKind` is derived
// from a response this console RECEIVED (`../src/http/client.ts` computes it
// from `response.status` and pairs it with that status in `AdminApiFailure`).
// A route that performs no read has received nothing, so it names nothing.
// Three screens already shipped that way; `M6-A-60` is what makes the fourth
// screen inherit it.

describe('M6-A-60: no route under src/app names an error kind it did not receive', () => {
  const APP = join(import.meta.dirname, '..', 'src', 'app');

  const appFiles = (): string[] => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else files.push(path);
      }
    };
    walk(APP);
    return files;
  };

  test('no file under src/app imports or derives an AdminErrorKind', () => {
    // COMMENTS ARE STRIPPED FIRST, AND THAT IS THE POINT RATHER THAN A
    // CONVENIENCE. Every one of these screens EXPLAINS in prose which statuses
    // its endpoint really answers, naming `toAdminErrorKind` and the kinds
    // while doing so. The rule is about the CODE: a kind that reaches a render
    // without a response behind it.
    const offences: string[] = [];
    for (const file of appFiles()) {
      const body = code(file);
      for (const needle of ['toAdminErrorKind', 'AdminErrorKind'])
        if (body.includes(needle)) offences.push(`${file}: ${needle}`);
    }
    expect(offences).toEqual([]);
  });

  test('no file under src/app serves an error kind as an attribute', () => {
    // `data-error` was `src/app/page.tsx`'s, and `test/flags-render.test.ts`
    // and `test/identity-render.test.ts` each already refuse it for their own
    // screen. This is the same refusal held over the DIRECTORY, so the screen
    // that has no suite yet is covered on the day its file lands.
    const offences = appFiles().filter((file) => code(file).includes('data-error'));
    expect(offences).toEqual([]);
  });

  test('the sweep walks the routes rather than an empty set', () => {
    // A FLOOR, DERIVED FROM THE DIRECTORY. `M6-A-41` states the same reason:
    // a green sweep over nothing is the failure mode of a source sweep.
    expect(appFiles().filter((file) => file.endsWith('.tsx')).length).toBeGreaterThanOrEqual(3);
  });

  test('the needle is real, and the kinds are still declared where they belong', () => {
    // THE COUNTERFACTUAL. A sweep for a name that no longer exists anywhere is
    // a sweep that can never fail, so this reads the file that DOES declare the
    // vocabulary and asserts it is intact. ADR-190 ruling 2 keeps `unavailable`
    // for the 13 registered `/admin/*` routes that really do answer 503.
    const client = readFileSync(
      join(import.meta.dirname, '..', 'src', 'http', 'client.ts'),
      'utf8',
    );
    expect(client).toContain('export function toAdminErrorKind');
    expect(client).toContain("if (status === 503) return 'unavailable';");
  });
});

describe('M6-A-61: the liability home serves the answers that were measured', () => {
  // THE BYTES, not the constant. WAVE-06 section 5.2's rule applied to the
  // arm this route actually returns today.
  const markup = renderToStaticMarkup(LiabilityHomeRoute());
  const served = text(markup);

  test('the page carries no error attribute at all', () => {
    expect(markup).not.toContain('data-error');
  });

  test("no AdminErrorKind member is served as this page's own read state", () => {
    // SCOPED TO THE READ-STATE PARAGRAPH RATHER THAN THE WHOLE PAGE, and the
    // scoping is the ruling rather than a way to keep the case green. The
    // blocker prose below it QUOTES `401 unauthenticated` and `500
    // internal_error` because those were measured against a real `compose()`;
    // what ADR-190 refuses is this page stating a kind AS ITS OWN read state,
    // which is the sentence `data-error` and `{read.error}` used to make.
    const paragraph = /<p data-testid="read-state">([\s\S]*?)<\/p>/.exec(markup);
    expect(paragraph).not.toBeNull();
    const state = text(paragraph?.[1] ?? '');
    for (const kind of [
      'unauthenticated',
      'forbidden',
      'not_found',
      'rate_limited',
      'unavailable',
      'server_error',
    ])
      expect(state, kind).not.toContain(kind);
  });

  test('the ADR-171 blocker names BOTH measured statuses with the condition of each', () => {
    // THE NUMBERS THAT WERE MEASURED, PINNED HERE SO PROSE CANNOT DRIFT AGAIN.
    // `apps/api/test/admin-reads.test.ts` asserts the same two against a real
    // `compose()`; this asserts the console says what that measures.
    expect(served).toContain('401 `unauthenticated`');
    expect(served).toContain('500 `internal_error`');
    expect(served).not.toContain('503');
  });

  test('every blocker is served with its origin and what blocks it', () => {
    expect(markup).toContain('data-origin="ADR-171"');
    expect(markup).toContain('data-origin="P5-l"');
    expect(markup).toContain('data-origin="API_CONTRACT section 8"');
    expect(served.match(/NOT BUILT, blocked by/g)).toHaveLength(3);
  });

  test('it invents no number while a supplier is missing', () => {
    // The page renders no figure at all in this arm, so no digit group that
    // could be read as money reaches the bytes. The statuses are three digits
    // and are what the exception is for.
    const money = served.match(/\d[\d,]*\.\d\d/g) ?? [];
    expect(money).toEqual([]);
  });
});
