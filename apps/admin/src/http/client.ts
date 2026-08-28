// =============================================================================
// apps/admin/src/http/client.ts
// =============================================================================
// THE ONE FILE IN `apps/admin` THAT PERFORMS A NETWORK CALL.
//
// `apps/portal/src/http/client.ts` is the precedent and ADR-162 is the record of
// the decision it embodies: the first `fetch` written in a UI package is a
// decision somebody makes on purpose rather than one that appears in a diff.
// `test/surface.test.ts` is what makes that true here rather than intended:
// exactly one call site, in this file, with `XMLHttpRequest`, `WebSocket` and
// `EventSource` permitted in no file at all.
//
// -----------------------------------------------------------------------------
// THE BASE URL IS RELATIVE, AND THAT IS THE WHOLE OF ADR-012 ON THIS SURFACE
// -----------------------------------------------------------------------------
// ADR-182 section 5 clause 2: "THE API BASE URL IS A RELATIVE PATH.
// `/api/v1/admin/...` and never an absolute origin. This is available only
// because `INFRA:53` puts `api-admin` on the same origin under `/api/v1`."
//
// SO THIS FILE TAKES NO ORIGIN, NOT AS A DEFAULT AND NOT AS A PARAMETER, AND
// THAT IS THE DIFFERENCE FROM THE PORTAL RATHER THAN AN OMISSION.
// `apps/portal/src/http/client.ts` resolves `MERIT_API_ORIGIN` and refuses when
// it is unset, because ADR-083 ruling 1 puts the trader API on its own origin
// and a portal that guessed it would guess wrong everywhere but one laptop.
// `INFRA:43` and `INFRA:44` row `admin` and `api-admin` on the SAME origin,
// `ADMIN_ORIGIN`, separated by path, so there is no origin here for an operator
// to configure and none for a build to inline. WAVE-06 section 5.3 states the
// consequence in one line: the console "needs no hostname, no
// `NEXT_PUBLIC_API_ORIGIN`, and no CORS configuration at all".
//
// THE HAZARD THIS FORECLOSES IS A BUILD ARTIFACT, WHICH IS THE ONE ADR-012 DOES
// NOT ALREADY COVER. `../origin.ts` has kept the value out of the tree since it
// was written, by reading `ADMIN_ORIGIN` from the environment with no default.
// What changed with ADR-182 is that this deployable now HAS a build, and a
// framework that inlines an environment value at build time would put a
// resolved `ADMIN_ORIGIN` into a client bundle, which is "any artifact" in
// ADR-012's own words. A relative URL cannot do that, and the two mechanisms by
// which one could arrive anyway -- a written origin, and a `NEXT_PUBLIC_`
// identifier -- are refused by name in `test/surface.test.ts`.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE IS NOT
// -----------------------------------------------------------------------------
// NO ROUTE HANDLER AND NO SERVER ACTION. ADR-095 ruling 3 refuses both for
// `/api/v1`, for any operator path and for any surface API_CONTRACT specifies,
// and `RI-09` and `RI-11` are the two mechanisms. ADR-182 section 3 makes the
// point that matters here: a hand-rolled console would have made both of those
// checks go silent, and the framework ruling is what keeps them reading this
// package at all. This console is a CLIENT of `/api/v1` on its own origin and
// re-serves nothing.
//
// NO DATABASE DOOR. `apps/admin` declares no accessor and is not in
// `DB_ADMITTED` (WAVE-06 rule 2). The only way data reaches this package is
// through the one call below.
//
// NO SHAPE CLAIM. `get` returns `unknown`, for the reason section 5 argues.
//
// NO WRITE. `get` is the only method and there is no `post`. WAVE-06 wave 5
// holds every mutating surface behind ADR-171's admin identity provider, and a
// transport that could already write would be the half-built control
// `../roles.ts` refuses to ship a negative-authz matrix for.

// -----------------------------------------------------------------------------
// 1. The base path and the operator prefixes
// -----------------------------------------------------------------------------

