// =============================================================================
// apps/worker/src/provisioning
// =============================================================================
// M02's PROVISIONING SAGA, AGAINST THE SIMULATOR AND AGAINST THE VENDOR
// WITHOUT KNOWING WHICH. `INV-M2-11` makes simulator output and vendor output
// pass through the same parser and normalizer, and `PlatformProvisioningPort`
// carries M02's `platform: 'rithmic' | 'simulator'` for the same reason: this
// module never branches on which one it is holding.
//
// EIGHT FILES AND TWO OF THEM DO I/O.
//
// **THIS LINE READ "FIVE FILES AND ONE OF THEM DOES I/O" WHILE THE LIST UNDER IT
// ENUMERATED SEVEN**, and ADR-338 found it while adding the eighth. Corrected by
// counting the entries below rather than by trusting the word, and recorded
// rather than quietly fixed: a hand-written count in a barrel header is the
// third one in this deployable to be wrong, and `src/index.ts`'s own
// `WORKER_MODULES_BEHIND_A_LEG` docblock carries the same repair.
//
//   vocabulary.ts    the seven operations and six statuses `0007` and `0001`
//                    close, bound to those migrations by the suite
//   payload.ts       SD-M2-01's canonical serialization and `payload_hash`,
//                    and M02 section 3.3's batch id and file name
//   machine.ts       M02 section 3.2's transitions, permitted edges listed and
//                    everything else refused
//   admission.ts     INV-M2-13's fail-closed exit
//   compensation.ts  what can be counteracted, what cannot, and what a failed
//                    compensation leaves behind
//   ports.ts         the I/O boundary, and what ADR-102's accessor cannot
//                    serve today
//   saga.ts          the pipeline
//   queue-adapter.ts the ONE live port of the four, over `src/queue.ts`'s door
//                    (ADR-338). It is the second file here that does I/O and the
//                    only one that names a module outside this directory

export {
  PROVISIONING_OPERATIONS,
  PROVISIONING_STATUSES,
  isProvisioningOperation,
  isProvisioningStatus,
  type ProvisioningOperation,
  type ProvisioningStatus,
} from './vocabulary.ts';

export {
  BATCH_ID_SHORT_LENGTH,
  ProvisioningPayloadError,
  batchId,
  canonicalPayload,
  payloadHash,
  provisioningFileName,
  renderPayload,
  type ProvisioningPayload,
  type ProvisioningValue,
} from './payload.ts';

export {
  LIVE_STATUSES,
  PERMITTED_TRANSITIONS,
  TRANSITION_REFUSALS,
  advance,
  type Transition,
  type TransitionRefusal,
} from './machine.ts';

// INV-M2-13. `setpointConfirmation` is the ONLY producer of a
// `SetpointConfirmation` and it is exported so the wiring session can call it;
// the brand's symbol is not exported and cannot be, so the type stays
// unforgeable outside a cast.
export {
  ADMISSION_REFUSALS,
  RISK_FLOOR_CENTS_FIELD,
  admitToTrading,
  readProvisioningRow,
  setpointConfirmation,
  type AdmissionRefusal,
  type AdmissionSubject,
  type ProvisioningRow,
  type SetpointConfirmation,
  type TradingAdmission,
} from './admission.ts';

export {
  COMPENSATING_OPERATION,
  REVOCATION_ORDER,
  compensationFor,
  inRevocationOrder,
  revocationRank,
  type CompensationOutcome,
} from './compensation.ts';

export type {
  EntitlementChange,
  PlatformProvisioningPort,
  ProvisioningAdvancePort,
  ProvisioningBatch,
  ProvisioningJobQueue,
  ProvisioningJobRequest,
  ProvisioningOp,
  ProvisioningReadPort,
  ProvisioningSqlExecutor,
  ProvisioningTx,
} from './ports.ts';

// ADR-338. THE LIVE PORT IS A LEG'S CARGO AND `src/queue.ts` IS NOT, WHICH IS
// `test/queue.test.ts`'s stated distinction: that file exports the CAPABILITY
// and this one exports an ADAPTER OVER A PORT, which is `./sweeps/ledger.ts`'s
// class and is re-exported for the reason `APPROVAL_LEDGER` is.
export {
  LIVE_PROVISIONING_QUEUE,
  declareProvisioningQueue,
  provisioningJobQueue,
} from './queue-adapter.ts';

export {
  PROVISIONING_QUEUE_NAME,
  buildBatch,
  enqueueProvisioningOp,
  entitleAfterSetpoint,
  runProvisioningSaga,
  type EnqueuedIntent,
  type ProvisioningIntent,
  type SagaIo,
  type SagaOutcome,
} from './saga.ts';
