import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import KycStatusPage, { dynamic, metadata } from '../src/app/kyc/page.ts';
import {
  KYC_NEXT_STEP_COPY,
  KYC_PLACEMENTS,
  KYC_PLACEMENT_PROMPT,
  KYC_PLACEMENT_REASON,
  KYC_SCREEN_COPY,
  KYC_STATE_COPY,
  traderFacingStrings,
} from '../src/app/kyc/copy.ts';
import {
  KYC_STATUS_FIELDS,
  KycScreenSourceUnwired,
  KycStatusShapeError,
  SCREENED_KEY_TERMS,
  SERVER_KYC_SCREEN_SOURCE,
  ScreenedFieldError,
  UNWIRED_KYC_SCREEN_SOURCE,
  currentKycScreenSource,
  resetKycScreenSource,
  screenKycStatus,
  useKycScreenSource,
  type KycScreenSource,
} from '../src/app/kyc/source.ts';
import { API_ORIGIN_VAR } from '../src/http/client.ts';
import {
  KycScreen,
  UnknownPlacementError,
  toKycScreenPlaceholder,
  toKycScreenView,
} from '../src/app/kyc/screen.ts';
import { INTERNAL_TIER_TERMS, KYC_STATES } from '../src/view/kyc.ts';

// =============================================================================
// SC-M4-07 RENDERED, AND THE CLAUSE THAT GOVERNS THE SCREEN
// =============================================================================
// ADR-114 clause 6: "MERIT NEVER PROXIES A DOCUMENT ... the port has no method
// returning a document and no field one could be assigned to. The receiver
// SCREENS a verified payload before anything stores it, REFUSES rather than
// redacts, and records KEY PATHS and never values."
//
// A TEST THAT CHECKS THE STATUS FIELD RENDERS PASSES ON A PAGE THAT ALSO LEAKS
// A PASSPORT. So the assertions below do the opposite: they hand the render
// path a payload carrying document-shaped fields and read the bytes that came
// out, looking for the values rather than for the fields that should be there.
// =============================================================================

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SEGMENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', 'kyc');

/** A well-formed `GET /kyc/status` body. */
function statusBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state: 'verified',
    placement: 'pre_funded',
    verified_at: '2026-08-20T14:02:11Z',
    expires_at: '2028-08-20T14:02:11Z',
    action_required: null,
    ...over,
  };
}

/** THE VALUES THE PAGE MUST NEVER EMIT. Distinctive on purpose, so a search is exact. */
const PASSPORT = 'data:image/jpeg;base64,QkFTRTY0UEFTU1BPUlRCWVRFUw';
const SELFIE = 'https://vendor.example/applicants/abc/selfie.jpg';
const PROVIDER_CODE = 'DOC_UNREADABLE_TIER3';
const BIRTH_DATE = '1988-04-17';

/**
 * The payload a naive server would send and this page must refuse.
 *
 * FOUR SHAPES AND NOT ONE: a top-level document field, a screened value that is
 * not a document at all (INV-M19-09's provider reason code), a NESTED document
 * inside the provider's own blob, and a PII attribute this surface has no field
 * for. A screen that only looked at top-level keys would pass three of the four.
 */
function documentBearingBody(): Record<string, unknown> {
  return statusBody({
    document_image: PASSPORT,
    rejection_reason: PROVIDER_CODE,
    date_of_birth: BIRTH_DATE,
    provider: { raw_result: { selfie_url: SELFIE } },
  });
}

function sourceReturning(body: unknown): KycScreenSource {
  return {
    // The port's declared return type is `KycStatus`, which has no field a
    // document could be assigned to. This cast is the suite standing in for a
    // SERVER, which is not type checked by this workspace and is exactly the
    // gap `screenKycStatus` exists to cover.
    status: () => Promise.resolve(body as never),
  };
}

async function renderPage(body: unknown): Promise<string> {
  useKycScreenSource(sourceReturning(body));
  try {
    return renderToStaticMarkup(await KycStatusPage());
  } finally {
    resetKycScreenSource();
  }
}

// -----------------------------------------------------------------------------
// THE CLAUSE
// -----------------------------------------------------------------------------

