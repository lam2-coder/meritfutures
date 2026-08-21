// =============================================================================
// apps/site/src/routes/geo.ts
// =============================================================================
// AS-M9-04. SOLICITATION IS NOT THE SAME ACT AS SALE.
//
// The scenario's own summary of why it nearly passes review: "Every engineering
// control is present and working. The restricted-country visitor genuinely
// cannot buy. The gap is that 'cannot buy' and 'was not solicited' are
// different claims, and only the first one was ever designed for."
//
// SO EVERYTHING IN THIS FILE IS DISCLOSURE AND NONE OF IT IS ENFORCEMENT, and
// saying that once at the top is worth more than saying it three times below.
// M9 section 1.2 puts enforcement at checkout ([M3](M03)) and at verification
// ([M19](M19)). M9 section 3.3's state machine carries the same note inside the
// drawing: "This is disclosure and courtesy, not a control... A VPN defeats this
// state machine and is expected to."
//
// FM-M9-04 IS THEREFORE A DEGRADATION AND NOT AN OUTAGE: "**Fail open on the
// notice and closed at checkout.** The notice is courtesy; the control is server
// side and unaffected." `GeoLookupPort.lookupCountry` returns `null` when the
// edge could not say, and `unknown` below is that case rendered as the normal
// page. A site that hard-blocked on a failed lookup would convert a courtesy
// into an outage for every visitor on earth.
//
// OQ-M9-03 IS OPEN AND THIS FILE IMPLEMENTS ITS PROPOSAL RATHER THAN ITS
// ANSWER. "Whether counsel wants the site to serve a hard block, a notice, or
// nothing at all in restricted jurisdictions. All three are defensible and the
// choice is not an engineer's." The proposal is notice plus call-to-action
// suppression, and `GeoDisposition` is a closed union of exactly those three so
// that counsel's ruling changes one function rather than every surface.
// =============================================================================

/** M9 section 3.3's three states, and OQ-M9-03's three candidate answers. */
export type GeoDisposition =
  /** No lookup yet, or the lookup failed. FM-M9-04: fail open. */
  'unknown' | 'unrestricted' | 'restricted';

/** What a page needs to know about the visitor's jurisdiction. */
export interface GeoNotice {
  readonly disposition: GeoDisposition;
  /** The country the edge reported. `null` when it could not say. */
  readonly country: string | null;
  /**
   * AS-M9-04: the notice names the jurisdiction and states plainly that Merit
   * does not accept traders there. `null` on every non-restricted disposition.
   */
  readonly notice: string | null;
  /** Whether the call to action is shown. Suppressed only when restricted. */
  readonly show_call_to_action: boolean;
  /** Where the published restricted list lives, so the notice can link to it. */
  readonly restricted_list_path: string;
}

/**
 * The disposition for one visitor.
 *
 * THE LIST IS AN ARGUMENT AND IS NEVER A CONSTANT IN THIS FILE. DEP-M9-04:
 * "`geo_restrictions` is the single source for checkout enforcement, campaign
 * targeting, and the site notice", and its unmet consequence is "the targeting
 * configuration and the enforcement configuration drift, which is AS-M9-04's
 * worst version". A country code typed into this module would be that drift
 * created deliberately.
 *
 * MATCHING IS CASE INSENSITIVE ON AN ISO CODE AND NOTHING MORE. There is no
 * region logic, no partial match and no aliasing, because each of those is a
 * place where the site's idea of "restricted" could differ from checkout's
 * while both read the same table.
 */
export function geoNotice(
  country: string | null,
  restricted: readonly string[],
  restricted_list_path = '/restricted-jurisdictions',
): GeoNotice {
  if (country === null) {
    return {
      disposition: 'unknown',
      country: null,
      notice: null,
      show_call_to_action: true,
      restricted_list_path,
    };
  }

  const normalized = country.trim().toUpperCase();
  const isRestricted = restricted.some((code) => code.trim().toUpperCase() === normalized);

  if (!isRestricted) {
    return {
      disposition: 'unrestricted',
      country: normalized,
      notice: null,
      show_call_to_action: true,
      restricted_list_path,
    };
  }

  return {
    disposition: 'restricted',
    country: normalized,
    notice:
      `Merit does not accept traders in ${normalized}. You are welcome to read the ` +
      'plans and the rules, and an account cannot be opened from this jurisdiction.',
    show_call_to_action: false,
    restricted_list_path,
  };
}
