// =============================================================================
// apps/portal/src/app/(purchases)/ports.ts
// =============================================================================
// WHAT THIS SEGMENT NEEDS FROM THE API, NAMED RATHER THAN INVENTED.
//
// Session 253 is writing `GET /purchases` concurrently and no HTTP client for
// it exists on this ref. A page that invented one would be writing half of
// somebody else's route against a shape nobody had agreed, so this file
// declares the READS as an interface and leaves the implementation to the
// session that owns the route. It is `apps/site/src/catalog/ports.ts`'s idiom
// one application over, and `apps/worker/src/batch/ports.ts`'s before that.
//
// NOTHING HERE OPENS A CONNECTION AND NOTHING HERE IS A WRITE. Every method is
// a read of the caller's own data. `POST /checkout`, `POST /accounts/:id/reset`
// and the `rule_diff_acknowledged_at` acknowledgement are absent for the reason
// ../../view/purchases.ts states at length: the acknowledgement is a WRITE on
// M03's ceremony (AS-M3-05) and capturing it here would build the half that
// cannot be tested.
//
// -----------------------------------------------------------------------------
// THE FOUR READS, AND WHO OWES EACH ONE
// -----------------------------------------------------------------------------
//   readPurchases        `GET /purchases`                     session 253
//   readPlanVersion      `GET /plans/:planId/versions/:v`      session 253
//   readCertificate      `GET /accounts/:accountId/certificate` NOBODY. See below
//   readDisclosure       no contract row exists at all.         See below
//
// TWO OF THE FOUR HAVE NO OWNER AND THAT IS A FINDING RATHER THAN A GAP IN THIS
// FILE.
//
// `GET /accounts/:accountId/certificate?kind=pass|payout` is API_CONTRACT
// section 6, approved. Sessions 251 to 258 divide the 33 unwritten contract
// endpoints between them and NONE of them claims this row: 251 takes the four
// `/accounts` rows and the certificate row is not among them. So the trader's
// certificate screen has an approved contract row and no session building it.
//
// The disclosure is worse and it is already on the record. ../../view/
// disclosure.ts: "NO CONTRACT ROW SERVES `content_documents` TO THE PORTAL, so
// `disclosureBlock()` takes the document's address as an ARGUMENT and the
// provenance is asserted by the caller rather than proven." INV-M4-09 makes the
// simulated-environment disclosure a compliance obligation on this screen, and
// the portal has no wire source for its text. That is why the port below takes
// a `DisclosureSource` and returns text: the shape is what an endpoint would
// have, so the day one exists this signature does not move.
//
// -----------------------------------------------------------------------------
// ONE SHAPE THE CONTRACT DOES NOT HAVE, SAID PLAINLY
// -----------------------------------------------------------------------------
// `readCertificate` IS SINGULAR BECAUSE THE CONTRACT ROW IS SINGULAR. It returns
// one certificate for one account and one kind. M11 section 4 names
// `GET /certificates` NEW, "the trader's own list, including `deferred` entries
// with their reason", and that row is M11's and is in no API_CONTRACT section
// today. So this screen assembles its list by asking per account and per kind,
// which is the shape the approved contract can actually answer, and the list
// endpoint is named as owed rather than assumed.

import type {
  CertificateResponse,
  PlanVersionResponse,
  PurchaseListItem,
} from '../../api/types.ts';
import type { DisclosureSource } from '../../view/disclosure.ts';

/** One account and one certificate kind, which is what the contract row keys on. */
export type CertificateRequest = {
  readonly account_id: string;
  readonly kind: 'pass' | 'payout';
};

/**
 * `GET /purchases`. Session 253.
 *
 * NO CURSOR ARGUMENT, AND THE ABSENCE IS DELIBERATE. The contract calls it a
 * cursor list and names no cursor field in `PurchaseListItem`, so the paging
 * token's shape is not settled on this ref. A parameter invented here would be
 * a guess this screen then renders paging controls against. The first page is
 * what this segment reads and the second page is owed with the cursor.
 */
export interface PurchaseReadPort {
  readPurchases(): Promise<readonly PurchaseListItem[]>;
}

/**
 * `GET /plans/:planId/versions/:version`. Session 253.
 *
 * SD-M4-02's rule diff needs BOTH versions and the purchase list carries only
 * `plan.version`, so the diff costs two reads of this port and never a
 * subtraction. Auth on this row is `none` and the response is the same for
 * every caller, which is why a purchase row can name a version the caller no
 * longer holds and still be diffable.
 */
export interface PlanVersionReadPort {
  readPlanVersion(plan_id: string, version: number): Promise<PlanVersionResponse>;
}

/**
 * `GET /accounts/:accountId/certificate?kind=pass|payout`. UNOWNED.
 *
 * Returns `null` for an account that has no certificate of that kind, which is
 * the ordinary case and not an error: a trader who has not passed has no pass
 * card. INV-M11-09 additionally makes `deferred` a real state, and the approved
 * response shape cannot express it, so a deferred certificate is indistinguish-
 * able from an absent one here. That is M11's list endpoint's job and it is
 * named in this file's header rather than guessed at.
 */
export interface CertificateReadPort {
  readCertificate(request: CertificateRequest): Promise<CertificateResponse | null>;
}

/**
 * The published legal text one required disclosure was written in. NO CONTRACT
 * ROW SERVES THIS.
 *
 * Returns the raw text and never a `DisclosureBlock`: minting the brand is
 * `disclosureBlock()`'s and it refuses a blank string, which is the check that
 * has to run on whatever a real endpoint returns rather than on a fixture.
 */
export interface DisclosureReadPort {
  readDisclosure(source: DisclosureSource): Promise<string>;
}

/** Everything this segment reads, in one place. */
export interface PurchasesSegmentPorts
  extends PurchaseReadPort, PlanVersionReadPort, CertificateReadPort, DisclosureReadPort {}
