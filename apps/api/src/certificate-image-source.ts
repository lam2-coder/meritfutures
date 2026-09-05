// =============================================================================
// apps/api/src/certificate-image-source.ts
// =============================================================================
// THE COMPOSITION ADR-256 NAMED AND DECLINED TO TAKE.
//
// ADR-256 landed `renderCertificateCard` and then drew a distinction that is
// this file's whole reason to exist. ADR-226 and ADR-229 permit a port to be
// wired when its only remaining gap is A THING THE DEPLOYMENT SETS, and ADR-256
// ruling 12 read `useCertificateImageSource`'s remaining gap as an ADAPTER plus
// one unnamed number: "a composition that does not exist is not such a gap", so
// the port was one SLICE from wireable rather than one VARIABLE from wired.
//
// THIS FILE IS THAT SLICE. It composes the three things that already existed
// separately and nothing in this tree put together:
//
//   1. `db.publicLookup`   the fifth door (ADR-231), `certificates` by `code`
//                          for a caller who will never be anybody.
//   2. `db.firm`           the `certificate_verifications` append, reached
//                          through `databaseVerifySource` rather than rewritten.
//   3. `renderCertificateCard`  the bytes (ADR-256).
//
// -----------------------------------------------------------------------------
// IT IS NOT UNDER `routes/` AND THAT IS ADR-256 SECTION 2 HELD RATHER THAN
// RESTATED
// -----------------------------------------------------------------------------
// `routes/certificates.ts` DOES NOT IMPORT THE RENDERER and the suite asserts
// that on the import statements. That is what keeps `assertPng` there a
// VALIDATOR at the boundary instead of a producer checking its own work, and
// putting this composition in that file would have spent it. It is not a
// workspace package either, for ADR-256 section 2's reason unchanged: a package
// is a claim that more than one deployable renders cards.
//
// AND THE RENDERER'S OWN ISOLATION IS UNTOUCHED. `src/certificate-card.ts` still
// imports `node:crypto` and `node:zlib` and nothing from this deployable, which
// the suite asserts as an exact list. THE DEPENDENCY RUNS ONE WAY: this file
// imports the renderer, the renderer imports nothing back, so the day a render
// service exists the renderer MOVES and this file is the only caller rewritten.
//
// -----------------------------------------------------------------------------
// THE TRAP THIS FILE IS ORGANISED AROUND, WHICH IS ADR-246 CLAUSE 8 ONE PORT
// OVER
// -----------------------------------------------------------------------------
// ADR-246 refused a half-wired `useCertificateBackend` because `projectCertificate`
// never calls `links` for a deferred row, so a live read beside a refusing signer
// answers 200 to a trader whose certificates are all deferred and 503 to the
// trader beside them whose certificate issued: A RESPONSE DECIDED BY THE STATE
// OF THE CALLER'S OWN ROWS.
//
// THE IMAGE ROW HAS THE SAME SHAPE AVAILABLE TO IT AND IT IS SHUT HERE. A
// DEFERRED CODE NEVER RENDERS (ADR-168 foreclosure 4, `imageHandler`), so every
// refusal the RENDER makes is a refusal only a code whose row issued can reach.
// `assertCopy` is exactly such a refusal: ADR-256 made it state-independent
// ACROSS THE FIVE SENTENCES, so a broken `fact_untrue` fails an issued card too,
// and that is the half a renderer can shut by itself. THE OTHER HALF IS THIS
// FILE'S: a deployment whose disclosure carries a character the typeface cannot
// draw would answer 404 for a deferred code and 500 for an issued one, which is
// a hit-versus-miss oracle over Merit's book built out of a configuration error.
//
// SO THE CONFIGURATION IS READ AND REFUSED IN FULL BEFORE THE DATABASE IS
// TOUCHED, on every request, for every code alike. That is `routes/verify.ts`'
// `readPresentation` timing control transcribed rather than re-derived: "read
// before the lookup and validated in full". `readCertificateImageConfig` runs
// `assertCopy` itself rather than leaving it to the render, because the render
// is the branch a deferral does not reach.
//
// -----------------------------------------------------------------------------
// ONE WRITER OF `certificate_verifications`, NOT TWO
// -----------------------------------------------------------------------------
// The append arm is `databaseVerifySource(db, env).record` DELEGATED TO rather
// than reimplemented, and the reason is stronger than tidiness. `code_hash` is a
// pseudonym: a second digest written here would make one code hash two ways
// depending on which row observed it, and a detector reading that table for a
// rate across sources would see two callers where there was one. ADR-235
// section 6.3 settled which digest and why, `routes/verify.ts` holds it, and one
// table gets one vocabulary. The suite asserts the two arms write identical
// bytes for one code.
//
// -----------------------------------------------------------------------------
// NO BUCKET, NO HOSTNAME, NO KEY AND NO SECRET (ADR-012)
// -----------------------------------------------------------------------------
// The card carries NO SIGNATURE AT ALL (ADR-249 section 3) and this file holds
// no key, names no origin and reads no address. The ONE variable it names is a
// cache lifetime, and it is named and valued nowhere in this repository.
// =============================================================================

