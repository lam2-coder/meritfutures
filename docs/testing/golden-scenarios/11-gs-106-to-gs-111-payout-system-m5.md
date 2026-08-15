## 11. GS-106 to GS-111: payout system (M5)

Defined by [M05](../../plans/M05-payout-system.md) section 8.2. The B4 payout battery (GS-035 to GS-039, GS-048, GS-051) is shared and stays where it is.

| ID | Name | Pins |
|---|---|---|
| GS-106 | A settled payout never appears as an adjustment on any mark | The observation window expires, `payout.balance_reflection_missing` pages, the account is `recon_blocked`, and the payout is **not** reversed. Asserts that having paid and the account knowing it was paid are two separate claims, and that the second one is checked. AS-M5-01 |
| GS-107 | Name match scored across a realistic set | Transliteration, a married name, middle-name ordering, and a genuine third-party destination. Only the last crosses the freeze threshold and every score is recorded. Asserts the check is a tunable score rather than a boolean, because a strict string comparison freezes real traders and catches no mules. AS-M5-02 |
| GS-108 | Ten correlated accounts under one identity approve on the same day | All ten individually correct and individually capped; the identity-level forecast showed the wave before it landed; `treasury.coverage_changed` fired the same-day top-up trigger. Asserts that the answer to a correlated wave is liquidity and visibility, never a payout block. AS-M5-03, pairs with GS-062 |
| GS-109 | A freeze reaches its expiry with no decision made | The payout **releases**. Extension requires a separate audited action with its own written reason. Asserts that an unbounded hold is a denial nobody had to authorize, and that the clock binds Merit rather than the trader. AS-M5-04 |
| GS-110 | A one cent per-transaction ledger imbalance | Halts payouts for the implicated identity only; a global sum mismatch halts everything and pages. Asserts that the system's own safety control is not itself a cheap denial-of-payouts trigger. AS-M5-05 |
| GS-111 | Settlement rail outage during a payout wave | Transfers queue with idempotency keys intact, no state is lost, and the pre-written comms template reaches every affected trader before any of them asks. Asserts that the communications response is part of the definition of done, not an afterthought. AS-M5-07 |
