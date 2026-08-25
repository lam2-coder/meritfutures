// =============================================================================
// apps/api/src/server.ts
// =============================================================================
// The Fastify instance, built from a surface and a set of route modules.
//
// IT TAKES THE MODULES AS AN ARGUMENT AND DISCOVERS NOTHING. Discovery reads
// the filesystem, which a test cannot vary and a caller cannot substitute; the
// composition is the part worth asserting on, so it is the part that is pure
// over its inputs. `main` in `index.ts` is where the two meet.
//
// -----------------------------------------------------------------------------
// THE ERROR MODEL HERE IS THE TRANSPORT'S TWO AND IS NOT THE CONTRACT'S SIXTEEN
// -----------------------------------------------------------------------------
// API_CONTRACT section 1 requires `application/problem+json` for errors and
// section 2 defines sixteen canonical codes. FOURTEEN OF THE SIXTEEN BELONG TO
// A HANDLER, and no handler in this tree computes anything: `payout_not_eligible`
// carries a gate breakdown, `idempotency_key_reuse` compares a stored body,
// `geo_restricted` reads a jurisdiction. Writing them here would be a
// transcription of a contract into a layer that cannot satisfy it.
//
// What IS the transport's, and is therefore here, is the pair the framework
// itself produces with no handler involved: the 404 for a path nothing
// registered, and the 500 for a handler that threw. THE FIRST OF THE TWO IS THE
// ONE ADR-083 RESTS ON. Its section 4 reads API_CONTRACT section 12's matrix,
// where a trader session calling `/internal/*` from the public origin gets 404
// rather than 403, and rules that the 404 must be the ROUTER's. Left to
// Fastify's default that 404 arrives as `{"message":"Route GET:/api/v1/...
// not found","error":"Not Found","statusCode":404}`, which is neither the
// contract's media type nor its shape and which names the framework and the
// path back to the caller. So the not-found handler is the smallest thing that
// makes ADR-083's structural claim also a contract-shaped one.
//
// A STATUS THIS FILE HAS NO CANONICAL CODE FOR BECOMES 500 AND IS LOGGED WITH
// ITS ORIGINAL STATUS. `STATUS_CODE` below is closed over section 2's table,
// so a 415 or a 405 does not silently acquire an invented code; it is reported
// as an `internal_error` with the real status in the log, which is a defect
// somebody can find. No route accepts a request body yet, so nothing in this
// tree can produce either one.
// =============================================================================

import Fastify from 'fastify';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { compose } from './registry.ts';
import type { CompositionReport, RouteModule } from './registry.ts';
import type { ApiSurface } from './surface.ts';

/**
 * The problem-document type URI prefix, API_CONTRACT section 2.
 *
 * `meritfutures.com` is the contract's own literal and is a namespace rather
 * than a fetched resource, so it is not the deployment hostname ADR-012 keeps
 * out of this repository.
 */
export const PROBLEM_TYPE_PREFIX = 'https://meritfutures.com/problems/';

/** API_CONTRACT section 2's media type for every error response. */
export const PROBLEM_MEDIA_TYPE = 'application/problem+json';

/**
 * The canonical codes of section 2 that a request can reach without a handler.
 *
 * CLOSED, and a status that is not a key here becomes `internal_error` rather
 * than acquiring a code this table does not define. Section 2's remaining
 * eleven codes are all 4xx or 422 answers a handler computes.
 */
const STATUS_CODE: Readonly<Record<number, string>> = {
  400: 'validation_failed',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  429: 'rate_limited',
};

/** Short human summary per code, section 2's `title`. Stable by contract. */
const TITLE: Readonly<Record<string, string>> = {
  validation_failed: 'Validation failed',
  unauthenticated: 'Unauthenticated',
  forbidden: 'Forbidden',
  not_found: 'Not found',
  conflict: 'Conflict',
  rate_limited: 'Rate limited',
  internal_error: 'Internal error',
};

/** An RFC 9457 problem document, API_CONTRACT section 2's `Problem`. */
export interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly instance: string;
}

/**
 * Build a problem document.
 *
 * `instance` is the request id, section 2's *"request id for support
 * correlation"*. `detail` is deliberately never set by this file: section 2
 * says it "never leaks internals or other users' data", and the only detail
 * available at the transport is the framework's own message about the path.
 */
export function problem(code: string, status: number, instance: string): Problem {
  return {
    type: `${PROBLEM_TYPE_PREFIX}${code}`,
    title: TITLE[code] ?? code,
    status,
    code,
    instance,
  };
}

function sendProblem(reply: FastifyReply, p: Problem): FastifyReply {
  return reply.code(p.status).type(PROBLEM_MEDIA_TYPE).send(p);
}

/** What `buildServer` needs. Both fields are required; neither has a safe default. */
export interface ServerOptions {
  readonly surface: ApiSurface;
  readonly modules: readonly RouteModule[];
  /** Off by default so a test's output is its assertions. `main` turns it on. */
  readonly logger?: boolean;
}

/** A built server, with the report of what it composed. */
export interface BuiltServer {
  readonly app: FastifyInstance;
  readonly report: CompositionReport;
}

/**
 * Build the server for one surface out of one set of modules.
 *
 * Registration is the LAST thing that happens, after both handlers are set, so
 * there is no window in which a request could reach Fastify's own error shape.
 */
export function buildServer(options: ServerOptions): BuiltServer {
  const app = Fastify({ logger: options.logger ?? false });

  // ADR-083's 404, in the contract's shape. Reached only because nothing was
  // registered at this path: this is not a check and there is nothing here to
  // decide.
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) =>
    sendProblem(reply, problem('not_found', 404, request.id)),
  );

  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    const code = STATUS_CODE[status];
    if (code === undefined) {
      // The original status goes in the log rather than in the response,
      // because the response may not carry a code section 2 does not define.
      request.log.error({ err: error, status }, 'unmapped error status, answering internal_error');
      return sendProblem(reply, problem('internal_error', 500, request.id));
    }
    return sendProblem(reply, problem(code, status, request.id));
  });

  const report = compose(app, options.surface, options.modules);
  return { app, report };
}