/**
 * The contract's base path, restated here because this package cannot import it.
 *
 * `apps/admin/package.json` does not declare `@merit/api` and must not:
 * `RI-04` refuses an app depending on an app, and ADR-182 section 3 makes that
 * refusal the property that keeps the operator API and the operator console one
 * API rather than two. So this is a SECOND COPY and the drift is asserted
 * rather than hoped for: `test/surface.test.ts` reads
 * `apps/api/src/surface.ts` and fails when the two strings stop agreeing, which
 * is the treatment `apps/portal/test/http-client.test.ts` gives the same
 * constant one directory over.
 */
export const API_BASE_PATH = '/api/v1';

/**
 * The prefixes `apps/api` withholds from the public deployment.
 *
 * A second copy of `OPERATOR_PREFIXES` in `apps/api/src/surface.ts`, under the
 * same drift assertion as `API_BASE_PATH` and for the same reason.
 *
 * IT IS HERE AS A REFUSAL RATHER THAN AS DOCUMENTATION. `surface.ts` classifies
 * a path as operator by these prefixes, so a console read on a path outside
 * them is a read of the PUBLIC surface issued by the operator console. That is
 * a different API with a different auth model reached from the deployable
 * SECURITY treats as total loss when owned, and it is refused below rather than
 * noticed in review.
 */
export const OPERATOR_PREFIXES = ['/admin', '/internal'] as const;

/** Raised when a caller asks this client for something it will not do. */
export class AdminApiPathError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AdminApiPathError';
  }
}

/**
 * The request URL for one contract path, ROOT RELATIVE AND NEVER ABSOLUTE.
 *
 * Exported so that the assertion in `test/surface.test.ts` can be behavioural
 * rather than only textual. A sweep for a written origin catches an origin
 * somebody typed; this catches one composed at run time from parts that are
 * individually innocent, and the two fail at different times.
 *
 * @param path an endpoint path as API_CONTRACT spells it: a leading slash, an
 *   operator prefix, and `API_BASE_PATH` NOT included. `/admin/liability`, not
 *   `/api/v1/admin/liability`.
 */
export function requestPath(path: string): string {
  if (!path.startsWith('/'))
    throw new AdminApiPathError(
      `\`${path}\` is not an endpoint path. API_CONTRACT spells every path with a leading ` +
        `slash and without \`${API_BASE_PATH}\`, which this file appends`,
    );

  if (path.startsWith(API_BASE_PATH))
    throw new AdminApiPathError(
      `\`${path}\` already carries \`${API_BASE_PATH}\`. This file appends it once, so a caller ` +
        'that supplies it produces a doubled base path and a 404 for the whole read',
    );

  const operator = OPERATOR_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  if (!operator)
    throw new AdminApiPathError(
      `\`${path}\` carries none of \`${OPERATOR_PREFIXES.join('`, `')}\`, so ` +
        '`apps/api/src/surface.ts` classifies it as PUBLIC. This console reads the operator ' +
        'surface and a public read issued from the admin origin is a second API reached from ' +
        'the deployable SECURITY treats as total loss when owned',
    );

  return `${API_BASE_PATH}${path}`;
}

// -----------------------------------------------------------------------------
// 2. The session, which this file forwards nothing for
// -----------------------------------------------------------------------------

