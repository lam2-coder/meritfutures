// =============================================================================
// apps/portal/src/http/client.ts
// =============================================================================
// THE ONE FILE IN `apps/portal` THAT PERFORMS A NETWORK CALL.
//
// `apps/portal/test/surface.test.ts` walked every `.ts` under `src/` and failed
// on `fetch(`, `XMLHttpRequest`, `WebSocket` and `EventSource`, with a stated
// reason: "the fetch layer arrives with the framework. Asserting it now means
// THE FIRST `fetch` WRITTEN HERE IS A DECISION SOMEBODY MAKES ON PURPOSE rather
// than one that appears in a diff."
//
// This file is that decision and ADR-162 is the record of it. The assertion is
// NARROWED rather than deleted: it now reads "transport exists in one named
// file and nowhere else", it names this file, and it still fails if a second
// file gains a `fetch(`. Three of its four needles are untouched and still hold
// at zero files -- `XMLHttpRequest` and `EventSource` have no admitted use, and
// `WebSocket` is `P6-h`'s to move from "nowhere" to `src/live/client.ts` when
// the socket lands.
//
// `apps/portal/src/app/payouts/source.ts` named the five decisions this file
// owes and said "this session is not that somebody". Each of the five is argued
// below AT THE POINT IT IS MADE rather than summarised here, in the order that
// file listed them: the base URL (section 1), the session cookie (section 2),
// the error mapping (section 3), the cache (section 4). The fifth -- that five
// other segments need this same client -- is the reason there is one file, and
// it is the narrowed assertion rather than a paragraph.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE IS NOT, AND THE REFUSALS ARE STRUCTURAL RATHER THAN STYLISTIC
// -----------------------------------------------------------------------------
// NO ROUTE HANDLER AND NO SERVER ACTION. ADR-095 ruling 3 refuses both for
// `/api/v1`, any operator path and any surface API_CONTRACT specifies, and
// ADR-138 section 3 makes the Server Action half TOTAL because an action has no
// path to check. `RI-11` in `packages/tooling/checks/ui-server-endpoints.mjs`
// is the mechanism and it reads EVERY compiled file under `apps/`, this one
// included. So the portal never re-serves what it reads: it is a CLIENT of
// `/api/v1` on another origin, and `API_CONTRACT` section 1's "no privileged
// back door" is a property of there being no door rather than of a policy.
//
// NO SHAPE CLAIM. `get` returns `unknown` and section 5 argues why a generic
// `get<T>` was refused.
//
// -----------------------------------------------------------------------------
// THE WRITE VERB ARRIVED SECOND, AND IT IS ADR-219 RATHER THAN ADR-162
// -----------------------------------------------------------------------------
// For seven weeks this interface had exactly one member. Three screens declined
// to add the second and each said why at the point it declined: the payout
// centre for `POST /accounts/:accountId/payout`, the security screen for
// `POST /sessions/:id/revoke`, and the sign-in screen for all four of its
// routes. THE DECLINES WERE RIGHT. A write is not a read with a different
// string in `method`: it carries a request body, it is the only place a CSRF
// posture can be argued, it is the only place an `Idempotency-Key` can be sent
// or withheld, and it is the first thing in this application that can receive a
// `Set-Cookie` it cannot deliver. Section 6 rules those four and nothing else.
//
// NO PAGE CALLS `post` IN THE COMMIT THAT ADDS IT, AND THAT IS THE RULING'S
// SHAPE RATHER THAN AN OMISSION. ADR-190 refuses a control that answers wrongly
// more strongly than it refuses one that honestly says it is not there, and a
// screen that starts posting on a posture nobody has read is that control.

import { toPortalErrorKind } from '../shell/app-shell.ts';
import type { PortalErrorKind } from '../shell/app-shell.ts';

// -----------------------------------------------------------------------------
// 1. The base URL
// -----------------------------------------------------------------------------

/**
 * The environment variable naming the API origin.
 *
 * IT IS AN ORIGIN AND NOT A BASE URL, which is the smaller of the two things it
 * could be and is deliberate. `BASE_PATH` in `apps/api/src/surface.ts` is
 * `/api/v1` and that file's own header calls it "one string in one place";
 * folding it into a deployment variable would make the contract's base path a
 * thing an operator can get wrong per environment, and a wrong one answers 404
 * for the whole surface.
 */
export const API_ORIGIN_VAR = 'MERIT_API_ORIGIN';

/**
 * The contract's base path, restated here because the portal cannot import it.
 *
 * `apps/portal/package.json` does not declare `@merit/api` and must not: that
 * package's closure is Fastify, `@merit/db`, `@merit/ledger` and five more, and
 * pulling it in to read one string would put the whole API's dependency set
 * into a UI deployable to save a duplicated constant. `.npmrc`'s
 * `node-linker=isolated` is what makes that a real cost rather than a stylistic
 * one.
 *
 * SO THIS IS A SECOND COPY AND THE DRIFT IS ASSERTED RATHER THAN HOPED FOR.
 * `apps/portal/test/http-client.test.ts` reads `apps/api/src/surface.ts` and
 * fails if the two strings stop agreeing, which is the same treatment
 * `apiSurfaceVocabulary` gives the same constant one directory over.
 */
