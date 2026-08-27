// =============================================================================
// apps/portal/src/app/(purchases)/fixtures.ts
// =============================================================================
// THE DATA THESE TWO PAGES RENDER UNTIL THEIR ROUTES EXIST, AND IT IS NAMED
// `fixtures` SO THAT NOBODY HAS TO READ A COMMENT TO KNOW IT.
//
// Session 253 is writing `GET /purchases` and `GET /plans/:planId/versions/:v`
// concurrently, `GET /accounts/:accountId/certificate` is owned by no session at
// all, and no contract row serves `content_documents` to the portal (./ports.ts
// says all three at length). So the pages import `FIXTURE_PORTS` BY NAME, from a
// file called `fixtures.ts`, and the seam is the import line of each page rather
// than a binding buried in a module. When the routes land, two import lines move
// and nothing else in this segment does.
//
// THE VALUES ARE THE CORPUS'S OWN AND NOT INVENTED ONES. The rules object is
// Core EOD as `DATA_MODEL` section 11 materializes it at the frozen
// configuration, transcribed rather than approximated, because a diff rendered
// over a made-up rule shape proves the renderer walks SOMETHING and proves
// nothing about the shape it will actually walk. `size_cents` is 50,000.00 and
// `amount_cents` is 1,500.00 as integer cents, per the money rule: no floats
// anywhere, fixtures included.

import type {
  CertificateResponse,
  PlanRules,
  PlanVersionResponse,
  PurchaseListItem,
} from '../../api/types.ts';
import type { DisclosureSource } from '../../view/disclosure.ts';
import type { CertificateRequest, PurchasesSegmentPorts } from './ports.ts';

/** Core EOD at the frozen configuration. DATA_MODEL section 11, transcribed. */
const CORE_EOD_V3 = {
  schema_version: 1,
  phase_eval: {
    enabled: true,
    profit_target_bp: 600,
    drawdown: {
      type: 'trailing_eod',
      amount_bp: 500,
      lock: { enabled: false, at_profit_cents: null, floor_at_cents: null },
    },
    daily_loss_limit: { type: 'none', amount_bp: null },
    min_trading_days: 1,
    consistency: { enabled: false, max_day_share_bp: null, mode: 'pass_time_dilutable' },
    max_days: null,
  },
  phase_funded: {
    drawdown: {
      type: 'trailing_eod',
      amount_bp: 500,
      lock: { enabled: true, at_profit_cents: null, floor_at_cents: null },
    },
    daily_loss_limit: { type: 'none', amount_bp: null },
    min_trading_days: 0,
    win_days: { required_count: 5, floor_bp: 30, reset_on_payout: true },
    consistency: { enabled: true, max_day_share_bp: 3000, mode: 'payout_gated' },
    buffer_bp: 200,
    cadence_gap_trading_days: 5,
    payout_cap_schedule: [{ from_ordinal: 1, cap_bp: 300 }],
    min_payout_cents: 10_000,
    split_bp: 9000,
    max_payouts: 5,
    post_payout_floor_rule: { mode: 'none' },
  },
  limits: { max_accounts_per_entity: 10 },
  kyc: { triggers: ['second_distinct_account_purchase', 'pre_funded'] },
} as const satisfies PlanRules;

/**
 * The version a reset bought, differing from v3 in FOUR shapes on purpose.
 *
 * One `changed` scalar (`buffer_bp`), one `changed` scalar in a second block
 * (`cadence_gap_trading_days`), one `changed` ARRAY leaf (`payout_cap_schedule`,
 * which ../../view/purchases.ts walks as one leaf rather than by index), and one
 * `added` path (`phase_funded.payout_review_trading_days`). A fixture that only
 * exercised `changed` would leave the two other `RuleChangeKind` members
 * unrendered by anything.
 */
const CORE_EOD_V4 = {
  ...CORE_EOD_V3,
  phase_funded: {
    ...CORE_EOD_V3.phase_funded,
    buffer_bp: 250,
    cadence_gap_trading_days: 7,
    payout_cap_schedule: [
      { from_ordinal: 1, cap_bp: 300 },
      { from_ordinal: 3, cap_bp: 500 },
    ],
    payout_review_trading_days: 2,
  },
} as const satisfies PlanRules;