/**
 * THE POLICY: THE REQUEST IS SAME ORIGIN, SO THE BROWSER PRESENTS THE SESSION
 * AND THIS FILE HANDLES NO CREDENTIAL AT ALL.
 *
 * `apps/portal/src/http/client.ts` forwards one named cookie from the inbound
 * request because the trader API is on a DIFFERENT origin: a browser call is
 * refused before the cookie question is reached, so the portal's server holds
 * the request and relays exactly `merit_session`. None of that reasoning
 * survives the move to this package, and the difference is `INFRA:53` rather
 * than a preference.
 *
 * THERE IS NO COOKIE NAME IN THIS FILE AND THERE MUST NEVER BE ONE. API_CONTRACT
 * section 1 marks the session cookie `httpOnly`, so page script cannot read it
 * and cannot attach it by hand; a same-origin request carries it automatically
 * and a name written here would be a copy of a credential identifier that does
 * nothing but rot. `INV-M6-02`'s "shares no cookie, no CORS policy, and no CSP
 * with any public surface" is satisfied by there being no cross-origin request
 * to have a policy about, which is WAVE-06 section 5.3's finding that the
 * separate-origin shape makes the obligation EASIER.
 *
 * `credentials` IS STATED AS `same-origin` RATHER THAN LEFT TO THE DEFAULT, and
 * the literal is the control. `include` would be this client asking to send
 * credentials cross-origin, which is the shape this console does not have and
 * must never acquire; `omit` would produce a 401 on every read that looks like
 * an expired session. The default happens to be the right one today and a
 * default is a thing that moves in a minor version with no diff in this
 * repository.
 *
 * AND THIS CONSOLE AUTHORIZES NOBODY. `../roles.ts` resolves a role STRING and
 * nothing produces one; ADR-171 finding 5 puts the mapping from a session to an
 * actor and a role with the admin identity provider, which does not exist. Every
 * operator route answers 503 until it does, and section 3 below is what lets the
 * console say that rather than guess.
 */
const CREDENTIALS_POLICY = 'same-origin' as const;

// -----------------------------------------------------------------------------
// 3. The error mapping
// -----------------------------------------------------------------------------

/**
 * What a read returned, in this console's words.
 *
 * MAPPED FROM THE HTTP STATUS AND NEVER FROM THE BODY. API_CONTRACT section 2
 * makes every error an RFC 9457 problem document with a stable `code`, and this
 * client parses none of it: a refusal is the one response whose body is least
 * worth trusting, and the status line carries everything a screen branches on.
 * A caller that needs `detail` is a caller rendering a server's prose, which is
 * a decision a screen takes and not one a transport takes for it.
 *
 * `unavailable` IS ITS OWN MEMBER AND THAT IS THE ONE MEMBER THIS SURFACE
 * GENUINELY NEEDS. ADR-171's blocker means every operator route answers 503
 * until an `AdminSessionSource` lands, so 503 is not an edge case on this
 * console, it is the state it lives in today. WAVE-06 section 8.1: "The console
 * renders the 503 with its reason, which is `page.ts`'s `PendingPanel` shape
 * used for what it was built for." A vocabulary that folded 503 into a general
 * server error would make the console unable to tell "not built yet" from
 * "broke just now", which is the two-failures-look-identical class ADR-166 named
 * one section over.
 *
 * `forbidden` IS MAPPED AND IS NOT AN INTERNAL FAULT, WHICH IS WHERE THIS
 * DIVERGES FROM THE PORTAL. `apps/portal/src/shell/app-shell.ts` deliberately
 * leaves 403 unmapped because a 403 on a trader read surface is a rendering bug
 * until proven otherwise. On this surface it is routine and expected:
 * API_CONTRACT section 1 rules that "admin surfaces return `403` because
 * existence is not a secret from an authorized operator", and section 8's RBAC
 * makes `readonly` a role that will meet one. An operator shown "something went
 * wrong" for a role boundary would be told a fault where they should be told a
 * permission.
 */
export type AdminErrorKind =
  'unauthenticated' | 'forbidden' | 'not_found' | 'rate_limited' | 'unavailable' | 'server_error';

/**
 * One status, one kind. TOTAL, with no default that hides an unmapped status.
 *
 * Anything this table does not name is `server_error` DELIBERATELY rather than
 * by fallthrough: a status this console has no sentence for is one the operator
 * can do nothing about, and inventing a fifth remedy for it would be putting a
 * sentence in the server's mouth that no server said.
 */
export function toAdminErrorKind(status: number): AdminErrorKind {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'unavailable';
  return 'server_error';
}

/**
 * A read that did not return a body this console may use.
 *
 * `status` IS `null` FOR A FAILURE THAT NEVER REACHED A STATUS LINE, and it is
 * carried so a caller can tell "the API said 503" from "nothing answered"
 * without this file growing a second vocabulary.
 */
