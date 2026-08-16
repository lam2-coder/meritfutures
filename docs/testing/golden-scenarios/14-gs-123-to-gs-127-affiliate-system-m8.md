## 14. GS-123 to GS-127: affiliate system (M8)

Defined by [M08](../../plans/M08-affiliate-system.md) section 8.1. GS-045, the B4 self-purchase case, is shared and stays where it is.

| ID | Name | Pins |
|---|---|---|
| GS-123 | Chargeback lands after the commission was paid | The clawback posts, the affiliate balance goes negative and nets against future commission, and a chargeback rate above the threshold **holds the next statement** pending review rather than merely appearing on a dashboard. Pins the accepted consequence of paying affiliates before the chargeback window closes, which is the only commercially available option. AS-M8-01 |
| GS-124 | An affiliate whose referred buyers cluster on shared signals | The concentration flag fires, commission is withheld on purchases by identities linked above the confidence ceiling, and a genuine family referral below the ceiling is **not** voided. Pins the extension of the self-deal check from "the buyer is the affiliate" to "the buyer is linked to the affiliate". AS-M8-02 |
| GS-125 | Ten thousand clicks with a near-zero conversion rate | The suspicious-pattern event fires on the clicks-to-conversions ratio and the distinct-referrer count, routes to the risk queue, and does **not** auto-suspend. The 30 day attribution window is deliberately unchanged, because shortening it would punish legitimate content affiliates to stop a pattern that is detectable directly. AS-M8-03 |
| GS-126 | A required disclosure version is superseded | Every creative bound to the old version is withdrawn automatically, and an approved landing page whose content later changes reverts to `pending` on re-check. Pins approval as per-asset and per-disclosure-version rather than a boolean on the affiliate. AS-M8-04 |
| GS-127 | An affiliate destination also receives trader payouts from unrelated identities | The shared destination-concentration detector fires across both payment types, because affiliate payments ride the same transfer machinery as trader payouts. Pins the general rule that every outbound payment path in Merit is the same path. AS-M8-05 |
