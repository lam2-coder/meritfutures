// =============================================================================
// apps/api/test/advertised-status.test.ts -- CI-02, `unit`.
// =============================================================================
// WHAT STATUS DOES A ROUTE MODULE'S REFUSAL DOCBLOCK PROMISE, AND WHAT STATUS
// DOES THE REAL ROUTER RETURN? ADR-373. Three rows found the same defect one
// module at a time and each repaired only its own port: ADR-359 on certificate
// revocation, ADR-365 on the admin payout console, ADR-366 on the admin wallet.
// In every one the docblock gave the whole refusal class a single status and
// `principal` refused one statement earlier, so the status a request actually
// met was a different one. This file asks the question of every module at once
// and makes the answer a derived control rather than a fourth hand repair.
//
// -----------------------------------------------------------------------------
// THE TWO HALVES ARE DERIVED SEPARATELY AND NEITHER IS WRITTEN DOWN
// -----------------------------------------------------------------------------
// ADVERTISED is read out of the source: the doc comment above every refusal
// class a route module declares, with every three-digit status it AFFIRMS
// collected and every one it DENIES dropped. "Answered as 503, never 500"
// affirms one and denies one, and a check that read both would refuse a
// sentence that is doing exactly what it should.
//
// REACHABLE is read off the wire: every route every module registers, driven
// through `buildServer` and `app.inject` against the module-scope defaults this
// deployable ships, once with no cookie and once with a session. Nothing is
// stubbed except the auth backend, and that only so the routes BEHIND
// authentication can be reached at all; each module's own port is left holding
// whatever `start.ts` would have replaced.
//
// THE RULE IS A SUBSET AND NOT AN EQUALITY. A module may reach statuses no
// docblock names -- a 400 for a malformed body, a 404 for an address that names
// nothing -- and that is the contract working. What it may not do is PROMISE a
// status no request to it can meet, which is the whole of the defect three rows
// found.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE CANNOT PROVE
// -----------------------------------------------------------------------------
// It drives an in-process server holding the shipped defaults. It proves what
// THAT process answers. It proves nothing about a deployment that ran
// `start.ts`, and nothing about a PARTIAL install, which is exactly the state in
// which the admin modules' outer 503 leg becomes reachable. It also cannot see a
// status reached only behind a well-formed request body: `EXPLAINED_BY_A_BODY`
// carries the one module where that matters, with the suite that proves it.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import type { FastifyReply, FastifyRequest } from 'fastify';

import { discoverRouteModules } from '../src/index.ts';
import {
  ADMIN_PAYOUT_ENDPOINTS,
  AdminPayoutUnwired,
  adminPayoutHandler,
} from '../src/routes/admin-payouts.ts';
import {
  ADMIN_WALLET_ENDPOINTS,
  AdminWalletUnwired,
  adminWalletHandler,
} from '../src/routes/admin-wallet.ts';
import {
  ADMIN_WRITE_ENDPOINTS,
  AdminWriteUnwired,
  adminHandler,
} from '../src/routes/admin-writes.ts';
import {
  SESSION_COOKIE,
  UNWIRED_AUTH_BACKEND,
  resetAuthBackend,
  useAuthBackend,
} from '../src/routes/auth.ts';
import { buildServer } from '../src/server.ts';
import { BASE_PATH, surfaceServes } from '../src/surface.ts';
import type { AuthSession } from '../src/routes/auth.ts';
import type { RouteModule } from '../src/index.ts';

const ROUTES_DIR = join(import.meta.dirname, '..', 'src', 'routes');

// -----------------------------------------------------------------------------
// 1. THE SCOPE, DERIVED
// -----------------------------------------------------------------------------

const MODULES: readonly RouteModule[] = await discoverRouteModules();

/** Every route module's own source, keyed by the module name `compose` uses. */
const SOURCE = new Map<string, string>(
  MODULES.map((m) => [m.name, readFileSync(join(ROUTES_DIR, `${m.name}.ts`), 'utf8')]),
);