import {
  assertCopy,
  renderCertificateCard,
  type CertificateCardCopy,
  type CertificateCardInput,
} from './certificate-card.ts';
import type { ApiDb } from './db.ts';
import {
  CertificateImageUnconfigured,
  cacheControl,
  type CertificateImageSource,
  type CertificateLookup,
} from './routes/certificates.ts';
import {
  databaseVerifySource,
  environmentVerifyPresentation,
  logResult,
  readPresentation,
  toVerifyRow,
  type VerifyRow,
} from './routes/verify.ts';
import type { Environment } from './surface.ts';

/**
 * `cache_max_age_seconds`, which API_CONTRACT section 6.3 calls "config rather
 * than a number stated here".
 *
 * THE ONE VARIABLE ADR-240 CLAUSE 10 DECLINED TO NAME, AND THE CONDITION IT
 * DECLINED UNDER HAS LIFTED. That clause held that "a variable whose only
 * consumer refuses is a name nothing reads", and the consumer was a composition
 * that did not exist. It exists below, so the name has a reader.
 *
 * IT IS NAMED AND VALUED NOWHERE (ADR-012). A deployment that has not set it
 * answers 503 for every code identically, which is the shape ADR-226 ruled for
 * an absent secret and ADR-240 applied to a threshold.
 */
export const CERTIFICATE_CARD_MAX_AGE_VAR = 'MERIT_CERTIFICATE_CARD_MAX_AGE_SECONDS';

/** Everything the deployment supplies for one render, read as one value. */
export interface CertificateImageConfig {
  /** `INV-M11-07`'s five sentences and `INV-M11-04`'s disclosure. */
  readonly copy: CertificateCardCopy;
  /** `Cache-Control`'s `max-age`, in whole seconds. */
  readonly cacheMaxAgeSeconds: number;
}

/**
 * The configured copy and lifetime, refused TOTALLY and BEFORE the lookup.
 *
 * THREE REFUSALS RUN HERE AND ALL THREE COULD HAVE RUN LATER, WHICH IS THE
 * POINT. Each of them is reachable from the render, and the render is the branch
 * an unknown code and a deferred code never take, so a check left there is a
 * check whose failure is decided by the state of the row the caller named. Run
 * here, one misconfigured deployment answers 503 for every code alike and holds
 * no information about any of them. See this file's header.
 *
 *   1. `readPresentation`, which is `routes/verify.ts`' own reader over the six
 *      copy variables. IT IS NOT A SECOND PARSER: ADR-256 asserts the card's
 *      statement keys and the page's are one set, and one reader is how that
 *      stays true rather than being re-checked.
 *   2. `assertCopy`, the renderer's own refusal of a sentence the typeface
 *      cannot draw or the box cannot hold. It is lifted OUT of the render and
 *      run on every path; the render runs it again, and a check that runs twice
 *      is cheaper than the oracle.
 *   3. `cacheControl`, the ROUTE's bound, called for its refusals and its string
 *      discarded. M11 section 4's "measured in minutes, never in days" is stated
 *      ONCE, in `routes/certificates.ts`, so this file cannot drift from it.
 *
 * THE FLOOR IS REQUIRED THOUGH THE CARD DOES NOT DRAW IT, and the cost is named
 * rather than hidden: a deployment serving the image row must also set
 * `MERIT_VERIFY_FLOOR_MS`. The alternative is a second parser over the same six
 * copy variables, and two parsers of one copy table is the drift ADR-256's
 * key-set assertion exists to refuse. Both rows are served by one deployable
 * from one route table; a deployment holding one without the other is not a
 * shape anything in this estate builds.
 */
export function readCertificateImageConfig(env: Environment): CertificateImageConfig {
  let copy: CertificateCardCopy;
  try {
    const presentation = readPresentation(environmentVerifyPresentation(env));
    copy = { statements: presentation.statements, disclosure: presentation.disclosure };
    assertCopy(copy);
  } catch (err) {
    throw new CertificateImageUnconfigured(
      err instanceof Error ? err.message : String(err),
      'the published copy',
    );
  }

  // AN ABSENT VARIABLE AND A NONSENSE ONE ARRIVE AS THE SAME REFUSAL, which is
  // `environmentVerifyPresentation`'s reason for parsing rather than coercing:
  // `Number('')` is `0` and `Number(undefined)` is `NaN`.
  const raw = env[CERTIFICATE_CARD_MAX_AGE_VAR];
  const cacheMaxAgeSeconds = raw === undefined || raw.trim() === '' ? Number.NaN : Number(raw);
  try {
    cacheControl(cacheMaxAgeSeconds);
  } catch (err) {
    throw new CertificateImageUnconfigured(
      err instanceof Error ? err.message : String(err),
      CERTIFICATE_CARD_MAX_AGE_VAR,
    );
  }

  return { copy, cacheMaxAgeSeconds };
}

