// =============================================================================
// packages/rail/src/port.ts
// =============================================================================
// THE INTERFACE EVERY PAYOUT RAIL IS USED THROUGH.
//
// M05 sections 2.1 and 3.1 are the specification. This file is `packages/psp`'s
// SHAPE and deliberately not its TYPE, which is P5 section 8's own instruction
// for this slice and is the wall three files in this tree have already hit:
//
//   `packages/psp/src/port.ts`   `HmacWebhookScheme` is branded
//                                `readonly psp: PspId`, and `PspId` is CLOSED at
//                                `'psp_a' | 'psp_b'` by a CHECK on
//                                `purchases.psp` (`0006_commerce.sql`). Calling
//                                it from the payout rail would write a payment
//                                processor's id into a transfer. There is no
//                                honest value to pass.
//   `packages/kyc/src/webhook.ts`   the same finding one path over.
//   `apps/api/src/rise-webhook.ts`  session 258's, which records the count:
//                                three consumers of one ordering rule, and
//                                ADR-146 section 3 defers the lift.
//
// THIS PACKAGE IS THAT LIFT FOR THE PAYOUT RAIL ONLY, AND IT DOES NOT CLAIM TO
// BE ADR-114 SECTION 4's NEUTRAL PACKAGE. That entry asks for one package that
// neither provider set brands, serving all three rails. This one brands itself
// `RailProviderId` and serves the payout rail, so it is a fourth verifier rather
// than the end of the duplication, and saying otherwise would retire a question
// this session has no ADR number to answer. What it does buy is the half P5
// asked for: the payout rail's port exists BEFORE the leg that sends through it,
// which is the whole reason `packages/psp` was written before `POST /checkout`.
//
// -----------------------------------------------------------------------------
// THE THREE RULES `packages/psp` MADE STRUCTURAL, KEPT, AND THE ONE THAT INVERTS
// -----------------------------------------------------------------------------
//   1. `verifyWebhook` THROWS rather than returning a boolean. "A boolean gets
//      ignored."  KEPT, unchanged.
//   2. NOTHING IN THE INTERFACE RETURNS A DECISION. The adapter reports what the
//      rail said. Whether that settles a payout is Merit's logic, in one place.
//      KEPT, and it is load bearing here in a way it was not there: settlement
//      is "the most consequential transition involving an outside party" (M05
//      section 3.1) and this port touches no state at all.
//   3. NO ADAPTER METHOD TAKES A PRICE. INVERTED, AND THE INVERSION IS THE
//      POINT. A payout rail's whole job is to move an amount Merit computed, so
//      `enqueue` DOES take one -- and it takes it branded, mintable from a
//      stored row and from nothing else, which is `CardAmountCents`'s control
//      applied in the direction money is travelling. See `TransferAmountCents`.
//
// -----------------------------------------------------------------------------
// THE FOURTH RULE, WHICH IS THIS PORT'S OWN AND IS THE OPPOSITE OF THE PSP'S
// -----------------------------------------------------------------------------
// `PurchaseIntent.idempotencyKey` is per ATTEMPT: "a new attempt is a new
// session with a new idempotency key" (M03 section 3.2), because a legitimate
// second attempt at a purchase must not look like a duplicate of the first.
//
// A TRANSFER IS THE OTHER WAY ROUND AND `INV-M5-06` SAYS SO IN TERMS: "the same
// `idempotency_key` on every attempt, generated BEFORE the first send and
// persisted in the same transaction". `payout_transfers.idempotency_key` is
// `text NOT NULL UNIQUE` (`0010_payouts.sql:238`), and a retry that minted a new
// key would pay a trader twice. So the key is generated AT APPROVAL, is carried
// unchanged through every attempt, and is branded so that a string which did not
// come from an approval cannot be spelled where one is wanted.
//
// -----------------------------------------------------------------------------
// WHAT THIS PACKAGE IS NOT
// -----------------------------------------------------------------------------
// It opens no socket, names no vendor SDK, registers no route and reads no row.
// It writes no ledger posting: `LT-02` and `LT-07` are the receiver's and
// `settlement.ts` records, with two mechanical assertions, why neither is
// postable in this tree today. `POST /webhooks/rise` is session 258's
// (`ADR-146`) and this package registers nothing.
// =============================================================================

// -----------------------------------------------------------------------------
// The provider set, and it is NOT closed the way the PSP's is
// -----------------------------------------------------------------------------