describe('the scope this file measures, derived rather than carried from a prompt', () => {
  it('is every route module on disk, and most of them talk about a 503', () => {
    // THE DISPATCH SAID "ROUGHLY 24" AND WAS EXPLICIT THAT THE NUMBER WAS ITS
    // OWN. It is derived here so a module joining the directory moves it.
    expect(MODULES.length).toBeGreaterThan(20);
    const mentioning = [...SOURCE.values()].filter((src) => src.includes('503')).length;
    expect(mentioning).toBeGreaterThan(0);
    expect(mentioning).toBeLessThan(MODULES.length);
    // The pin is the pair, so a module gained or a `503` dropped shows up as a
    // changed pair rather than as a number nobody can place.
    expect([MODULES.length, mentioning]).toStrictEqual([27, 24]);
  });
});

// -----------------------------------------------------------------------------
// 2. ADVERTISED: the status a refusal docblock affirms
// -----------------------------------------------------------------------------

/**
 * A refusal class by this tree's naming convention.
 *
 * `Unwired` is "no implementation was installed" and `Unconfigured` is "one was
 * installed and a value it needs is unset"; both are a deployment nobody
 * finished. TWO MODULES RAISE THEIR UNWIRED REFUSAL THROUGH A CLASS THAT FOLLOWS
 * NEITHER SPELLING and section 5 asserts them by name rather than widening this
 * pattern until it catches them, because a pattern widened to reach a known case
 * is a pattern that has stopped being a rule.
 */
const REFUSAL_CLASS = /^export class (\w*(?:Unwired|Unconfigured))\b/;

/** A three-digit response status, once registry ids and line pointers are gone. */
const STATUS = /\b([1-5]\d\d)\b/g;

/** The same shape without `g`, because `RegExp.test` on a global regex is stateful. */
const ANY_STATUS = /\b[1-5]\d\d\b/;

/**
 * Tokens that carry three digits and are not a status.
 *
 * `ADR-192` is a decision, `:392` is a line pointer, and both would otherwise
 * read as a status and make every sentence citing one advertise it.
 */
const NOT_A_STATUS = /\b[A-Z]{1,6}-\d+[\w-]*|:\d+(?:-\d+)?/g;

/** A status the sentence says it does NOT answer, so it is not a promise. */
const DENIED = /\b(?:never|not|rather than)\b[^.]{0,12}$/i;

/**
 * The leading decoration a block comment carries on each of its own lines.
 *
 * IT IS NOT A COMMENT STRIPPER AND IT IS SPELLED SO THAT NOBODY HAS TO TAKE
 * THAT ON TRUST. `RI-30` refuses a `.replace()` written over a block-comment
 * opener, on the measurement in its own header: two replacements cannot strip
 * comments, because an opener inside a line comment opens a phantom block. That
 * check went RED on this file's first draft and it was right to look. What runs
 * here is the opposite operation -- the docblock has ALREADY been located and
 * this removes the ` * ` rail from inside it so the prose reads as prose -- and
 * `stripComments` is the wrong tool for it, since it would delete the very text
 * this file exists to read.
 */
const DOC_RAIL = /^[ \t]*[*/]+/gm;

/** The block comment immediately above a line, or `''`. */
function docblockAbove(lines: readonly string[], index: number): string {
  const end = index - 1;
  if (!/\*\/\s*$/.test(lines[end] ?? '')) return '';
  let start = end;
  while (start >= 0 && !/^\s*\/\*\*/.test(lines[start] ?? '')) start -= 1;
  if (start < 0) return '';
  return lines.slice(start, end + 1).join('\n');
}

/**
 * Every status a docblock AFFIRMS, with the denied ones dropped.
 *
 * THE PROMISE IS THE FIRST PARAGRAPH THAT NAMES A STATUS, AND THE REST OF THE
 * BLOCK IS ARGUMENT. That is a measurement rather than a convenience: read
 * whole, `account-reads.ts` promises a 500 in a clause explaining what would
 * happen if a sibling class ESCAPED the catch, `economic-calendar.ts` promises
 * one in a sentence contrasting the two answers, and `certificates.ts` promises
 * a 200 and a 404 in a paragraph about which caller could reach which. None of
 * the five is a promise and a reader who acted on them would be misled by this
 * file rather than by the tree. The summary paragraph alone would be the
 * narrower rule and it loses `catalog.ts`, whose status sentence is the second
 * paragraph and is the sharpest finding here.
 */
