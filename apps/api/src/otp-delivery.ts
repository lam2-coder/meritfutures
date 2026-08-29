// =============================================================================
// apps/api/src/otp-delivery.ts
// =============================================================================
// THE BLOCKER THAT OUTLIVED TWENTY-SIX WAVES: `NOTHING IN THIS DEPLOYABLE
// DELIVERS A CODE`.
//
// `auth-backend.ts` refused `requestOtp` with that sentence, and the sentence
// was true: a search for a mail or SMS vendor over `apps`, `packages`, `e2e`,
// `scripts` and `.github` matched nothing at all. `verifyOtp` has been wired
// since ADR-200, so a trader could verify a code this deployment had no way to
// send them. This file is the send, and ADR-229 is the entry that rules it.
//
// -----------------------------------------------------------------------------
// THE SHAPE IS `turnstile.ts`'s AND THE COPY IS DELIBERATE
// -----------------------------------------------------------------------------
// ADR-226 landed one wave earlier and settled every question this file would
// otherwise re-open: an outcome union rather than a boolean, an absent secret
// that REFUSES rather than passing, one deadline and no retry, a vendor's own
// error vocabulary that reaches the LOG and never a branch, and a
// `Exclude<..., 'sent'>` refusal type at the call site so a fifth outcome member
// is a `tsc` error rather than an unhandled case. Where this file departs from
// that one it says so and why; everywhere else the two read alike on purpose,
// because two controls on one route that fail closed differently are two
// controls a reader has to hold separately in their head.
//
// -----------------------------------------------------------------------------
// NO TOKEN, NO ACCOUNT, NO SENDER ADDRESS AND NO PRICE IS WRITTEN HERE (ADR-012)
// -----------------------------------------------------------------------------
// {@link POSTMARK_SEND_URL} is a PUBLIC, tenant-agnostic vendor endpoint and is
// a constant for `TURNSTILE_SITEVERIFY_URL`'s reason exactly: it is a fact about
// a vendor's API rather than a fact about a deployment, and an environment
// variable there would be a way to point the sender somewhere that swallows
// mail. Everything that identifies MERIT is a variable NAMED here and VALUED
// nowhere in this repository: {@link OTP_EMAIL_TOKEN_VAR},
// {@link OTP_EMAIL_FROM_VAR} and {@link OTP_SMS_PRICE_CENTS_VAR}.
//
// -----------------------------------------------------------------------------
// THE VENDOR, AND WHY IT IS POSTMARK RATHER THAN AMAZON SES
// -----------------------------------------------------------------------------
// The channel that signs a trader in is EMAIL and not SMS -- `verifyOtp` refuses
// `sms` outright -- so the vendor decision that matters here is a mail vendor,
// and it was taken on four criteria rather than defaulted. ADR-229 section 2
// carries the full weighing; the two that decide it are stated here because
// they are properties of THIS FILE:
//
//   1. POSTMARK IS ONE `fetch` AND SES IS A DEPENDENCY. A Postmark send is a
//      JSON POST carrying a token in a header, which is `turnstile.ts`'s call
//      shape with a different body. Amazon SES authenticates with SigV4, so it
//      is either `@aws-sdk/client-ses` -- a VG-12 admission with an entry of its
//      own, which is the sentence `NO_WEBAUTHN` already uses to refuse a
//      dependency on this same path -- or a hand-rolled request signer on the
//      sign-in path. Neither is a line in a delivery slice.
//   2. THE CREDENTIAL SCOPES TO SENDING. A Postmark server token sends from one
//      server and cannot manage the account, the domains or the other servers;
//      the account token that can is a DIFFERENT credential and this deployment
//      is never given one. That is the tightest reading of "a key scoped to
//      sending alone" available without writing an IAM policy.
//
// -----------------------------------------------------------------------------
// THE PER-SEND PRICE IS CONFIG, AND IT IS THE SMS BRANCH'S ALONE
// -----------------------------------------------------------------------------
// The second half of the old refusal was a price: an SMS send charges
// `otp_send_budget.spend_cents` and this tree had no source for the number. Two
// rulings, and ADR-229 section 3 argues both.
//
// THE EMAIL BRANCH CHARGES NOTHING AND THAT IS THE SCHEMA'S OWN DESIGN.
// `0029_phone_identity_and_auth.sql:388` admits four scope kinds -- `phone`,
// `ip`, `country`, `global` -- and no `email`, and its own header says the cost
// breaker is `global` "because Merit's SMS bill is one number". API_CONTRACT
// section 11 rows the email channel as prose velocity with no cost half at all.
// So the price is not a precondition of the branch this file wires, and the
// cost half of the old blocker survives on the branch it was always about.
//
// THE PRICE IS AN INTEGER-CENTS ENVIRONMENT VARIABLE AND NEVER A CONSTANT.
// {@link OTP_SMS_PRICE_CENTS_VAR} is NAMED here and unset everywhere, and
// {@link resolveOtpSmsPriceCents} is total over what a deployment can put in it.
// A per-send price is not one number: it varies by destination country, by
// carrier surcharge and by contract, and a figure compiled into a file is a
// figure that is wrong for every destination but one and stale the day the
// vendor's table moves. `spend_cents` is `bigint` INTEGER CENTS, so the
// configured value is integer cents too and a decimal point is REFUSED rather
// than rounded here: rounding is a policy about money and it belongs to whoever
// sets the value, stated once in that variable, rather than to a parser.
//
// THE ROUNDING DIRECTION IS THE RULING AND IT IS UP. A real per-message price is
// a fraction of a cent, and truncating it to zero would leave a cost breaker
// that counts every send as free and therefore never trips, which is a
// fail-open control wearing the costume of an enforced budget. Over-stating
// trips the breaker EARLY, and `otp_send_budget` DEGRADES rather than stopping
// (`0029` header item 2), so an early trip defers a verification and a late one
// pays an unbounded bill.
//
// -----------------------------------------------------------------------------
// FOUR OUTCOMES, AND THREE OF THEM REFUSE
// -----------------------------------------------------------------------------
// `sent` is the only one that admits. The other three are three different facts
// about the world, kept apart for the OPERATOR and not for the caller:
//
//   `rejected`     the vendor read the message and would not take it. A refused
//                  address, a token it will not accept, a body it will not
//                  parse.
//   `unconfigured` this deployment holds no credential, or no sender address,
//                  or no sender at all for the channel asked for. Merit's
//                  problem, and never a send.
//   `unavailable`  the call did not complete, or came back in a shape this file
//                  cannot read. Nobody's problem and still not a send.
//
// WHY `rejected` IS NOT TOLD TO THE CALLER, WHICH IS THE ONE PLACE THIS FILE'S
// CALLER DIFFERS FROM ADR-226's. Turnstile's `failed` becomes a 403 because the
// caller holds the token and can solve the challenge again. A rejected
// DESTINATION is different: API_CONTRACT section 3 says `POST /auth/otp`
// "deliberately does not reveal whether the destination exists", and an answer
// that differed for a refused address would disclose through the status what
// the body withholds. So all three refusals leave this file separated and
// arrive at the caller as one 503. What the distinction buys is a log line an
// operator can act on.
//
// -----------------------------------------------------------------------------
// THE DEADLINE, AND WHY THERE IS NO RETRY
// -----------------------------------------------------------------------------
// {@link OTP_DELIVERY_TIMEOUT_MS} is 5s where `TURNSTILE_TIMEOUT_MS` is 3s, and
// the difference is what is on the other end. That one is an anycast edge
// answering a form post; this one is a regional API accepting a message into a
// queue. Both are on the sign-in path and both fail closed, so both must avoid
// converting ordinary latency into a refusal, and 5s bounds one HTTPS round trip
// to a regional API with room to spare.
//
// THERE IS NO RETRY, AND HERE THAT IS A STRONGER RULE THAN IT WAS FOR TURNSTILE.
// A repeated verification costs a packet. A repeated SEND is a second message
// the vendor bills for and a second copy of a live code in a person's inbox, and
// a request that timed out may well have been ACCEPTED. So a send that does not
// answer is refused ONCE and the caller is told to try again, which spends one
// of their own velocity slots and cannot double-charge Merit for a message
// nobody asked for twice.
//
// THAT REFUSAL CAN UNDER-REPORT A DELIVERY AND THE COST IS ACCEPTED RATHER THAN
// HIDDEN: a message accepted just after the deadline reaches the trader while
// the trader is reading a 503. They ask for another code, which is an
// inconvenience; the direction that fails the other way is answering `sent:
// true` for a message that never left, which is the exact sentence this file
// exists to stop being true.
// =============================================================================

