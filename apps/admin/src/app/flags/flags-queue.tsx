// =============================================================================
// apps/admin/src/app/flags/flags-queue.tsx
// =============================================================================
// M06 SECTION 3.3's QUEUE AS A DOCUMENT, RENDERED IN THE ORDER THE SERVER SENT
// AND NEVER IN AN ORDER THIS FILE DECIDES.
//
// -----------------------------------------------------------------------------
// 1. THE ORDER IS ADR-178's AND IT IS INHERITED, NOT RECOMPUTED
// -----------------------------------------------------------------------------
// API_CONTRACT section 8 sorts `GET /admin/flags` by corroboration depth, then
// severity, then age, and states the directions this file renders under: most
// corroborated first, then most severe first, then oldest first.
// `assertFlagOrder` in `apps/api/src/routes/admin-reads.ts` is where that order
// is ENFORCED, over the rows the adapter produced, one refusal per key.
//
// SO THIS DOCUMENT SORTS NOTHING, AND THE ABSENCE IS CHECKED RATHER THAN
// PROMISED. `test/flags-render.test.ts` reads this module's own source with
// comments stripped and refuses a `.sort(`, which is `M6-A-39`'s shape one
// screen over, where the same suite refuses `assessDataTrust` in the liability
// home's document for the same reason: a console that recomputes is a second
// opinion where the corpus requires one.
//
// A SECOND COMPARISON HERE WOULD ALSO BE A SECOND COPY OF A RULE THIS PACKAGE
// MAY NOT IMPORT. `RI-04` refuses `apps/admin` depending on `apps/api`, so a
// console-side order check could only be a hand-written second implementation
// of `assertFlagOrder`, in a package with no fixtures for it, drifting from the
// original on the first amendment to either. WAVE-06 section 9's row for this
// slice states the rule as "the ordering is ADR-178's and is NOT recomputed in
// the console", and this is that sentence with nothing added to it.
//
// -----------------------------------------------------------------------------
// 2. THE DEPTH IS BESIDE THE SEVERITY, IN THE TEXT, AND THAT IS THE SCREEN
// -----------------------------------------------------------------------------
// The contract's own reason for putting `corroboration_depth` on the wire is
// that "an operator shown a severity 3 above a severity 5 has nothing on the
// row that says why". A queue that carried the depth in a `data-` attribute
// and not in the words would leave that operator exactly where they started:
// `FM-M6-01` is the failure mode, "a screenshot of a styled page pasted into a
// message loses the style and keeps the number", and `feed.ts`'s header states
// the same rule for a redaction. So the depth is a word on the row and the
// attribute is for a test and a stylesheet.
//
// AND THE PAGE STATES THE ORDER IT IS IN. An operator who has not read ADR-178
// reads a queue whose second row is more severe than its first and concludes
// the queue is broken. The ordering sentence is served above the rows, which is
// where the liability home puts `P-M6-09`'s banner and for the same reason.
//
// -----------------------------------------------------------------------------
// 3. NO SUBJECT IDENTIFIER IS SERVED, AND THE QUEUE NAMES NO SUBJECT
// -----------------------------------------------------------------------------
// `INV-M6-10`: the console renders trader-identifying data ONLY when the query
// names a specific subject. A queue is the surface that names none, and M06
// section 5 says what a flag-queue surface may carry in its place: "counts and
// links, never trader-identifying rows".
//
// `FlagListItem` carries `identity_id` and `account_id` and this document
// renders NEITHER. What it renders instead of `account_id` is the one fact that
// field decides and that an operator triaging actually needs: whether the flag
// is scoped to one account or to the whole human. That is a SCOPE and not an
// identifier, and it survives INV-M6-10 intact.
//
// `flag_id` IS NOT RENDERED EITHER, AND THAT IS A DECISION RATHER THAN AN
// OVERSIGHT. `assertNamesNoSubject` (`../../page.ts`) refuses any uuid in the
// served strings, and its own message says where an id belongs: "The id belongs
// on the link, not in the figure." THIS SCREEN HAS NO LINK YET. Both
// destinations a flag row would open are unbuilt, the identity drill-down being
// `W6-g`'s and the account drill-down `W6-j`'s, and putting a uuid into an
// `href` on a queue requires an exemption inside the one control WAVE-06 rule 4
// exists to make load bearing. A slice that widened that control for a link to
// a route that does not exist would have paid the whole cost and bought nothing.
// So the queue is READ ONLY IN THE STRICT SENSE for now: every row is
// identified by its position, its type, its detector and its date, the sweep
// stays total, and the link arrives with the first destination that exists.
//
// -----------------------------------------------------------------------------
// 4. THE SWEEP IS THE ONE `../liability-home.tsx` ALREADY SHIPS
// -----------------------------------------------------------------------------
// WAVE-06 rule 4: "AN ASSERTION THAT CANNOT REACH THE SERVED BYTES IS NOT AN
// ASSERTION." `W6-d` built the walk for exactly that and exported
// `collectServedStrings` so its refusal would be testable; it takes a NODE
// rather than a `LiabilityHomePage`, so it is the reusable half of that slice
// and `servedLiabilityHomeStrings` is the half bound to one page type.
//
// THIS FILE IMPORTS THE WALK AND WRITES ITS OWN ENTRY POINT, WHICH IS THE
// DIVISION SESSION 340's LOG NAMED FOR THIS SLICE. A second copy of the walk
// would be a second place to teach about a node kind, and the day one of them
// learned an element shape the other had not would be the day a screen silently
// stopped being covered. The walk THROWS on a node it cannot resolve rather
// than skipping it, and that property is inherited here with the walk.
//
// -----------------------------------------------------------------------------
// 5. NO READ, NO ORIGIN, NO WRITE
// -----------------------------------------------------------------------------
// This module is a pure function of a value. `./page.tsx` is where the read
// would go and it performs none today; `../../http/client.ts` is the one file
// in this package that may perform one at all. No `POST /admin/flags/:flagId/
// status` affordance exists here and none may: that is a write, `INV-M6-01`
// makes every write an audited action and WAVE-06 wave 5 holds all of them
// behind ADR-171's admin identity provider.

