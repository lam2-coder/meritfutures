## 10. GS-100 to GS-105: trader portal (M4)

Defined by [M04](../../plans/M04-trader-portal.md) section 8.2. These are Playwright and component-contract fixtures rather than engine fixtures, and they follow the same rule: each pins a decision, not a rendering.

| ID | Name | Pins |
|---|---|---|
| GS-100 | Consistency meter and dilution amount render on a **passing** account | Both visible when the gate passes, not only when it fails. The OQ-9 ruling, and the reason AS-13 (making money and losing eligibility) does not read as a moved goalpost. AS-M4-01 |
| GS-101 | Eligibility moves between dashboard render and confirm | The confirm step re-fetches, states plainly that the amount changed, and requires fresh confirmation; the request body carries the displayed amount so the server clamp can only ever reduce it. Asserts the trader's screenshot and their payout can never disagree. AS-M4-02 |
| GS-102 | Certificate verification: valid, unknown, revoked | Valid resolves to the signed claims; an unknown code returns "no certificate with this code" rather than "fake"; a revoked certificate states its revocation. Asserts the verification page is the authority and the image never is. AS-M4-03 |
| GS-103 | Breach screen ordering at every breakpoint | Floor, day low, shortfall, and rule name appear above the reset call to action at 375px and 1280px, with no countdown and no pre-selected option. Asserts the ordering itself is the anti-dark-pattern control. AS-M4-04 |
| GS-104 | Payout destination change enters a 48 hour cooling window | Accepted, not effective, notified to the existing contact, and visible in the active-session view. Asserts the one control that survives an attacker holding a valid session. AS-M4-05 |
| GS-105 | Eligibility notification names its trading day and links to the gates screen | The body carries "as of <trading day>" and deep-links to eligibility rather than to a request action. Asserts a notification never promises an outcome it cannot guarantee is still true. AS-M4-06 |