import type { Environment } from './surface.ts';

/**
 * The environment variable holding the Postmark SERVER token.
 *
 * NAMED HERE AND VALUED NOWHERE IN THIS REPOSITORY (ADR-012), exactly as
 * `MERIT_TURNSTILE_SECRET` and `MERIT_OTP_MAC_KEY` are. INFRA section 7 scopes
 * secrets per service in the platform vault; this is a name deployment sets on
 * the `api` service and on no other.
 *
 * A SERVER TOKEN AND NOT AN ACCOUNT TOKEN, which is the scoping half of the
 * vendor argument in the header. A server token sends; it cannot create
 * servers, move domains or read the account. If a deployment is ever given an
 * account token here it gains authority this file never asks for, so the name
 * says which one it wants.
 */
export const OTP_EMAIL_TOKEN_VAR = 'MERIT_POSTMARK_SERVER_TOKEN';

/**
 * The address a code is sent FROM.
 *
 * A DEPLOYMENT FACT AND NOT A CONSTANT, and it is here rather than in a template
 * because it is exactly the kind of value ADR-012 keeps out of a repository: a
 * real sender identity on a real domain. It is also the value the vendor
 * verifies against a signature the account owns, so a wrong one is a refusal
 * rather than a mis-sent message.
 *
 * IT IS NOT VALIDATED AS AN ADDRESS HERE. The vendor is the authority on what it
 * will send from -- it holds the domain verification this file cannot see -- and
 * a second, weaker address grammar in this file would refuse values the vendor
 * accepts. What IS refused is ABSENCE, because an absent sender is a message
 * that cannot be built at all.
 */
