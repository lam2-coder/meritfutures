## 17. GS-149 to GS-154: integrations (M10)

Defined by [M10](../../plans/M10-integrations.md) section 8.2. Every scenario here is about what leaves the building, or about what happens when a thing outside the building stops answering.

| ID | Name | Pins |
|---|---|---|
| GS-149 | A support agent attempts to address an unassigned identity | The request carries **no identity parameter to tamper with**; the contact reference resolves server side; the read is audited with the exact field list returned. Asserts that the support tool is minimized in the data rather than in the agent's training, because agents are hired to be helpful under time pressure. AS-M10-01, EC-086 |
| GS-150 | An internal analytical question diverges from the published metric | The nightly reconciliation alerts, the **published value does not change**, and the internal question is the one investigated. Asserts that the analytical tool is a checker of the published number rather than a competing source of it. AS-M10-02 |
| GS-151 | Breach at 00:20, detector flag at 00:40, restriction at 09:15 | The commiseration and its reset offer are **suppressed at send**, not delivered at 00:21. Asserts guards evaluate against live state, and that the offer-bearing messages hold deliberately so a late signal has time to arrive. AS-M10-03, EC-087 |
| GS-152 | An unhandled exception on the payout path | The captured payload contains route, release, error class, request id, and account id, and nothing else; the seeded canary never appears vendor-side. Asserts deny-by-default egress on money paths, because a denylist tuned for auth secrets is blind to financial data. AS-M10-04, EC-088 |
| GS-153 | An operational alert dispatched to a mis-set Discord channel | The startup and per-send channel assertion **fails closed and pages**; nothing is posted; and the message body carried a severity and a link rather than a figure in any case. Asserts that an operations alert conveys what an operator must act on and nothing a reader could quote. AS-M10-05 |
| GS-154 | Every vendor returns 500, then times out | Purchase, provisioning, payout request, and payout settlement all complete; messages queue and dead-letter with replay available. Asserts INV-M10-01 as an executable assertion rather than an agreed principle. AS-M10-06, EC-089 |