function affirmed(docblock: string): readonly number[] {
  const paragraphs = docblock
    .replace(NOT_A_STATUS, ' ')
    .split(/\n\s*\*\s*\n/)
    .map((part) => part.replace(DOC_RAIL, ' '));
  for (const prose of paragraphs) {
    const out = new Set<number>();
    for (const match of prose.matchAll(STATUS)) {
      if (DENIED.test(prose.slice(0, match.index))) continue;
      out.add(Number(match[1]));
    }
    if (out.size > 0) return [...out].sort((a, b) => a - b);
    // A PARAGRAPH WHOSE ONLY STATUSES ARE DENIED STOPS THE WALK TOO, or a
    // sentence saying "never a 500" would hand the next paragraph the promise.
    if (ANY_STATUS.test(prose)) return [];
  }
  return [];
}

interface Advertised {
  readonly module: string;
  readonly klass: string;
  readonly statuses: readonly number[];
}

/** Every refusal class in every route module, with what its docblock promises. */
function advertisedTable(): readonly Advertised[] {
  const out: Advertised[] = [];
  for (const [module, src] of SOURCE) {
    const lines = src.split('\n');
    for (const [i, line] of lines.entries()) {
      const klass = REFUSAL_CLASS.exec(line)?.[1];
      if (klass === undefined) continue;
      out.push({ module, klass, statuses: affirmed(docblockAbove(lines, i)) });
    }
  }
  return out;
}

const ADVERTISED = advertisedTable();

describe('the advertised half, parsed out of the docblocks themselves', () => {
  it('finds a refusal class in most modules and reads one promise from each', () => {
    expect(ADVERTISED.length).toBe(21);
    expect(new Set(ADVERTISED.map((row) => row.module)).size).toBe(17);
  });

  it('drops the status a sentence DENIES, which is the half a naive read gets wrong', () => {
    // THIS CASE IS THE PARSER DEFENDING ITSELF ON SHAPES THAT ARE IN THE TREE.
    // Every string below is a sentence a route module carries or carried, and a
    // reader that collected both numerals would refuse `accounts.ts` for saying
    // exactly what it should say.
    expect(affirmed('/** Answered as 503, never 500. */')).toStrictEqual([503]);
    expect(affirmed('/** Answered as 503 rather than 500. */')).toStrictEqual([503]);
    expect(affirmed('/** Answered 503, never a 500. */')).toStrictEqual([503]);
    expect(affirmed('/** A 503 and not a 404. */')).toStrictEqual([503]);
    expect(affirmed('/** becomes a 500 rather than a 4xx it invents. */')).toStrictEqual([500]);
    // A PERIOD ENDS THE DENIAL'S REACH, or "its origin is not usable. 503" reads
    // as a denial of the 503 it affirms. `certificates.ts` carries that shape.
    expect(
      affirmed('/** installed and its origin is not usable. 503, never 500. */'),
    ).toStrictEqual([503]);
    // AND A DECISION NUMBER IS NOT A STATUS. Without this the four modules
    // ADR-373 repaired would advertise `192` and `373` as well as `401`.
    expect(affirmed('/** meets 401 (ADR-192 clause 2), ADR-373. */')).toStrictEqual([401]);
  });

  it('reads no promise at all from a docblock that names no status', () => {
    // NON-VACUITY IN THE OTHER DIRECTION. A parser that returned a status for
    // everything would make the subset rule below trivially satisfiable.
    expect(
      affirmed('/** Raised when the source is wired and the horizon is unset. */'),
    ).toStrictEqual([]);
    expect(affirmed('')).toStrictEqual([]);
  });
});

// -----------------------------------------------------------------------------
// 3. REACHABLE: the status the real router returns
// -----------------------------------------------------------------------------

const TOKEN = 'advertised-status-373';

/**
 * A session the auth backend hands back, so routes behind authentication are
 * reached at all.
 *
 * ELEVATED, because an endpoint declaring an elevated factor would otherwise
 * answer 403 and its own port would never be consulted. This is the ONLY thing
 * stubbed anywhere in this file.
 */
const SESSION: AuthSession = {
  id: '0199c7a1-3333-7000-8000-000000000373',
  identityId: '0199c7a1-2222-7000-8000-000000000373',
  userId: '0199c7a1-4444-7000-8000-000000000373',
  authFactor: 'passkey',
  elevatedAt: '2026-09-06T00:00:00.000Z',
  elevatedByFactor: 'passkey',
};