export const OTP_EMAIL_FROM_VAR = 'MERIT_OTP_EMAIL_FROM';

/**
 * The per-send SMS price, in INTEGER CENTS. See the header.
 *
 * NAMED HERE AND SET NOWHERE, and the absence is stated rather than papered
 * over: no environment in this repository carries a value, because no SMS
 * vendor has been taken and a price quoted against no contract is a number
 * pulled from the air. ADR-229 section 3.
 */
export const OTP_SMS_PRICE_CENTS_VAR = 'MERIT_OTP_SMS_PRICE_CENTS';

/**
 * Postmark's single-message endpoint.
 *
 * PUBLIC, DOCUMENTED AND THE SAME FOR EVERY TENANT, so it is a constant for
 * `TURNSTILE_SITEVERIFY_URL`'s reason: a deployment cannot need a different one,
 * and an environment variable here would be a way to point a sender at a host
 * that answers 200 and delivers nothing.
 */
export const POSTMARK_SEND_URL = 'https://api.postmarkapp.com/email';

/** The header the server token rides in. The vendor's name for it, spelled once. */
export const POSTMARK_TOKEN_HEADER = 'x-postmark-server-token';

/** The deadline on the outbound call, in milliseconds. See the header. */
export const OTP_DELIVERY_TIMEOUT_MS = 5_000;

/**
 * What one delivery attempt decided.
 *
 * IT CARRIES THE REASON AND NOT ONLY THE BOOLEAN, on `TurnstileOutcome`'s
 * precedent: a suite asserting a send it believes happened cannot otherwise tell
 * that the token was missing and the call never left the process.
 *
 * `detail` IS FOR THE LOG. Nothing here is written into a response body, and
 * `reference` is the vendor's own handle for the message so an operator can ask
 * the vendor about a send a trader says never arrived.
 */
export type OtpDeliveryOutcome =
  | { readonly outcome: 'sent'; readonly reference: string }
  | { readonly outcome: 'rejected'; readonly detail: string }
  | { readonly outcome: 'unconfigured'; readonly detail: string }
  | { readonly outcome: 'unavailable'; readonly detail: string };