test('THE CLAUSE: no document and no screened value reaches this page', async () => {
  const html = await renderPage(documentBearingBody());

  // THE PROBE FIRES. A `not.toContain` on a string the haystack never had is an
  // assertion that passes for the wrong reason, so each needle is proven
  // findable before it is proven absent. This is `falsify.mjs`'s rule applied
  // to four string searches.
  for (const value of [PASSPORT, SELFIE, PROVIDER_CODE, BIRTH_DATE]) {
    expect(`${html}${value}`, `${value} is findable`).toContain(value);
    expect(html, `${value} does not reach the page`).not.toContain(value);
  }

  // AND NOT THE KEY EITHER. A field name is a statement that the field exists,
  // and `data-field="document_image"` on an empty element would be a page
  // announcing that Merit holds one.
  for (const key of [
    'document_image',
    'rejection_reason',
    'date_of_birth',
    'raw_result',
    'selfie',
  ]) {
    expect(html, `${key} does not reach the page`).not.toContain(key);
  }

  // WHAT IT RENDERS INSTEAD IS AN ERROR STATE INSIDE INTACT CHROME, which is
  // the refusal being visible rather than the page being blank.
  expect(html).toContain('data-content="server_error"');
});

test('the same page renders the status when the payload carries no screened key', async () => {
  // THE CONTROL FOR THE TEST ABOVE. Without this, an assertion that a passport
  // is absent is satisfied by a page that renders nothing at all.
  const html = await renderPage(statusBody());
  expect(html).toContain(`>${KYC_STATE_COPY.verified}<`);
  expect(html).toContain('data-badge="verified"');
  expect(html).toContain('data-state="verified"');
  expect(html).not.toContain('data-content="server_error"');
});

