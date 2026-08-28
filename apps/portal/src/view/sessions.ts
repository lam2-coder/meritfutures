// =============================================================================
// apps/portal/src/view/sessions.ts
// =============================================================================
// SC-M4-11's VIEW MODEL. M04 section 3.7, and section 3.1's row: "Every active
// session with the factor that established it, revocation, the verified phone,
// and the phone-change ceremony's state while it runs."
//
// TWO OF THOSE FOUR HAVE A WIRED ENDPOINT TODAY AND TWO DO NOT, MEASURED RATHER
// THAN ASSUMED, AND THE SPLIT IS THE SHAPE OF THIS FILE. See ../../app/security/
// source.ts, which carries the measurement and names the two.
//
// -----------------------------------------------------------------------------
// THERE IS NO PASSWORD ROW ON THIS SCREEN AND THERE IS NO RESET LINK
// -----------------------------------------------------------------------------
// MERIT IS PASSWORDLESS AND IT IS PASSWORDLESS IN THE SCHEMA, not merely in the
// UI. `0002:280` records that there is no password table anywhere in this schema
// by design, ADR-039 is the ruling, and `M04:80`'s SC-M4-01 row states the
// consequence: "No password field exists anywhere. There is no password database
// to stuff (D2)."
//
// A SECURITY SCREEN IS EXACTLY WHERE A PASSWORD ROW WOULD BE ADDED WITHOUT
// THOUGHT, because every other product's security screen has one. So the
// absence is asserted rather than left to a reader noticing:
// `test/security.test.ts` fails on the words a password control would have to
// carry. What this screen offers instead is the thing that actually defends a
// passwordless account, which is revocation.
//
// -----------------------------------------------------------------------------
// THE FACTOR IS ON EVERY ROW BECAUSE THAT IS WHAT MAKES THE SCREEN WORK AT ALL
// -----------------------------------------------------------------------------
// API_CONTRACT section 3.1 states it with the endpoint: the establishing factor
// "is what makes a SIM-swapped session visible to the person it was taken from".
// `M04:185` closes the loop from the threat end: what a SIM-swapped session
// still sees is EVERYTHING -- "balance, withdrawable, floor distance, and
// history" -- because read access is the priced cost of any-single-factor login,
// "and the trader's own defence is SC-M4-11's session list, which is why
// revocation is on the same screen as the factor that established the session".
//
// SO THE FACTOR AND THE REVOKE CONTROL ARE ON THE SAME ROW IN THIS TYPE. They
// are not two sections that happen to be on one page: a trader recognises a
// session by its factor and its device and disowns it in the same movement, and
// splitting them is how that movement acquires a step.
//
// -----------------------------------------------------------------------------
// AND THE FACTOR TOKEN IS THE SERVER'S, RENDERED AND NOT INTERPRETED
// -----------------------------------------------------------------------------
// `auth_factor` is a closed three-member union the database CHECKs. This file
// carries the token through and pairs it with a label derived MECHANICALLY from
// the token itself, which is `app/payouts/view.ts`'s `humanise` argument: "The
// label set is therefore the contract's own key set, and changing a label means
// changing a contract key, which is a diff on API_CONTRACT rather than a wording
// decision taken in a component."
//
// NO SENTENCE HERE RANKS THE THREE FACTORS. `M04:263`'s obligation against
// `POST /auth/otp` is that "the portal offers email and SMS as peers rather than
// as a fallback, because C-01 makes any single factor sufficient and a UI that
// calls one of them 'fallback' is describing a hierarchy the server does not
// have". A session list that labelled one row "weak" would describe that same
// hierarchy on the screen where it matters most, so it does not.

import type { AuthFactor, SessionRow } from '../api/types.ts';

// -----------------------------------------------------------------------------
// 1. The label, derived rather than authored
// -----------------------------------------------------------------------------

/**
 * Words that are acronyms, cased as acronyms.
 *
 * THIS CHANGES CASE AND NEVER WORDS. `otp` becomes `OTP` and `sms` becomes
 * `SMS`; nothing here maps a token to a different token, so the label set stays
 * the contract's own vocabulary spelled for a reader.
 */
const ACRONYMS: Readonly<Record<string, string>> = { otp: 'OTP', sms: 'SMS' };

/**
 * `email_otp` becomes "Email OTP", `passkey` becomes "Passkey".
 *
 * MECHANICAL, AND THAT IS THE POINT. A hand-written map from three tokens to
 * three phrases is three sentences authored in the portal, and the fourth token
 * would render as nothing. This transform has no fourth case to forget.
 */
export function factorLabel(factor: AuthFactor): string {
  return factor
    .split('_')
    .map((word, index) => {
      const acronym = ACRONYMS[word];
      if (acronym !== undefined) return acronym;
      return index === 0 ? `${word[0]!.toUpperCase()}${word.slice(1)}` : word;
    })
    .join(' ');
}

// -----------------------------------------------------------------------------
// 2. One session
// -----------------------------------------------------------------------------