/**
 * One code, addressed.
 *
 * IT CARRIES THE CODE AND NOT A RENDERED BODY, so the composition of the message
 * is this file's and a caller cannot accidentally put a code somewhere a
 * template does not expect it. `expiresInSeconds` is the challenge's own TTL,
 * passed in rather than recomputed here: the row that expires is written by the
 * backend and a second opinion about when it dies is a second source of truth.
 */
export interface OtpMessage {
  readonly channel: 'email' | 'sms';
  /** The destination AS THE PERSON TYPED IT. This file normalizes none of it. */
  readonly destination: string;
  readonly code: string;
  readonly expiresInSeconds: number;
}

/**
 * The port. One method, because there is one question.
 *
 * A PORT RATHER THAN A FUNCTION so the suite can install a sender that refuses,
 * or accepts, or hangs, without a socket, without a credential and without any
 * way to spend money. `databaseAuthBackend` holds the installed one exactly as
 * it holds its clock and its environment.
 */
export interface OtpSender {
  send(message: OtpMessage): Promise<OtpDeliveryOutcome>;
}

/** What `fetch` looks like to this file. Narrowed so a fake needs no DOM types. */
export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * What {@link resolveOtpSmsPriceCents} answers.
 *
 * A RESULT RATHER THAN A THROW, on this file's own rule that nothing here
 * throws: a price that cannot be read is a refusal to send, and a rejection on
 * the sign-in path would reach Fastify's error handler as a 500, which is a
 * control's refusal arriving as a bug.
 */
export type OtpPrice = { readonly cents: number } | { readonly refusal: string };

const NO_SMS_SENDER =
  'this deployment sends no SMS. ADR-229 took a mail vendor and took no SMS vendor, because a ' +
  'code delivered by SMS cannot be verified anywhere in this tree and a send would be money ' +
  'spent on a code no handler can answer';

function unconfigured(detail: string): OtpDeliveryOutcome {
  return { outcome: 'unconfigured', detail };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * A field of the vendor's answer, rendered for a log line and for nothing else.
 *
 * Total over a shape this file does not control: an absent member, a number
 * where a string was expected and a nested object all render rather than throw,
 * because a send must not fail on the shape of its own explanation. That is
 * `renderErrorCodes`' rule in `turnstile.ts`, applied to one field instead of an
 * array.
 */
function renderField(value: unknown): string {
  if (typeof value === 'string') return value === '' ? 'none reported' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return 'none reported';
}

/**
 * The per-send SMS price a deployment configured, or the reason there is none.
 *
 * STRICT, AND THE STRICTNESS IS THE MONEY RULE RATHER THAN TASTE. The
 * constitution puts money in integer cents with no floats on a financial path,
 * and `otp_send_budget.spend_cents` is `bigint`. So:
 *
 *   - AN ABSENT VALUE IS A REFUSAL and never a zero. A price defaulted to zero
 *     is a cost breaker that counts every send as free, which is a control that
 *     is off while every gate is green -- ADR-226's "an absent secret is a
 *     refusal and never a disabled control", arriving on the money half.
 *   - A DECIMAL POINT IS REFUSED rather than rounded. Rounding a fraction of a
 *     cent is a policy about money, it belongs to whoever sets the value, and a
 *     parser that silently took `0.79` to `0` would restore the fail-open this
 *     function exists to close.
 *   - ZERO IS REFUSED for the same reason absence is, and a NEGATIVE price would
 *     credit the budget on every send.
 */
export function resolveOtpSmsPriceCents(env: Environment): OtpPrice {
  const raw = env[OTP_SMS_PRICE_CENTS_VAR];
  if (raw === undefined || raw.trim() === '')
    return {
      refusal:
        `no \`${OTP_SMS_PRICE_CENTS_VAR}\` is set, so a send has no price to charge against ` +
        '`otp_send_budget.spend_cents`. There is deliberately no default: a price of zero is a ' +
        'cost breaker that never trips, which is worse than a breaker that is absent because it ' +
        'reports green. ADR-229',
    };
  const value = raw.trim();
  // WHOLE DIGITS ONLY. `Number('0.79')` and `Number(' 12 ')` both succeed and
  // both are values this column cannot hold, so the SHAPE is refused before the
  // number is read rather than after.
  if (!/^\d+$/.test(value))
    return {
      refusal:
        `\`${OTP_SMS_PRICE_CENTS_VAR}\` is not a whole number of cents. Money is integer cents ` +
        'and a fraction of a cent has nowhere to live in `otp_send_budget.spend_cents`; round ' +
        'UP, in the value, where the rounding is a decision somebody took rather than one a ' +
        'parser took silently',
    };
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents <= 0)
    return {
      refusal:
        `\`${OTP_SMS_PRICE_CENTS_VAR}\` must be a positive whole number of cents that survives ` +
        'integer arithmetic. Zero is a breaker that never trips and an unsafe integer is a ' +
        'budget that stops counting',
    };
  return { cents };
}

