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
 * API is has not been configured, and it fails here, at start, in one sentence.
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

/** What every segment in this application talks to. */
export interface ApiClient {
  /**
   * Read one endpoint.
   *
   * @param path an endpoint path as API_CONTRACT spells it, leading slash, with
   *   `API_BASE_PATH` NOT included. `/payouts`, not `/api/v1/payouts`.
   */
  readonly get: (path: string) => Promise<ApiResult>;
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
      if (!path.startsWith('/'))
        throw new ApiConfigError(
          `\`${path}\` is not an endpoint path. API_CONTRACT spells every path with a leading ` +
            `slash and without \`${API_BASE_PATH}\`, which this file appends`,
        );

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

      if (!response.ok)
        return { ok: false, error: toPortalErrorKind(response.status), status: response.status };

      try {
        return { ok: true, body: (await response.json()) as unknown };
      } catch {
        // A 2xx whose body is not JSON is a server that answered wrongly, and
        // it is `server_error` for the same reason a 500 is: the trader can do
        // nothing about it and no other member of the vocabulary is true. The
        // status is carried because there WAS one.
        return { ok: false, error: 'server_error', status: response.status };
      }
    },
  };
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
