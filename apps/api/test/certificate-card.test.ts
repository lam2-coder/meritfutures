import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CERTIFICATE_CODE_ALPHABET } from '@merit/db';
import { afterEach, expect, test } from 'vitest';

import {
  CARD_CHARSET,
  CARD_HEIGHT_PX,
  CARD_INPUT_KEYS,
  CARD_PALETTE,
  CARD_REVOCATION_CLASSES,
  CARD_STATEMENT_KEYS,
  CARD_STATES,
  CARD_WIDTH_PX,
  CertificateCardError,
  certificateCardVersion,
  formatCents,
  renderCertificateCard,
  type CertificateCardCopy,
  type CertificateCardInput,
} from '../src/certificate-card.ts';
import { BASE_PATH, buildServer, discoverRouteModules } from '../src/index.ts';
import {
  assertPng,
  resetCertificateImageSource,
  useCertificateImageSource,
} from '../src/routes/certificates.ts';
import { VERIFY_PRESENTATION_VARS } from '../src/routes/verify.ts';

// CI-02, the `unit` project.
//
// =============================================================================
// THE CARD RENDERER ADR-249 RULED AND DID NOT BUILD
// =============================================================================
// ADR-249 ruled the renderer's home, its timing, its storage and its address
// and deliberately landed no renderer, which left `useCertificateImageSource`
// and `useCertificateBackend` waiting on one absent artefact. This file is the
// suite for that artefact, and its cases are chosen against the two traps the
// ruling and the route already name rather than against the happy path.
//
// -----------------------------------------------------------------------------
// TRAP 1: A RENDERER THAT ANSWERS NOTHING FOR A REVOKED ROW TURNS THE
//         REVOCATION INTO THE FAILURE
// -----------------------------------------------------------------------------
// `imageHandler` throws when a non-deferred lookup carries no card, in words
// that name the invariant: "a revoked certificate that does not render is the
// revocation failing to arrive" (`INV-M11-08`, `AS-M11-02`). So the cases below
// assert that a revoked row RENDERS, for every one of `SD-M11-02`'s four
// classes, and that what changes is WHAT IT SAYS. The route half is executed
// end to end: a wired source that renders a revoked card answers 200 with the
// bytes, and never reaches the throw.
//
// AND THE REFUSALS ARE ASSERTED STATE-INDEPENDENT, which is the deeper half of
// the same trap. A misconfigured `fact_untrue` sentence must fail the ISSUED
// card too, because a check that ran only on the sentence being drawn would
// surface on the first card that had to publish a revocation.
//
// -----------------------------------------------------------------------------
// TRAP 2: THE TEMPLATE DRAWING SOMETHING THE DIGEST DID NOT SEE
// -----------------------------------------------------------------------------
// ADR-249's founder block names the sentence most likely to fall: clause 8's
// derived render version holds "only while the template draws NOTHING the
// digest did not see", and "a renderer that reaches for the clock, for a
// plan-version lookup, or for a logo it fetches, has a rendering input the row
// does not carry". Three cases stand against it. The module's own source is
// swept for a clock, an environment read, a file read, a network read and a
// random source; two renders of one input are asserted byte identical; and
// every field of the input is asserted to change the version, with every DRAWN
// value asserted to change the bytes.
// =============================================================================

const HERE = import.meta.dirname;
const REPO = join(HERE, '..', '..', '..');
const RENDERER = join(REPO, 'apps', 'api', 'src', 'certificate-card.ts');
const DESIGN_SYSTEM = join(REPO, 'docs', 'design', 'DESIGN_SYSTEM.md');

const onDisk = await discoverRouteModules();

afterEach(() => {
  resetCertificateImageSource();
});

// -----------------------------------------------------------------------------
// The fixture. Every sentence below is a FIXTURE and none of it is Merit copy:
// the real wording is configuration `routes/verify.ts` reads from the
// environment, and this repository writes none of it.
// -----------------------------------------------------------------------------

