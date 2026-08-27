// =============================================================================
// packages/kyc
// =============================================================================
// The vendor-agnostic identity-verification port, ADR-021's composite trigger
// set, and the screen that keeps a document out of Merit's storage.
//
// IT IS A LIBRARY BOTH DEPLOYABLES CALL, which is why it is a package and not
// two route files. `second_distinct_account_purchase` is reached at checkout,
// which is `apps/api`'s; `pre_funded` is reached at `phase.passed`, which is
// `apps/worker`'s; and ADR-100 ruling 2 forbids anything outside
// `apps/api/src/routes/` from importing anything inside it. One evaluator, two
// callers, and neither of them owns the other's query.
//
// IT DECLARES NO DEPENDENCY, RUNTIME OR WORKSPACE. It opens no socket, names no
// vendor SDK, registers no route and reads no row.
//
// WHAT IS DELIBERATELY ABSENT: dedupe, sanctions screening and re-verification.
// `dedupe_matches` is session 168's `M19-8`, `sanctions_screenings` is M19
// section 3.4, and `POST /kyc/reverify` is M19's. P3's content is the
// VERIFICATION PATH and its TRIGGERS, and a package that grew the other three
// would have widened a fence rather than finished a slice.
// =============================================================================

export {
  KycWebhookVerificationError,
  type HostedVerificationSession,
  type JsonObject,
  type JsonValue,
  type KycApplicant,
  type KycOutcome,
  type KycProvider,
  type KycWebhookHeaders,
  type KycWebhookRefusal,
  type VerifiedKycEvent,
} from './port.ts';

export {
  KYC_TRIGGERS_AS_CHECKED,
  KYC_TRIGGERS_IN_FIRING_ORDER,
  KycConfigError,
  FROZEN_V1_TRIGGERS,
  effectiveTriggers,
  evaluateGate,
  readTriggerConfig,
  triggerConditionHolds,
  type GateEvaluation,
  type GateFacts,
  type KycTrigger,
} from './triggers.ts';

export {
  DOCUMENT_CARRIER_PAIRS,
  DOCUMENT_CARRIER_WORDS,
  KycDocumentInPayloadError,
  documentBearingPaths,
  keyWords,
  screenForDocuments,
} from './documents.ts';

export {
  KYC_WEBHOOK_WINDOW_SECONDS,
  concatBytes,
  decimalInteger,
  decodeKycMac,
  singleKycHeader,
  utf8,
  verifyKycWebhook,
  type KycEventIdentity,
  type KycPresentedSignature,
  type KycWebhookScheme,
  type VerifyKycWebhookArgs,
} from './webhook.ts';

// THE FAKE IS EXPORTED AND A FAKE MUST NEVER SERVE A REAL PROVIDER. It is
// exported because `apps/api`'s suite needs a provider that signs for real, and
// the thing that keeps it out of production is not its absence from this list:
// it is that `productionDeps` in `routes/webhooks-kyc.ts` resolves NOTHING, so
// a live deployment answers 503 rather than running a fake.
export {
  FAKE_KYC_HEADERS,
  FAKE_KYC_PROVIDER,
  fakeKycProvider,
  fakeKycScheme,
  fakeSignedBytes,
  type FakeKycProviderOptions,
} from './fakes/provider.ts';