/**
 * One `certificates` row as the card draws it.
 *
 * `toVerifyRow` DOES THE NARROWING AND THIS FUNCTION DOES NOT RE-DO IT. That
 * reader already refuses a row whose `revoked_at` and `revocation_class`
 * disagree, which is the biconditional `assertRow` checks from the other side,
 * and it already drops `identity_id`, `id`, `payout_request_id` and
 * `revoked_reason` structurally.
 *
 * `signature` AND `signing_key_id` SURVIVE `toVerifyRow` AND DIE HERE, and they
 * die by having nowhere to go: `CertificateCardInput` has no field for either.
 * That is `CertificateRow`'s discipline and ADR-256's input-key assertion
 * meeting in the one place a value could have leaked between them.
 *
 * A DEFERRED ROW NEVER REACHES THIS FUNCTION. `CARD_STATES` is two members and
 * the caller below branches on `logResult` first, so the deferral is refused by
 * the type rather than by a trailing conditional.
 */
export function toCardInput(row: VerifyRow, copy: CertificateCardCopy): CertificateCardInput {
  return {
    kind: row.kind,
    claims: row.claims,
    claimsSchemaVersion: row.claimsSchemaVersion,
    code: row.code,
    issuedAt: row.issuedAt,
    state: row.revokedAt === null ? 'issued' : 'revoked',
    revocation:
      row.revokedAt === null || row.revocationClass === null
        ? null
        : { class: row.revocationClass, at: row.revokedAt },
    copy,
  };
}

/**
 * The source, composing the two doors with the render.
 *
 * THE READ IS `db.publicLookup` AND NEVER `db.scoped`. ADR-231 section 4
 * refused resolving the identity from the code and opening the scoped door with
 * it, which would put an authority over that trader's payouts, accounts and
 * wallet behind an unauthenticated route in exchange for one column of one row.
 * `databaseVerifySource` holds the same posture on the same table and the suite
 * asserts here that no call carries an identity.
 *
 * THE ORDER IS CONFIGURATION, THEN READ, THEN RENDER, AND THE FIRST TWO MAY NOT
 * SWAP. See this file's header and {@link readCertificateImageConfig}.
 *
 * WHAT IS STILL OWED AND IS NOT BUILT HERE: `FM-M11-05`'s CACHE. This adapter
 * renders on every fetch, which is ADR-249 section 2.2's ruling and its accepted
 * cost; `renderCertificateCard` returns the derived `version` that a cache keyed
 * on `(code, version)` needs, and nothing reads it yet.
 *
 * THIS PARAGRAPH ALSO SAID "THE RATE LIMIT `INV-M11-05` REQUIRES ALSO EXISTS
 * NOWHERE IN THIS TREE", AND THAT HALF IS AMENDED RATHER THAN DELETED. ADR-347
 * built it: `src/certificate-rate-limit.ts`, per IP and per `code` on this row,
 * decided in `imageHandler` BEFORE this adapter is reached, so the render an
 * attacker can drive is now bounded by numbers the deployment sets. ADR-256's
 * founder block remains the right sentence about the cache, which is the part
 * still unbuilt, and `start.ts` carries both at the line that installs this.
 */
export function databaseCertificateImageSource(
  db: ApiDb,
  env: Environment = process.env,
): CertificateImageSource {
  return {
    lookup: async (code): Promise<CertificateLookup | null> => {
      // BEFORE THE DOOR IS OPENED. A configuration refusal raised after the read
      // is a refusal the caller's own row decided.
      const config = readCertificateImageConfig(env);

      const found = await db.publicLookup((px) => px.rowAt('certificates', { code }));
      // `undefined` IS THE ACCESSOR'S "NO ROW" AND `null` IS THE PORT'S, which
      // is `databaseVerifySource`'s translation at the same seam. The handler's
      // `null` is a claim about Merit's book (`INV-M11-02`).
      if (found === undefined || found === null) return null;

      const row = toVerifyRow(found);
      const result = logResult(row);
      // A DEFERRED CLAIM IS ONE MERIT HAS NOT MADE YET, so there is nothing to
      // draw. `imageHandler` throws if a card arrives here anyway, and this is
      // the arm that must not build one.
      if (result === 'deferred') return { result, card: null };
      // `logResult` returns `unknown` only for a null row, which returned above.
      if (result === 'unknown') return null;

      const rendered = renderCertificateCard(toCardInput(row, config.copy));
      return {
        result,
        card: { bytes: rendered.bytes, cache_max_age_seconds: config.cacheMaxAgeSeconds },
      };
    },

    // ONE WRITER OF `certificate_verifications` IN THIS DEPLOYABLE AND THIS IS
    // NOT A SECOND ONE. See this file's header.
    record: databaseVerifySource(db, env).record,
  };
}
