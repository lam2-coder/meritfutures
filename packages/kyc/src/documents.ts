// =============================================================================
// packages/kyc/src/documents.ts
// =============================================================================
// INV-M19-07 AT RUN TIME, BECAUSE THE TYPE CANNOT REACH INSIDE A JSONB BLOB.
//
//   "No document, image, biometric template, or document number is stored,
//    logged, cached, or transmitted through Merit's systems." (INV-M19-07,
//    Appendix D2, SECURITY C-13)
//
//   "Merit stores STATUS AND REFERENCES ONLY. Documents, images and biometric
//    templates never touch Merit storage (VG-10). Every jsonb column below
//    holds provider decision metadata and never document data."
//    (`0003_kyc.sql`, its own header)
//
// THE PORT MAKES THE STRUCTURAL HALF TRUE AND THIS FILE MAKES THE OTHER HALF
// CHECKABLE. `KycProvider` has no method that returns a document and no field a
// document could be assigned to, so Merit cannot ASK for one. What it cannot
// prevent is a provider POSTING one into a webhook envelope, where it would
// arrive inside `payload` and be written to `raw_result jsonb` by a receiver
// that stored what it was sent. `raw_result` is `NOT NULL DEFAULT '{}'` and
// nothing in the DDL can tell an image from a score.
//
// -----------------------------------------------------------------------------
// WHAT THIS SCREEN IS, AND THE TWO THINGS IT IS NOT
// -----------------------------------------------------------------------------
// It is a REFUSAL rather than a redaction. A payload carrying a document is a
// provider misconfiguration and the honest response is to refuse the event and
// say so, because redacting it silently would leave Merit's operators believing
// their provider is configured the way the privacy policy says it is.
//
// IT IS NOT A PROOF OF ABSENCE. It screens the shapes INV-M19-07 names, by
// key name, by declared word pair, and by data-URI value, over the whole document including nested
// objects and arrays. A provider that sent an image under the key `notes` and
// no data-URI prefix would pass it. That is stated here rather than implied,
// because a control whose limits are not written down gets cited as though it
// had none.
//
// IT IS NOT A RETENTION POLICY. `kyc_verifications` is "Retention: forever (AML
// obligation)" by its own table comment, which is exactly why nothing that
// should not be kept forever may enter it.
// =============================================================================

import type { JsonObject, JsonValue } from './port.ts';

/**
 * Key words that carry CONTENT on their own, whatever else the key says.
 *
 * MATCHED AS WHOLE WORDS AFTER SPLITTING A KEY ON CASE AND PUNCTUATION, so
 * `documentImage`, `document_image` and `DOCUMENT-IMAGE` are one thing and
 * `imagined_at` is not any of them. A substring match would have refused
 * `scanned_at` for containing `scan`, and a control that fires on innocent keys
 * is a control an operator turns off.
 *
 * THE LIST IS SHORT ON PURPOSE AND `face` IS NOT ON IT. `face_match_score` is
 * exactly the decision metadata the corpus requires Merit to KEEP:
 * `dedupe_matches.evidence_snapshot` holds "the provider's decision metadata:
 * scores, method, timestamps. NEVER images", and INV-M19-12 makes that snapshot
 * the evidence an enforcement survives on. A screen that refused scores would
 * refuse the one payload M19 is built to record.
 */
export const DOCUMENT_CARRIER_WORDS: readonly string[] = [
  'image',
  'images',
  'photo',
  'photos',
  'picture',
  'pictures',
  'selfie',
  'selfies',
  'thumbnail',
  'thumbnails',
  'base64',
  'blob',
  'binary',
  'mrz',
  'faceprint',
  'faceprints',
  'embedding',
  'embeddings',
  'descriptor',
  'descriptors',
];

/**
 * Word PAIRS that carry content only together, both words in the same key.
 *
 * THIS HALF EXISTS BECAUSE THE SINGLE-WORD VERSION REFUSES LEGITIMATE
 * METADATA. `document_type: "passport"` is a provider reporting WHICH KIND of
 * identification was used, which is a decision fact Merit may hold; `document`
 * as a carrier word would refuse it. `attempt_number` is a funnel field
 * (`kyc_funnel_events.attempt_number`); `number` as a carrier word would refuse
 * that. So the words that are ambiguous alone are declared in the combinations
 * that are not, and INV-M19-07's "document number" is one pair rather than two
 * tokens.
 */