test('screenKycStatus refuses rather than redacts, and names key paths and never values', () => {
  let caught: unknown;
  try {
    screenKycStatus(documentBearingBody());
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(ScreenedFieldError);
  const error = caught as ScreenedFieldError;

  // KEY PATHS, INCLUDING THE NESTED ONE, in the order the walk reached them.
  expect([...error.keyPaths].sort()).toEqual(
    [
      'date_of_birth',
      'document_image',
      'provider.raw_result',
      'provider.raw_result.selfie_url',
      'rejection_reason',
    ].sort(),
  );

  // AND NEVER A VALUE. The message is written to a log.
  for (const value of [PASSPORT, SELFIE, PROVIDER_CODE, BIRTH_DATE]) {
    expect(`${error.message}${value}`, `${value} is findable`).toContain(value);
    expect(error.message, `${value} is not quoted in the refusal`).not.toContain(value);
  }
});

test('the port has no method that could return a document', () => {
  // ADR-114 clause 6's FIRST half, asserted as a shape rather than read as a
  // sentence: ONE method, typed to API_CONTRACT section 7's five fields, and no
  // second method a document could arrive through.
  expect(Object.keys(UNWIRED_KYC_SCREEN_SOURCE)).toEqual(['status']);

  // AND THE FIVE FIELDS ARE THE CONTRACT'S, re-derived from the handler that
  // serves them rather than from memory.
  const route = readFileSync(join(ROOT, 'apps/api/src/routes/kyc.ts'), 'utf8');
  const start = route.indexOf('export interface KycStatus {');
  expect(start, 'apps/api declares KycStatus').toBeGreaterThanOrEqual(0);
  const block = route.slice(start, route.indexOf('}', start));
  const declared = [...block.matchAll(/readonly\s+([a-z_]+)\s*:/g)].map((m) => m[1]!);

  expect(declared).toEqual([...KYC_STATUS_FIELDS]);
});

test('no screening term matches a field the contract declares', () => {
  // THE DIRECTION THIS CHECK MUST NEVER FAIL IN. A term matching a contract
  // field would refuse every well-formed response, and the screen would look
  // like a broken endpoint rather than like an over-broad list.
  for (const field of KYC_STATUS_FIELDS) {
    for (const term of SCREENED_KEY_TERMS) {
      expect(field.includes(term), `${field} matches the screening term ${term}`).toBe(false);
    }
  }
});

test('an unknown key that is not screened is dropped rather than refused', () => {
  // TWO TIERS. API_CONTRACT can add a field, and a portal that refused every
  // response carrying one would break on an additive change.
  const projected = screenKycStatus(statusBody({ next_review_at: '2027-01-01T00:00:00Z' }));
  expect(Object.keys(projected).sort()).toEqual([...KYC_STATUS_FIELDS].sort());
});

test('a malformed payload refuses rather than rendering a guess', () => {
  expect(() => screenKycStatus(null)).toThrow(KycStatusShapeError);
  expect(() => screenKycStatus([statusBody()])).toThrow(KycStatusShapeError);
  expect(() => screenKycStatus(statusBody({ state: 4 }))).toThrow(KycStatusShapeError);
  expect(() => screenKycStatus(statusBody({ verified_at: 17 }))).toThrow(KycStatusShapeError);
});

// -----------------------------------------------------------------------------
// SC-M4-07: the states, and what to do in each
// -----------------------------------------------------------------------------

test('every state renders, with its own words and its own control', async () => {
  for (const state of KYC_STATES) {
    const html = await renderPage(statusBody({ state, action_required: null }));
    expect(html, `${state} renders`).toContain(`data-state="${state}"`);
    expect(html, `${state} has a label`).toContain(`>${KYC_STATE_COPY[state]}<`);

    // THE BADGE FOLLOWS THE STATE AND NOT `verified_at`. The fixture carries a
    // verification date in every state, including `expired`, which is the row
    // shape `view/kyc.ts` warns about.
    expect(html.includes('data-badge="verified"'), `${state} badge`).toBe(state === 'verified');
  }
});

test('pending shows no control at all and rejected routes to a human', async () => {
  // Section 7.9: "Repeated prompting reads as accusation regardless of wording",
  // so the pending state carries no control.
  const pending = await renderPage(statusBody({ state: 'pending' }));
  expect(pending).not.toContain('data-next-step');

  const rejected = await renderPage(statusBody({ state: 'rejected' }));
  expect(rejected).toContain('data-next-step="contact_support"');
  expect(rejected).toContain(KYC_NEXT_STEP_COPY.contact_support!);

  const required = await renderPage(statusBody({ state: 'kyc_required' }));
  expect(required).toContain('data-next-step="verify"');
});

test('the contextual prompt leads only where the trader is being asked', async () => {
  // THE DEFECT THIS ASSERTION EXISTS FOR WAS FOUND BY READING THE BYTES. The
  // first render of this page put "You passed. One quick step to activate your
  // funded account" under "Why you were asked" on a verification that was
  // already finished, and on one that had failed. M04 section 7.9 asks for ONE
  // contextual prompt at the trigger moment and then a card that waits.
  const asked = ['kyc_required', 'expired'] as const;
  const finished = ['pending', 'verified', 'rejected'] as const;

  for (const state of asked) {
    const html = await renderPage(statusBody({ state }));
    expect(html, `${state} leads with the prompt`).toContain('data-field="prompt"');
    expect(html).toContain(KYC_PLACEMENT_PROMPT.pre_funded);
  }

  for (const state of finished) {
    const html = await renderPage(statusBody({ state }));
    expect(html, `${state} carries no prompt`).not.toContain('data-field="prompt"');
    expect(html, `${state} does not claim a step is pending`).not.toContain(
      KYC_PLACEMENT_PROMPT.pre_funded,
    );
    // AND THE REASON IS STILL THERE, because "why you were asked" stays true
    // after the check is over and is the half a trader still wants.
    expect(html, `${state} keeps the reason`).toContain(KYC_PLACEMENT_REASON.pre_funded);
  }
});

test("the server's sentence renders verbatim and is never paraphrased", async () => {
  const sentence = 'Finish the check you started. It takes about 2 minutes.';
  const html = await renderPage(statusBody({ state: 'pending', action_required: sentence }));
  expect(html).toContain(sentence);
});

test('a sentence carrying an internal-tier word refuses the whole screen', async () => {
  // M04 section 7.9, enforced at the point the server's string enters the
  // trader's screen. The refusal is the screen, so the page renders the error
  // state and the offending sentence appears nowhere.
  const sentence = 'Your account is under review.';
  const html = await renderPage(statusBody({ state: 'pending', action_required: sentence }));
  expect(html).toContain('data-content="server_error"');
  expect(html).not.toContain('under review');
});

test('an unknown state and an unknown placement each refuse', async () => {
  expect(() =>
    toKycScreenView({
      status: {
        state: 'under_manual_check',
        placement: 'pre_funded',
        verified_at: null,
        expires_at: null,
        action_required: null,
      },
    }),
  ).toThrow(/is not a member of kyc_status/);

  expect(() =>
    toKycScreenView({
      status: {
        state: 'pending',
        placement: 'pre_eval',
        verified_at: null,
        expires_at: null,
        action_required: null,
      },
    }),
  ).toThrow(UnknownPlacementError);
});

test('the placement vocabulary is the CHECK at 0003_kyc.sql, re-derived', () => {
  const sql = readFileSync(join(ROOT, 'packages/db/migrations/0003_kyc.sql'), 'utf8');
  const start = sql.indexOf('placement              text NOT NULL CHECK (placement IN (');
  expect(start, 'the placement CHECK is declared in 0003').toBeGreaterThanOrEqual(0);
  const block = sql.slice(start, sql.indexOf('))', start));
  const declared = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);

  expect(declared).toEqual([...KYC_PLACEMENTS]);

  // AND EVERY MEMBER HAS A SENTENCE. A placement with no copy renders the raw
  // wire token, which is the failure this catalogue exists to prevent.
  for (const placement of KYC_PLACEMENTS) {
    expect(KYC_PLACEMENT_PROMPT[placement].length, `${placement} has a prompt`).toBeGreaterThan(0);
    expect(KYC_PLACEMENT_REASON[placement].length, `${placement} has a reason`).toBeGreaterThan(0);
  }
});