/**
 * The rails this package serves.
 *
 * THE ASYMMETRY WITH `PspId` IS REAL AND IS NOT SMOOTHED OVER. `purchases.psp`
 * carries a CHECK constraint naming both members, so `PspId` is a transcription
 * of a database constraint and a third member is "a schema change before it is a
 * type change". `payout_transfers.provider` is
 *
 *   provider  text NOT NULL DEFAULT 'rise'
 *
 * (`0010_payouts.sql:236`) with **no CHECK anywhere**, so the database would
 * accept any string at all and this type is derived from a DEFAULT plus
 * `apps/api/src/rise-webhook.ts`'s `RISE_PROVIDER`, which is the only other
 * place in the tree that names the value.
 *
 * SO THIS TYPE IS TIGHTER THAN THE COLUMN, DELIBERATELY, and the direction
 * matters: a type narrower than its column refuses values the database would
 * have taken, which is a compile error somebody reads. The reverse -- a type
 * wider than a CHECK -- is a runtime constraint violation on the money path.
 * `test/schema-bind.test.ts` asserts the absence of the CHECK rather than
 * asserting a constraint that is not there, so the day one is added this file
 * is what fails.
 */
export type RailProviderId = 'rise';

/** Every member. One, and `payout_transfers.provider`'s DEFAULT is it. */
export const RAIL_PROVIDER_IDS: readonly RailProviderId[] = ['rise'];

// -----------------------------------------------------------------------------
// JSON, spelled out rather than imported
// -----------------------------------------------------------------------------

/** A JSON value, as `JSON.parse` returns one. */
export type RailJsonValue =
  null | boolean | number | string | RailJsonValue[] | { [k: string]: RailJsonValue };

/** A JSON object, which is the only top-level shape a webhook body may take. */
export type RailJsonObject = { readonly [k: string]: RailJsonValue };

// -----------------------------------------------------------------------------
// Money and keys: two brands, each with exactly one producer
// -----------------------------------------------------------------------------

/**
 * Integer cents on a transfer, and the brand is the control.
 *
 * `payout_transfers.amount_cents` and `wallet_withdrawals.amount_cents` are both
 * `bigint NOT NULL CHECK (amount_cents > 0)`. A number that came from a request
 * body cannot be spelled here, because {@link transferAmountOf} is the only
 * producer and it takes the row Merit wrote.
 *
 * NO FLOAT REACHES THIS TYPE BY CONSTRUCTION: it is a `bigint`, and JavaScript
 * has no implicit conversion from `number` to `bigint`.
 */
export type TransferAmountCents = bigint & { readonly __brand: 'TransferAmountCents' };

/**
 * The key `INV-M5-06` requires, generated at APPROVAL and never per attempt.
 *
 * {@link approvalKeyOf} is the only producer and it takes the approval's own
 * stored key. See this file's header for why this brand exists and why its rule
 * is the opposite of `PurchaseIntent.idempotencyKey`'s.
 */
export type ApprovalIdempotencyKey = string & { readonly __brand: 'ApprovalIdempotencyKey' };

/** Why an amount or a key was refused. CLOSED, so a caller can switch on it. */
export type TransferMintRefusal =
  | 'amount_not_bigint'
  | 'amount_not_positive'
  | 'approval_key_empty'
  | 'approval_key_untrimmed'
  | 'reference_empty';

/**
 * THE THROW FOR A MINT THAT WAS REFUSED.
 *
 * It is an error and not a `null`, on `cardLegOf`'s reasoning: every caller of
 * these two functions is on the money path, and the one thing worse than
 * refusing to send is sending an amount nobody checked.
 */
export class TransferMintError extends Error {
  readonly refusal: TransferMintRefusal;

  constructor(refusal: TransferMintRefusal, detail: string) {
    super(`rail: ${refusal}. ${detail}`);
    this.name = 'TransferMintError';
    this.refusal = refusal;
  }
}

/**
 * The row Merit already wrote, in the only shape this package will read one.
 *
 * TWO TABLES SATISFY IT AND THAT IS THE POINT. `payout_transfers` carries
 * `amount_cents` and `idempotency_key`; `wallet_withdrawals` carries
 * `amount_cents` and `idempotency_key` too (`0011_wallet.sql:129,135`). The two
 * legs are different animals under ADR-019 and they present the rail with the
 * same two facts, so the mint is one function rather than two that drift.
 */
export interface StoredTransferRow {
  /** `amount_cents`, as the driver returns a `bigint` column. */
  readonly amountCents: bigint;
  /** The row's own stored `idempotency_key`. */
  readonly idempotencyKey: string;
}