/**
 * The plain-text body of one code.
 *
 * TEXT AND NOT HTML, and the reason is deliverability rather than austerity: a
 * transactional code carrying images, links and a tracking pixel is a message
 * every filter scores, and an HTML template is a rendering system this tree does
 * not have. What a person needs is the code and how long it lives.
 *
 * NO LINK, DELIBERATELY. A one-click sign-in link is a second authentication
 * path with its own replay and forwarding properties, and `POST /auth/verify` is
 * the one door API_CONTRACT declares.
 */
export function otpEmailBody(message: OtpMessage): string {
  const minutes = Math.max(1, Math.round(message.expiresInSeconds / 60));
  return (
    `Your Merit sign-in code is ${message.code}\n\n` +
    `It expires in ${String(minutes)} minute${minutes === 1 ? '' : 's'} and can be used once.\n\n` +
    'If you did not ask for this code, you can ignore this message. Nobody can sign in ' +
    'without it.\n'
  );
}

/** The subject line. Short, and it names the product and the act and nothing else. */
export const OTP_EMAIL_SUBJECT = 'Your Merit sign-in code';

/**
 * The real sender.
 *
 * @param env       where the token and the sender address are read from, PER
 *                  CALL. A parameter for `cloudflareTurnstileVerifier`'s reason:
 *                  a suite that could not vary the environment could assert none
 *                  of the configuration behaviour.
 * @param fetchImpl the outbound call. Injected so the suite exercises THIS
 *                  function's request shape, deadline and response handling
 *                  rather than a re-implementation of them, and so that no test
 *                  in this repository can reach a vendor. A suite that could
 *                  reach one is a suite that can spend money.
 * @param timeoutMs overrides {@link OTP_DELIVERY_TIMEOUT_MS}. For suites.
 *
 * THE CONFIGURATION IS READ PER SEND AND NOT MEMOISED, for `resolveOtpMacKeys`'
 * reason: a value captured at import is a value a rotation cannot reach.
 *
 * NOTHING HERE THROWS. Every failure is an outcome, because a rejection on the
 * sign-in path would be caught by `endpointHandler`'s `AuthBackendUnwired`
 * filter, fail its `instanceof`, and reach Fastify's own error handler as a 500:
 * a control's refusal would arrive as a bug.
 */