test('the two frozen v1 triggers carry the corpus sentences verbatim', () => {
  const m04 = readFileSync(join(ROOT, 'docs/plans/M04-trader-portal.md'), 'utf8');
  expect(m04).toContain(KYC_PLACEMENT_PROMPT.pre_funded.replace(/\.$/, ''));

  const m19 = readFileSync(join(ROOT, 'docs/plans/M19-kyc-identity.md'), 'utf8');
  expect(m19).toContain(KYC_PLACEMENT_PROMPT.second_distinct_account_purchase.replace(/\.$/, ''));
});

// -----------------------------------------------------------------------------
// M04 section 7.9's lint, which now has a catalogue to read
// -----------------------------------------------------------------------------

test('M04 section 7.9: no trader-facing string carries an internal-tier word', () => {
  const strings = traderFacingStrings();
  expect(strings.length, 'the catalogue is not empty').toBeGreaterThan(20);

  for (const value of strings) {
    const haystack = value.toLowerCase();
    for (const term of INTERNAL_TIER_TERMS) {
      expect(haystack.includes(term), `"${value}" contains "${term}"`).toBe(false);
    }
  }
});

test('INV-M4-07: no string in this segment words a refusal as forbidden', () => {
  for (const value of traderFacingStrings()) {
    for (const term of ['forbidden', 'not allowed', 'denied', 'permission']) {
      expect(value.toLowerCase().includes(term), `"${value}" contains "${term}"`).toBe(false);
    }
  }
});

// -----------------------------------------------------------------------------
// The chrome, which no content state can drop
// -----------------------------------------------------------------------------

test('this segment renders NO chrome, because the root layout owns all of it', async () => {
  // THE INVERSE OF THE TEST THIS REPLACES, and the reason is that session 250
  // landed `app/layout.tsx`. This segment rendered the band, a `<main>` and the
  // INV-M4-09 footer while no layout existed. The layout renders all three
  // around every page now, so a segment that still rendered them would produce a
  // second band, a `<main>` nested in a `<main>`, and the compliance disclosure
  // printed twice.
  //
  // THE DUPLICATED DISCLOSURE IS THE ONE THAT MATTERS. A doubled obligation is
  // not a safer failure than a missing one, and this assertion is what stops it
  // coming back.
  const states = [
    { kind: 'loading' as const },
    { kind: 'empty' as const },
    { kind: 'error' as const, error: 'not_found' as const },
    { kind: 'error' as const, error: 'server_error' as const },
  ];

  const rendered = [
    ...states.map((state) =>
      renderToStaticMarkup(KycScreen({ view: toKycScreenPlaceholder({ state }) })),
    ),
    await renderPage(statusBody()),
  ];

  for (const html of rendered) {
    for (const chrome of ['<main', '<footer', '<html', '<body', 'data-band', 'data-disclosure']) {
      expect(html, `${chrome} is the layout's, not this segment's`).not.toContain(chrome);
    }
    // AND IT STILL RENDERS ITS OWN HEADING, so "no chrome" is not "no output".
    expect(html).toContain('data-screen="SC-M4-07"');
  }
});

test('the root layout renders the chrome this segment stopped rendering', () => {
  // THE OTHER HALF, asserted against the layout's SOURCE rather than assumed.
  // The test above proves this segment emits no footer; on its own that is also
  // what a page with no disclosure anywhere looks like.
  //
  // IT IS READ AS TEXT RATHER THAN IMPORTED, AND THAT IS FORCED RATHER THAN
  // LAZY. `apps/portal/tsconfig.json` sets `jsx: preserve`, which hands JSX to
  // the framework's bundler and is correct for `next build`; Vitest reads the
  // same setting and leaves JSX untransformed, so importing any `.tsx` in this
  // workspace fails before a single assertion runs:
  //
  //   Failed to parse source for import analysis because the content contains
  //   invalid JS syntax. If you use tsconfig.json, make sure to not set jsx to
  //   preserve.  (vite:import-analysis, src/app/layout.tsx)
  //
  // Measured on this tree by trying it. No test in this repository imports a
  // `.tsx` file today, so nothing else has hit it yet. Reading the source is
  // strictly weaker than rendering it and is what is available; the tsconfig
  // line is session 250's and the finding is reported rather than taken.
  const layout = readFileSync(join(SEGMENT, '..', 'layout.tsx'), 'utf8');
  expect(layout).toContain('<main>{children}</main>');
  expect(layout).toContain('simulated-environment-disclosure');
  expect(layout).toContain('ImpersonationBand');
});

