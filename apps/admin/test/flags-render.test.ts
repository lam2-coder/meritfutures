import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { renderToStaticMarkup } from 'react-dom/server';

import type { FlagListItem } from '../src/api/types.ts';
import FlagQueueRoute from '../src/app/flags/page.tsx';
import {
  FlagQueueDocument,
  type FlagQueuePage,
  QUEUE_ORDER,
  assertServedFlagQueueStrings,
  flagScope,
  renderFlagQueueDocument,
  servedFlagQueueStrings,
} from '../src/app/flags/flags-queue.tsx';
import { PageError, assertNamesNoSubject } from '../src/page.ts';

// =============================================================================
// THE FLAGS QUEUE, ASSERTED OVER THE BYTES AN OPERATOR RECEIVES
// =============================================================================
// WAVE-06 rule 4: "AN ASSERTION THAT CANNOT REACH THE SERVED BYTES IS NOT AN
// ASSERTION", and section 5.2 names this slice beside `W6-d` as the pair most
// able to leave the two INV-M6-10 controls reading a line array nobody serves.
// So every case below reads the markup, the walk that ships, or this module's
// own source, and none of them reads an intermediate the browser never sees.
//
// THE MARKUP RENDER LIVES HERE AND NOT IN THE SOURCE, WHICH IS `test/render.
// test.ts`'s finding inherited rather than re-learned: `next build` refuses
// `react-dom/server` inside a Server Component's import graph, so the control
// that ships walks the element tree and this suite, which is in no route graph,
// renders the real markup and binds the two.
//
// THE COMPONENT IS CALLED RATHER THAN WRITTEN AS AN ELEMENT because this file
// is `.ts`: WAVE-06's `W6-f` row names `test/flags-render.test.ts` and a `.tsx`
// suite would be a second filename in a fence that spells one.
//
// -----------------------------------------------------------------------------
// THE FIXTURE IS THE SCREEN'S OWN ARGUMENT, WRITTEN AS DATA
// -----------------------------------------------------------------------------
// API_CONTRACT section 8's reason for putting `corroboration_depth` on the wire
// is "an operator shown a severity 3 above a severity 5 has nothing on the row
// that says why". A fixture whose severities happened to descend would render a
// queue in which that sentence is never exercised, so this one is ADR-178's
// order with the second key INVERTED against the first on purpose: two flags at
// depth 3 and severity 2 sit above one at depth 1 and severity 5.
// =============================================================================

const RENDERED_AT = '2026-08-28T14:00:00.000Z';

const ROWS: readonly FlagListItem[] = [
  {
    flag_id: '3f7c1a52-0d64-4b19-9a2e-5c81d0f4b731',
    identity_id: 'a1d2c3b4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    account_id: null,
    flag_type: 'coordinated_entry',
    severity: 2,
    status: 'open',
    first_detected_on: '2026-08-10',
    detector: 'shared-exit-node',
    evidence_summary: 'Three funded accounts entering the same contract within four minutes',
    corroboration_depth: 3,
  },
  {
    flag_id: '9b2e7d41-6c05-4f38-8a1b-2d3e4f5a6b7c',
    identity_id: 'a1d2c3b4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    account_id: 'c4b5a6d7-8e9f-4012-9a3b-4c5d6e7f8091',
    flag_type: 'payout_velocity',
    severity: 2,
    status: 'investigating',
    first_detected_on: '2026-08-14',
    detector: 'velocity-window',
    evidence_summary: 'Trailing seven day settled payouts at 3.1x the thirty day average',
    corroboration_depth: 3,
  },
  {
    flag_id: '5e8f0a63-1b74-4c29-9d3e-6a7b8c9d0e1f',
    identity_id: 'b2c3d4e5-6f70-4819-8a2b-3c4d5e6f7081',
    account_id: 'd5e6f708-1920-4a3b-8c4d-5e6f70819203',
    flag_type: 'document_reuse',
    severity: 5,
    status: 'open',
    first_detected_on: '2026-08-01',
    detector: 'kyc-document-hash',
    evidence_summary: 'A proof of address hash matching a previously enforced submission',
    corroboration_depth: 1,
  },
];

const PAGE: FlagQueuePage = { renderedAt: RENDERED_AT, rows: ROWS };

/** Every identifier the response carries and the document must not serve. */
const SUBJECT_IDS = ROWS.flatMap((row) =>
  [row.identity_id, row.account_id].filter((id): id is string => id !== null),
);