const UUID = '11111111-1111-4111-8111-111111111111';

/** Every status one module's own routes answer, on both surfaces, derived. */
async function reachableStatuses(): Promise<ReadonlyMap<string, readonly number[]>> {
  useAuthBackend({
    ...UNWIRED_AUTH_BACKEND,
    sessionByToken: (token: string) => Promise.resolve(token === TOKEN ? SESSION : null),
  });
  const seen = new Map<string, Set<number>>();
  for (const surface of ['public', 'operator'] as const) {
    for (const module of MODULES) {
      const routes = module.routes.filter((route) => surfaceServes(surface, route.path));
      if (routes.length === 0) continue;
      const { app } = buildServer({ surface, modules: [module] });
      for (const route of routes) {
        const url = BASE_PATH + route.path.replace(/:[A-Za-z]+/g, UUID);
        for (const cookie of [null, `${SESSION_COOKIE}=${TOKEN}`]) {
          const response = await app.inject({
            method: route.method,
            url,
            headers: cookie === null ? {} : { cookie },
            ...(route.method === 'POST' ? { payload: {} } : {}),
          });
          const held = seen.get(module.name) ?? new Set<number>();
          held.add(response.statusCode);
          seen.set(module.name, held);
        }
      }
      await app.close();
    }
  }
  return new Map([...seen].map(([name, set]) => [name, [...set].sort((a, b) => a - b)]));
}

const REACHABLE = await reachableStatuses();

afterAll(() => {
  resetAuthBackend();
});

describe('the reachable half, driven through the router this deployable composes', () => {
  it('answers every registered route, so no module is silently missing from the table', () => {
    for (const module of MODULES)
      expect([module.name, REACHABLE.has(module.name)]).toStrictEqual([module.name, true]);
    for (const [name, statuses] of REACHABLE)
      expect([name, statuses.length > 0]).toStrictEqual([name, true]);
  });

  it('answers 401 and nothing else on all four admin modules that hold a refusing default', () => {
    // THE MEASUREMENT THE THREE PRIOR ROWS EACH MADE ON ONE MODULE, MADE ON ALL
    // FOUR AT ONCE. `principal` is the first member touched on every route of
    // every one of them, and its refusal is a 401 by ADR-192 clause 2.
    for (const name of ['admin-certificates', 'admin-payouts', 'admin-wallet', 'admin-writes'])
      expect([name, REACHABLE.get(name)]).toStrictEqual([name, [401]]);
  });
});

// -----------------------------------------------------------------------------
// 4. THE RULE, AND THE TWO EXCEPTIONS THAT ARE NAMED RATHER THAN QUIET
// -----------------------------------------------------------------------------

/**
 * A status a module reaches only behind a well-formed body, with what proves it.
 *
 * `checkout.ts`'s two rows validate before they consult the port, so a probe
 * sending an empty body is answered 400 and never reaches the backend at all.
 * The 503 is real and `apps/api/test/checkout.test.ts` drives it with a body
 * that parses. THIS IS AN EXPLANATION AND NOT AN EXEMPTION: the status is
 * named, so a module that started promising a different one still fails.
 */
const EXPLAINED_BY_A_BODY: ReadonlyMap<string, number> = new Map([['checkout', 503]]);

/**
 * A module whose docblock and whose wire disagree, WHERE ADR-373 RULED THE
 * HANDLER THE WRONG SIDE AND SO LEFT THE DOCBLOCK ALONE.
 *
 * `catalog.ts` is the only one. Its class is caught by nothing at all, so the
 * error handler in `server.ts` answers `internal_error` on all three of its
 * rows, and the docblock's argument for the other status is the argument
 * `economic-calendar.ts`, `verify.ts` and `certificates.ts` all act on. A catch
 * is behaviour and ADR-373 changes none, so the disagreement is PINNED here
 * instead: the day somebody adds the catch this case goes red and the entry
 * comes out, which is the only way an exception expires by itself.
 */
const RULED_HANDLER_WRONG: ReadonlyMap<
  string,
  { readonly promised: number; readonly met: number }
> = new Map([['catalog', { promised: 503, met: 500 }]]);

