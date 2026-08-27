import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import { CertificatesScreen } from '../src/app/(purchases)/certificates-screen.ts';
import { CERTIFICATE_REQUESTS, FIXTURE_PORTS } from '../src/app/(purchases)/fixtures.ts';
import {
  PUBLISHED_CERTIFICATE_FIELDS,
  certificatesPageModel,
  publishedCertificate,
} from '../src/app/(purchases)/model.ts';
import type { PurchasesSegmentPorts } from '../src/app/(purchases)/ports.ts';
import { MissingDisclosureError } from '../src/view/disclosure.ts';

// =============================================================================
// SC-M4-08 RENDERED: WHAT A CERTIFICATE MAY CARRY ONTO A SURFACE
// =============================================================================
// THE ASSERTIONS THAT MATTER HERE ARE ABSENCES AND THEY ARE MADE OVER THE
// RENDERED BYTES.
//
// A suite that checks the happy fields passes on a certificate that renders them
// AND an account id beside them. INV-M11-01 and AS-M4-03 rule 3 are both written
// as absences ("no identity, no email, no display name, no cumulative total, no
// lifetime figure"), so the test has to be written as one too, and it has to
// read the OUTPUT rather than the model: a value can reach a page through an
// `alt` attribute, a `title`, an error message or a `data-` prop without ever
// appearing in the model's visible fields.

const SEGMENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', '(purchases)');

async function renderCertificates(ports: PurchasesSegmentPorts = FIXTURE_PORTS): Promise<string> {
  const model = await certificatesPageModel(ports, CERTIFICATE_REQUESTS);
  return renderToStaticMarkup(CertificatesScreen({ model }));
}

test('the allowlist and the function that applies it agree, field for field', async () => {
  // The list is the control and the function is its implementation. A field
  // added to one and not the other is a field whose publication nobody decided,
  // so the disagreement fails the build rather than reaching a card.
  const model = await certificatesPageModel(FIXTURE_PORTS, CERTIFICATE_REQUESTS);
  const card = model.cards[0];
  expect(card).toBeDefined();
  expect(Object.keys(card!).sort()).toEqual([...PUBLISHED_CERTIFICATE_FIELDS].sort());
});

test('the allowlist is applied by construction and never by spreading the view', () => {
  // ../src/app/(purchases)/model.ts states the reason: a spread carries the next
  // field somebody adds to `CertificateView` onto a public artifact by default.
  // This is the source-level half, on ./inv-m4-01.test.ts's precedent, because
  // the behavioural half above cannot see a field that does not exist yet.
  const source = readFileSync(join(SEGMENT, 'model.ts'), 'utf8');
  const body = /export function publishedCertificate\([\s\S]*?\n}/.exec(source)?.[0];
  expect(body, 'publishedCertificate is defined in model.ts').toBeDefined();
  expect(body).not.toMatch(/\.\.\./);
  for (const field of PUBLISHED_CERTIFICATE_FIELDS) expect(body).toContain(`${field}:`);
});

test('NOTHING THE CORPUS EXCLUDES REACHES THE RENDERED PAGE', async () => {
  const html = await renderCertificates();

  // Built from the fixtures rather than typed here, so the forbidden set moves
  // when the data does and a renamed fixture cannot silently empty this check.
  const responses = await Promise.all(
    CERTIFICATE_REQUESTS.map((request) => FIXTURE_PORTS.readCertificate(request)),
  );
  const present = responses.filter((r) => r !== null);
  expect(present.length, 'the fixtures serve certificates to assert over').toBeGreaterThan(0);

  for (const certificate of present) {
    // `certificate_id` IS THE PRIMARY KEY SD-M11-01 SEPARATED FROM THE PUBLIC
    // `code` so the public token could be rotated after an incident without
    // rewriting it. A screen that prints it publishes the half the split keeps
    // private, on the one screen whose purpose is copying something out.
    expect(html, 'no certificate_id is rendered').not.toContain(certificate.certificate_id);
  }

  for (const request of CERTIFICATE_REQUESTS) {
    // SD-M4-01 puts `account_id` and `identity_id` on the row and API_CONTRACT
    // puts neither on the response. The screen is not grouped by account for
    // this reason: see ../src/app/(purchases)/model.ts.
    expect(html, 'no account identifier is rendered').not.toContain(request.account_id);
  }

  // INV-M11-01's own list, read as a denylist over the output. It is the WEAKER
  // half of this file (a denylist is wrong about every field invented after it
  // is written, which is why the allowlist above is the real control) and it is
  // here because it is the half that would catch a value arriving through an
  // attribute rather than through a field.
  for (const forbidden of ['@', 'identity', 'lifetime', 'total', 'balance', 'cumulative']) {
    expect(html.toLowerCase(), `no "${forbidden}" appears on a certificate page`).not.toContain(
      forbidden,
    );
  }
});