const PLAN_ID = 'plan_core_eod';

const PLAN_VERSIONS: Readonly<Record<number, PlanVersionResponse>> = {
  3: {
    plan_version_id: 'pv_core_eod_3',
    plan_id: PLAN_ID,
    version: 3,
    status: 'retired',
    published_at: '2026-02-01T00:00:00Z',
    retired_at: '2026-06-01T00:00:00Z',
    rules: CORE_EOD_V3,
    copy_blocks: {},
    sizes: [],
  },
  4: {
    plan_version_id: 'pv_core_eod_4',
    plan_id: PLAN_ID,
    version: 4,
    status: 'published',
    published_at: '2026-06-01T00:00:00Z',
    retired_at: null,
    rules: CORE_EOD_V4,
    copy_blocks: {},
    sizes: [],
  },
};

/**
 * `GET /purchases`, newest first, which is the order a cursor list arrives in
 * and the order ../../view/purchases.ts refuses to re-sort.
 *
 * FIVE ROWS COVERING FIVE STATES. A reset whose earlier purchase IS on the page
 * (the diff renders), a reset whose earlier purchase is NOT (the unpairable
 * panel renders), a refunded purchase (settled is false), a pending purchase
 * with a null `account_id`, and an ordinary paid new purchase.
 */
const PURCHASES: readonly PurchaseListItem[] = [
  {
    purchase_id: 'pur_5',
    created_at: '2026-08-20T14:02:11Z',
    kind: 'reset',
    plan: { plan_id: PLAN_ID, code: 'core_eod', version: 4 },
    size_cents: 5_000_000,
    amount_paid_cents: 14_900,
    discount_cents: 0,
    status: 'paid',
    account_id: 'acc_7f21',
  },
  {
    purchase_id: 'pur_4',
    created_at: '2026-08-11T09:41:00Z',
    kind: 'new',
    plan: { plan_id: 'plan_rapid', code: 'rapid', version: 2 },
    size_cents: 2_500_000,
    amount_paid_cents: 9900,
    discount_cents: 0,
    status: 'pending',
    account_id: null,
  },
  {
    purchase_id: 'pur_3',
    created_at: '2026-07-02T18:15:47Z',
    kind: 'reset',
    plan: { plan_id: 'plan_direct', code: 'direct', version: 6 },
    size_cents: 10_000_000,
    amount_paid_cents: 24_900,
    discount_cents: 5000,
    status: 'refunded',
    account_id: 'acc_1c04',
  },
  {
    purchase_id: 'pur_2',
    created_at: '2026-05-19T11:03:22Z',
    kind: 'new',
    plan: { plan_id: PLAN_ID, code: 'core_eod', version: 3 },
    size_cents: 5_000_000,
    amount_paid_cents: 17_900,
    discount_cents: 3000,
    status: 'paid',
    account_id: 'acc_7f21',
  },
  {
    purchase_id: 'pur_1',
    created_at: '2026-03-04T16:58:09Z',
    kind: 'new',
    plan: { plan_id: 'plan_rapid', code: 'rapid', version: 1 },
    size_cents: 1_000_000,
    amount_paid_cents: 4900,
    discount_cents: 0,
    status: 'paid',
    account_id: 'acc_0aa9',
  },
];

/**
 * `GET /accounts/:accountId/certificate`, keyed the way the contract row is.
 *
 * `acc_7f21` has both a pass and a payout card. `acc_1c04` has a payout card
 * that arrived with a BLANK `verify_url`, which is the case AS-M4-03 is about
 * and the case this screen refuses rather than rendering as an image alone.
 * `acc_0aa9` has neither, which is the ordinary state of an account whose
 * evaluation is still running.
 */