export type AdminApiFailure = {
  readonly ok: false;
  readonly error: AdminErrorKind;
  readonly status: number | null;
};

export type AdminApiSuccess = {
  readonly ok: true;
  readonly body: unknown;
};

export type AdminApiResult = AdminApiSuccess | AdminApiFailure;

/**
 * A request that never reached a status line: DNS, connection refused, TLS, an
 * aborted socket.
 *
 * `toAdminErrorKind` takes a NUMBER and there is no number here. Mapping it to
 * `unavailable` was checked and refused: that member means the SERVER said 503,
 * which on this console is ADR-171's blocker speaking, and an unreachable API
 * saying the same thing would make the one state the console is designed to
 * render indistinguishable from an outage.
 */
const TRANSPORT_FAILURE: AdminApiFailure = { ok: false, error: 'server_error', status: null };

// -----------------------------------------------------------------------------
// 4. The cache
// -----------------------------------------------------------------------------

/**
 * `no-store`, on every request, with no option to say otherwise.
 *
 * THE ARGUMENT IS `apps/portal/src/http/client.ts`'S AND ITS THIRD LEG IS
 * REPLACED RATHER THAN REUSED, because the portal's third leg is that every
 * response is identity-scoped and this console's responses are aggregates.
 *
 * ONE. `INV-M6-04` makes a number without its as-of and its source unrenderable
 * here, and a cache serves a number whose as-of is the one it was fetched with
 * while the reader believes it is now. `../figure.ts` carries the as-of in the
 * type precisely so this cannot be lost, and a cache would lose the thing the
 * type protects by keeping it accurate about the wrong moment.
 *
 * TWO. `AS-M6-04` is the failure this whole module exists against: the liability
 * number is the one whose staleness has a named body count. `../page.ts`'s
 * `ageAtRender` computes how old a figure is AT THE MOMENT IT IS SHOWN, and a
 * cache makes that computation truthful about a fetch nobody watched.
 *
 * THREE. THIS IS AN INCIDENT SURFACE. An operator opens the liability home
 * during the event it describes; a cache with any lifetime at all serves the
 * pre-incident number to the one reader who most needs the current one.
 *
 * IT IS STATED RATHER THAN INHERITED. The framework has its own default and a
 * default moves in a minor version with no diff in this repository; ADR-182
 * ruling 2 pins `next` through `pnpm-workspace.yaml`'s catalog and `VG-12`
 * makes moving it a human approval, and this line makes the behaviour survive
 * the move either way.
 */
const CACHE_POLICY = 'no-store' as const;

// -----------------------------------------------------------------------------
// 5. The client
// -----------------------------------------------------------------------------

/**
 * The `fetch` implementation to use.
 *
 * Injectable SO THAT THE CLIENT IS TESTABLE WITHOUT A NETWORK, and for no other
 * reason: the production caller passes nothing and gets the global.
 */
export type Transport = (input: string, init: AdminRequestInit) => Promise<Response>;

/**
 * `RequestInit` PLUS THE ONE OPTION THE AMBIENT TYPE DOES NOT CARRY, and the
 * widening is a measurement rather than a convenience.
 *
 * `apps/admin/tsconfig.json` sets `types: ["node"]` and `lib: ["ES2023"]`, so
 * the global `RequestInit` here is `@types/node@22`'s undici one, which declares
 * no `cache` member: undici implements no HTTP cache, so the option is genuinely
 * absent from the runtime that type describes. The BROWSER's `RequestInit` does
 * declare it, this is a browser client, and section 4's `no-store` is therefore
 * a real instruction at run time and an unknown property at check time.
 *
 * `apps/portal/src/http/client.ts` never met this because
 * `apps/portal/tsconfig.json` carries `lib: ["ES2023", "DOM", "DOM.Iterable"]`,
 * which ADR-095 `F7` puts with the first page. **`apps/admin/tsconfig.json` is
 * `W6-d`'s file** (ADR-182 section 6 moved it there), so this slice widens the
 * type it declares rather than reaching for the `dom` lib that would supply it,
 * and the widening becomes redundant rather than wrong on the day `W6-d` lands
 * the key. The member is pinned to the one value section 4 permits, so the
 * widening cannot become a way to ask for a cache.
 */