/**
 * Mint the amount, FROM A STORED ROW AND FROM NOWHERE ELSE.
 *
 * @throws {TransferMintError} `amount_not_bigint` on a `number` (which is how a
 * float would arrive), `amount_not_positive` on zero or below, which is both
 * table's own CHECK read forward rather than waited for.
 */
export function transferAmountOf(row: StoredTransferRow): TransferAmountCents {
  if (typeof row.amountCents !== 'bigint') {
    throw new TransferMintError(
      'amount_not_bigint',
      `a transfer amount is integer cents as a bigint and this one is a ${typeof row.amountCents}. ` +
        'No float reaches a financial path (constitution, and 0027s NO-FLOATS block).',
    );
  }
  if (row.amountCents <= 0n) {
    throw new TransferMintError(
      'amount_not_positive',
      `a transfer moves a POSITIVE amount and this one is ${row.amountCents.toString()}c. ` +
        'Both payout_transfers and wallet_withdrawals declare CHECK (amount_cents > 0).',
    );
  }
  return row.amountCents as TransferAmountCents;
}

/**
 * Mint the approval key, FROM A STORED ROW AND FROM NOWHERE ELSE.
 *
 * IT IS THE ROW'S OWN KEY AND NOTHING IS PREFIXED ONTO IT, which is a decision
 * and not an omission. `wallet-withdrawals.ts` recorded the reasoning for the
 * LEDGER key one column over and it holds identically here: a key naming the
 * door that happened to reach the rail "is how one withdrawal becomes two
 * postings", because the send is reachable from a route, from a sweep and from
 * an operator console. The row is the anchor; the door is not.
 *
 * @throws {TransferMintError} on an empty or untrimmed key. Untrimmed is
 * refused rather than trimmed, because `payout_transfers.idempotency_key` is
 * UNIQUE over the exact bytes and a silent trim makes `"k"` and `"k "` one key
 * here and two keys in the database.
 */
export function approvalKeyOf(row: StoredTransferRow): ApprovalIdempotencyKey {
  const key = row.idempotencyKey;
  if (typeof key !== 'string' || key.length === 0) {
    throw new TransferMintError(
      'approval_key_empty',
      'INV-M5-06: the same idempotency_key on every attempt, generated BEFORE the first send ' +
        'and persisted in the same transaction. An absent key is not one.',
    );
  }
  if (key.trim() !== key) {
    throw new TransferMintError(
      'approval_key_untrimmed',
      `the stored key ${JSON.stringify(key)} carries surrounding whitespace. ` +
        'payout_transfers.idempotency_key is UNIQUE over exact bytes, so trimming it here ' +
        'would make two database rows one key in this process.',
    );
  }
  return key as ApprovalIdempotencyKey;
}

// -----------------------------------------------------------------------------
// Outbound: the transfer
// -----------------------------------------------------------------------------

/**
 * Which leg is sending, because the two are different animals (ADR-019).
 *
 * `payout_request` is `payout_transfers.payout_request_id`; `wallet_withdrawal`
 * is a `wallet_withdrawals` row, which has no transfer table of its own --
 * `payout_transfers.payout_request_id` is `NOT NULL REFERENCES payout_requests`,
 * so a withdrawal cannot be written there. THAT ABSENCE IS REPORTED IN
 * `settlement.ts` AND NOT REPAIRED HERE.
 */
export type TransferLeg = 'payout_request' | 'wallet_withdrawal';

/**
 * What Merit hands the rail, and the two fields this type does NOT carry are the
 * ones that matter.
 *
 * NO BANK DETAILS. `destination_ref` is a "Provider-side destination id, NEVER
 * bank details. Merit does not hold them, which is the point"
 * (`0010_payouts.sql:241`). There is no field here one could be put in.
 *
 * NO NAME-MATCH SCORE AND NO REVIEWER. `destination_name_match`,
 * `name_match_score`, `name_match_method` and `name_match_reviewed_by` are
 * Merit's decision record about the destination (`SD-M5-02`), computed before
 * the send and never asked of an adapter. A port that carried them would be
 * inviting a rail to have an opinion about a gate.
 */
export interface TransferInstruction {
  readonly leg: TransferLeg;
  /** `payout_requests.id` or `wallet_withdrawals.id`. Merit's own row. */
  readonly referenceId: string;
  /** Integer cents, produced only from a stored row. */
  readonly amountCents: TransferAmountCents;
  /** `char(3)` in both tables' neighbourhood. ISO 4217 alpha-3. */
  readonly currency: string;
  /** The provider-side destination id. Never bank details. */
  readonly destinationRef: string;
  /** `INV-M5-06`'s key, generated at approval and identical on every attempt. */
  readonly idempotencyKey: ApprovalIdempotencyKey;
}