export const API_BASE_PATH = '/api/v1';

/** Raised when the deployment has not been configured. */
export class ApiConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ApiConfigError';
  }
}

/**
 * The API origin this process talks to, or a refusal.
 *
 * THERE IS NO DEFAULT AND THAT IS `resolveSurface`'S ARGUMENT APPLIED TO A
 * SECOND VARIABLE. `apps/api/src/index.ts` gives `PORT` a default and refuses
 * to guess `MERIT_API_SURFACE`, on the ground that the difference is which
 * direction a wrong value fails in: "an unset port decides nothing about what
 * is served: a wrong one is unreachable within a second of the deploy, by
 * everything at once."
 *
 * AN UNSET API ORIGIN IS THE SURFACE VARIABLE'S SHAPE AND NOT THE PORT'S. A
 * default of `http://localhost:3000` is right on exactly one machine and wrong
 * in the deployment where being wrong costs money, and it fails QUIETLY there:
 * the screen renders its honest unavailable state, which is what it renders
 * when the API is merely down. A deployment that has not been told where its
 * API is has not been configured, and this refuses rather than guesses.
 *
 * THE REFUSAL IS PER READ AND NOT AT START, WHICH IS WORTH STATING BECAUSE IT
 * BOUNDS WHAT THE REFUSAL BUYS. Nothing in this application runs at start; the
 * first `serverApiClient()` of a request is where this is reached, so an
 * unconfigured deployment is discovered by a screen rather than by a process
 * that failed to boot. What a caller does with it is the caller's ruling:
 * `src/app/payouts/source.ts` converts THIS error and no other into the
 * screen's existing "waiting on an endpoint" state, on the ground that a
 * deployment with no API genuinely cannot reach either endpoint.
 *
 * THE VALUE IS AN ORIGIN AND IS CHECKED AS ONE. A trailing path is refused
 * rather than trimmed: an operator who set `https://api.example/api/v1` meant
 * something, and silently discarding half of it would serve a surface nobody
 * asked for. A non-`https` scheme is refused outside `localhost` because
 * `API_CONTRACT` section 1 marks the session cookie `Secure`, and a cookie the
 * browser will not send over `http` produces a 401 that looks like an expired
 * session.
 */
export function resolveApiOrigin(env: Readonly<Record<string, string | undefined>>): string {
  const raw = env[API_ORIGIN_VAR];
  if (raw === undefined || raw.trim() === '')
    throw new ApiConfigError(
      `${API_ORIGIN_VAR} is unset. The portal reads \`${API_BASE_PATH}\` on the API's own ` +
        'origin (ADR-083 ruling 1: the API is its own deployable), and there is no default ' +
        'that is right anywhere but one laptop',
    );

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new ApiConfigError(
      `${API_ORIGIN_VAR} is \`${raw}\`, which is not an absolute URL. It is an ORIGIN, ` +
        `scheme and host and optional port, and \`${API_BASE_PATH}\` is appended to it`,
    );
  }

  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '')
    throw new ApiConfigError(
      `${API_ORIGIN_VAR} is \`${raw}\`, which carries a path, a query or a fragment. It is an ` +
        `ORIGIN; \`${API_BASE_PATH}\` is this file's and is not an operator's to move`,
    );

  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !local)
    throw new ApiConfigError(
      `${API_ORIGIN_VAR} is \`${raw}\`, which is not https. API_CONTRACT section 1 marks the ` +
        'session cookie `Secure`, so the browser withholds it over http and every read ' +
        'returns 401 while looking like an expired session',
    );

  return parsed.origin;
}

// -----------------------------------------------------------------------------
// 2. The session cookie
// -----------------------------------------------------------------------------

/**
 * The session cookie's name, as `apps/api/src/routes/auth.ts` declares it.
 *
 * That file's `SESSION_COOKIE` is the producer and this is the one forwarder.
 * It is a second copy for `API_BASE_PATH`'s reason exactly, and it drifts under
 * the same assertion in `apps/portal/test/http-client.test.ts`.
 */
export const SESSION_COOKIE = 'merit_session';