const COPY: CertificateCardCopy = {
  statements: {
    valid: 'fixture: this certificate is valid',
    fact_untrue: 'fixture: the claim was issued in error and is withdrawn',
    account_enforced: 'fixture: the claim stands and the account was later closed',
    issued_in_error: 'fixture: a system fault, and it is reversible',
    trader_request: 'fixture: withdrawn at the request of the holder',
  },
  disclosure: 'fixture: simulated environment disclosure',
};

const ISSUED: CertificateCardInput = {
  kind: 'pass',
  claims: { plan_code: 'MERIT-CORE-EOD-50K', size_cents: 5_000_000, trading_day: '2026-08-24' },
  claimsSchemaVersion: 1,
  code: 'A7K3M9QRSTVWXYZ0123456789',
  issuedAt: '2026-08-24T12:00:00.000Z',
  state: 'issued',
  revocation: null,
  copy: COPY,
};

const REVOKED: CertificateCardInput = {
  ...ISSUED,
  state: 'revoked',
  revocation: { class: 'account_enforced', at: '2026-08-25T09:00:00.000Z' },
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

// -----------------------------------------------------------------------------
// 1. It produces bytes, and they are the bytes the route will accept
// -----------------------------------------------------------------------------

test('the renderer produces PNG bytes that `assertPng` accepts', () => {
  const card = renderCertificateCard(ISSUED);

  // `assertPng` IS THE ROUTE'S OWN VALIDATOR AND IT IS THE ORACLE HERE rather
  // than a signature check written twice. It refuses bytes that do not open
  // with the PNG signature, and the route labels whatever survives it
  // `image/png`.
  expect(assertPng(card.bytes)).toBe(card.bytes);
  expect(card.bytes.length).toBeGreaterThan(0);
  expect(card.version).toMatch(/^[0-9a-f]{64}$/);
});

/**
 * The chunk stream, parsed by a reader that shares no code with the encoder.
 *
 * THE CRC IS RECOMPUTED HERE FROM THE POLYNOMIAL rather than compared with what
 * the encoder produced, because a checksum verified by its own author verifies
 * nothing. ISO 15948 clause 5.5.
 */
function chunksOf(bytes: Uint8Array): readonly { type: string; data: Uint8Array }[] {
  expect([...bytes.subarray(0, 8)]).toStrictEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: { type: string; data: Uint8Array }[] = [];
  let at = 8;
  while (at < bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(at + 4, at + 8 + length)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1)
        crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    expect(view.getUint32(at + 8 + length), `the CRC of the \`${type}\` chunk`).toBe(
      (crc ^ 0xffffffff) >>> 0,
    );
    found.push({ type, data });
    at += 12 + length;
  }
  return found;
}

test('the bytes are a well formed PNG: the chunks, the order, and every CRC', () => {
  const chunks = chunksOf(renderCertificateCard(ISSUED).bytes);

  // COLOUR TYPE 3 NEEDS A `PLTE` AND NEEDS IT BEFORE THE `IDAT`, which is the
  // one ordering rule a hand-rolled encoder gets wrong and no viewer forgives.
  expect(chunks.map((one) => one.type)).toStrictEqual(['IHDR', 'PLTE', 'IDAT', 'IEND']);

  const header = chunks[0]?.data ?? new Uint8Array(0);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  expect(view.getUint32(0)).toBe(CARD_WIDTH_PX);
  expect(view.getUint32(4)).toBe(CARD_HEIGHT_PX);
  // Bit depth 8, colour type 3, and the three zeroes ISO 15948 fixes.
  expect([...header.subarray(8)]).toStrictEqual([8, 3, 0, 0, 0]);

  // FOUR PALETTE ENTRIES AND NO FIFTH. The absent fifth is `oxide-500`; see
  // case 8.
  expect(chunks[1]?.data.length).toBe(Object.keys(CARD_PALETTE).length * 3);
});

// -----------------------------------------------------------------------------
// 2. THE TRAP. A revoked certificate renders, and what changes is what it says
// -----------------------------------------------------------------------------

