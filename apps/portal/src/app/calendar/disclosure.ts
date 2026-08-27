// =============================================================================
// apps/portal/src/app/calendar/disclosure.ts
// =============================================================================
// ONE SENTENCE, IN ONE PLACE, BECAUSE `ShellView` REQUIRES IT ON EVERY SCREEN.
//
// `toShellView` types `simulated_environment_disclosure` as a required `string`
// and `shell/app-shell.ts` says why: "what this module owns is that there is
// nowhere to render the footer without it." Three routes in this segment each
// build a `ShellView`, so without this constant the sentence would be typed out
// three times and would drift on the first edit, which is the drift ADR-034
// exists to end.
//
// IT IS QUOTED AND NOT AUTHORED, from GLOSSARY's "sim, simulated and B-book"
// entry, which is the same source `src/app/layout.tsx` quotes and for the same
// stated reason: `view/disclosure.ts` mints a `DisclosureBlock` from a
// `content_documents` address, NO CONTRACT ROW SERVES ONE to the portal, and
// minting one here would assert a provenance that does not exist.
//
// IT IS DELIBERATELY NOT IMPORTED FROM THE LAYOUT. That file does not export it,
// and a segment reaching into a sibling route's module for a constant would
// couple two fences together to save a duplicate string. The duplication is
// visible, it is one sentence, and it goes away the day an endpoint serves the
// row (ADR-138 section 6 carries that as owed).

/**
 * GLOSSARY, "sim, simulated and B-book". Superseded by the `content_documents`
 * row the moment a contract row serves one.
 */
export const SIMULATED_ENVIRONMENT_DISCLOSURE =
  'All Merit trading, including the funded phase, occurs in a simulated ' +
  'environment; the firm takes the other side internally rather than routing ' +
  'trader orders to the exchange.';