describe('the rule: a module may not promise a status no request to it can meet', () => {
  it('holds for every module but the one ADR-373 ruled the handler wrong on', () => {
    const broken: string[] = [];
    for (const row of ADVERTISED) {
      if (RULED_HANDLER_WRONG.has(row.module)) continue;
      const reachable = REACHABLE.get(row.module) ?? [];
      const excused = EXPLAINED_BY_A_BODY.get(row.module);
      for (const status of row.statuses)
        if (!reachable.includes(status) && status !== excused)
          broken.push(`${row.module}: ${row.klass} promises ${String(status)}`);
    }
    expect(broken).toStrictEqual([]);
  });

  it('and the exception is asserted to be REAL, so it cannot outlive the defect', () => {
    // FAILING ON GOOD NEWS IS THE POINT. If a later row gives `CatalogUnwired` a
    // catch, this case reddens and the entry above must be deleted rather than
    // inherited. An exception nothing re-checks is an exemption list.
    for (const [module, { promised, met }] of RULED_HANDLER_WRONG) {
      const reachable = REACHABLE.get(module) ?? [];
      expect([module, reachable.includes(met)]).toStrictEqual([module, true]);
      expect([module, reachable.includes(promised)]).toStrictEqual([module, false]);
      const promises = ADVERTISED.filter((row) => row.module === module).flatMap(
        (row) => row.statuses,
      );
      expect([module, promises]).toStrictEqual([module, [promised]]);
    }
  });

  it('and the body-shaped explanation is asserted to be needed, not decorative', () => {
    // The same discipline one exception over. If `checkout.ts` ever answers its
    // own 503 to a probe with no body, this entry is no longer buying anything
    // and must go.
    for (const [module, status] of EXPLAINED_BY_A_BODY) {
      const reachable = REACHABLE.get(module) ?? [];
      expect([module, reachable.includes(status)]).toStrictEqual([module, false]);
      const promises = ADVERTISED.filter((row) => row.module === module).flatMap(
        (row) => row.statuses,
      );
      expect([module, promises.includes(status)]).toStrictEqual([module, true]);
    }
  });
});

// -----------------------------------------------------------------------------
// 5. THE THREE MODULES THAT ANSWER 500, AND WHY ONLY ONE OF THEM IS A FINDING
// -----------------------------------------------------------------------------

describe('the modules whose unwired refusal reaches the error handler', () => {
  it('are exactly three, derived off the wire rather than listed', () => {
    const answering500 = [...REACHABLE]
      .filter(([, statuses]) => statuses.includes(500))
      .map(([name]) => name)
      .sort();
    expect(answering500).toStrictEqual(['catalog', 'internal', 'public-methods']);
  });

  it('and two of the three ARGUE for it in their own source, which is why they are not the finding', () => {
    // `internal.ts` and `public-methods.ts` each chose this answer and wrote
    // down why: a 503 invites a retry against a process that will never succeed.
    // NEITHER NAMES ITS CLASS `Unwired`, so neither is in section 2's population
    // and both are asserted here by name instead of by a widened pattern.
    const internal = SOURCE.get('internal') ?? '';
    const methods = SOURCE.get('public-methods') ?? '';
    expect(internal).toContain('AN UNSET PORT IS A 500 AND NOT A 503');
    expect(methods).toContain('does not answer 503');
    expect(internal).toContain('class InternalOpsError');
    expect(methods).toContain('class MethodPageError');
    expect(ADVERTISED.some((row) => row.module === 'internal')).toBe(false);
    expect(ADVERTISED.some((row) => row.module === 'public-methods')).toBe(false);
  });

  it('while `catalog.ts` argues the other way and is caught by nothing', () => {
    // THE DIFFERENCE BETWEEN A DECISION AND AN OMISSION, ASSERTED. The other
    // twenty modules that raise a refusal class convert it somewhere; this one
    // has no catch site anywhere in the deployable, which is why ADR-373 rules
    // the handler wrong here and ruled the docblock wrong on the admin four.
    const anywhere = [...SOURCE.values()].join('\n');
    expect(anywhere).toContain('class CatalogUnwired');
    expect(anywhere).not.toContain('instanceof CatalogUnwired');
    expect(REACHABLE.get('catalog')).toContain(500);
  });
});