test('every revocation class RENDERS, and each one draws its own sentence', () => {
  const issued = renderCertificateCard(ISSUED);
  const drawn = new Map<string, string>();

  for (const revocationClass of CARD_REVOCATION_CLASSES) {
    const card = renderCertificateCard({
      ...REVOKED,
      revocation: { class: revocationClass, at: '2026-08-25T09:00:00.000Z' },
    });

    // BYTES, NOT NOTHING. `imageHandler` throws on a non-deferred lookup that
    // carried no card, so a renderer that answered `null` here would convert
    // the revocation into a 500 on exactly the fetch that matters.
    expect(assertPng(card.bytes)).toBe(card.bytes);
    expect(hex(card.bytes), `\`${revocationClass}\` draws the issued card`).not.toBe(
      hex(issued.bytes),
    );
    drawn.set(revocationClass, hex(card.bytes));
  }

  // AND THE FOUR ARE FOUR DIFFERENT CARDS. `AS-M11-05`: collapsing the classes
  // lets an enforcement retroactively deny an achievement that did happen, and
  // four classes drawing one card is that collapse arriving in the renderer.
  //
  // THIS HALF DOES NOT PROVE THE SENTENCE IS SELECTED BY THE CLASS AND IT WAS
  // WRITTEN BELIEVING IT DID. A renderer that ignored the class when picking
  // the sentence still passes here, because the class is also drawn in the
  // state line, so four distinct cards come out either way. It was watched
  // passing on exactly that seeded defect. The case below is the one that
  // catches it, and this one is left as what it actually measures.
  expect(new Set(drawn.values()).size).toBe(CARD_REVOCATION_CLASSES.length);
});

test('retuning one class`s sentence changes that card and leaves the other three', () => {
  // `INV-M11-07` IN ITS OWN WORDS: the class DRIVES the published sentence. The
  // property that says so is a bijection rather than a count. Retune exactly
  // one of the five sentences and exactly one of the four cards may move; a
  // renderer that drew `valid` on every revoked card moves NONE of them, and a
  // renderer that drew all five moves ALL of them.
  const at = '2026-08-25T09:00:00.000Z';
  for (const retunedClass of CARD_REVOCATION_CLASSES) {
    const retuned: CertificateCardCopy = {
      ...COPY,
      statements: { ...COPY.statements, [retunedClass]: 'fixture: a different sentence entirely' },
    };
    for (const drawnClass of CARD_REVOCATION_CLASSES) {
      const revocation = { class: drawnClass, at } as const;
      const before = hex(renderCertificateCard({ ...REVOKED, revocation }).bytes);
      const after = hex(renderCertificateCard({ ...REVOKED, revocation, copy: retuned }).bytes);
      const label = `retuned \`${retunedClass}\` and drew \`${drawnClass}\``;
      if (retunedClass === drawnClass) expect(after, label).not.toBe(before);
      else expect(after, label).toBe(before);
    }
  }
});

test('the route serves a revoked card end to end and never reaches its own refusal', async () => {
  const card = renderCertificateCard(REVOKED);
  useCertificateImageSource({
    lookup: () =>
      Promise.resolve({
        result: 'revoked',
        card: { bytes: card.bytes, cache_max_age_seconds: 120 },
      }),
    record: () => Promise.resolve(),
  });

  const { app } = buildServer({ surface: 'public', modules: onDisk });
  const res = await app.inject({
    method: 'GET',
    url: `${BASE_PATH}/certificates/${ISSUED.code}/image.png`,
  });
  await app.close();

  // THE HALF `certificate-card-home.test.ts` ASSERTS IS THE FAILURE AND THIS IS
  // THE SUCCESS BESIDE IT: that file wires a source resolving `revoked` with a
  // null card and asserts a 500. Here the same state renders, and the answer is
  // the bytes.
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toBe('image/png');
  expect(res.headers['cache-control']).toBe('public, max-age=120');
  expect(hex(new Uint8Array(res.rawPayload))).toBe(hex(card.bytes));
});

