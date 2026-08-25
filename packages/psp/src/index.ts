// =============================================================================
// packages/psp
// =============================================================================
// THE PSP PORT. One interface, two fakes, and no vendor.
//
// M03 section 2.1 is the specification and ADR-103 is the ruling. The three
// consumers that do not exist yet -- `POST /webhooks/psp/:provider` (session
// 219), `POST /checkout` (session 220) and the dispute path -- all program
// against this file, which is the entire reason it was written before any of
// them.
//
// WHAT IS DELIBERATELY NOT EXPORTED, AND WHY EACH ABSENCE IS A DECISION.
//
//   NO HTTP CLIENT AND NO VENDOR SDK. This package opens no socket. The two
//   implementations of the I/O methods are fakes and they are honest about it.
//
//   NO WAY TO MINT A `CardAmountCents` EXCEPT `cardLegOf`. The brand is what
//   makes M03's "no adapter method takes a price" structural, and a second
//   producer would be a second door into the money path.
//
//   NO WAY TO PARSE A WEBHOOK BODY. `verifyWebhook` is the only function in
//   this package that returns a parsed payload, and it returns one only after
//   the digest agreed. API_CONTRACT section 10 states that ordering in capitals
//   and this is that sentence expressed as a module boundary.
//
//   NO MID HEALTH COMPUTATION. `mid_health` is Merit's decision record
//   (SD-M3-03) and `chooseMidForNewAttempt` READS it. `health()` on an adapter
//   is a reachability probe and never a state.
//
//   NO FUNCTION THAT MOVES A LIVE SESSION BETWEEN PROVIDERS. AS-M3-02: that is
//   how one purchase becomes two charges.
// =============================================================================

export {
  PSP_IDS,
  WebhookVerificationError,
  type CardAmountCents,
  type JsonObject,
  type JsonValue,
  type PaymentSession,
  type PspAdapter,
  type PspId,
  type PspProbe,
  type PurchaseIntent,
  type RefundResult,
  type VerifiedEvent,
  type WebhookHeaders,
  type WebhookRefusal,
} from './port.ts';

export { CardLegError, cardLegOf, type CardLegRefusal, type PurchaseRowMoney } from './amount.ts';

export {
  WEBHOOK_WINDOW_SECONDS,
  concatBytes,
  decimalInteger,
  decodeMac,
  singleHeader,
  utf8,
  verifyHmacWebhook,
  type EventIdentity,
  type HmacWebhookScheme,
  type PresentedSignature,
  type VerifyHmacWebhookArgs,
} from './webhook.ts';

export {
  BothMidsUnhealthyError,
  chooseMidForNewAttempt,
  type MidCandidate,
  type MidState,
} from './routing.ts';

export {
  PSP_A_SIGNATURE_HEADER,
  PspAFake,
  createPspAFake,
  type Clock,
  type PspAFakeOptions,
  type PspASignRequest,
  type PspASignedWebhook,
} from './fakes/psp-a.ts';

export {
  PSP_B_NONCE_HEADER,
  PSP_B_SIGNATURE_HEADER,
  PSP_B_TIMESTAMP_HEADER,
  PspBFake,
  createPspBFake,
  type PspBFakeOptions,
  type PspBSignRequest,
  type PspBSignedWebhook,
} from './fakes/psp-b.ts';