export type AdminRequestInit = RequestInit & { readonly cache?: 'no-store' };

/** What every screen in this console talks to. */
export interface AdminApiClient {
  /**
   * Read one operator endpoint.
   *
   * @param path an endpoint path as API_CONTRACT section 8 or 9 spells it, with
   *   a leading slash, an operator prefix, and without `API_BASE_PATH`.
   */
  readonly get: (path: string) => Promise<AdminApiResult>;
}

/**
 * The console's client. THE ONLY ENTRY POINT A SCREEN CALLS.
 *
 * IT IS A BROWSER CLIENT AND THAT FOLLOWS FROM THE RELATIVE URL RATHER THAN
 * FROM A PREFERENCE. A root-relative path is resolved against the document's
 * origin, which is `ADMIN_ORIGIN`, which is where `api-admin` also serves; there
 * is no origin for the caller to supply and no cookie for it to forward. In a
 * Node process there is no document, so `fetch('/api/v1/admin/liability')`
 * throws rather than guessing a host, which is the correct direction for a
 * refusal in a package whose subject is not writing a hostname down.
 *
 * SO A SERVER-SIDE READ IS A DECISION `W6-d` TAKES AND THIS FILE DOES NOT TAKE
 * FOR IT, AND IT IS STATED HERE RATHER THAN LEFT TO BE DISCOVERED. ADR-182
 * section 5 clause 3 permits reading `ADMIN_ORIGIN` at request time through
 * `resolveAdminOrigin` and forbids reading it at build time or at the top level
 * of a prerendered module; a slice that needs a server-rendered read composes
 * the origin there, per request, and `test/surface.test.ts`'s sweep is over
 * WRITTEN origins so it does not stand in the way of that. What this file
 * refuses is holding an origin at all, because a client that can take one is a
 * client somebody configures with one.
 *
 * `get` RETURNS `unknown` AND A GENERIC `get<T>` WAS REFUSED. A type parameter a
 * caller supplies is a cast the compiler cannot check: `get<LiabilityResponse>`
 * reads as a guarantee and is a claim about bytes nobody inspected. This package
 * already keeps its wire shapes honest by transcription, in `../api/types.ts`,
 * and the transport is the wrong layer to assert them at because it would have
 * to know all of them. Narrowing is the screen's, and `unknown` is what forces
 * the screen to write the check beside the shape it transcribed.
 */
export function createAdminApiClient(
  input: { readonly transport?: Transport } = {},
): AdminApiClient {
  const transport = input.transport ?? ((url, init) => fetch(url, init));

  return {
    get: async (path: string): Promise<AdminApiResult> => {
      const url = requestPath(path);

      let response: Response;
      try {
        response = await transport(url, {
          method: 'GET',
          headers: { accept: 'application/json' },
          cache: CACHE_POLICY,
          credentials: CREDENTIALS_POLICY,

          // A redirect on an API read is a login page or a proxy, and following
          // one turns a 401 into a 200 carrying HTML. The console would then
          // parse a document as a figure.
          redirect: 'error',
        });
      } catch {
        return TRANSPORT_FAILURE;
      }

      if (!response.ok)
        return { ok: false, error: toAdminErrorKind(response.status), status: response.status };

      try {
        return { ok: true, body: (await response.json()) as unknown };
      } catch {
        // A 2xx whose body is not JSON is a server that answered wrongly, and it
        // is `server_error` rather than `unavailable` for the same reason a
        // transport failure is: nothing said 503, and this console's 503 means
        // something specific. The status is carried because there WAS one.
        return { ok: false, error: 'server_error', status: response.status };
      }
    },
  };
}