test('a deferred state has no member to arrive as, and is refused if one is forced', () => {
  // THE WITHHOLDING IS STRUCTURAL. `CARD_STATES` is the two states that render,
  // "a deferral is a claim Merit has not made yet" (ADR-168 foreclosure 4), and
  // the input type has no field a deferral could arrive in.
  expect([...CARD_STATES]).toStrictEqual(['issued', 'revoked']);
  expect(() => renderCertificateCard({ ...ISSUED, state: 'deferred' as never })).toThrowError(
    CertificateCardError,
  );
});

// -----------------------------------------------------------------------------
// 3. Every refusal is state-independent, which is the trap's deeper half
// -----------------------------------------------------------------------------

test('a broken sentence this card will not draw still fails THIS card', () => {
  // `routes/verify.ts`' RULE TRANSCRIBED: "Every sentence is checked on every
  // path, because a sentence missing only for the result it describes is a
  // hit-versus-miss oracle built out of the configuration error." Here the cost
  // of getting it wrong is higher than an oracle: a `fact_untrue` sentence that
  // only fails when a revocation is published is `INV-M11-08` failing at the
  // moment it is load bearing.
  for (const key of CARD_STATEMENT_KEYS) {
    const broken: CertificateCardCopy = {
      ...COPY,
      statements: { ...COPY.statements, [key]: '   ' },
    };
    expect(() => renderCertificateCard({ ...ISSUED, copy: broken }), key).toThrowError(
      CertificateCardError,
    );
  }
});

test('a sentence too long for its box fails every card rather than the one it describes', () => {
  const long = `fixture ${'word '.repeat(80)}`;
  const broken: CertificateCardCopy = {
    ...COPY,
    statements: { ...COPY.statements, fact_untrue: long },
  };

  // THE ISSUED CARD, which never draws `fact_untrue`, and the `trader_request`
  // card, which never draws it either. Both refuse.
  expect(() => renderCertificateCard({ ...ISSUED, copy: broken })).toThrowError(
    CertificateCardError,
  );
  expect(() =>
    renderCertificateCard({
      ...REVOKED,
      revocation: { class: 'trader_request', at: '2026-08-25T09:00:00.000Z' },
      copy: broken,
    }),
  ).toThrowError(CertificateCardError);
});

test('a character the typeface cannot draw is refused in COPY and replaced in a ROW', () => {
  // THE TWO EM-DASHES BELOW ARE THE SUBJECT OF THIS CASE RATHER THAN PROSE, and
  // Appendix F is why they are the character chosen: the dash this corpus bans
  // from Merit's own writing is exactly the one a deployment is most likely to
  // paste into configured copy from somewhere else.
  //
  // COPY IS REFUSED, because Merit's published wording is not silently altered
  // on a public artefact and because the refusal reaches every card at once.
  expect(() =>
    renderCertificateCard({ ...ISSUED, copy: { ...COPY, disclosure: 'fixture — disclosure' } }),
  ).toThrowError(CertificateCardError);

  // A ROW IS DRAWN ANYWAY, and that asymmetry is the trap again. Refusing an
  // unexpected byte in `plan_code` would turn one odd row into a revocation
  // that never renders.
  const odd = renderCertificateCard({
    ...REVOKED,
    claims: { ...REVOKED.claims, plan_code: 'MERIT—50K' },
  });
  expect(assertPng(odd.bytes)).toBe(odd.bytes);
});

test('an over-long row value is drawn truncated rather than refused', () => {
  const long = renderCertificateCard({
    ...REVOKED,
    claims: { ...REVOKED.claims, plan_code: 'X'.repeat(200) },
  });
  expect(assertPng(long.bytes)).toBe(long.bytes);
});

// -----------------------------------------------------------------------------
// 4. The template draws nothing the digest did not see (ADR-249 clause 8)
// -----------------------------------------------------------------------------

