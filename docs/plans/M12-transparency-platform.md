---
status: draft
depends_on: []
last_updated: 2026-08-14
---

# M12: Transparency Platform

Module plan placeholder. Content is generated in Wave 3 following the mandatory B5 ten-section template: (1) purpose and invariants; (2) entities/schema deltas; (3) full state machines; (4) API endpoints touched; (5) events emitted/consumed; (6) failure-mode enumeration; (7) adversarial scenarios (minimum 5 novel); (8) test plan; (9) observability; (10) open questions for the founder.

Gate: no module code begins until this plan is reviewed and section 7 contains creative scenarios not found in the constitution.

## Research inputs queued for drafting (Wave 1 amendment, 2026-08-14)

- **Trustpilot auto-review request on payout settlement.** The Axcera Futures Solution brochure (February 2026, primary source; [PROP_TECH_LANDSCAPE section 1.2](../../research/PROP_TECH_LANDSCAPE.md)) ships an automatic Trustpilot review request triggered when a payout settles. Classify **SHOULD/LATER**. The trigger would consume `payout.settled`. **Mandatory when specced: an explicit compliance check against Trustpilot's ToS and platform review-solicitation policies.** Soliciting reviews only at the trader's happiest moment is selective solicitation, which review platforms treat as review gating; a transparency module in particular cannot afford a review-manipulation finding. The check is part of the spec, not a launch-day afterthought.
