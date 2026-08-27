import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import type { AffiliateStats } from '../src/api/types.ts';
import { ReferralScreen } from '../src/app/referrals/screen.ts';
import type { ReferralScreenView } from '../src/app/referrals/screen.ts';
import { ReferralDataUnwiredError, loadReferralScreenData } from '../src/app/referrals/data.ts';
import type { ReferralScreenData } from '../src/app/referrals/data.ts';
import { toReferralScreen } from '../src/app/referrals/page.ts';
import { MissingRequiredDisclosureError, toCreativeSubmission } from '../src/view/referrals.ts';
import type { CreateCreativeResponse } from '../src/view/referrals.ts';

// =============================================================================
// SC-M4-09 RENDERED, AND THE ONE CLAUSE THAT IS A COMPLIANCE FACT
// =============================================================================
// `affiliate_creatives_approved_has_disclosure` is
// `status <> 'approved' OR disclosure_version_id IS NOT NULL`
// (packages/db/migrations/0005_affiliate_program.sql:140), and
// `disclosure_version_id` is `uuid NULL` (:126). So a `pending` creative
// carries NO disclosure, ADR-113 clause 2 named the contract field
// `required_disclosure` "so nobody reads it as a pin", and this file is where
// that naming either survives contact with a screen or does not.
//
// EVERY ASSERTION BELOW IS AGAINST RENDERED HTML rather than against a view
// model, because the mistake this exists to catch is a heading. A view object
// with the right field names, rendered under the wrong words, is wrong on the
// screen and green in a shape test.

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const DISCLOSURE_TEXT =
  'Merit accounts are simulated. Merit compensates this promoter for referred ' +
  'purchases. Past results do not predict future results.';

const REQUIRED_TEXT =
  'This communication is a paid promotion of Merit Futures. Trading involves ' +
  'substantial risk of loss and is not suitable for every investor.';

function stats(over: Partial<AffiliateStats> = {}): AffiliateStats {
  return {
    code: 'TRADER77',
    commission_bp: 1_500,
    status: 'active',
    clicks_30d: 412,
    conversions_30d: 9,
    earned_cents_lifetime: 184_500,
    payable_cents: 42_000,
    paid_cents_lifetime: 130_000,
    chargeback_rate_bp: 240,
    ...over,
  };
}

/**
 * THE EXACT CASE THE CLAUSE NAMES: `pending`, and the row carries no disclosure.
 *
 * The response literally cannot carry one. API_CONTRACT section 7 declares five
 * fields on `creative` and `disclosure_version_id` is not among them, which is
 * ADR-113 clause 2 refusing to put a field in the response that would be null on
 * every fresh submission. The NULL in the database is therefore an ABSENT FIELD
 * on the wire, and this fixture is that absence.
 */
function pendingCreative(over: Partial<CreateCreativeResponse['required_disclosure']> = {}) {
  return {
    creative: {
      creative_id: '7c1f0a3e-9b42-4d51-8a10-2f6c5e0d1b93',
      kind: 'landing',
      url_or_ref: 'https://example.com/merit-eval-review',
      status: 'pending',
      submitted_at: '2026-08-27T14:02:11Z',
    },
    required_disclosure: {
      tos_version_id: '3d9b6c14-77ae-4b2f-9c08-51ad4e7f2c60',
      version: '4',
      text: REQUIRED_TEXT,
      ...over,
    },
  } as const satisfies CreateCreativeResponse;
}

function data(over: Partial<ReferralScreenData> = {}): ReferralScreenData {
  return {
    stats: stats(),
    creative: pendingCreative(),
    disclosure_text: DISCLOSURE_TEXT,
    ...over,
  };
}

const render = (view: ReferralScreenView): string => renderToStaticMarkup(ReferralScreen(view));

/**
 * The region the disclosure is allowed to appear in, and nothing else.
 *
 * There is no nested `section` inside it, so the first closing tag after the
 * marker closes the region itself.
 */
function requiredRegion(html: string): string {
  const marker = html.indexOf('data-disclosure-state="required-at-approval"');
  expect(marker, 'the required-disclosure region is rendered').toBeGreaterThan(-1);
  const open = html.lastIndexOf('<section', marker);
  const close = html.indexOf('</section>', marker);
  expect(close, 'the region closes').toBeGreaterThan(open);
  return html.slice(open, close);
}

// -----------------------------------------------------------------------------
// THE CLAUSE
// -----------------------------------------------------------------------------