import type { ReactElement } from 'react';

import type { FlagListItem } from '../../api/types.ts';
import { PageError, assertNamesNoSubject } from '../../page.ts';
import { collectServedStrings } from '../liability-home.tsx';

/**
 * What the flags queue renders, and it is the response plus the instant.
 *
 * `rows` IS THE RESPONSE'S ORDER AND CARRIES NO SECOND ORDERING FIELD, which
 * is section 1 of this header expressed as a type: there is no `sortKey`, no
 * `comparator` and no `ranked` flag for a caller to set, so a screen that
 * wanted a different order would have to be a different screen.
 *
 * `renderedAt` IS SUPPLIED RATHER THAN READ FROM A CLOCK, which is `page.ts`'s
 * refusal of an ambient one inherited by having nothing else to read.
 */
export type FlagQueuePage = {
  readonly renderedAt: string;
  readonly rows: readonly FlagListItem[];
};

/**
 * The order the rows are in, as a sentence an operator reads before the rows.
 *
 * IT IS A CONSTANT AND NOT A DERIVATION. Computing this from the rows would be
 * the console describing the order it observed, which is a claim about the data;
 * this is a statement of the order the contract promises, which is a claim about
 * the endpoint. When they disagree the operator sees the depths on the rows and
 * can tell, which is the whole reason `corroboration_depth` is on the wire.
 */
export const QUEUE_ORDER =
  'Ordered by the server, ADR-178: most corroborated first, then most severe first, then ' +
  'oldest first. Corroboration depth is the number of INDEPENDENT detector families ' +
  'implicated on one identity, never a count of flags, so one loud detector cannot lift a ' +
  'case above three that agree. A lower severity above a higher one is that first key doing ' +
  'its work and the depth on each row is the reason.';

/** Whether a flag is scoped to one account or to every account the human holds. */
export function flagScope(row: FlagListItem): string {
  return row.account_id === null ? 'the whole identity' : 'one account';
}

/**
 * One row, in the order it arrived, with its depth in the words.
 *
 * `position` IS 1-BASED AND IS THE ROW'S ONLY IDENTIFIER ON THIS SCREEN, per
 * section 3 of this header. It is passed rather than computed inside so that
 * nothing here indexes into the array a second time.
 */
function FlagRow({
  row,
  position,
}: {
  readonly row: FlagListItem;
  readonly position: number;
}): ReactElement {
  return (
    <li
      data-position={String(position)}
      data-corroboration-depth={String(row.corroboration_depth)}
      data-severity={String(row.severity)}
      data-status={row.status}
    >
      {`${String(position)}. Corroboration depth ${String(row.corroboration_depth)} across ` +
        `independent detector families, severity ${String(row.severity)} of 5, ${row.status}, ` +
        `first detected on ${row.first_detected_on}. ${row.flag_type}, raised by ` +
        `${row.detector}, scoped to ${flagScope(row)}. ${row.evidence_summary}`}
    </li>
  );
}

/**
 * The whole document for one `FlagQueuePage`.
 *
 * AN EMPTY QUEUE IS A SENTENCE AND NOT AN EMPTY LIST. A screen that renders
 * nothing when there is nothing is indistinguishable from a screen whose read
 * failed, and this console's whole subject is that the two are different
 * states with different sentences.
 */
export function FlagQueueDocument({ page }: { readonly page: FlagQueuePage }): ReactElement {
  return (
    <article data-testid="flags-queue" data-rows={String(page.rows.length)}>
      <h1>Flags queue</h1>

      <p data-testid="queue-order">{QUEUE_ORDER}</p>

      <p data-testid="render-stamp">
        {`Rendered at ${page.renderedAt}. ${String(page.rows.length)} flags on this page, in the ` +
          'order the operator API returned them.'}
      </p>

      {page.rows.length === 0 ? (
        <p data-testid="empty-queue">
          No flags were returned for this query. That is an empty queue and not a failed read: a
          read that did not answer is reported as what it answered instead.
        </p>
      ) : (
        <ol data-testid="flag-rows">
          {page.rows.map((row, index) => (
            <FlagRow key={row.flag_id} row={row} position={index + 1} />
          ))}
        </ol>
      )}
    </article>
  );
}