export function postmarkOtpSender(
  env: Environment = process.env,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  timeoutMs: number = OTP_DELIVERY_TIMEOUT_MS,
): OtpSender {
  return {
    async send(message: OtpMessage): Promise<OtpDeliveryOutcome> {
      // THE SMS ARM IS `unconfigured` AND NOT A NEW OUTCOME MEMBER. "This
      // deployment holds no sender for that channel" is the same fact as "this
      // deployment holds no token", and a fifth member would be a fifth case
      // every caller has to switch on to say 503 in a fifth way. The price is
      // resolved rather than assumed, so the refusal names BOTH halves of what
      // an SMS branch is owed instead of the first one somebody notices.
      if (message.channel === 'sms') {
        const price = resolveOtpSmsPriceCents(env);
        const priceState = 'cents' in price ? 'a price is configured' : price.refusal;
        return unconfigured(`${NO_SMS_SENDER}. On the price: ${priceState}`);
      }

      const token = env[OTP_EMAIL_TOKEN_VAR];
      if (token === undefined || token.trim() === '')
        return unconfigured(
          `this deployment sets no \`${OTP_EMAIL_TOKEN_VAR}\`, so no message can be handed to ` +
            'the mail vendor. There is deliberately no fallback and deliberately no pretend ' +
            'send: a credential absent from one environment must not be the way delivery ' +
            'switches itself off in another. ADR-229',
        );

      const from = env[OTP_EMAIL_FROM_VAR];
      if (from === undefined || from.trim() === '')
        return unconfigured(
          `this deployment sets no \`${OTP_EMAIL_FROM_VAR}\`, so a message has no sender. The ` +
            'address is a deployment fact and this repository holds no default for it (ADR-012)',
        );

      if (message.destination.trim() === '')
        // NOT A VALIDATOR AND NOT PRETENDING TO BE ONE. `validateOtpRequest`
        // already refused an empty destination; this refuses to hand the vendor
        // a message addressed to nobody, which is a fact about THIS call.
        return { outcome: 'rejected', detail: 'the message names no destination' };

      let response: { ok: boolean; status: number; json: () => Promise<unknown> };
      try {
        response = await fetchImpl(POSTMARK_SEND_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            [POSTMARK_TOKEN_HEADER]: token,
          },
          // `JSON.stringify` ESCAPES EVERY MEMBER, so neither the token holder's
          // sender address nor a caller-supplied destination can break out of
          // the body. That is `URLSearchParams`' role in `turnstile.ts`.
          body: JSON.stringify({
            From: from,
            To: message.destination,
            Subject: OTP_EMAIL_SUBJECT,
            TextBody: otpEmailBody(message),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        // An abort, a DNS failure, a reset, a TLS error. The message reaches the
        // log; the caller is told only that a dependency is down.
        return {
          outcome: 'unavailable',
          detail: `the mail vendor did not answer: ${String(err)}`,
        };
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (err) {
        // READ BEFORE THE STATUS IS BRANCHED ON, so a 200 that is not JSON is
        // never mistaken for a send. A body this file cannot read is a send it
        // cannot claim.
        return {
          outcome: 'unavailable',
          detail: `the mail vendor answered unreadable JSON: ${String(err)}`,
        };
      }

      const body = asRecord(payload);
      if (body === null)
        return {
          outcome: 'unavailable',
          detail: 'the mail vendor answered something that is not an object',
        };

      // 5xx IS THE VENDOR FAILING AND 4xx IS THE VENDOR REFUSING, AND THAT IS
      // THE ONLY THING THE STATUS IS READ FOR. The vendor's own `ErrorCode`
      // vocabulary is rendered into the log and never branched on, which is
      // ADR-226's ruling transcribed: a transcribed vendor vocabulary that is
      // wrong is wrong in the direction of claiming a send that did not happen.
      // Both arms refuse, so a mis-classification costs a log line and never a
      // delivery Merit believes in.
      if (!response.ok)
        return response.status >= 500
          ? {
              outcome: 'unavailable',
              detail: `the mail vendor answered HTTP ${String(response.status)}`,
            }
          : {
              outcome: 'rejected',
              detail:
                `the mail vendor refused the message with HTTP ${String(response.status)}. ` +
                `ErrorCode: ${renderField(body['ErrorCode'])}. Message: ` +
                `${renderField(body['Message'])}`,
            };

      // A 200 IS NOT A SEND ON ITS OWN. The vendor reports a per-message result
      // in the body, and `ErrorCode` is the member that carries it; a 200
      // carrying a non-zero one is a message that was not accepted.
      const errorCode = body['ErrorCode'];
      if (errorCode !== 0)
        return {
          outcome: 'rejected',
          detail:
            'the mail vendor answered HTTP 200 with no zero `ErrorCode`, so the message was not ' +
            `accepted. ErrorCode: ${renderField(errorCode)}. Message: ` +
            `${renderField(body['Message'])}`,
        };

      return { outcome: 'sent', reference: renderField(body['MessageID']) };
    },
  };
}