/**
 * THE POLICY: THE REQUEST IS MADE BY THE PORTAL'S SERVER, CARRYING EXACTLY ONE
 * COOKIE, AND THE BROWSER NEVER CALLS THE API AT ALL.
 *
 * Three measurements decide this and none of them is a preference.
 *
 * ONE. `apps/api` SETS NO CORS HEADER. `grep -rn 'Access-Control' apps/api`
 * returns nothing, and ADR-083 ruling 1 makes the API its own deployable on its
 * own origin. A browser `fetch` from the portal origin to the API origin is
 * therefore refused by the browser before the cookie question is reached, and
 * `credentials: 'include'` would additionally require
 * `Access-Control-Allow-Credentials`, which is a change to `apps/api` and is
 * outside this session's fence. THE CLIENT DOES NOT ASK FOR SOMETHING THE
 * SERVER HAS NOT AGREED TO SEND.
 *
 * TWO. THE COOKIE IS `httpOnly` (API_CONTRACT section 1), so page script cannot
 * read it and cannot attach it by hand. The only two things that can present it
 * are the browser, automatically, and a server holding the inbound request's
 * `Cookie` header. The first is closed by measurement one, so it is the second.
 *
 * THREE. THE FORWARD IS ONE NAMED COOKIE AND NEVER THE WHOLE HEADER. The
 * portal's own origin may accumulate cookies that are nobody's business but the
 * portal's, and relaying `request.headers.cookie` wholesale would hand every
 * one of them to another deployable on every read. One name is the whole
 * policy and there is no branch here that can widen it.
 *
 * WHAT THIS FORECLOSES. There is no browser-side client in this application and
 * no `credentials` option anywhere below: a segment that wants data fetches it
 * where the session already is, which is the server component. `INV-M4-10`'s
 * "no screen is reachable without an authenticated session" is then a property
 * of the API refusing an absent cookie with a 401 that section 3 maps, rather
 * than of anything this file decides about who is signed in. THE PORTAL
 * AUTHORIZES NOBODY (`INV-M4-06`).
 */
export type SessionToken = string | null;

// -----------------------------------------------------------------------------
// 3. The error mapping
// -----------------------------------------------------------------------------

/**
 * What a read returned.
 *
 * `status` IS `null` FOR A FAILURE THAT HAD NO RESPONSE, and it is carried so a
 * caller can tell "the API said 404" from "nothing answered" without this file
 * growing a second vocabulary. `error` is `PortalErrorKind` and nothing else,
 * because `shell/app-shell.ts` is where the portal decides how to word a
 * refusal and its header spends a paragraph on why `403` is deliberately
 * unmapped. THIS FILE ADDS NO MEMBER TO THAT UNION.
 */
export type ApiFailure = {
  readonly ok: false;
  readonly error: PortalErrorKind;
  readonly status: number | null;
};

export type ApiSuccess = {
  readonly ok: true;
  readonly body: unknown;
};

export type ApiResult = ApiSuccess | ApiFailure;

/**
 * A request that never reached a status line.
 *
 * DNS, connection refused, TLS, an aborted socket. `toPortalErrorKind` takes a
 * NUMBER and there is no number here; inventing one -- 503 is the tempting one
 * -- would put a sentence in the server's mouth that no server said, which is
 * the move `view/certificates.ts` refuses when it reports an unverifiable
 * certificate as unverifiable rather than as false.
 *
 * SO IT IS MAPPED DIRECTLY, AND `server_error` RATHER THAN `unexpected` IS THE
 * ARGUMENT. `app-shell.ts` reserves `unexpected` for the case it names: a `403`
 * on a read surface, which "is FM-M4-10 firing" and is "a rendering bug until
 * proven otherwise". An unreachable API is not a bug in this page; it is an
 * outage, the trader can do nothing about it, and the sentence a trader should
 * read is the one `server_error` carries. `status: null` is what keeps the two
 * distinguishable for anything that needs to know.
 */
const TRANSPORT_FAILURE: ApiFailure = { ok: false, error: 'server_error', status: null };

/**
 * A response that DID arrive, read into the vocabulary above.
 *
 * EXTRACTED RATHER THAN COPIED, and the extraction is the whole of what section
 * 6 shares with section 5. A second copy of these six lines beside a `POST` is
 * how a read and a write drift apart on the one axis a trader can see, which is
 * which sentence a refusal renders as. There is no parameter here and there is
 * no branch on method: a status means the same thing whichever verb asked.
 *
 * THE ONE THING IT DOES NOT SETTLE IS `204`, and that is deliberate. A `204` is
 * a success with no body, `response.ok` is already true for it, and this
 * function would then hand `response.json()` an empty stream and map a
 * successful logout to `server_error`. It is section 6.4's arm rather than a
 * flag here, because a `204` on a READ is not in the contract and the read path
 * keeps the stricter reading it already had.
 */
async function settle(response: Response): Promise<ApiResult> {
  if (!response.ok)
    return { ok: false, error: toPortalErrorKind(response.status), status: response.status };

  try {
    return { ok: true, body: (await response.json()) as unknown };
  } catch {
    // A 2xx whose body is not JSON is a server that answered wrongly, and it is
    // `server_error` for the same reason a 500 is: the trader can do nothing
    // about it and no other member of the vocabulary is true. The status is
    // carried because there WAS one.
    return { ok: false, error: 'server_error', status: response.status };
  }
}

// -----------------------------------------------------------------------------
// 4. The cache
// -----------------------------------------------------------------------------

