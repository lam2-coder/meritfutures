import { expect, test } from 'vitest';

import type { SessionRow } from '../src/api/types.ts';
import {
  GAPS,
  REQUIRED_ENDPOINTS,
  SESSIONS_PATH,
  isSessionList,
  loadFrom,
} from '../src/app/security/source.ts';
import { API_BASE_PATH, SESSION_COOKIE, createApiClient } from '../src/http/client.ts';
import type { Transport } from '../src/http/client.ts';

// =============================================================================
// SC-M4-11's SEAM, THROUGH THE REAL CLIENT
// =============================================================================
// Same rule as every other source suite in this application: the assertions go
// through the real `createApiClient` over a stub transport rather than through a
// mock of the client, because a mock would only prove that `loadFrom` calls a
// function.

const ORIGIN = 'https://api.example.com';

const ROW: SessionRow = {
  id: '0199a1c4-0000-7000-8000-000000000001',
  auth_factor: 'passkey',
  elevated: true,
  created_at: '2026-08-28T08:00:00Z',
  last_seen_at: '2026-08-28T09:30:00Z',
  user_agent_family: 'Chrome on macOS',
  is_current: true,
};

function serving(
  body: unknown,
  status = 200,
): { readonly transport: Transport; readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    transport: (url, init) => {
      calls.push(url);
      void init;
      return Promise.resolve(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  };
}

test('the ready branch is reached through a real request', async () => {
  const { transport, calls } = serving([ROW]);
  const client = createApiClient({ origin: ORIGIN, sessionToken: 'tok_abc', transport });

  const loaded = await loadFrom({ client });

  expect(loaded.kind).toBe('ready');
  if (loaded.kind !== 'ready') throw new Error('unreachable');

  expect(loaded.view.sessions).toHaveLength(1);
  expect(loaded.view.sessions[0]!.factor_label).toBe('Passkey');

  // THE GAPS TRAVEL WITH THE READY BRANCH, so a screen that CAN list sessions
  // still says what it cannot show. They are not an error state.
  expect(loaded.view.gaps).toEqual(GAPS);

  expect(calls).toEqual([`${ORIGIN}${API_BASE_PATH}${SESSIONS_PATH}`]);
});

test('the trader’s session cookie is forwarded', async () => {
  const headers: Record<string, string>[] = [];
  const transport: Transport = (_url, init) => {
    headers.push({ ...(init.headers as Record<string, string>) });
    return Promise.resolve(
      new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  };

  const client = createApiClient({ origin: ORIGIN, sessionToken: 'tok_abc', transport });
  await client.get(SESSIONS_PATH);

  expect(headers[0]!['cookie']).toBe(`${SESSION_COOKIE}=tok_abc`);
});

test('a refusal is unavailable and names the endpoint', async () => {
  for (const status of [401, 403, 500, 503]) {
    const { transport } = serving({ type: 'about:blank' }, status);
    const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport });

    const loaded = await loadFrom({ client });

    expect(loaded.kind, `status ${String(status)}`).toBe('unavailable');
    if (loaded.kind !== 'unavailable') throw new Error('unreachable');
    expect(loaded.missing).toEqual([...REQUIRED_ENDPOINTS]);
  }
});

test('an empty list from a 200 is a real answer and not an absence', () => {
  // A TRADER SIGNED IN ON ONE DEVICE ONLY IS A NORMAL STATE. The server always
  // includes the caller's own session, so a truly empty array is unusual, but
  // it is a successful read either way and must not render as a fault: the
  // unavailable arm exists for a read that did not answer, and this one did.
  expect(isSessionList([])).toBe(true);
});

// -----------------------------------------------------------------------------
// The guard
// -----------------------------------------------------------------------------

test('the guard accepts the contract’s shape, on every factor', () => {
  // THE ACCEPTANCE CASE FIRST, and across the WHOLE closed union rather than one
  // member, because a guard that accidentally special-cased one factor would
  // pass a single-member probe. The dispatch protocol asks for exactly this:
  // "a probe that only ever attempts forbidden things passes against a guard
  // that rejects everything".
  expect(isSessionList([ROW])).toBe(true);
  expect(isSessionList([{ ...ROW, auth_factor: 'sms_otp' }])).toBe(true);
  expect(isSessionList([{ ...ROW, auth_factor: 'email_otp' }])).toBe(true);
  expect(isSessionList([{ ...ROW, elevated: false, is_current: false }])).toBe(true);
});

test('the guard refuses a factor the database CHECK does not carry', () => {
  // `auth_factor` is a closed three-member CHECK in `0029` and `SD-M4-04` makes
  // its membership the enforcement of C-27. `password` is the value worth naming
  // here: there is no password table in this schema at all (ADR-039, 0002:280),
  // so a row claiming one is a server this screen must not render.
  expect(isSessionList([{ ...ROW, auth_factor: 'password' }])).toBe(false);
  expect(isSessionList([{ ...ROW, auth_factor: 'totp' }])).toBe(false);
});

test('the guard refuses a missing is_current rather than coercing it', () => {
  // THIS IS THE ASSERTION THAT MATTERS MOST IN THIS FILE. `undefined` is falsy,
  // so a response that dropped `is_current` would coerce to "not the current
  // session" and the screen would offer the trader a revoke control for the very
  // session they are reading it on. Checked as a boolean, so it cannot.
  const without: Record<string, unknown> = { ...ROW };
  delete without['is_current'];
  expect(isSessionList([without])).toBe(false);

  expect(isSessionList([{ ...ROW, is_current: 'true' }])).toBe(false);
});

test('the guard refuses a missing elevated rather than coercing it', () => {
  // The same shape, and the coercion here would fail SAFE (a missing `elevated`
  // reads as not elevated). It is still refused, because a response that lost
  // one boolean has lost the other kind too and this screen should not guess
  // which.
  const without: Record<string, unknown> = { ...ROW };
  delete without['elevated'];
  expect(isSessionList([without])).toBe(false);
});

test('the guard refuses a partial row rather than rendering a blank cell', () => {
  for (const field of ['id', 'created_at', 'last_seen_at', 'user_agent_family']) {
    const partial: Record<string, unknown> = { ...ROW };
    delete partial[field];
    expect(isSessionList([partial]), `${field} missing must be refused`).toBe(false);
  }
});

test('the guard refuses an envelope, because this endpoint returns a bare array', () => {
  // `GET /sessions` is declared in API_CONTRACT section 3.1 as a bare array and
  // NOT as section 1's `{ data, next_cursor }` envelope. A guard that accepted
  // both would hide a server that started paging without the contract moving.
  expect(isSessionList({ data: [ROW], next_cursor: null })).toBe(false);
});
