// =============================================================================
// apps/portal/src/app/calendar/states.tsx
// =============================================================================
// THE TWO SCREENS THAT ARE NOT `ready`, AND WHY THEY ARE TWO AND NOT ONE.
//
// ./load.ts's three load unions have three arms. The four screen components in
// this directory render the first. These render the other two, and the whole
// reason they are separate components is that they are separate facts:
//
//   `unavailable`  NOTHING FAILED AND NOTHING WAS REFUSED. This deployment has
//                  not been told where its API is, so `serverApiClient()` threw
//                  `ApiConfigError` before a request was made
//   `error`        A REGISTERED ENDPOINT REFUSED OR FAILED, and the trader is
//                  told so in the vocabulary ../../shell/app-shell.ts owns
//
// COLLAPSING THEM WOULD BE THE DEFECT ADR-162 SECTION 5 ITEM 1 REPORTS ON THE
// PAYOUT CENTRE, which has no error arm and therefore renders a 500 exactly as
// a missing endpoint. That entry says the repair "needs `./sections.ts` to
// render it and `./page.ts` to branch on it, and this session's fence holds
// neither". This segment's fence holds both.
//
// -----------------------------------------------------------------------------
// WHY THIS IS NOT `ScreenFrame`, AND THE `data-content-state` VALUE IS THE POINT
// -----------------------------------------------------------------------------
// ./screen-frame.tsx renders `ContentState`, which is `loading | ready | empty |
// error`. `unavailable` is none of the four and ../../shell/app-shell.ts leaves
// it out on purpose. So these components carry the segment's own wrapper rather
// than being handed to a frame with a content state that would have to be a lie:
// passing `ready` would put `data-content-state="ready"` on a screen holding no
// data, and passing `error` is the collapse the section above refuses.
//
// `data-content-state="unavailable"` IS THEREFORE A VALUE OUTSIDE THE UNION, ON
// PURPOSE. The attribute says what the type system declines to represent, the
// suite asserts on it, and adding a fifth member to `ContentState` is a change
// to a shell file this session's fence does not hold.
//
// -----------------------------------------------------------------------------
// INV-M4-07: THIS FILE WORDS A REFUSAL AND MAY NOT WORD IT AS A REFUSAL OF
// PERMISSION
// -----------------------------------------------------------------------------
//   "Cross-trader resource access returns 404, and the portal renders it as
//   'not found', NOT 'forbidden' ... existence is not confirmed to a stranger,
//   AND THE UI MUST NOT UNDO THAT BY WORDING."
//
// `PortalErrorKind` has no `forbidden` member for that reason, and a copy
// catalogue is exactly where the type's refusal gets reinstated by a sentence.
// So no string below says "not allowed", "no permission", "denied" or
// "forbidden", and `apps/portal/test/calendar-segment.test.ts` asserts the
// absence over the catalogue rather than trusting a reader to notice.
//
// THE STATUS IS NOT ON THE SCREEN AND THAT IS INV-M4-07 AGAIN. A `404` printed
// beside "we could not find that" is the number a stranger would use to tell
// "no such account" from "not yours", which is what the server's 404 exists to
// withhold. `CalendarFailure` carries it so a later observability slice can
// report it; it is not trader-facing copy.
//
// -----------------------------------------------------------------------------
// THE COPY IS THIS SEGMENT'S OWN AND THE DUPLICATION IS REPORTED
// -----------------------------------------------------------------------------
// `app/accounts/states.ts` and `app/kyc/copy.ts` hold catalogues of the same
// shape, written for the same union and for the same INV-M4-07 reason. This
// file does not import either: a segment reaching into another segment's copy
// couples two screens' wording to one edit. `app/accounts/states.ts` already
// reported that a shared catalogue under `src/shell/` is probably right and is
// outside a segment's fence; this is the THIRD instance and the report is
// repeated rather than acted on, because acting on it is that directory's
// session.

import type { ReactNode } from 'react';

import type { PortalErrorKind } from '../../shell/app-shell.ts';
import { SEGMENT_STYLES } from './styles.ts';

/**
 * One sentence per member of the error vocabulary.
 *
 * `Record<PortalErrorKind, string>` IS THE MECHANISM. A member added to
 * ../../shell/app-shell.ts and not worded here is `error TS2741`, so this
 * catalogue cannot fall behind the union it words.
 *
 * `unexpected` DOES NOT APOLOGISE FOR A BUG IT CANNOT NAME. ../../shell/
 * app-shell.ts reserves that member for a `403`, "which is FM-M4-10 firing" and
 * is "a rendering bug until proven otherwise and an authorization bug if it is
 * not". The trader can act on neither, so the sentence says what is true.
 */
export const CALENDAR_ERROR_COPY: Readonly<Record<PortalErrorKind, string>> = {
  not_found: 'We could not find that.',
  unauthenticated: 'Your session has ended. Sign in again to continue.',
  rate_limited: 'That was a lot of requests at once. Try again in a moment.',
  server_error: 'Merit could not load this. The failure is ours and it has been recorded.',
  unexpected: 'Something did not go as expected. Try again shortly.',
};

type FrameProps = {
  readonly title: string;
  readonly state: 'unavailable' | 'error';
  readonly children: ReactNode;
};

/**
 * The segment's wrapper, without a `ContentState`.
 *
 * It is ./screen-frame.tsx's markup minus the branch, because the branch is
 * exactly the thing that cannot express these two states. The `<style>` tag is
 * carried so an unavailable screen is styled like every other screen in the
 * segment rather than like an unstyled failure.
 */
function StateFrame({ title, state, children }: FrameProps) {
  return (
    <div className="merit-screen" data-content-state={state}>
      <style>{SEGMENT_STYLES}</style>
      <h1>{title}</h1>
      {children}
    </div>
  );
}

/**
 * This deployment has not been told where its API is.
 *
 * IT STATES THAT NOTHING FAILED, IN WORDS, because the alternative reading is
 * the one a trader will reach for. A screen that listed endpoint names under a
 * bare heading would be read as a fault report by the only person who cannot
 * tell the difference.
 *
 * THE ENDPOINTS ARE NAMED BECAUSE THE READER WHO CAN ACT ON THIS IS AN
 * OPERATOR. ADR-162 clause 1 makes an unset `MERIT_API_ORIGIN` a per-read
 * refusal rather than a boot failure, "so an unconfigured deployment is
 * discovered by a screen rather than by a process that failed to boot". This is
 * that screen, and a list of what it was going to read is the whole diagnostic.
 */
export function CalendarUnavailable(props: {
  readonly title: string;
  readonly missing: readonly string[];
}) {
  return (
    <StateFrame title={props.title} state="unavailable">
      <p className="merit-unavailable">
        This screen is built and this deployment is not connected to the Merit API. Nothing has
        failed and nothing has been refused.
      </p>
      <ul>
        {props.missing.map((name) => (
          <li className="merit-unavailable__endpoint" key={name}>
            {name}
          </li>
        ))}
      </ul>
    </StateFrame>
  );
}

/** A registered endpoint refused or failed. */
export function CalendarError(props: { readonly title: string; readonly error: PortalErrorKind }) {
  return (
    <StateFrame title={props.title} state="error">
      <p className="merit-empty" data-error-kind={props.error}>
        {CALENDAR_ERROR_COPY[props.error]}
      </p>
    </StateFrame>
  );
}