/**
 * `no-store`, on every request, with no option to say otherwise.
 *
 * THREE REASONS, AND THE THIRD IS THE ONE THAT MAKES IT NON-NEGOTIABLE.
 *
 * ONE. M04 section 1.2 rows "storing anything durable" as the API's and not the
 * portal's, in one line: "No client-side cache of a money number survives a
 * navigation."
 *
 * TWO. `INV-M4-04`: "a payout confirmation re-fetches eligibility immediately
 * before submit, and shows the number it will actually send." A cache with any
 * lifetime at all can serve the confirmation screen a number the server has
 * already moved, which is `FM-M4-02` exactly.
 *
 * THREE. EVERY RESPONSE ON THIS SURFACE IS IDENTITY-SCOPED. A cache is a key
 * and a value, and the key here would have to include the session cookie or it
 * serves one trader's payouts to another. That is `FM-M4-03`, "the single most
 * common vibe-code fatality", and it is reached not by writing a bad key but by
 * failing to write a key at all. THE ANSWER IS NOT A BETTER KEY. `INV-M4-06`
 * makes the portal a place where another identity's data must never arrive, so
 * the safe design is the one with no store to leak.
 *
 * IT IS STATED RATHER THAN INHERITED, AND THAT IS THE POINT OF THE CONSTANT.
 * The framework has its own default and a default is a thing that changes in a
 * minor version with no diff in this repository. `pnpm-workspace.yaml` pins
 * `next: 16.3.2`, VG-12 makes moving it a human approval, and this line makes
 * the behaviour survive the move either way.
 *
 * WHAT IT FORECLOSES. No `revalidate`, no cache tag, no `force-cache`, and
 * therefore NO STATICALLY RENDERED SCREEN IN THIS APPLICATION THAT SHOWS API
 * DATA. Every read is dynamic, every navigation pays a round trip, and that
 * cost is accepted here rather than argued per segment. A future screen that
 * genuinely wants caching -- a public certificate verification page is the only
 * candidate in M04, because it is the one surface with no session -- does not
 * relax this constant; it is a different function with its own entry.
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
export type Transport = (input: string, init: RequestInit) => Promise<Response>;

/**
 * The endpoint path a caller names, refused when this file cannot compose it.
 *
 * SHARED BY BOTH VERBS BECAUSE THE COMPOSITION IS ONE FACT. `get` carried this
 * check inline while it was the only caller; a second inline copy is how a
 * write ends up accepting a path a read refuses.
 */
function refuseUncomposablePath(path: string): void {
  if (!path.startsWith('/'))
    throw new ApiConfigError(
      `\`${path}\` is not an endpoint path. API_CONTRACT spells every path with a leading ` +
        `slash and without \`${API_BASE_PATH}\`, which this file appends`,
    );
}

/** What every segment in this application talks to. */
export interface ApiClient {
  /**
   * Read one endpoint.
   *
   * @param path an endpoint path as API_CONTRACT spells it, leading slash, with
   *   `API_BASE_PATH` NOT included. `/payouts`, not `/api/v1/payouts`.
   */
  readonly get: (path: string) => Promise<ApiResult>;

  /**
   * Write one endpoint. SECTION 6 IS THE RULING AND THIS IS THE SIGNATURE.
   *
   * `POST` AND NO OTHER METHOD, measured rather than assumed: a real `compose()`
   * over the modules discovered from disk registers 46 routes on the `public`
   * surface and withholds 27, and the 46 are 24 `GET` and 22 `POST` with no
   * `PATCH`, `PUT` or `DELETE` among them. A method parameter would be a
   * vocabulary this contract does not use, and `registry.ts` closes the verb
   * list at five for the API's own side of the same argument.
   *
   * IT TAKES ONE ARGUMENT, which is the same foreclosure `get`'s arity is: there
   * is no options object a caller could put a cache window, a redirect policy or
   * a second cookie into.
   */
  readonly post: (request: WriteRequest) => Promise<ApiResult>;
}

/**
 * A client bound to one origin and one session.
 *
 * `get` RETURNS `unknown` AND A GENERIC `get<T>` WAS REFUSED. A type parameter
 * a caller supplies is a cast the compiler cannot check: `get<AccountDetail>`
 * reads as a guarantee and is a claim about bytes nobody inspected. This
 * application already keeps its wire shapes honest by transcription --
 * `src/api/types.ts` is API_CONTRACT sections 3, 5, 6 and 7 written out -- and
 * the transport is the wrong layer to start asserting them at, because it would
 * have to know all of them.
 *
 * SO NARROWING IS THE SEGMENT'S AND IT IS FORCED. `unknown` cannot be read
 * without a check, which means a segment that wants a field writes the check,
 * beside the shape it transcribed, where a reviewer looking at the screen can
 * see it. `src/app/payouts/source.ts` is the worked example.
 */