/**
 * What the rail said when it took the instruction.
 *
 * `providerTransferId` IS THE ANCHOR HALF THE CONTRACT NAMES. API_CONTRACT
 * section 10's row for this endpoint anchors on "`provider_transfer_id` plus
 * event id", and `payout_transfers_provider_transfer_uq` is UNIQUE on
 * `(provider, provider_transfer_id) WHERE provider_transfer_id IS NOT NULL`.
 *
 * `status` IS THE RAIL'S WORD AND NOT MERIT'S DISPOSITION, which is `psp`'s
 * `providerStatus` rule kept: a rail may say `accepted` and Merit's row still
 * reads `queued` until it has written one. The three members are the subset of
 * `payout_transfers.status` an ACCEPTANCE can honestly report; `settled` and
 * `failed` are not among them, because a rail that claimed either in the same
 * breath as accepting would be reporting an outcome it has not had yet.
 */
export interface AcceptedTransfer {
  readonly provider: RailProviderId;
  readonly providerTransferId: string;
  readonly status: 'queued' | 'sent' | 'retrying';
  /** Echoed back, so a caller can prove the rail keyed on what it sent. */
  readonly idempotencyKey: ApprovalIdempotencyKey;
}

// -----------------------------------------------------------------------------
// Inbound: the verified settlement webhook
// -----------------------------------------------------------------------------

/**
 * A webhook that VERIFIED. There is no shape in this package for one that did
 * not: {@link verifyRailWebhook} throws, and {@link RailWebhookVerificationError}
 * carries what a receiver needs to record the refusal.
 *
 * EVERY FIELD HERE IS COVERED BY THE SIGNATURE, and that is the property the
 * type exists to hold rather than a happy accident. `raw` is the bytes that were
 * MAC'd; `payload` is `JSON.parse` of exactly those bytes and of nothing else;
 * the identity fields are read out of `payload` or out of headers the MAC
 * covered. Nothing reached this object without going through the digest.
 *
 * `providerTransferId` IS REQUIRED AND ITS ABSENCE IS A REFUSAL, because it is
 * half of API_CONTRACT section 10's anchor for this endpoint and a receiver
 * would have nothing to attach the outcome to. `nonce` is required for the same
 * row's own reason: that row reads "HMAC plus timestamp and nonce" where the PSP
 * row reads "HMAC per provider secret".
 */
export interface VerifiedRailEvent {
  readonly provider: RailProviderId;
  /** The idempotency anchor's second half. */
  readonly providerEventId: string;
  /** The anchor's first half. `payout_transfers.provider_transfer_id`. */
  readonly providerTransferId: string;
  /** The rail's word for what happened. Never Merit's disposition. */
  readonly eventType: string;
  /** The replay anchor. Covered by the signature. See `webhook.ts`. */
  readonly nonce: string;
  /** The rail's own timestamp, as seconds since the epoch. */
  readonly timestampEpochSeconds: number;
  /** The bytes that were signed. */
  readonly raw: Uint8Array;
  /** `JSON.parse(raw)`, performed only after the digest agreed. */
  readonly payload: RailJsonObject;
}

/**
 * Why a payload was refused. CLOSED.
 *
 * MEMBER FOR MEMBER AND IN THE SAME ORDER AS `WebhookRefusal` in
 * `packages/psp/src/port.ts` and `RiseWebhookRefusal` in
 * `apps/api/src/rise-webhook.ts`, PLUS ONE. `test/psp-shape-bind.test.ts`
 * asserts the first seven by reading that file, because two closed sets that
 * disagree are two receivers reporting different security events for the same
 * thing.
 *
 * THE EIGHTH IS `replay_detected` AND IT IS THIS RAIL'S OWN. Neither of the
 * other two sets carries one: the PSP rail leaves duplicate suppression to a
 * `(psp, provider_event_id)` UNIQUE INDEX, and session 258 measured that no
 * equivalent table exists for this rail at all. `replay.ts` is that refusal
 * expressed as an interface a receiver must satisfy, and its member is here so
 * a receiver can switch on it rather than distinguishing it by prose.
 */
export type RailWebhookRefusal =
  | 'signature_header_missing'
  | 'signature_header_repeated'
  | 'signature_malformed'
  | 'signature_mismatch'
  | 'timestamp_outside_window'
  | 'payload_not_json_object'
  | 'event_identity_missing'
  | 'replay_detected';

