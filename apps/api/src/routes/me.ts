// =============================================================================
// apps/api/src/routes/me.ts
// =============================================================================
// API_CONTRACT section 3's `GET /me`, and nothing else.
//
// -----------------------------------------------------------------------------
// WHY IT IS ITS OWN MODULE AND WHY IT IMPORTS `auth.ts`
// -----------------------------------------------------------------------------
// `GET /me` is the trader portal's first call on every page load and it is the
// one endpoint in section 3 that is a READ of the whole person rather than a
// step in a ceremony. It gets its own file for the reason ADR-100 gives for
// making the module list a directory listing: a slice that changes what `/me`
// returns then edits one file no other slice edits.
//
// It imports the vocabulary from `auth.ts` rather than re-declaring it. The
// alternative would be a third source file holding the shared types, and this
// session's fence admits exactly two; a shared file placed under `routes/`
// would be a route module declaring no route, which `defineRoutes` refuses by
// name. So `auth.ts` owns the vocabulary and this file reads it, and the factor
// declaration, the guard and the fail-closed backend are one implementation
// rather than two.
//
// -----------------------------------------------------------------------------
// THE RESPONSE IS BUILT FIELD BY FIELD AND THE BACKEND'S ROW IS NEVER RETURNED
// -----------------------------------------------------------------------------
// API_CONTRACT section 1: *"Responses list fields explicitly (allowlist), never
// `SELECT *` serialized. This is the API3 control: a field that is not in the
// schema below is not in the response, so an added column never leaks by
// default."* `project` below is that allowlist. Returning the port's object
// directly would type-check, satisfy every assertion about the fields that ARE
// in the schema, and ship whatever else the row happened to carry the day a
// column was added. The suite hands the backend a row with extra fields on it
// and asserts they do not appear.
//
// The `restriction` block is FOLD-02 and ADR-041: the state was already in this
// response and said nothing about itself, so a trader reading `restricted`
// learned that something had happened and not what, which surfaces are
// affected, or whether it ends. It is ToS-cited, trader-safe text and NEVER the
// detector, which is `INV-M7-10`.
//
// `session` is FOLD-01, and the boundary is SHOWN rather than hit: the client
// reads what this session may do from one server declaration instead of
// inferring it, which is the same declaration `auth.ts` enforces with.
// =============================================================================

import { defineRoutes } from '../registry.ts';
import {
  type EndpointSpec,
  type Me,
  problemNotFound,
  requiredFactorTable,
  toRoutes,
  withSessionContext,
} from './auth.ts';

/**
 * The allowlist. Every field API_CONTRACT section 3's `Me` declares, named.
 *
 * IT IS A COPY AND THAT IS THE POINT. A spread would be one character shorter
 * and would be the `SELECT *` section 1 forbids.
 */
function project(me: Me): Me {
  return {
    identity_id: me.identity_id,
    user_id: me.user_id,
    email: me.email,
    country_code: me.country_code,
    kyc: {
      state: me.kyc.state,
      placement: me.kyc.placement,
      verified_at: me.kyc.verified_at,
    },
    identity_status: me.identity_status,
    payouts_frozen: me.payouts_frozen,
    frozen_reason: me.frozen_reason,
    restriction:
      me.restriction === null
        ? null
        : {
            reason: me.restriction.reason,
            tos_clause: me.restriction.tos_clause,
            opened_at: me.restriction.opened_at,
            resolves_by: me.restriction.resolves_by,
          },
    accounts_count: me.accounts_count,
    max_accounts: me.max_accounts,
    affiliate: {
      is_affiliate: me.affiliate.is_affiliate,
      code: me.affiliate.code,
    },
    phone: {
      verified: me.phone.verified,
      preview: me.phone.preview,
      verified_at: me.phone.verified_at,
    },
    session: {
      auth_factor: me.session.auth_factor,
      elevated: me.session.elevated,
      elevated_by_factor: me.session.elevated_by_factor,
    },
  };
}

/**
 * Section 3: *"Auth: session"*.
 *
 * A single factor, deliberately. `/me` is what a compromised account's real
 * owner loads to SEE that something is wrong, and `session.elevated` is one of
 * the fields it carries, so requiring elevation to read it would make the
 * declaration unreadable to exactly the session it describes.
 */
export const ME_ENDPOINTS: readonly EndpointSpec[] = [
  {
    method: 'GET',
    path: '/me',
    required: 'session',
    handle: withSessionContext(async ({ request, reply, backend, session }) => {
      const me = await backend.readMe(session);
      if (me === null) return problemNotFound(reply, request.id);
      return project(me);
    }),
  },
];

/** The declaration as data, on `auth.ts`'s shape. */
export const ME_REQUIRED_FACTORS = requiredFactorTable(ME_ENDPOINTS);

export default defineRoutes({
  name: 'me',
  routes: toRoutes(ME_ENDPOINTS),
});