export function createApiClient(input: {
  readonly origin: string;
  readonly sessionToken: SessionToken;
  readonly transport?: Transport;
}): ApiClient {
  const transport = input.transport ?? ((url, init) => fetch(url, init));

  return {
    get: async (path: string): Promise<ApiResult> => {
      refuseUncomposablePath(path);

      const headers: Record<string, string> = { accept: 'application/json' };
      if (input.sessionToken !== null)
        headers['cookie'] = `${SESSION_COOKIE}=${input.sessionToken}`;

      let response: Response;
      try {
        response = await transport(`${input.origin}${API_BASE_PATH}${path}`, {
          method: 'GET',
          headers,
          cache: CACHE_POLICY,
          redirect: 'error',
        });
      } catch {
        return TRANSPORT_FAILURE;
      }

      return settle(response);
    },

    post: async (request: WriteRequest): Promise<ApiResult> => {
      refuseUncomposablePath(request.path);
      const payload = serialisedBody(request);
      const key = checkedIdempotencyKey(request);

      // SECTION 6.2. The forward is the same one named cookie the read sends,
      // and `content-type` is the only header the method adds beyond the key.
      const headers: Record<string, string> = {
        accept: 'application/json',
        'content-type': WRITE_CONTENT_TYPE,
      };
      if (input.sessionToken !== null)
        headers['cookie'] = `${SESSION_COOKIE}=${input.sessionToken}`;
      if (key !== null) headers[IDEMPOTENCY_HEADER] = key;

      let response: Response;
      try {
        response = await transport(`${input.origin}${API_BASE_PATH}${request.path}`, {
          method: 'POST',
          headers,
          body: payload,
          cache: CACHE_POLICY,

          // `redirect: 'error'` IS LOAD-BEARING ON A WRITE IN A WAY IT IS NOT ON
          // A READ. `fetch` follows a 301, 302 or 303 by REWRITING the request
          // to a bodyless `GET`, so a misconfigured edge could turn a payout
          // request into a read of whatever it redirected to and answer 200.
          // Nothing in API_CONTRACT redirects, so a redirect here is a
          // deployment fault, and it surfaces as a transport failure rather
          // than as a success nobody asked for.
          redirect: 'error',
        });
      } catch {
        return TRANSPORT_FAILURE;
      }

      // SECTION 6.4. A `204` is a success with no body and `settle` would hand
      // its empty stream to `response.json()`.
      if (response.status === NO_CONTENT) return { ok: true, body: null };

      return settle(response);
    },
  };
}

