// =============================================================================
// packages/rail
// =============================================================================
// THE PAYOUT RAIL PORT. One interface, one sandbox adapter, and no vendor.
//
// [P5](../../../docs/plans/P5-payouts-and-wallet.md) section 8's `P5-m`, the
// half session 258 (`ADR-146`) did not claim. M05 sections 2.1 and 3.1 are the
// specification. The consumers do not exist yet, which is the entire reason this
// is written before them: `packages/psp` was written before `POST /checkout` for
// the same reason and it is the shape this follows.
//
// WHAT IS DELIBERATELY NOT HERE, AND WHY EACH ABSENCE IS A DECISION.
//
//   NO HTTP CLIENT AND NO VENDOR SDK. This package opens no socket. The one
//   implementation of `enqueue` and `health` is a fake and it is honest about it.
//
//   NO ROUTE. `POST /webhooks/rise` is API_CONTRACT section 10's only payout-rail
//   row and session 258 registered it. There is no `POST /webhooks/rail` row in
//   the contract, and the contract is `approved`, so minting one is an ADR this
//   session does not hold. Nothing here registers anything.
//
//   NO ROW READ AND NO ROW WRITTEN. The manifest declares no `@merit/db`, which
//   is what keeps `RI-08` satisfiable here without an admission.
//
//   NO LEDGER POSTING AND NO LEDGER IDEMPOTENCY KEY. `settlement.ts`'s
//   `LT_07_FINDINGS` is the three-part reason, each part asserted by
//   `test/lt-07.test.ts` against its primary source rather than left as prose.
//
//   NO WAY TO MINT A `TransferAmountCents` OR AN `ApprovalIdempotencyKey` EXCEPT
//   `transferAmountOf` AND `approvalKeyOf`. Both take a row Merit already wrote.
//   A second producer would be a second door into the money path.
//
//   NO WAY TO PARSE A WEBHOOK BODY. `verifyRailWebhook` is the only function
//   here that returns a parsed payload, and it returns one only after the digest
//   agreed. API_CONTRACT section 10 states that ordering in capitals and this is
//   that sentence expressed as a module boundary.
//
//   NO `refund`. Money that left on this rail comes back as `LT-03`, a ledger
//   act inside Merit, not a request to a provider.
//
//   NO `IdempotencyStore`. `replay.ts` says at length why its `DeliveryLedger`
//   is not one and why `ADR-172` is not depended on.
//
// VG-12 IS ASKED TO ADMIT NOTHING, and P5 section 8 requires that be stated
// rather than assumed: no runtime dependency, no workspace dependency, three
// `catalog:` devDependencies already installed for `@merit/psp`, `node:crypto`
// is a builtin, the catalog and `onlyBuiltDependencies` are untouched, and the
// only line `pnpm-lock.yaml` gains is this package's own `importers` block.
// =============================================================================

export {
  RAIL_PROVIDER_IDS,
  RailWebhookVerificationError,
  TransferMintError,
  approvalKeyOf,
  transferAmountOf,
  type AcceptedTransfer,
  type ApprovalIdempotencyKey,
  type RailAdapter,
  type RailJsonObject,
  type RailJsonValue,
  type RailProbe,
  type RailProviderId,
  type RailWebhookHeaders,
  type RailWebhookRefusal,
  type StoredTransferRow,
  type TransferAmountCents,
  type TransferInstruction,
  type TransferLeg,
  type TransferMintRefusal,
  type VerifiedRailEvent,
} from './port.ts';

export {
  RAIL_WEBHOOK_WINDOW_SECONDS,
  decodeRailMac,
  railConcatBytes,
  railDecimalInteger,
  railUtf8,
  singleRailHeader,
  verifyRailWebhook,
  type PresentedRailSignature,
  type RailEventIdentity,
  type RailWebhookScheme,
  type VerifyRailWebhookArgs,
} from './webhook.ts';

export {
  InMemoryDeliveryLedger,
  refuseReplay,
  type DeliveryDisposition,
  type DeliveryLedger,
} from './replay.ts';

export {
  LT_07_FINDINGS,
  PORT_PERFORMED_STEPS,
  SETTLEMENT_STEPS,
  SettlementAnchorError,
  settlementAnchorsOf,
  type SettlementAnchors,
  type SettlementPerformer,
  type SettlementStep,
} from './settlement.ts';

export {
  RAIL_NONCE_HEADER,
  RAIL_SIGNATURE_HEADER,
  RAIL_TIMESTAMP_HEADER,
  SandboxRail,
  createSandboxRail,
  type Clock,
  type RailDeliveryRequest,
  type SandboxRailOptions,
  type SignedRailDelivery,
} from './fakes/sandbox.ts';