export const DOCUMENT_CARRIER_PAIRS: readonly (readonly [string, string])[] = [
  ['document', 'number'],
  ['document', 'front'],
  ['document', 'back'],
  ['document', 'scan'],
  ['document', 'data'],
  ['id', 'number'],
  ['identity', 'number'],
  ['licence', 'number'],
  ['license', 'number'],
  ['card', 'number'],
  ['passport', 'number'],
  ['biometric', 'template'],
  ['face', 'template'],
  ['data', 'uri'],
  ['data', 'url'],
];

/**
 * Split a key into lowercase words, across every spelling a vendor might use.
 *
 * `providerImageUrl` -> `provider`, `image`, `url`
 * `document_number`  -> `document`, `number`
 * `ID-Photo`         -> `id`, `photo`
 */
export function keyWords(key: string): readonly string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .flatMap((part) => (part === '' ? [] : [part.toLowerCase()]));
}

/** A `data:` URI, which carries its payload inline and is never metadata. */
function isDataUri(value: string): boolean {
  return /^data:[a-z0-9!#$&^_.+-]*\/[a-z0-9!#$&^_.+-]*[;,]/i.test(value.trimStart());
}

/**
 * Whether one key names content, by a carrier word or by a declared pair.
 */
function keyCarriesContent(key: string, carriers: ReadonlySet<string>): boolean {
  const words = new Set(keyWords(key));
  for (const word of words) if (carriers.has(word)) return true;
  for (const [a, b] of DOCUMENT_CARRIER_PAIRS) if (words.has(a) && words.has(b)) return true;
  return false;
}

/**
 * Every path in `payload` that a document could be riding on, in document
 * order. Empty means the screen found nothing.
 *
 * A PATH AND NEVER A VALUE. The whole point of this file is that the offending
 * content must not travel, and a finding that quoted it would carry the
 * document into the log line that reported the document. `apps/api`'s receiver
 * writes these paths and only these paths.
 */
export function documentBearingPaths(payload: JsonObject): readonly string[] {
  const found: string[] = [];
  const carriers = new Set(DOCUMENT_CARRIER_WORDS);

  const walk = (value: JsonValue, path: string): void => {
    if (typeof value === 'string' && isDataUri(value)) {
      found.push(`${path === '' ? '<root>' : path} (data: URI)`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        walk(item, `${path}[${index}]`);
      });
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      const here = path === '' ? key : `${path}.${key}`;
      if (keyCarriesContent(key, carriers)) {
        found.push(here);
        // NOT DESCENDED INTO. The parent is already the finding, and walking a
        // refused subtree would report one image as four paths.
        continue;
      }
      walk(child as JsonValue, here);
    }
  };

  walk(payload, '');
  return found;
}

/**
 * Raised when a verified payload carries something INV-M19-07 forbids.
 *
 * IT IS RAISED AFTER VERIFICATION AND NOT BEFORE, which is deliberate: an
 * unsigned payload is refused by the signature and never reaches here, so
 * everything this refuses is a document a REAL provider genuinely sent, which
 * is a configuration finding an operator has to see.
 */
export class KycDocumentInPayloadError extends Error {
  /** Paths, never values. See {@link documentBearingPaths}. */
  readonly paths: readonly string[];

  constructor(provider: string, paths: readonly string[]) {
    super(
      `the ${provider} KYC webhook carried document-bearing content at ${paths.join(', ')}. ` +
        'INV-M19-07: no document, image, biometric template or document number is stored, ' +
        "logged, cached or transmitted through Merit's systems, and `kyc_verifications` is " +
        'retained forever under an AML obligation. The event is refused rather than redacted, ' +
        'because a provider sending these is misconfigured against the privacy policy.',
    );
    this.name = 'KycDocumentInPayloadError';
    this.paths = paths;
  }
}

/**
 * Refuse a payload that carries a document. Returns nothing on a clean one.
 *
 * @throws {KycDocumentInPayloadError}
 */
export function screenForDocuments(provider: string, payload: JsonObject): void {
  const paths = documentBearingPaths(payload);
  if (paths.length > 0) throw new KycDocumentInPayloadError(provider, paths);
}