// -----------------------------------------------------------------------------
// 6. The write verb
// -----------------------------------------------------------------------------
//
// THIS SECTION IS BELOW SECTION 5 RATHER THAN BESIDE THE READ IT PARALLELS, AND
// THE REASON IS A CITATION COUNT RATHER THAN A PREFERENCE. Five files outside
// this one cite "its section 5" for the `unknown` argument: `app/referrals/
// data.ts`, `app/payouts/source.ts`, `app/(purchases)/source.ts`,
// `app/accounts/source.ts` and `app/calendar/load.ts`. Inserting a section
// above it would renumber five pointers in five files this fence does not hold,
// which is the citation drift this corpus has now repaired more often than it
// has written new transport.
//
// -----------------------------------------------------------------------------
// 6.1 THE CSRF POSTURE. NO TOKEN IS MINTED HERE, AND `SameSite=Lax` IS NOT THE
// WHOLE REASON
// -----------------------------------------------------------------------------
// THE CORPUS IS NOT SILENT, WHICH IS WHERE THIS HAD TO START.
// `grep -rn CSRF docs/architecture/SECURITY.md docs/architecture/API_CONTRACT.md` returns nothing,
// which is what ALLOCATION row 219 measured and what re-running it still shows.
// BUT THE CONSTITUTION RULES IT IN FOUR WORDS. `MERIT_BUILD_MASTER_PROMPT.md`
// Appendix D section D2 lists "CSRF on cookie mutations" among the binding
// application controls, beside Turnstile and the CSP. So the live question is
// never whether Merit wants the control. It is WHOSE it is, and it is not this
// file's, for three reasons that are measured rather than argued.
//
// ONE. NOTHING ON THE SERVER CHECKS ONE. `grep -rni csrf apps packages` returns nothing.
// A token minted here would be an unread header, and an unread header on a
// money path is worse than no header: it is a control a later reader counts.
//
// TWO. THE REQUEST THIS CLIENT MAKES IS NOT THE REQUEST CSRF DEFENDS AGAINST.
// Section 2 established that the browser never calls the API at all and that the
// portal's SERVER holds the inbound `Cookie` header and forwards one name from
// it. A cross-site request forgery is a request the VICTIM'S BROWSER is tricked
// into issuing with its own cookies attached. This `fetch` runs in Node, the
// cookie is attached by the eleven lines above rather than by a cookie jar, and
// no page anywhere can cause it to be issued: `ADR-095` ruling 3 and `ADR-138`
// section 3 refuse a Server Action in this deployable OUTRIGHT, and `RI-11`
// reads every compiled file under `apps/` for one. THE PORTAL EXPOSES NO
// BROWSER-REACHABLE WRITE ENDPOINT FOR A FORGED FORM TO TARGET.
//
// THREE. FOR THE CROSS-SITE CASE, THE COOKIE IS ALREADY THE CONTROL AND A TOKEN
// WOULD BE A SECOND COPY OF IT. `apps/api/src/routes/auth.ts:589` sets
// `merit_session` with `HttpOnly; Secure; SameSite=Lax`, which is API_CONTRACT
// line 19's attribute list, and a `Lax` cookie is not attached to a cross-site
// `POST` at all. An attacker page on `evil.com` posting to `/api/v1/checkout`
// therefore arrives with no session and is a 401.
//
// -----------------------------------------------------------------------------
// WHAT `Lax` DOES NOT COVER, STATED SO THE RULING IS NOT MISTAKEN FOR A CLEAN
// BILL
// -----------------------------------------------------------------------------
// `SameSite` IS SITE-SCOPED AND MERIT'S TRADER SURFACES SHARE A SITE.
// `INFRA` section 2.1 rows `site` on `meritfutures.com`, `portal` on
// `app.meritfutures.com`, and `api` on `app.meritfutures.com` under `/api/v1`.
// `meritfutures.com` and `app.meritfutures.com` are the SAME SITE, so a request
// issued by a page on the marketing origin to the API is same-site, `Lax`
// permits it, and the host-only `merit_session` cookie is sent because the
// destination host matches. AN INJECTION ON THE MARKETING SITE IS A FULLY
// AUTHENTICATED WRITE AGAINST A TRADER'S MONEY, AND `Lax` DOES NOTHING ABOUT IT.
//
// THE CORPUS ALREADY REASONS THIS WAY ONE ORIGIN OVER, WHICH IS WHY THE GAP IS
// AN OVERSIGHT RATHER THAN A TRADE. `INFRA` section 3 hard rule 3 puts the
// admin console and `api-admin` on `ADMIN_ORIGIN`, "a separate apex domain",
// and says in terms that "cookie scope, CORS, and the CSP never span the two
// origins". The operator surfaces were separated at the SITE boundary on
// purpose. The trader surfaces were not.
//
// The other two things `Lax` does not do are named so nobody has to rediscover
// them. It permits a top-level GET navigation, which is harmless only while
// every mutation is a `POST` (measured above: 24 GET and 22 POST, no other
// verb, and `registry.ts` closes the list). And it is not a defence against
// script running on the origin itself, where `httpOnly` is the control and a
// token in a readable cookie would be no control at all.
//
// SO THE OBLIGATION IS REGISTERED RATHER THAN DISCHARGED, AND IT IS
// `apps/api`'s. That package is outside this fence by ADR-219's own terms. The
// shape a founder has to choose between is in ADR-219 section 4 and this file
// does not pick one, because a client that starts sending a header before the
// server decides which header it reads has made the decision by shipping.
//
// -----------------------------------------------------------------------------
// 6.2 THE UNSAFE-METHOD COOKIE POLICY, AGAINST C-02 AS WRITTEN
// -----------------------------------------------------------------------------
// OUTBOUND: NOTHING CHANGES, AND THAT IS THE RULING RATHER THAN AN ABSENCE OF
// ONE. Section 2's three measurements were about who can present the cookie and
// what a wholesale header relay would leak, and not one of them turns on the
// method. So a write forwards exactly one named cookie, never
// `request.headers.cookie`, and asks for no `credentials` mode. `SECURITY`
// `C-02` reads "short-lived access session, rotating refresh, httpOnly Secure
// SameSite cookies" and rules nothing about unsafe methods separately.
//
// C-02 IS ALSO WEAKER THAN THE DISPATCH THAT CITED IT, AND THE DIFFERENCE IS
// WORTH ONE LINE. C-02 says "SameSite" and names NO MODE. `Lax` appears in
// API_CONTRACT line 19 and in `auth.ts:589`, and nowhere in `SECURITY.md`. The
// mode is the contract's and the code's, and reading it back out of C-02 is
// reading a document for a word it does not contain.
//
// INBOUND IS THE HALF ONLY A WRITE HAS, AND IT IS A DEAD END THAT MUST BE SAID
// OUT LOUD. THREE REGISTERED `POST`s ANSWER WITH A `Set-Cookie`:
// `auth.ts:1033` and `auth.ts:1088` establish a session and `auth.ts:1098`
// clears one. This client receives all three on a server-side `Response` and
// DELIVERS NONE OF THEM. That is not a gap this file can close:
// `next@16.3.2` raises `ReadonlyRequestCookiesError`, "Cookies can only be
// modified in a Server Action or Route Handler", and `ADR-138` section 3 with
// `RI-11` refuse a Server Action in this deployable outright. A portal-owned
// Route Handler on a path API_CONTRACT does not specify is the one door
// `ADR-095` ruling 3 leaves standing, and nobody has ruled on it.
//
// SO `post` IS NECESSARY AND NOT SUFFICIENT FOR SIGN-IN, and a session
// established through it would be established for a browser that never receives
// it. Session 408 found that the served set already admits no complete sign-in;
// this is a second and independent reason, on this side of the fence.
//
// -----------------------------------------------------------------------------
// 6.3 IDEMPOTENCY. THE CALLER'S KEY, NEVER THIS FILE'S, AND NEVER A DEFAULT
// -----------------------------------------------------------------------------
// WHAT IS SENT: the caller's string, verbatim, in `Idempotency-Key`, when the
// caller supplies one, and no header at all when the caller passes `null`.
//
// WHO GENERATES IT: THE CALLER, AND A TRANSPORT THAT MINTED ONE WOULD DEFEAT
// THE MECHANISM RATHER THAN IMPLEMENT IT. API_CONTRACT line 23 is the whole
// argument: "replaying a key with an identical body returns the original
// response verbatim". A replay is a SECOND CALL, and a client that minted a
// fresh key per call would send a different key on the retry, which is a second
// payout rather than a replay of the first. `INV-M5-06` states the same rule one
// leg over, for the API's own call to the transfer rail, in the form that makes
// the direction unmissable: "the same `idempotency_key` on every attempt,
// generated BEFORE the first send and persisted in the same transaction"
// (`docs/plans/M05-payout-system.md:85`). Before the first send is before this
// function is entered.
//
// WHY THE FIELD IS REQUIRED AND `null` MUST BE WRITTEN OUT. API_CONTRACT line 23
// requires a key on `POST /checkout`, `POST /accounts/:id/payout`,
// `POST /accounts/:id/reset` and `POST /wallet/withdrawals`, and accepts one
// everywhere else. THIS FILE HOLDS NO LIST OF THOSE FOUR, on purpose: three of
// them carry a path parameter, so a check here would need a pattern table,
// which is a third copy of a contract fact whose enforcement already lives in
// the handler. The portal is not the idempotency control for the same reason
// `INV-M4-06` makes it not the authorization control. What an OPTIONAL field
// would buy is a silent default, and a payout that omitted its key by omission
// rather than by decision is exactly the failure the key exists to prevent. A
// required `string | null` puts the decision at the call site, in the diff, next
// to the path, which is `submits_to`'s idiom on three screens already.
//
// WHAT IS CHECKED HERE IS THE SHAPE AND NOTHING ELSE, because a header value is
// this layer's business: a key carrying CR, LF or a NUL is a header-injection
// attempt and is refused before it reaches a socket.
//
// -----------------------------------------------------------------------------
// 6.4 THE BODY, THE `204`, AND THE ONE THING THIS RESULT TYPE STILL CANNOT SAY
// -----------------------------------------------------------------------------
// THE BODY IS ALWAYS SENT AND IS ALWAYS JSON. API_CONTRACT section 1's content
// type is `application/json` for requests. A `POST` with no meaningful payload
// passes `{}` and says so at the call site; there is no branch here that omits
// a body, because a branch on "did the caller mean to send nothing" is a branch
// that fires on `undefined` arriving by accident. `JSON.stringify` returning
// `undefined`, which is what it does for `undefined`, a function and a symbol,
// is refused by name rather than sent as an empty body.
//
// A `204` IS A SUCCESS WITH `body: null`. RFC 9110 gives 204 no content, two
// registered routes use it (`auth.ts:1100` and `auth.ts:1176`), and
// `response.ok` is true for it, so without this arm a successful logout parses
// an empty stream and renders as `server_error`. It is keyed on the STATUS and
// never on an empty payload: a status is a statement the server made, while an
// empty body on a 200 is a server that answered wrongly, which is section 3's
// existing reading and does not move.
//
// WHAT THIS TYPE STILL CANNOT SAY, AND THIS IS NOW THE FIFTH SITE ASKING.
// `ApiSuccess` is `{ ok: true, body: unknown }` and carries NO STATUS, so a
// `204` and a `200` whose body is the JSON value `null` are indistinguishable
// here, and `201` (`POST /checkout`), `202` (`POST /auth/otp`) and `200` are the
// same answer to a caller. FOUR SEGMENTS ALREADY REPORTED THIS AND EACH REFUSED
// TO REACH FOR IT because this file was outside their fence:
// `app/accounts/source.ts`, `app/calendar/load.ts`, `app/(purchases)/source.ts`
// and `app/referrals/data.ts` each carry the sentence "widening `ApiSuccess` is
// a change to ADR-162's file". THIS SESSION HOLDS THAT FENCE AND STILL DECLINES,
// and the reason is a count rather than caution: adding the field would make
// those four sentences false in four files this fence does not hold, which is
// four new stale citations bought to save one. ADR-219 section 5 registers it as
// one slice over `client.ts` AND the four segments, which is the shape ADR-217
// clause 5 used for the identical trade.

