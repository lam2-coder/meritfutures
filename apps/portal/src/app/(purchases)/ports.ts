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
// THE IMPLEMENTATION HAS ARRIVED AND THIS FILE DID NOT MOVE, WHICH IS WHAT AN
// INTERFACE IS FOR. ADR-162 landed the portal's one HTTP client and ./source.ts
// implements every method below against it, over `apps/portal/src/http/
// client.ts` and nothing else. ./fixtures.ts implements the same interface for
// the suite. The signatures are unchanged from the ref that could not call
// anything, which is the claim this file made and is now the record of.
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
//   readPurchases        `GET /purchases`                      REGISTERED
//   readPlanVersion      `GET /plans/:planId/versions/:v`       REGISTERED
//   readCertificate      `GET /accounts/:accountId/certificate` REGISTERED
//   readDisclosure       no contract row exists at all.         See below
//
// THREE OF THE FOUR ARE NOW REGISTERED, MEASURED FROM
// `CompositionReport.registered` ON BOTH SURFACES RATHER THAN FROM A GREP.
// ./source.ts carries that measurement and the two rows it adds to it.
//
// THE PARAGRAPH THAT USED TO SIT HERE IS NO LONGER TRUE AND IS REPLACED RATHER
// THAN DELETED, which is ADR-168's own convention applied to this file a second
// time. It read: `GET /accounts/:accountId/certificate?kind=pass|payout` "is
// API_CONTRACT section 6, approved. Sessions 251 to 258 divide the 33 unwritten
// contract endpoints between them and NONE of them claims this row ... So the
// trader's certificate screen has an approved contract row and no session
// building it." A session built it; `apps/api/src/routes/account-reads.ts`
// registers the row and its backend method rejects with a stated blocker, so the
// endpoint answers 503 until a wiring slice installs one. THAT IS A REGISTERED
// ENDPOINT FAILING AND NOT A MISSING ONE, and ./source.ts reports it as such.
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
// THE LIST ENDPOINT NOW EXISTS, AND THIS PORT STILL DOES NOT GAIN A METHOD
// -----------------------------------------------------------------------------
// `readCertificate` IS SINGULAR BECAUSE THE CONTRACT ROW IT CALLS IS SINGULAR.
// It returns one certificate for one account and one kind.
//
// THE SENTENCE THAT USED TO SIT HERE IS NO LONGER TRUE AND IS REPLACED RATHER
// THAN DELETED. It read: M11 section 4 names `GET /certificates` NEW, "the
// trader's own list, including `deferred` entries with their reason", "and that
// row is M11's and is in no API_CONTRACT section today". ADR-168 ruled that a
// commitment made by an approved module plan and absent from the interface
// contract is a MISSING ROW rather than a segment reaching for scope, and the
// row landed: API_CONTRACT section 6.3, `GET /certificates`, session scoped,
// with the deferred entries typed and the paging envelope stated.
//
// AND THE SENTENCE THAT REPLACED IT HAS NOW GONE THE SAME WAY, WHICH IS WORTH
// LEAVING VISIBLE. It read: "Admitting a row to an approved contract is an
// entry; REGISTERING it is a later slice, and `discoverRouteModules()` composed
// against this tree still serves no `/certificates` path on either surface." It
// does now. Session 297 registered `GET /certificates` and
// `GET /certificates/:code/image.png`, and both appear in
// `CompositionReport.registered` on the public surface.
//
// THIS PORT STILL DOES NOT GAIN A METHOD, AND THE REASON MOVED RATHER THAN
// DISAPPEARING. `GET /certificates` answers `CertificateListResponse`, whose
// item carries `state`, `code`, `deferred` and `revoked`; ../../api/types.ts
// transcribes `CertificateResponse` and no list item, and ./model.ts and
// ../../view/certificates.ts consume the singular row's shape. So the read is
// REGISTERED-AND-UNTRANSCRIBED rather than owed, ./source.ts names it in that
// vocabulary, and this screen goes on assembling its list per account and per
// kind. Whoever transcribes the item writes the guard beside ./source.ts's, adds
// the method here, and replaces the assembly.

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