// -----------------------------------------------------------------------------
// The page, and what it refuses to be
// -----------------------------------------------------------------------------

test('the production source READS now, and an unconfigured deployment still errors', async () => {
  // THE DEFAULT MOVED AND THE OBSERVABLE BEHAVIOUR OF THIS BRANCH DID NOT.
  // `UNWIRED_KYC_SCREEN_SOURCE` was the default while this application had no
  // transport at all; ADR-162 landed one and `SERVER_KYC_SCREEN_SOURCE` reads
  // `GET /kyc/status` through it. With `MERIT_API_ORIGIN` unset there is no API
  // to read, so the page renders exactly the error state it rendered before.
  //
  // IT USED TO THROW BEFORE THAT, and that was right while this segment owned
  // the footer: a screen that cannot render a required disclosure must not
  // render. The layout renders the footer now, so an unavailable status is
  // content that failed rather than an obligation that failed.
  const saved = process.env[API_ORIGIN_VAR];
  delete process.env[API_ORIGIN_VAR];
  try {
    resetKycScreenSource();
    expect(currentKycScreenSource()).toBe(SERVER_KYC_SCREEN_SOURCE);

    const html = renderToStaticMarkup(await KycStatusPage());
    expect(html).toContain('data-content="server_error"');
    expect(html).toContain('data-screen="SC-M4-07"');
  } finally {
    if (saved !== undefined) process.env[API_ORIGIN_VAR] = saved;
  }
});

test('ADR-114 clause 6 half one holds on the LIVE source and not only on the unwired one', async () => {
  // THE SHAPE ASSERTION HAD TO FOLLOW THE DEFAULT. "The port has no method
  // returning a document and no field one could be assigned to" is a claim
  // about the source a production request actually reaches, and until this
  // session that was `UNWIRED_KYC_SCREEN_SOURCE`. Asserting it only there would
  // now be asserting it about a value nothing serves.
  expect(Object.keys(SERVER_KYC_SCREEN_SOURCE)).toEqual(['status']);

  // AND THE FAIL-CLOSED VALUE IS STILL HERE AND STILL FAILS CLOSED. It is what
  // a caller installs when it wants a source that answers nothing.
  expect(Object.keys(UNWIRED_KYC_SCREEN_SOURCE)).toEqual(['status']);
  await expect(UNWIRED_KYC_SCREEN_SOURCE.status()).rejects.toThrow(KycScreenSourceUnwired);

  useKycScreenSource(UNWIRED_KYC_SCREEN_SOURCE);
  try {
    const html = renderToStaticMarkup(await KycStatusPage());
    expect(html).toContain('data-content="server_error"');
    expect(html).toContain('data-screen="SC-M4-07"');
  } finally {
    resetKycScreenSource();
  }
});

test('the page is never statically generated', () => {
  // A prerendered identity-scoped page is one trader's verification state
  // served to every trader from a cache.
  expect(dynamic).toBe('force-dynamic');
  expect(metadata.title).toBe(KYC_SCREEN_COPY.heading);
});

test('this segment serves no API path and declares no server action', () => {
  // ADR-095 ruling 3 and ADR-083 section 3. `RI-09` reads the PATH; this reads
  // the CONTENTS, which is the half a path check cannot see.
  const files = readdirSync(SEGMENT, { withFileTypes: true });
  expect(files.length, 'the segment has files').toBeGreaterThan(0);

  for (const entry of files) {
    expect(entry.isFile(), `${entry.name} is a file`).toBe(true);
    expect(entry.name, 'no route handler in this segment').not.toMatch(/^route\./);

    const code = readFileSync(join(SEGMENT, entry.name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');
    expect(code, `${entry.name} declares no server action`).not.toContain('use server');
    expect(code, `${entry.name} spells no API base path`).not.toContain('/api/v1');
  }
});