test('a refused certificate takes its claims off the page with it', async () => {
  // The fixture `acc_1c04` payout card has a blank `verify_url`, which
  // `toCertificateView` refuses (AS-M4-03: a card shared without its
  // verification route is the artifact the attack forges). The refusal must not
  // become a second, weaker rendering of the same claims.
  const html = await renderCertificates();
  const refused = await FIXTURE_PORTS.readCertificate({ account_id: 'acc_1c04', kind: 'payout' });
  expect(refused).not.toBeNull();

  expect(html).toContain('could not be shown');
  expect(html, 'the refused card claims no amount').not.toContain('2,200.00');
  expect(html, 'the refused card names no plan').not.toContain('direct');
  expect(html, 'the refused card carries no trading day').not.toContain('2026-04-28');
  expect(html, 'the refusal reason carries no certificate_id').not.toContain(
    refused!.certificate_id,
  );
});

test('a pass card claims no amount and renders nothing where one would go', async () => {
  const html = await renderCertificates();
  expect(html).toContain('Evaluation pass certificate');
  expect(html).toContain('Payout certificate');

  // Exactly one `Payout` fact row, from the one payout card that survived.
  expect(html.match(/<dt class="merit-fact-label">Payout<\/dt>/g)).toHaveLength(1);
  expect(html).toContain('1,500.00');
  // The forgery direction produced by a default rather than by an adversary.
  expect(html, 'an absent amount is never rendered as zero').not.toContain('>0.00<');
});

test('every card carries the disclosure, and a blank document refuses the page', async () => {
  const html = await renderCertificates();
  const cards = html.match(/class="merit-certificate"/g) ?? [];
  const disclosures = html.match(/class="merit-disclosure"/g) ?? [];
  expect(cards.length).toBeGreaterThan(0);
  // INV-M4-09 is per surface and a card is a surface, so the count is per card
  // rather than one footer for the page.
  expect(disclosures).toHaveLength(cards.length);
  expect(html).toContain('All trading on Merit accounts is simulated.');

  // A blank document is treated as missing, which is `disclosureBlock()`'s rule.
  // The page refuses rather than rendering cards without the obligation, because
  // "a blank where a required disclosure belongs is the obligation failing
  // silently, which is the only way it fails".
  const blank: PurchasesSegmentPorts = {
    ...FIXTURE_PORTS,
    readDisclosure: () => Promise.resolve('   '),
  };
  await expect(renderCertificates(blank)).rejects.toThrow(MissingDisclosureError);
});

test('the share affordance is the verification page and never the image', async () => {
  const html = await renderCertificates();
  const model = await certificatesPageModel(FIXTURE_PORTS, CERTIFICATE_REQUESTS);

  // React escapes `&` in an attribute value, so the comparison is made against
  // the bytes the browser receives rather than against the model's string. A
  // negative assertion written against the unescaped form would pass on a page
  // that does link the image, which is the failure this test exists to catch.
  const attr = (value: string): string => value.replaceAll('&', '&amp;');

  for (const card of model.cards) {
    expect(html, 'the verify url is a link').toContain(`href="${attr(card.verify_url)}"`);
    expect(html, 'the image is rendered and never linked').not.toContain(
      `href="${attr(card.image_url)}"`,
    );
    expect(html).toContain(`src="${attr(card.image_url)}"`);
  }

  // AS-M4-03 rule 1, said to the trader on the screen where they decide.
  expect(html).toContain('The verification page is what proves this certificate');
  // AS-M4-03 rule 2's absence, stated rather than left to be assumed.
  expect(html).toContain('reports a revocation');
});

test('publishedCertificate carries the branded disclosure through unchanged', async () => {
  const model = await certificatesPageModel(FIXTURE_PORTS, CERTIFICATE_REQUESTS);
  const card = model.cards[0]!;
  // The brand is compile-time only, so the runtime assertion is that the text
  // survives the allowlist rather than being re-authored inside it.
  expect(String(card.disclosure)).toContain('simulated');
  expect(publishedCertificate({ ...card, certificate_id: 'x' } as never).disclosure).toBe(
    card.disclosure,
  );
});