test('a pending creative with no disclosure renders the disclosure as REQUIRED, never as attached', () => {
  const html = render(toReferralScreen(data()));

  // 1. The creative really is the case the clause names.
  expect(html).toContain('>pending</dd>');

  // 2. The disclosure text appears EXACTLY ONCE in the whole document, and that
  //    occurrence is inside the region whose heading names the moment the
  //    requirement lands. One occurrence is what makes this an assertion about
  //    the whole screen rather than about one region of it: there is nowhere
  //    else it could be, including the creative's own field list.
  const occurrences = html.split(REQUIRED_TEXT).length - 1;
  expect(occurrences, 'the required disclosure text appears once').toBe(1);
  expect(requiredRegion(html)).toContain(REQUIRED_TEXT);

  // 3. The region says the submission carries none, and says it BEFORE the text.
  const region = requiredRegion(html);
  expect(region).toContain('Disclosure required at approval');
  expect(region).toContain('This submission does not carry a disclosure.');
  expect(region.indexOf('does not carry a disclosure')).toBeLessThan(
    region.indexOf(REQUIRED_TEXT),
    'the absence is stated before the text a reader would otherwise attach to the row',
  );

  // 4. NOTHING ON THE SCREEN CALLS IT ATTACHED. These are the words a redesign
  //    would reach for, and the screen may not carry any of them.
  for (const word of ['Attached', 'attached', 'Disclosure attached', 'Approved with']) {
    expect(html.includes(word), `the screen says "${word}"`).toBe(false);
  }

  // 5. The creative's field list has no disclosure row at all. The requirement
  //    is a region beside the row, never a property of it.
  expect(html).not.toContain('<dt>Disclosure</dt>');
  expect(html).not.toContain('disclosure_version_id');
});

test('the clause check fails on the render that would violate it', () => {
  // RI-06's argument: a control watched only in its passing state is a control
  // nobody has seen work. This is the diff that would break it, which is a
  // heading and a placement rather than a type change. The view model is
  // untouched; the text is moved into the creative's field list, where a reader
  // takes it for a property of the row.
  const html = render(toReferralScreen(data()));
  const seeded = html
    .replace(
      '<dt>Kind</dt>',
      `<dt>Disclosure</dt><dd>${REQUIRED_TEXT}</dd></div><div class="mf-referrals__fact"><dt>Kind</dt>`,
    )
    .replace('This submission does not carry a disclosure.', 'Disclosure attached.');

  expect(seeded.split(REQUIRED_TEXT).length - 1, 'the seeded render duplicates the text').toBe(2);
  expect(seeded).toContain('<dt>Disclosure</dt>');
  expect(seeded).toContain('Disclosure attached.');
});

test('no field on the view could hold an attached disclosure', () => {
  // The structural half of the clause. Assertion 4 above is about words on a
  // screen and this is about what a later author could write without changing a
  // type, which is the half that survives a redesign.
  const view = toCreativeSubmission(pendingCreative());
  expect(Object.keys(view)).toEqual([
    'creative_id',
    'kind',
    'url_or_ref',
    'status',
    'submitted_at',
    'disclosure_required_at_approval',
  ]);

  const source = readFileSync(join(SRC, 'view', 'referrals.ts'), 'utf8');
  const block = source.slice(source.indexOf('export type CreativeSubmissionView'));
  // COMMENTS OUT, AND THE FIRST RUN OF THIS CHECK IS WHY: the docblock over
  // `disclosure_required_at_approval` says the row's own `disclosure_version_id`
  // is NULL at `pending`, which is the explanation and not a field. A check that
  // fires on its own reasoning gets disabled within a week (inv-m4-01.test.ts's
  // own recorded finding, one directory over).
  const declared = block
    .slice(0, block.indexOf('};'))
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  expect(declared).toContain('readonly disclosure_required_at_approval: RequiredDisclosureView;');
  for (const field of ['disclosure:', 'disclosure_version_id', 'attached', 'approved_with']) {
    expect(declared.includes(field), `CreativeSubmissionView declares ${field}`).toBe(false);
  }
});

test('the status is the word the server sent and the portal decides no lifecycle', () => {
  const view = toCreativeSubmission(pendingCreative());
  expect(view.status).toBe('pending');

  // No translation table, no "Under review", no invented terminal state. The
  // same discipline `ReferralPanelView.status` already keeps one file over.
  const html = render(toReferralScreen(data()));
  for (const invented of ['Under review', 'Awaiting approval', 'In progress']) {
    expect(html.includes(invented), `the screen invents "${invented}"`).toBe(false);
  }
});

test('a blank required disclosure refuses rather than rendering an empty box', () => {
  // ../src/view/disclosure.ts's rule, applied to the other table: "a blank where
  // a required disclosure belongs is the obligation failing silently, which is
  // the only way it fails". A space satisfies every check that only asks whether
  // a value is present.
  for (const blank of ['', ' ', '\n  \t']) {
    expect(() => toCreativeSubmission(pendingCreative({ text: blank }))).toThrow(
      MissingRequiredDisclosureError,
    );
  }
  expect(() => toCreativeSubmission(pendingCreative({ text: REQUIRED_TEXT }))).not.toThrow();
});