/**
 * THE THROW, AND WHY IT CARRIES A PAYLOAD.
 *
 * `verifyWebhook` throws rather than returning a boolean (M03 section 2.1, kept
 * here: "a boolean gets ignored"), and a payload whose signature did not verify
 * IS STILL RECORDED, with the fact that it did not verify -- which is
 * `psp_webhook_events.signature_verified boolean NOT NULL`'s own rule on the
 * rail one over.
 *
 * A bare `throw new Error()` is therefore not enough: the handler in the catch
 * block has to record something, and it cannot unless the throw tells it which
 * provider and which bytes. So the error carries them. The refusal is not
 * softened by carrying them: nothing here is parsed, nothing is trusted, and
 * `raw` is the same bytes that arrived.
 */
export class RailWebhookVerificationError extends Error {
  readonly provider: RailProviderId;
  readonly refusal: RailWebhookRefusal;
  /** The bytes as received. Untrusted, and possibly not JSON at all. */
  readonly raw: Uint8Array;

  constructor(
    provider: RailProviderId,
    refusal: RailWebhookRefusal,
    raw: Uint8Array,
    detail?: string,
  ) {
    super(
      `${provider} webhook refused: ${refusal}${detail === undefined ? '' : ` (${detail})`}. ` +
        'An unverified signature never reaches business logic.',
    );
    this.name = 'RailWebhookVerificationError';
    this.provider = provider;
    this.refusal = refusal;
    this.raw = raw;
  }
}

// -----------------------------------------------------------------------------
// Probes
// -----------------------------------------------------------------------------

/**
 * A REACHABILITY PROBE, AND IT IS NOT A HEALTH STATE.
 *
 * `PspProbe`'s rule, kept verbatim in intent: what an adapter can honestly
 * report is whether it got an answer and how long it waited. Whether the rail is
 * usable is Merit's decision, and `ledger_halts` plus `FM-M5-13` are where a
 * stalled rail becomes an operational fact.
 */
export interface RailProbe {
  readonly provider: RailProviderId;
  readonly reachable: boolean;
  /** Integer milliseconds. Never a float, and never negative. */
  readonly latencyMs: number;
}

// -----------------------------------------------------------------------------
// The port
// -----------------------------------------------------------------------------

/**
 * Inbound headers, in the shape a Node HTTP server actually produces.
 *
 * `IncomingHttpHeaders` is `Record<string, string | string[] | undefined>` and a
 * repeated header arrives as an ARRAY. Typing this as the web `Headers` class
 * would require every caller to convert, and a conversion that picks `[0]` out
 * of a repeated signature header is the header-smuggling hole this package
 * refuses by name (`signature_header_repeated`). ADR-105 section 3.
 */
export type RailWebhookHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

/**
 * Everything the rest of Merit is allowed to ask a payout rail for.
 *
 * THREE MEMBERS, WHERE `PspAdapter` HAS FOUR, AND THE MISSING ONE IS `refund`.
 * A payout rail has no counterpart: money that left on this rail comes back as a
 * `payout_reversal` (`LT-03`), which M05 section 2.1 defines as "the exact
 * negation of LT-01, with `reversal_of` set" -- a LEDGER act inside Merit, not a
 * request to a provider. Putting a `refund` here would have invited a receiver
 * to ask a rail to undo a settlement, which is not what a reversal is.
 */
export interface RailAdapter {
  /** Which rail this is. Written to `payout_transfers.provider`. */
  readonly provider: RailProviderId;

  /**
   * Hand the rail an instruction Merit has already written a row for.
   *
   * IDEMPOTENT ON `instruction.idempotencyKey`, AND THAT IS A PROMISE OF THE
   * PORT rather than a convenience of an implementation. `INV-M5-06`: the same
   * key on every attempt. Re-enqueueing a key returns the transfer that key
   * already bought; it never mints a second one.
   */
  enqueue(instruction: TransferInstruction): Promise<AcceptedTransfer>;

  /**
   * Verify, then parse. Never the other way round, and never both optional.
   *
   * API_CONTRACT section 10, in capitals in the contract: "HMAC signature
   * verified BEFORE parsing". This method is the only way to obtain a parsed
   * webhook body from this package, so the ordering is not a convention a
   * handler could get wrong: there is no parsed body to be had without it.
   *
   * @throws {RailWebhookVerificationError} always, on any refusal, never a
   * boolean.
   */
  verifyWebhook(raw: Uint8Array, headers: RailWebhookHeaders): Promise<VerifiedRailEvent>;

  /** Ask the rail whether it is answering. Not whether it is healthy. */
  health(): Promise<RailProbe>;
}