const CERTIFICATES: Readonly<Record<string, CertificateResponse>> = {
  'acc_7f21:pass': {
    certificate_id: '9f3c8b02-7a41-4d55-b0e1-2c6a9d14f7e8',
    kind: 'pass',
    image_url: 'https://cdn.meritfutures.com/cards/QK7M2P.png?exp=1787000000&sig=6a1f',
    verify_url: 'https://meritfutures.com/verify/QK7M2P',
    issued_at: '2026-06-18T21:04:33Z',
    claims: { plan_code: 'core_eod', size_cents: 5_000_000, trading_day: '2026-06-18' },
  },
  'acc_7f21:payout': {
    certificate_id: 'c1d4e7a9-3b62-49f8-8e07-5d21b8c03a44',
    kind: 'payout',
    image_url: 'https://cdn.meritfutures.com/cards/T4WD9R.png?exp=1787000000&sig=b93e',
    verify_url: 'https://meritfutures.com/verify/T4WD9R',
    issued_at: '2026-08-07T13:22:05Z',
    claims: {
      plan_code: 'core_eod',
      size_cents: 5_000_000,
      amount_cents: 150_000,
      trading_day: '2026-08-06',
    },
  },
  'acc_1c04:payout': {
    certificate_id: '2e88a5f1-40cd-4b17-9a3e-71f0c6d29b55',
    kind: 'payout',
    image_url: 'https://cdn.meritfutures.com/cards/unknown.png',
    verify_url: '',
    issued_at: '2026-04-29T10:11:00Z',
    claims: {
      plan_code: 'direct',
      size_cents: 10_000_000,
      amount_cents: 220_000,
      trading_day: '2026-04-28',
    },
  },
};

/**
 * The requests SC-M4-08 makes, one per account and kind.
 *
 * A LIST AND NOT A LOOP OVER THE PURCHASE PAGE. A purchase is not an account and
 * the two do not correspond: a purchase can be pending with no account yet, and
 * an account outlives the page of purchases that created it. The accounts a
 * trader holds are `GET /accounts`, which is SC-M4-02's read and session 259's
 * segment; asking for it here would be this page reaching into that one.
 */
export const CERTIFICATE_REQUESTS: readonly CertificateRequest[] = [
  { account_id: 'acc_7f21', kind: 'pass' },
  { account_id: 'acc_7f21', kind: 'payout' },
  { account_id: 'acc_1c04', kind: 'payout' },
  { account_id: 'acc_0aa9', kind: 'pass' },
];

/**
 * The simulated-environment disclosure, as `content_documents` would serve it.
 *
 * Constitution section 6 and INV-M4-09. The text is the obligation's and not
 * this file's to word, which is exactly why `disclosureBlock()` refuses to let a
 * screen author one: the day a real document exists, this string is replaced by
 * the row and no screen changes.
 */
const DISCLOSURE_TEXT: Readonly<Record<string, string>> = {
  'simulated-environment-disclosure@2':
    'All trading on Merit accounts is simulated. No order placed on a Merit ' +
    'account reaches a live exchange, and no position is held in a live market.',
};

/** The ports, backed by the fixtures above and by no network at all. */
export const FIXTURE_PORTS: PurchasesSegmentPorts = {
  readPurchases(): Promise<readonly PurchaseListItem[]> {
    return Promise.resolve(PURCHASES);
  },

  readPlanVersion(plan_id: string, version: number): Promise<PlanVersionResponse> {
    const found = plan_id === PLAN_ID ? PLAN_VERSIONS[version] : undefined;
    if (found === undefined) {
      // A FIXTURE THAT CANNOT ANSWER SAYS SO. Returning an empty rules object
      // would render as "every rule was removed", which is a diff panel making a
      // false statement about a contract, and it is the exact failure
      // ../../view/purchases.ts's structural walk exists to avoid.
      return Promise.reject(
        new Error(
          `no fixture for plan ${plan_id} version ${String(version)}. ` +
            'The fixtures cover Core EOD versions 3 and 4 only.',
        ),
      );
    }
    return Promise.resolve(found);
  },

  readCertificate(request: CertificateRequest): Promise<CertificateResponse | null> {
    return Promise.resolve(CERTIFICATES[`${request.account_id}:${request.kind}`] ?? null);
  },

  readDisclosure(source: DisclosureSource): Promise<string> {
    return Promise.resolve(DISCLOSURE_TEXT[`${source.slug}@${String(source.version)}`] ?? '');
  },
};