/** One row of the active-session list, with everything a trader recognises it by. */
export type ActiveSessionView = {
  readonly id: string;

  /** The server's token, carried through for a guard or a style to key on. */
  readonly factor: AuthFactor;

  /** {@link factorLabel} of the same token, and never a second vocabulary. */
  readonly factor_label: string;

  /**
   * Whether THIS session has been stepped up. `SD-M4-04`'s pair, resolved by the
   * server into the boolean the portal was given.
   *
   * SECTION 3.7: "The portal shows that an action is currently available and
   * does not show WHEN IT STOPS BEING AVAILABLE, because a visible countdown is
   * a prompt to hurry and hurrying is the attacker's ally on exactly these three
   * actions." There is therefore no expiry, no remaining time and no clock on
   * this type, and `SD-M4-04` records that the schema has no
   * `elevation_expires_at` either: "the window is a launch parameter the config
   * owns, evaluated against `elevated_at` at the moment of the action".
   */
  readonly elevated: boolean;

  readonly created_at: string;

  /**
   * The server's `last_seen_at`, carried and not interpreted.
   *
   * IT EQUALS `created_at` ON EVERY ROW IN THIS TREE TODAY AND THE PORTAL CANNOT
   * TELL. `apps/api/src/auth-backend.ts`'s `listSessions` falls back to
   * `created_at` and says why in its own comment: "NOTHING STAMPS `last_seen_at`
   * IN THIS TREE", because stamping it would be "an UPDATE on every
   * authenticated request, inside its own transaction, on the hottest path this
   * deployable has". That is a write-amplification ruling, it is owed, ADR-120
   * reports it, and it matters here rather than there: `AS-M4-05` counter 2
   * names last-seen time as one of the three things a trader recognises a
   * session by, and a last-seen that is always the creation time is the one of
   * the three that quietly carries no information. Reported and not repaired --
   * `auth-backend.ts` is another session's ground.
   */
  readonly last_seen_at: string;

  /** Coarse, and coarse at the server. The portal never sees the raw string. */
  readonly user_agent_family: string;

  /** The session reading this screen. Never offered for revocation; see below. */
  readonly is_current: boolean;

  /**
   * THE ROUTE THE REVOKE CONTROL SUBMITS TO, WHICH THIS APPLICATION CANNOT CALL,
   * TYPED AS THE LITERAL `null` SO THAT WIRING IT IS A TYPE CHANGE A REVIEWER
   * READS.
   *
   * `POST /sessions/:id/revoke` IS REGISTERED AND ITS BACKEND IS WIRED. This is
   * not a missing endpoint: it was measured through `CompositionReport.
   * registered` over a real `compose()`, and `databaseAuthBackend.revokeSession`
   * is a real implementation. WHAT IS MISSING IS ON THIS SIDE. ../http/client.ts
   * declares an `ApiClient` with `get` and nothing else, `test/surface.test.ts`
   * fails on a second file in this application growing a `fetch(`, and ADR-083
   * section 3 with ADR-095 ruling 3 forbid a route handler or a Server Action
   * here. So this application has no write path of any kind, and the payout
   * centre's `RequestControlView.submits_to` records the same `null` for the
   * same reason one screen over.
   *
   * THE CONTROL IS RENDERED INERT AND THE SCREEN SAYS SO, which is that file's
   * rule: "An enabled control that silently does nothing is a promise to a
   * trader that the code cannot keep." On this screen the promise would be the
   * worst one in the product -- a trader who believes they have just thrown an
   * attacker out and has not.
   */
  readonly revokes_at: null;
};

/**
 * Whether this row may be offered for revocation at all.
 *
 * THE CURRENT SESSION IS NOT OFFERED, AND IT IS A CORRECTNESS RULE RATHER THAN A
 * COURTESY. `POST /sessions/:id/revoke` accepts the caller's own id and the
 * server would carry it out, so a trader who taps it signs themselves out while
 * looking at the screen they opened to sign somebody ELSE out. That reads as the
 * revocation having failed, on the one screen where a trader must be able to
 * tell whether it worked. `logout` is the control for leaving, it is a different
 * action with a different name, and it is not this screen's.
 */
export function isRevocable(row: ActiveSessionView): boolean {
  return !row.is_current;
}

function toActiveSession(row: SessionRow): ActiveSessionView {
  return {
    id: row.id,
    factor: row.auth_factor,
    factor_label: factorLabel(row.auth_factor),
    elevated: row.elevated,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
    user_agent_family: row.user_agent_family,
    is_current: row.is_current,
    revokes_at: null,
  };
}

// -----------------------------------------------------------------------------
// 3. The screen
// -----------------------------------------------------------------------------

/**
 * A part of SC-M4-11 that section 3.1 requires and no wired endpoint serves.
 *
 * NAMED RATHER THAN OMITTED, on `app/payouts/source.ts`'s precedent: that
 * segment reports "which of them it actually failed to get, rather than assuming
 * both". A screen that simply left out the phone section would be indistinguish-
 * able from a screen that had decided the trader has no phone.
 */
export type SecurityGap = {
  /** `METHOD /path`, as API_CONTRACT spells it. */
  readonly endpoint: string;

  /** What the screen would show if it answered. One clause, no rule text. */
  readonly shows: string;
};

/** SC-M4-11, whole. */
export type SecurityView = {
  /**
   * Every LIVE session, newest first, which is the order the server sorts and
   * this file does not re-sort.
   *
   * REVOKED AND EXPIRED ROWS ARE NOT HERE AND THE FILTER IS THE SERVER'S.
   * `listSessions` states the reason: "the list exists so a person can revoke a
   * session they do not recognise, and a revoked one is not revocable."
   */
  readonly sessions: readonly ActiveSessionView[];

  /**
   * The requirements of section 3.1's row that no wired endpoint can satisfy.
   *
   * EMPTY IS THE GOAL AND IS NOT THIS BUILD'S STATE. See ../../app/security/
   * source.ts for the measurement and for each endpoint's own blocker.
   */
  readonly gaps: readonly SecurityGap[];
};

/**
 * Build the security screen.
 *
 * @param sessions `GET /sessions`, already narrowed by the caller.
 * @param gaps     the parts of this screen no wired endpoint serves, measured by
 *                 the caller rather than assumed here.
 */
export function toSecurityView(input: {
  readonly sessions: readonly SessionRow[];
  readonly gaps: readonly SecurityGap[];
}): SecurityView {
  return {
    sessions: input.sessions.map(toActiveSession),
    gaps: input.gaps,
  };
}