/**
 * Every string this document serves: each text node and each attribute value.
 *
 * `key` IS NOT AMONG THEM AND THAT IS REACT'S RULE RATHER THAN A GAP. A `key`
 * is lifted off the props onto the element and is never serialised, so the
 * `flag_id` this document uses as one is not a served string. It is used there
 * precisely because it is the response's own stable identifier for a row and it
 * reaches no byte a browser receives, which `test/flags-render.test.ts` asserts
 * over the real markup rather than trusting.
 */
export function servedFlagQueueStrings(page: FlagQueuePage): readonly string[] {
  const served: string[] = [];
  collectServedStrings(<FlagQueueDocument page={page} />, served);
  return served;
}

/**
 * The identifiers this document declines to render, asserted absent from what
 * it served.
 *
 * IT IS A VALUE CHECK AND NOT A SECOND DEFINITION OF INV-M6-10, which is the
 * distinction that earns it a place beside `assertNamesNoSubject` rather than
 * instead of it. `assertNamesNoSubject` answers "does this string name SOME
 * subject", by pattern, and covers an id that is in no field of this response.
 * This answers "did this document serve one of the THREE identifiers it
 * promised not to", by value, and covers one however it is spelled. Neither
 * subsumes the other and the two fail at different times, which is the shape
 * `apps/api/src/admin-source/index.ts` argues for its own pair of defences.
 *
 * **AND THE SECOND LEG IS LOAD BEARING RATHER THAN BELT AND BRACES, MEASURED
 * RATHER THAN ASSUMED.** `assertNamesNoSubject`'s pattern is a `\b`-anchored
 * uuid, so a uuid GLUED TO A WORD CHARACTER is not a match: an
 * `evidence_summary` reading `linked_to_<identity_id>` passes it and an
 * `evidence_summary` reading `linked to <identity_id>` does not. Both were run.
 * That is `../../page.ts`'s regex, which is `P5-l`'s file and outside this
 * slice's fence, so the gap is REPORTED and this leg is what keeps THIS
 * screen's promise in the meantime. What neither leg catches is a subject id
 * that is in no field of this response AND is glued to a word character, and
 * that residue is the reported gap exactly.
 */
function assertRowIdentifiersAreWithheld(page: FlagQueuePage, served: readonly string[]): void {
  for (const row of page.rows) {
    const identifiers: readonly (readonly [string, string | null])[] = [
      ['flag_id', row.flag_id],
      ['identity_id', row.identity_id],
      ['account_id', row.account_id],
    ];

    // AN EMPTY OR ABSENT VALUE IS SKIPPED RATHER THAN SEARCHED FOR. `''` is a
    // substring of every string, so a response carrying one would make this
    // control refuse every page it was ever handed, which is a control nobody
    // keeps. `account_id` is `string | null` on the contract and null is the
    // identity-wide flag rather than a missing value.
    for (const [field, value] of identifiers)
      if (value !== null && value !== '' && served.some((string) => string.includes(value)))
        throw new PageError(
          `the flags queue served the \`${field}\` of a flag it renders. INV-M6-10: the console ` +
            'renders trader-identifying data only when the query names a specific subject, and a ' +
            'queue names none. The id belongs on the link, not in the figure, and this screen ' +
            'has no link',
        );
  }
}

/**
 * `INV-M6-10` over what the browser receives, on a screen that names no subject.
 *
 * TWO LEGS, AND THE FIRST IS THE PACKAGE'S OWN ASSERTION RATHER THAN A COPY OF
 * IT. `assertNamesNoSubject` refuses a trader-identifying token in a rendered
 * string and throws `PageError`; a private variant of THAT here would be a
 * second answer to what INV-M6-10 means, in the package whose subject is that a
 * figure carries one definition.
 *
 * THE FIRST LEG IS STRICTLY WIDER THAN THE THREE FIELDS THIS DOCUMENT DECLINES
 * TO RENDER, AND THE WIDTH IS THE POINT. `evidence_summary`, `detector` and
 * `flag_type` are SERVER-SUPPLIED FREE TEXT, so a detector that writes an
 * identity id into its own summary reaches this screen through a field nobody
 * classified as an identifier. That is the same shape as the seed `W6-d` caught
 * arriving through `movement.feed`, one screen over, and it is caught here by
 * the same control.
 */
export function assertServedFlagQueueStrings(page: FlagQueuePage): readonly string[] {
  const served = servedFlagQueueStrings(page);
  assertNamesNoSubject(served);
  assertRowIdentifiersAreWithheld(page, served);
  return served;
}

/**
 * The document, with what it serves asserted before it is served.
 *
 * THE ROUTE CALLS THIS AND NEVER `FlagQueueDocument` DIRECTLY, so the control is
 * on the path rather than in the suite.
 */
export function renderFlagQueueDocument(page: FlagQueuePage): ReactElement {
  assertServedFlagQueueStrings(page);
  return <FlagQueueDocument page={page} />;
}