/** The request line 23 of API_CONTRACT and section 6 above describe. */
export type WriteRequest = {
  /**
   * An endpoint path as API_CONTRACT spells it, leading slash, with
   * `API_BASE_PATH` NOT included. `/checkout`, not `/api/v1/checkout`.
   */
  readonly path: string;

  /**
   * The request payload, serialised as JSON. `{}` for a route that takes none.
   *
   * `unknown` FOR THE REASON `get` RETURNS `unknown`. A generic `post<T>` would
   * read as a guarantee that the body matches what the contract declares, and
   * this layer has inspected nothing. `src/api/types.ts` is where the wire
   * shapes are transcribed and the segment is where one is asserted.
   */
  readonly body: unknown;

  /**
   * The caller's `Idempotency-Key`, or `null` said out loud.
   *
   * NOT OPTIONAL. Section 6.3 is the argument: an omitted key must be a
   * decision a reviewer can see beside the path, and never a default.
   */
  readonly idempotencyKey: string | null;
};

/** API_CONTRACT section 1: "`application/json` for requests". */
const WRITE_CONTENT_TYPE = 'application/json';

/**
 * The header API_CONTRACT line 23 names, spelled as this file spells `cookie`.
 *
 * LOWER CASE BECAUSE HEADER NAMES ARE CASE-INSENSITIVE AND THE READER IS
 * ALREADY LOWER CASE: `apps/api/src/routes/affiliate.ts:807` reads
 * `headers['idempotency-key']`, which is the shape Fastify normalises to.
 */