// -----------------------------------------------------------------------------
// 6. THE CHANNEL, WHERE THE WIRE IS DELIBERATELY MUTE
// -----------------------------------------------------------------------------
// ADR-359 held this for `admin-certificates.ts` with four cases and measured
// that nothing executed had been holding it: the 401 is byte-identical to the
// document an anonymous caller receives, so `request.log.error` is the ONLY
// place the fact that this deployment installed no backend exists. THE OTHER
// THREE MODULES CARRY THE SAME LINE AND NOTHING HOLDS ANY OF THEM. A refactor
// dropping one leaves that surface with no channel at all and every case in this
// tree green.

interface Driven {
  readonly sent: readonly unknown[];
  readonly logged: readonly { readonly err?: unknown }[];
}

/** Run one admin handler against the shipped default and record both channels. */
async function driveAdmin(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
): Promise<Driven> {
  const sent: unknown[] = [];
  const logged: { readonly err?: unknown }[] = [];
  const reply = {
    code: () => reply,
    type: () => reply,
    send: (body: unknown) => {
      sent.push(body);
      return reply;
    },
  } as unknown as FastifyReply;
  const request = {
    id: 'req-373',
    params: { id: UUID, accountId: UUID, identityId: UUID, flagId: UUID, planId: UUID },
    query: {},
    body: {},
    ip: '203.0.113.7',
    headers: {},
    log: {
      error: (payload: { readonly err?: unknown }) => {
        logged.push(payload);
      },
    },
  } as unknown as FastifyRequest;
  await handler(request, reply);
  return { sent, logged };
}

describe('the log line that is the only channel, held on the three modules that had nobody holding it', () => {
  const cases = [
    {
      name: 'admin-payouts',
      spec: ADMIN_PAYOUT_ENDPOINTS[0],
      handler: adminPayoutHandler,
      klass: AdminPayoutUnwired,
      member: 'AdminPayoutBackend.principal',
      setter: 'useAdminPayoutBackend',
    },
    {
      name: 'admin-wallet',
      spec: ADMIN_WALLET_ENDPOINTS[0],
      handler: adminWalletHandler,
      klass: AdminWalletUnwired,
      member: 'AdminWalletBackend.principal',
      setter: 'useAdminWalletBackend',
    },
    {
      name: 'admin-writes',
      spec: ADMIN_WRITE_ENDPOINTS[0],
      handler: adminHandler,
      klass: AdminWriteUnwired,
      member: 'AdminWriteBackend.principal',
      setter: 'useAdminWriteBackend',
    },
  ] as const;

  for (const entry of cases)
    it(`${entry.name} logs the refusal once, naming the member and the setter`, async () => {
      const spec = entry.spec;
      if (spec === undefined) throw new Error(`${entry.name} declares no endpoint`);
      // The cast is the price of driving three differently typed handler
      // factories through one case. Each is called with its OWN spec, so no
      // handler is ever handed a spec from another module.
      const build = entry.handler as unknown as (
        s: unknown,
      ) => (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
      const { sent, logged } = await driveAdmin(build(spec));

      expect(sent).toHaveLength(1);
      expect((sent[0] as { readonly status?: unknown }).status).toBe(401);
      // ONE ENTRY, CARRYING THE ERROR ITSELF rather than a rewritten string, so
      // the sentence an operator reads is the one the class composes.
      expect(logged).toHaveLength(1);
      const err = logged[0]?.err;
      expect(err).toBeInstanceOf(entry.klass);
      expect((err as Error).message).toContain(entry.member);
      expect((err as Error).message).toContain(entry.setter);
    });

  it('and the document it answers carries no hint of the port, which is what makes the log load bearing', () => {
    // ADR-192 clause 2 as an executed fact. The four admin modules answer the
    // five keys of section 2 and nothing else; a `detail` naming the port would
    // fail here and re-argue the disclosure rather than drift through it.
    for (const name of ['admin-certificates', 'admin-payouts', 'admin-wallet', 'admin-writes']) {
      const src = SOURCE.get(name) ?? '';
      expect([
        name,
        src.includes("handlerProblem('unauthenticated', 'Unauthenticated', 401"),
      ]).toStrictEqual([name, true]);
      expect([name, src.includes('request.log.error')]).toStrictEqual([name, true]);
    }
  });
});
