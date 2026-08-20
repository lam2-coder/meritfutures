---
status: approved
depends_on: [README.md]
last_updated: 2026-08-20
---

## 36. GS-285 to GS-299: the vendor-parity gap-fill (FOLD-03)

`ADR-066` and `ADR-067`, planned by [FOLD-03](../../plans/FOLD-03-vendor-parity-gap-fill.md). **Both ADRs are reserved and unwritten**, so these scenarios are allocated ahead of the rulings they pin, on [ADR-034](../../decisions/ADR-034.md)'s rule that the claim precedes the artifact. **They are registered here so that four concurrent folding sessions cannot race for numbers**, which is the collision this registry has already recorded twice.

**The range continues from the registry maximum, derived rather than quoted.**

**GS-296 to GS-299 are money path and are written by `ADR-067`'s own session**, not by the fold sessions. They are listed here because the numbers are spent either way and a hole is worse than a forward reference.

**Three of these pin a control declining to act, which is the half a parity check never asks for.** GS-287 pins a stale calendar declining to fire, GS-292 pins a soft link changing nothing, and GS-295 pins a spam complaint leaving the security class alone. **A gap-fill driven by a competitor demo will specify the doing and not the refusing**, and the refusing is where zero denial lives.

| ID | Scenario | Pins |
|---|---|---|
| GS-285 | A Tier-1 event renders on two traders' dashboards in two timezones | Both read **one** [`economic_calendar`](../../architecture/data-model/economic_calendar.md) row through `economic_calendar_current`. The panel's source is Merit's table and not an embed ([M04](../../plans/M04-trader-portal.md) `INV-M4-16`), which is the only mechanical form of "one source of truth for when was the news". **There is no timezone column**: the conversion is a rendering, so two correct answers come from one stored instant rather than from two rows |
| GS-286 | A scheduled release time is revised after publication | The panel and `D-04`'s window **both** move to the new instant, **because there is no "both" to move separately**: a revision is a new row at the next `revision` number and both consumers read `economic_calendar_current`, whose only definition of "current" is the highest revision. `DEP-M7-06` is satisfied by a dataset that carries a revision, not by a static import. The original row is still there, so what the calendar said when `D-04` read it stays answerable |
| GS-287 | The calendar passes its staleness threshold | The alarm fires per `FM-M7-08` from [`economic_calendar_loads`](../../architecture/data-model/economic_calendar_loads.md)`.coverage_end_day`, and **`D-04` declines to fire rather than firing on stale windows**. Firing on a wrong window manufactures evidence against a trader, which is worse than not firing. **The coverage bound is what makes declining possible at all**: without it an exhausted calendar returns no releases, which is byte-identical to a quiet week, so `D-04` would report a clean result it has no basis for |
| GS-288 | A scheduled digest fails to deliver while the job reports success | The alarm fires from the `report_deliveries` record. **[M05](../../plans/M05-payout-system.md) `INV-M5-18`'s idiom on a second sweep**: a job that reports success is not evidence that the work happened |
| GS-289 | The daily liability digest is generated for an estate with named traders | The digest carries aggregates and no trader-identifying rows, so `INV-M6-10`'s no-bulk-export rule survives a delivery channel that leaves the console |
| GS-290 | A digest schedule names a recipient who has been removed | Delivery degrades to the remaining recipients **and records the removal**. A schedule that silently drops a recipient is the liability blindness this feature exists against |
| GS-291 | A shared IP across three identities and a shared payment fingerprint across two, the second carrying higher open liability | The payment fingerprint **ranks first**. Sorting by signal count teaches an operator to chase coffee shops; [M07](../../plans/M07-risk-abuse.md):94 says a shared IP is one |
| GS-292 | A soft link appears in a standing duplicate-signal view | It renders **as a soft link**, aggregates no cap and **changes nothing the trader may buy**. The view reads the tier and computes no confidence of its own |
| GS-293 | A security-class message bounces | The alarm fires and the trader is **not silently locked out**. OTP login depends on deliverability, so a silent bounce on this class is an access incident |
| GS-294 | An admin resends a notice after its template has changed | The **stored `rendered_body` snapshot** is delivered, not a re-render. Proof of notice survives a template change, which is `FM-M16-05`'s whole concern |
| GS-295 | A trader files a spam complaint | Marketing-class delivery is suppressed and **security class is untouched**. A complaint that silenced every class would silence the freeze notice, which [M16](../../plans/M16-notification-center.md) section 1.2's five-class table already forbids |
| GS-296 | **`ADR-067`** A goodwill credit is posted, then the trader requests a payout | Whichever way `OQ-F3-01` is ruled, **stated**: either the adjustment is excluded from eligibility and the credit is unwithdrawable, or it is admitted and **flagged on the request**. Zero denial makes an admitted adjustment an obligation |
| GS-297 | **`ADR-067`** An adjustment is reversed | The reversal is **a second double-entry posting**, never a deletion or a balance mutation. Open Liability moves twice and the timeline carries both |
| GS-298 | **`ADR-067`** An adjustment is attempted against a **restricted** identity | Refused or held, per the ruling. **The state is `restricted` and not `suspended`**: [`0001`](../../../packages/db/migrations/0001_extensions_and_enums.sql):27 declares `('active','restricted','closed')` and [ADR-041](../../decisions/ADR-041.md) refused to add a fourth |
| GS-299 | **`ADR-067`** An adjustment crosses the configurable dual-control threshold | It enters [M06](../../plans/M06-admin-ops-console.md) section 3.4's pending state, binds to a **payload hash**, and applies only when a second owner approves the same hash. **This is the amendment to [ADR-010](../../decisions/ADR-010.md)'s closed sensitive set**, exercised |