// -----------------------------------------------------------------------------
// THE REST OF THE SCREEN
// -----------------------------------------------------------------------------

test('every money figure on the screen is the formatter string, unmodified', () => {
  // INV-M4-01. `toReferralPanel` formatted these; this file asserts the render
  // did not then reformat, round, or combine them.
  const html = render(toReferralScreen(data()));

  for (const shown of ['1,845.00', '420.00', '1,300.00', '15.00%', '2.40%']) {
    expect(html, `${shown} is rendered`).toContain(`>${shown}</dd>`);
  }

  // 1,845.00 less 1,300.00 is 545.00 and the server's payable is 420.00. The
  // subtraction that looks like it reconciles them is wrong as well as banned.
  expect(html).not.toContain('545.00');

  // NO DECIMAL FIGURE IN THE DOCUMENT'S TEXT CAME FROM ANYWHERE BUT THE
  // FORMATTER. The `style` element is excluded and not exempted: its `rem` and
  // `rgba` values are layout and are the only decimals on this screen that are
  // not money, so leaving them in would make the assertion a list of CSS
  // constants that nobody would ever re-read.
  const body = html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, ' ');
  const decimals = [...body.matchAll(/[\d,]+\.\d+/g)].map((m) => m[0]);
  expect(new Set(decimals)).toEqual(new Set(['1,845.00', '420.00', '1,300.00', '15.00', '2.40']));
});

test('the NFA disclosure is on the screen and is the document the page names', () => {
  const html = render(toReferralScreen(data()));
  expect(html).toContain(DISCLOSURE_TEXT);

  // The panel's disclosure and the creative's required disclosure are DIFFERENT
  // TEXTS FROM DIFFERENT TABLES, and both are on the screen at once. That is the
  // case where a screen that collapsed them would look correct.
  expect(DISCLOSURE_TEXT).not.toBe(REQUIRED_TEXT);
  expect(html).toContain(REQUIRED_TEXT);
});

test('zeroes render as zeroes and no panel is hidden', () => {
  const html = render(
    toReferralScreen(
      data({
        stats: stats({
          clicks_30d: 0,
          conversions_30d: 0,
          earned_cents_lifetime: 0,
          payable_cents: 0,
          paid_cents_lifetime: 0,
          chargeback_rate_bp: 0,
        }),
      }),
    ),
  );

  expect(html).toContain('>0</dd>');
  expect(html).toContain('>0.00</dd>');
  expect(html).toContain('>0.00%</dd>');
  expect(html).toContain('Clicks, last 30 days');
});

test('no creative renders the absence and never a disclosure nobody sent', () => {
  // M08 section 4 wants the requirement visible "before submitting rather than
  // after being rejected", and API_CONTRACT carries no GET that would supply the
  // text. So this state states the absence and shows no disclosure text at all,
  // rather than inventing one at the point of render.
  const html = render(toReferralScreen(data({ creative: null })));

  expect(html).toContain('No creative has been submitted for review.');
  expect(html).not.toContain(REQUIRED_TEXT);
  expect(html).not.toContain('Disclosure required at approval');

  // The panel's own NFA disclosure is unaffected: it is a required prop.
  expect(html).toContain(DISCLOSURE_TEXT);
});

test('the screen makes no claim about what an affiliate might earn', () => {
  // M08 AS-M8-04. This is the surface a trader reads before they publish, and
  // the absence is the control at the render layer too.
  const html = render(toReferralScreen(data()));
  for (const claim of [
    'guaranteed',
    'you could earn',
    'projected',
    'estimate',
    'potential',
    'forecast',
    'up to',
  ]) {
    expect(html.toLowerCase().includes(claim), `the screen says "${claim}"`).toBe(false);
  }

  // And no conversion rate: M08 owns what a conversion means and a ratio the
  // portal invented would be a second definition of a number M12 publishes.
  expect(html).not.toContain('Conversion rate');
});

test('the segment holds no route handler, no server action and no transport', () => {
  // ADR-095 ruling 3, on ADR-083 section 3, asserted over the segment rather
  // than promised in a comment.
  const dir = join(SRC, 'app', 'referrals');
  for (const file of ['page.ts', 'screen.ts', 'data.ts']) {
    const code = readFileSync(join(dir, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');
    for (const banned of ['use server', 'fetch(', 'NextRequest', 'NextResponse', '/api/v1']) {
      expect(code.includes(banned), `${file} contains ${banned}`).toBe(false);
    }
  }
});

test('the data port refuses rather than seeding figures Merit never computed', async () => {
  await expect(loadReferralScreenData()).rejects.toThrow(ReferralDataUnwiredError);
  await expect(loadReferralScreenData()).rejects.toThrow(/GET \/affiliate\/stats/);
});