/** The bytes a browser receives for this document. */
function servedBytes(page: FlagQueuePage): string {
  return renderToStaticMarkup(FlagQueueDocument({ page }));
}

/**
 * Source with comments removed, so a needle named in prose is not a finding.
 *
 * `test/render.test.ts` and `test/surface.test.ts` carry the same function and
 * the same lookbehind, and the reason is theirs: stripping `//` unconditionally
 * deletes the second half of a `https://host` before a sweep can read it. This
 * module's header names `.sort(` while arguing why it is absent.
 */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
    .replaceAll(/(?<!:)\/\/[^\n]*/g, ' ');
}

/** The markup's text, with tags removed and the five entities React escapes decoded. */
function text(markup: string): string {
  return markup
    .replaceAll(/<[^>]*>/g, '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

const QUEUE = join(import.meta.dirname, '..', 'src', 'app', 'flags', 'flags-queue.tsx');

describe('M6-A-43: the order is the server`s, rendered and never recomputed', () => {
  test('the rows are served in the order the response carried them', () => {
    const markup = servedBytes(PAGE);
    const positions = ROWS.map((row) => markup.indexOf(row.evidence_summary));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  test('A QUEUE THAT ARRIVES OUT OF ORDER IS RENDERED OUT OF ORDER, NOT REPAIRED', () => {
    // THE CASE THAT MAKES "NOT RECOMPUTED" MEAN SOMETHING. A console that
    // quietly re-sorted would pass every case above while hiding an adapter
    // defect `assertFlagOrder` exists to refuse at the source. ADR-178's first
    // key is a SECURITY control, so a second implementation of it here that
    // disagreed with the server's would be the console deciding which cases an
    // operator triages first, which is exactly the decision `AS-M7-03` clause 3
    // takes away from anything an adversary can reach.
    const reversed: FlagQueuePage = { renderedAt: RENDERED_AT, rows: [...ROWS].reverse() };
    const markup = servedBytes(reversed);
    const depths = [...markup.matchAll(/data-corroboration-depth="(\d+)"/g)].map(
      (match) => match[1] ?? '',
    );
    expect(depths).toEqual(['1', '3', '3']);
  });

  test('the module sorts nothing, read from its own source', () => {
    // THE MECHANICAL HALF, in `M6-A-39`'s shape one screen over: the liability
    // home's document is asserted to import nothing from `data-trust.ts`, and
    // this one is asserted to compare nothing.
    const source = code(QUEUE);
    expect(source).not.toContain('.sort(');
    expect(source).not.toContain('localeCompare');
    expect(source).not.toContain('corroboration_depth >');
    expect(source).not.toContain('severity >');
  });
});

describe('M6-A-44: the depth is beside the severity IN THE WORDS', () => {
  const markup = servedBytes(PAGE);
  const body = text(markup);

  test('every row carries its corroboration depth and its severity as text', () => {
    for (const row of ROWS) {
      expect(body).toContain(
        `Corroboration depth ${String(row.corroboration_depth)} across independent detector ` +
          `families, severity ${String(row.severity)} of 5, ${row.status}`,
      );
    }
  });

  test('the depth is not only an attribute, which is FM-M6-01 rather than style', () => {
    // A screenshot pasted into a message loses the style and keeps the number.
    // So a depth that lived only in `data-corroboration-depth` would be a
    // reason the operator who most needs it cannot see.
    const stripped = text(markup);
    for (const row of ROWS)
      expect(stripped).toContain(`Corroboration depth ${String(row.corroboration_depth)}`);
    expect(markup).toContain('data-corroboration-depth="3"');
  });

  test('the ordering sentence is served ABOVE the first row', () => {
    const order = markup.indexOf(QUEUE_ORDER);
    const firstRow = markup.indexOf(ROWS[0]?.evidence_summary ?? '');
    expect(order).toBeGreaterThanOrEqual(0);
    expect(firstRow).toBeGreaterThanOrEqual(0);
    expect(order).toBeLessThan(firstRow);
  });

  test('a severity 2 IS served above a severity 5, which is the screen', () => {
    const low = markup.indexOf('severity 2 of 5');
    const high = markup.indexOf('severity 5 of 5');
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeGreaterThan(low);
  });
});

describe('M6-A-45: INV-M6-10 on a screen that names no subject', () => {
  test('no identifier the response carries reaches the served bytes', () => {
    const markup = servedBytes(PAGE);
    for (const id of SUBJECT_IDS) expect(markup).not.toContain(id);
    for (const row of ROWS) expect(markup).not.toContain(row.flag_id);
  });

  test('the `flag_id` used as a React key is never serialised', () => {
    // The header's claim, checked rather than trusted: React lifts `key` off
    // the props, so the response's own row identifier orders the list and
    // reaches no byte.
    const markup = servedBytes(PAGE);
    expect(markup).toContain('data-position="1"');
    expect(markup).not.toContain('key=');
    for (const row of ROWS) expect(markup).not.toContain(row.flag_id);
  });

  test('A SUBJECT ID ARRIVING THROUGH `evidence_summary` IS REFUSED', () => {
    // THE SEED THIS CONTROL EXISTS FOR. `evidence_summary` is server-supplied
    // free text, so a detector that writes an identity id into its own summary
    // reaches this screen through a field nobody classified as an identifier.
    // It is the same shape as the seed `W6-d` caught arriving through
    // `movement.feed`, and it is caught by the same assertion.
    const first = ROWS[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const seeded: FlagQueuePage = {
      renderedAt: RENDERED_AT,
      rows: [
        { ...first, evidence_summary: `Shared exit node with ${first.identity_id}` },
        ...ROWS.slice(1),
      ],
    };
    expect(() => assertServedFlagQueueStrings(seeded)).toThrow(PageError);
    expect(() => renderFlagQueueDocument(seeded)).toThrow(PageError);
  });

  test('a subject id arriving through `detector` or `flag_type` is refused too', () => {
    const first = ROWS[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const viaDetector: FlagQueuePage = {
      renderedAt: RENDERED_AT,
      rows: [{ ...first, detector: `manual-review-${first.identity_id}` }],
    };
    const viaType: FlagQueuePage = {
      renderedAt: RENDERED_AT,
      rows: [{ ...first, flag_type: `linked_to_${first.identity_id}` }],
    };
    expect(() => renderFlagQueueDocument(viaDetector)).toThrow(PageError);
    expect(() => renderFlagQueueDocument(viaType)).toThrow(PageError);
  });

  test('THE TWO LEGS STILL FAIL AT DIFFERENT TIMES, AND NEITHER SUBSUMES THE OTHER', () => {
    // THIS CASE RECORDED A HOLE AND NOW RECORDS ITS REPAIR, WHICH IS WHY IT IS
    // REWRITTEN RATHER THAN DELETED.
    //
    // It was found by seeding, not by reading: the first draft of `M6-A-45`
    // asserted that a subject id in `flag_type` was refused by the pattern leg
    // and it was not. `assertNamesNoSubject`'s uuid was `\b`-anchored, so a word
    // character on either side removed the boundary and `linked_to_<uuid>`
    // passed while `manual-review-<uuid>` threw. The value leg was what refused
    // both, and the residue that survived both legs was a subject id in NO field
    // of this response AND glued to a word character.
    //
    // SESSION 348 DROPPED THE BOUNDARIES IN `../src/page.ts` AND THAT RESIDUE IS
    // CLOSED. The pattern leg now refuses the glued spelling on its own, which
    // is asserted here rather than assumed, and `M6-A-55` in `page.test.ts`
    // holds the pattern's own before-and-after.
    //
    // THE TWO LEGS ARE STILL NOT ONE LEG, and the reason is the interesting
    // half: each refuses something the other cannot see.
    const first = ROWS[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    const glued = `linked_to_${first.identity_id}`;
    const spaced = `linked to ${first.identity_id}`;
    expect(() => assertNamesNoSubject([spaced])).toThrow(PageError);
    expect(() => assertNamesNoSubject([glued])).toThrow(PageError);
    expect(() =>
      renderFlagQueueDocument({ renderedAt: RENDERED_AT, rows: [{ ...first, flag_type: glued }] }),
    ).toThrow(PageError);

    // THE PATTERN LEG ALONE: a uuid that is in no field of this response at all.
    // The value leg searches for the three identifiers this document declines to
    // render, so a third party's id is invisible to it and is a subject name all
    // the same.
    const foreign = '7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
    expect([first.flag_id, first.identity_id, first.account_id]).not.toContain(foreign);
    expect(() =>
      renderFlagQueueDocument({
        renderedAt: RENDERED_AT,
        rows: [{ ...first, evidence_summary: `Shared exit node with ${foreign}` }],
      }),
    ).toThrow(PageError);

    // THE VALUE LEG ALONE: an identifier of THIS response that is not uuid
    // shaped. The contract types `identity_id` as a string, so a server that
    // ever answers with another spelling is a shape the pattern cannot match and
    // the value leg still refuses.
    const unshaped = 'identity-90210';
    expect(() => assertNamesNoSubject([`Shared exit node with ${unshaped}`])).not.toThrow();
    expect(() =>
      renderFlagQueueDocument({
        renderedAt: RENDERED_AT,
        rows: [
          {
            ...first,
            identity_id: unshaped,
            evidence_summary: `Shared exit node with ${unshaped}`,
          },
        ],
      }),
    ).toThrow(PageError);
  });

  test('the refusal is ON THE RENDER PATH and not only in this suite', () => {
    const first = ROWS[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const seeded: FlagQueuePage = {
      renderedAt: RENDERED_AT,
      rows: [{ ...first, evidence_summary: `see ${first.identity_id}` }],
    };
    // The component the guard wraps renders it without complaint, which is what
    // makes the guard the thing that fires rather than a coincidence.
    expect(() => FlagQueueDocument({ page: seeded })).not.toThrow();
    expect(() => renderFlagQueueDocument(seeded)).toThrow(PageError);
  });

  test('the whole clean queue passes over its whole document', () => {
    expect(() => renderFlagQueueDocument(PAGE)).not.toThrow();
  });
});

describe('M6-A-46: the shipped walk and the served bytes are the same surface', () => {
  const served = servedFlagQueueStrings(PAGE);
  const markup = servedBytes(PAGE);

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
    expect(served.length).toBeGreaterThan(ROWS.length);
    expect(served).toContain(QUEUE_ORDER);
    for (const row of ROWS) expect(served.join('\n')).toContain(row.evidence_summary);
  });

  test('it collects attribute values and not only text', () => {
    expect(served).toContain('flags-queue');
    expect(served).toContain('investigating');
  });
});

describe('M6-A-47: an empty queue is a sentence, and a scope is not an identifier', () => {
  test('zero rows renders a stated emptiness rather than an empty list', () => {
    const markup = servedBytes({ renderedAt: RENDERED_AT, rows: [] });
    expect(markup).toContain('data-testid="empty-queue"');
    expect(markup).not.toContain('data-testid="flag-rows"');
    expect(text(markup)).toContain('That is an empty queue and not a failed read');
  });

  test('`account_id` decides a SCOPE and the id itself is never rendered', () => {
    // What INV-M6-10 costs and what it does not. The fact an operator triaging
    // needs from `account_id` is whether the flag is scoped to one account or
    // to every account the human holds, and that fact is not an identifier.
    const identityWide = ROWS[0];
    const accountScoped = ROWS[1];
    expect(identityWide).toBeDefined();
    expect(accountScoped).toBeDefined();
    if (identityWide === undefined || accountScoped === undefined) return;
    expect(flagScope(identityWide)).toBe('the whole identity');
    expect(flagScope(accountScoped)).toBe('one account');

    const body = text(servedBytes(PAGE));
    expect(body).toContain('scoped to the whole identity');
    expect(body).toContain('scoped to one account');
  });
});

describe('M6-A-48: the route performs no read and claims no status it cannot produce', () => {
  const markup = renderToStaticMarkup(FlagQueueRoute());

  test('it renders the blocked state and no row', () => {
    expect(markup).toContain('data-testid="flags-queue-unsupplied"');
    expect(markup).not.toContain('data-testid="flag-rows"');
    expect(markup).toContain('[ADR-171]');
    expect(markup.split('NOT BUILT').length - 1).toBe(1);
  });

  test('IT NAMES NO ERROR KIND, because 503 is a status no operator route produces', () => {
    // MEASURED over a real `compose()` and Fastify's own `inject`: with no
    // admin session cookie an operator route answers 401 `unauthenticated`, and
    // with one it answers 500 `internal_error`. WAVE-06 section 8.1 says 503
    // and `src/app/page.tsx` renders `toAdminErrorKind(503)` on that basis.
    // Both are outside this fence and are REPORTED; this route declines to
    // repeat the claim, and the two real answers are named in its blocker prose
    // where an operator reads them.
    expect(markup).not.toContain('data-error=');
    expect(markup).not.toContain('unavailable');
    expect(text(markup)).toContain('401 `unauthenticated`');
    expect(text(markup)).toContain('500 `internal_error`');
  });
});