test('the renderer reads no clock, no environment, no file, no network and no randomness', () => {
  const source = readFileSync(RENDERER, 'utf8');
  // THE COMMENTS ARE STRIPPED FIRST, because this file's own header names every
  // one of these words while explaining why it does not use them, and a sweep
  // that read the prose would either fail on the explanation or be written to
  // ignore exactly the thing it checks.
  const code = source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
    .join('\n')
    .replace(/\/\*\*[\s\S]*?\*\//g, '');

  for (const forbidden of [
    'Date',
    'process.env',
    'fetch(',
    'readFile',
    'Math.random',
    'randomBytes',
    'performance',
    'node:fs',
    'node:http',
  ])
    expect(code, `the renderer names \`${forbidden}\``).not.toContain(forbidden);

  // AND THE IMPORTS ARE THE WHOLE ANSWER RATHER THAN A DENYLIST. Two, and
  // neither of them can reach the world.
  expect([...code.matchAll(/^import .* from '(.*)';$/gm)].map((match) => match[1])).toStrictEqual([
    'node:crypto',
    'node:zlib',
  ]);
});

test('one input renders to identical bytes twice', () => {
  // PURITY, EXECUTED. A renderer that reached for a clock would differ here on
  // a fast enough machine and pass on a slow one, so the case is the cheap half
  // of the sweep above rather than a replacement for it.
  expect(hex(renderCertificateCard(REVOKED).bytes)).toBe(hex(renderCertificateCard(REVOKED).bytes));
  expect(certificateCardVersion(REVOKED)).toBe(certificateCardVersion(REVOKED));
});

test('`CARD_INPUT_KEYS` is TOTAL over the input, so nothing escapes the digest', () => {
  // THE PROPERTY ADR-249 CLAUSE 8 RESTS ON. A field added to the input and
  // forgotten in the canonical form would be a rendering input the version
  // cannot see, and a cache keyed on that version would serve a stale card
  // nobody can tell is stale.
  expect(Object.keys(ISSUED).sort()).toStrictEqual([...CARD_INPUT_KEYS].sort());
  expect(Object.keys(REVOKED).sort()).toStrictEqual([...CARD_INPUT_KEYS].sort());
});

/** One field, changed, with what the change is expected to cost. */
const MUTATIONS: readonly (readonly [string, CertificateCardInput, CertificateCardInput])[] = [
  [
    'kind',
    ISSUED,
    { ...ISSUED, kind: 'payout', claims: { ...ISSUED.claims, amount_cents: 250_000 } },
  ],
  ['claims.plan_code', ISSUED, { ...ISSUED, claims: { ...ISSUED.claims, plan_code: 'MERIT-25K' } }],
  ['claims.size_cents', ISSUED, { ...ISSUED, claims: { ...ISSUED.claims, size_cents: 2_500_000 } }],
  [
    'claims.trading_day',
    ISSUED,
    { ...ISSUED, claims: { ...ISSUED.claims, trading_day: '2026-08-25' } },
  ],
  ['code', ISSUED, { ...ISSUED, code: 'ZZZZZZZZZZZZZZZZZZZZZZZZZ' }],
  ['issuedAt', ISSUED, { ...ISSUED, issuedAt: '2026-01-02T03:04:05.000Z' }],
  ['state', ISSUED, REVOKED],
  [
    'revocation.class',
    REVOKED,
    { ...REVOKED, revocation: { class: 'fact_untrue', at: '2026-08-25T09:00:00.000Z' } },
  ],
  [
    'revocation.at',
    REVOKED,
    { ...REVOKED, revocation: { class: 'account_enforced', at: '2026-08-26T09:00:00.000Z' } },
  ],
  [
    'copy.statements.valid',
    ISSUED,
    { ...ISSUED, copy: { ...COPY, statements: { ...COPY.statements, valid: 'fixture: other' } } },
  ],
  ['copy.disclosure', ISSUED, { ...ISSUED, copy: { ...COPY, disclosure: 'fixture: other' } }],
];

test('every DRAWN value changes the bytes, so nothing is claimed rendered that is not', () => {
  for (const [field, before, after] of MUTATIONS) {
    expect(hex(renderCertificateCard(after).bytes), `\`${field}\` is not drawn`).not.toBe(
      hex(renderCertificateCard(before).bytes),
    );
    expect(certificateCardVersion(after), `\`${field}\` is outside the digest`).not.toBe(
      certificateCardVersion(before),
    );
  }
});

test('the four undrawn sentences are inside the digest, and that is deliberate', () => {
  // THE ONE FIELD THAT DOES NOT CHANGE THE BYTES, NAMED RATHER THAN LEFT OUT OF
  // THE TABLE ABOVE. An issued card draws `valid` and none of the other four,
  // so retuning `fact_untrue` leaves these bytes identical. It still changes the
  // VERSION, and the alternative is worse: a version blind to the copy would
  // keep serving cards drawn from the sentence a deployment has just replaced,
  // and `INV-M9-04` is the row that exists because a fire-and-forget
  // invalidation is a cache that is USUALLY RIGHT.
  const retuned: CertificateCardInput = {
    ...ISSUED,
    copy: { ...COPY, statements: { ...COPY.statements, fact_untrue: 'fixture: reworded' } },
  };
  expect(hex(renderCertificateCard(retuned).bytes)).toBe(hex(renderCertificateCard(ISSUED).bytes));
  expect(certificateCardVersion(retuned)).not.toBe(certificateCardVersion(ISSUED));
});

test('`claimsSchemaVersion` is drawn, and the only other value is refused', () => {
  // `SD-M11-01` EXISTS SO THE CLAIM SHAPE CAN EVOLVE, and a template that drew
  // a shape it did not know would be a card asserting a claim it never read.
  expect(() => renderCertificateCard({ ...ISSUED, claimsSchemaVersion: 2 })).toThrowError(
    CertificateCardError,
  );
  expect(certificateCardVersion({ ...ISSUED, claimsSchemaVersion: 2 })).not.toBe(
    certificateCardVersion(ISSUED),
  );
});

// -----------------------------------------------------------------------------
// 5. The biconditionals, both ways round
// -----------------------------------------------------------------------------

test('the state and the revocation are one fact, and a card that disagrees is refused', () => {
  expect(() => renderCertificateCard({ ...REVOKED, revocation: null })).toThrowError(
    CertificateCardError,
  );
  expect(() =>
    renderCertificateCard({
      ...ISSUED,
      revocation: { class: 'trader_request', at: '2026-08-25T09:00:00.000Z' },
    }),
  ).toThrowError(CertificateCardError);
});

test('the amount is the payout card`s value, and a pass card carrying one is refused', () => {
  expect(() =>
    renderCertificateCard({ ...ISSUED, claims: { ...ISSUED.claims, amount_cents: 250_000 } }),
  ).toThrowError(CertificateCardError);
  expect(() => renderCertificateCard({ ...ISSUED, kind: 'payout' })).toThrowError(
    CertificateCardError,
  );
});

// -----------------------------------------------------------------------------
// 6. Money is integer cents and no float is constructed
// -----------------------------------------------------------------------------

test('a card prints integer cents by string surgery and refuses anything else', () => {
  expect(formatCents(5_000_000, 'size_cents')).toBe('$50,000.00');
  expect(formatCents(250_000, 'amount_cents')).toBe('$2,500.00');
  expect(formatCents(0, 'size_cents')).toBe('$0.00');
  expect(formatCents(5, 'size_cents')).toBe('$0.05');
  expect(formatCents(123_456_789, 'size_cents')).toBe('$1,234,567.89');

  for (const bad of [12.5, -100, Number.NaN, Number.POSITIVE_INFINITY])
    expect(() => formatCents(bad, 'size_cents'), String(bad)).toThrowError(CertificateCardError);

  // AND THE REFUSAL REACHES THE CARD rather than sitting on a helper nothing
  // calls with a bad value.
  expect(() =>
    renderCertificateCard({ ...ISSUED, claims: { ...ISSUED.claims, size_cents: 5_000_000.5 } }),
  ).toThrowError(CertificateCardError);
});

// -----------------------------------------------------------------------------
// 7. The vocabulary is shared with the verify page rather than invented here
// -----------------------------------------------------------------------------

test('the card and the verify page key the five sentences identically', () => {
  // TWO SURFACES PUBLISH ONE REVOCATION and `INV-M11-07` gives it one sentence
  // per class. A card keyed differently from the page would be two vocabularies
  // for one fact, and the drift would be invisible until a class was renamed.
  expect([...CARD_STATEMENT_KEYS].sort()).toStrictEqual(
    Object.keys(VERIFY_PRESENTATION_VARS).sort(),
  );
});

test('every symbol this estate mints a code from has a glyph', () => {
  // `SD-M11-01`: the token "appears in the image". `mintCertificateCode` draws
  // from Crockford base32, so a code this estate can mint must be a code this
  // card can draw, and the replacement box must never be the answer for one.
  for (const symbol of CERTIFICATE_CODE_ALPHABET)
    expect(CARD_CHARSET, `the code alphabet carries \`${symbol}\``).toContain(symbol);
});

// -----------------------------------------------------------------------------
// 8. The palette is cited, and the colour that is absent is the decision
// -----------------------------------------------------------------------------

test('the four colours are the DESIGN_SYSTEM tokens, read out of that document', () => {
  const design = readFileSync(DESIGN_SYSTEM, 'utf8');
  const tokenValue = (token: string): string | undefined => {
    const row = design.split('\n').find((line) => line.startsWith(`| \`${token}\` |`));
    return /`(#[0-9A-Fa-f]{6})`/.exec(row ?? '')?.[1];
  };

  expect(CARD_PALETTE.paper).toBe(tokenValue('ink-050'));
  expect(CARD_PALETTE.ink).toBe(tokenValue('ink-900'));
  expect(CARD_PALETTE.rule).toBe(tokenValue('ink-200'));
  expect(CARD_PALETTE.brass).toBe(tokenValue('brass-400'));

  // THE NEGATIVE COLOUR IS NOT ON THIS CARD AND ITS ABSENCE IS THE RULING.
  // DESIGN_SYSTEM section 1.2 expresses attention "with weight, a hairline
  // rule, and position, never with a third hue", and `AS-M11-05` is the harder
  // reason: an `account_enforced` revocation means the claim STANDS, so
  // painting it in the breach colour is the retroactive denial that scenario is
  // written to refuse.
  const oxide = tokenValue('oxide-500');
  expect(oxide, 'DESIGN_SYSTEM no longer rows `oxide-500`').toBeDefined();
  expect(Object.values(CARD_PALETTE)).not.toContain(oxide);
});

// -----------------------------------------------------------------------------
// 9. The renderer is behind the port and is not the route
// -----------------------------------------------------------------------------

test('the renderer imports nothing from `routes/`, and the route imports no renderer', () => {
  // ADR-249 CLAUSE 1: the renderer sits BEHIND `CertificateImageSource.lookup`
  // and that is a PORT rather than a process. A route that imported the
  // renderer would have decided the deployment shape the ruling left open, and
  // it would turn `assertPng` from a validator at the boundary into a producer
  // checking its own work.
  //
  // THE CLAIM IS ABOUT IMPORTS AND NOT ABOUT MENTIONS, and the distinction is
  // load bearing rather than pedantic: `routes/certificates.ts`' header NAMES
  // this module, because ADR-256 repaired the sentence that said the renderer
  // was not in this repository, and a sweep for the file name would read that
  // repair as the coupling it is asserting the absence of.
  const importsOf = (path: string): readonly string[] =>
    [...readFileSync(path, 'utf8').matchAll(/^import[\s\S]*?from '(.*)';$/gm)].map(
      (match) => match[1] ?? '',
    );

  expect(importsOf(RENDERER).filter((one) => one.includes('routes/'))).toStrictEqual([]);
  expect(
    importsOf(join(REPO, 'apps', 'api', 'src', 'routes', 'certificates.ts')).filter((one) =>
      one.includes('certificate-card'),
    ),
  ).toStrictEqual([]);
});