const IDEMPOTENCY_HEADER = 'idempotency-key';

/** RFC 9110's no-content status. Section 6.4. */
const NO_CONTENT = 204;

/**
 * A legal HTTP field value: visible ASCII, with no leading or trailing space.
 *
 * THE POINT IS CR, LF AND NUL. Everything else this rejects is a key no server
 * would accept anyway, and rejecting a control character in a header value is
 * the transport's job rather than the contract's.
 */
const LEGAL_HEADER_VALUE = /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/;

/** The body as bytes, or a refusal naming the path that cannot be composed. */
function serialisedBody(request: WriteRequest): string {
  let payload: string | undefined;
  try {
    payload = JSON.stringify(request.body);
  } catch (cause) {
    throw new ApiConfigError(
      `the body for \`${request.path}\` cannot be serialised as JSON (${String(cause)}). ` +
        'API_CONTRACT section 1 makes every request `application/json`, and a circular ' +
        'structure or a BigInt is a caller defect rather than a transport failure',
    );
  }

  if (payload === undefined)
    throw new ApiConfigError(
      `the body for \`${request.path}\` serialises to nothing. \`undefined\`, a function and ` +
        'a symbol each produce no JSON at all; a route that takes no payload sends `{}` and ' +
        'says so at the call site',
    );

  return payload;
}

/** The caller's key, checked as a header value, or `null`. */
function checkedIdempotencyKey(request: WriteRequest): string | null {
  const key = request.idempotencyKey;
  if (key === null) return null;

  if (!LEGAL_HEADER_VALUE.test(key))
    throw new ApiConfigError(
      `the \`Idempotency-Key\` for \`${request.path}\` is not a legal header value. It must be ` +
        'visible ASCII with no leading or trailing space, which is what keeps a carriage ' +
        'return out of a request this file composes by hand',
    );

  return key;
}

/**
 * The client a server component uses. THE ONLY ENTRY POINT A SEGMENT CALLS.
 *
 * `next/headers` IS IMPORTED DYNAMICALLY AND THAT IS NOT STYLE. `cookies()`
 * throws outside a request scope, so a static import would make this module
 * unloadable in a unit test and would push every segment's test into a
 * framework harness to exercise one branch. The dynamic import keeps
 * `createApiClient` -- which is all of the behaviour -- reachable from a plain
 * `vitest` file, and confines the framework to the four lines that genuinely
 * need a request.
 *
 * THE SPECIFIER CARRIES `.js` AND IT WAS MEASURED RATHER THAN GUESSED.
 * `next@16.3.2`'s manifest declares NO `exports` map, `tsconfig.base.json` sets
 * `moduleResolution: NodeNext`, and this package is `"type": "module"`, so ESM
 * resolution performs no extension search: `next/headers` is
 * `error TS2307: Cannot find module`, watched, and `next/headers.js` resolves
 * under both `tsc --noEmit` and `node --input-type=module` (`cookies`,
 * `draftMode`, `headers`). THIS IS THE FIRST IMPORT OF `next` IN THIS
 * REPOSITORY, so the finding had not been paid for by anyone before.
 *
 * IT IS `await`ED BECAUSE `cookies()` IS ASYNCHRONOUS IN THE PINNED VERSION.
 * `next: 16.3.2` in `pnpm-workspace.yaml`'s catalog block; the synchronous form
 * was Next 14's and a caller written against it type-checks and returns a
 * promise where a cookie store was expected.
 *
 * A MISSING COOKIE IS NOT AN ERROR HERE. The request is made without one and
 * the API answers 401, which section 3 maps to `unauthenticated`. The
 * alternative -- refusing to make the call -- would put the portal in the
 * business of deciding who is signed in, which is `INV-M4-06` in the direction
 * nobody watches: the portal is not the authorization control and must never be
 * described as one (`FM-M4-03`).
 */
export async function serverApiClient(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ApiClient> {
  const origin = resolveApiOrigin(env);
  const { cookies } = await import('next/headers.js');
  const store = await cookies();
  return createApiClient({ origin, sessionToken: store.get(SESSION_COOKIE)?.value ?? null });
}
