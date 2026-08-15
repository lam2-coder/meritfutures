## 30. GS-243 to GS-245: the cap-release rejection and cross-account loyalty (M14)

[ADR-025](../../decisions/ADR-025.md). GS-179 above is rewritten by the same ruling and stays where it is.

| ID | Scenario | Pins |
|---|---|---|
| GS-243 | INV-17's bound computed for a first-time buyer and for an identity on its tenth completed ladder | **Equal to the cent**, on every plan and every size. The executable form of INV-M14-11 and of ADR-025's central claim: cross-account loyalty changes the price of the next purchase and the order of a discretionary queue, and changes no number the engine reads. AS-M14-01 |
| GS-244 | An identity completes its Nth ladder while under an open severity 4+ flag | The **milestone is earned and recorded**; **no perk is issued** while the exclusion holds, evaluated at computation and again at issuance; and the milestone is **not revoked** when the review closes, because the fact is true. Pins that a loyalty program which withholds a reward and a loyalty program which erases an achievement are different products. AS-M14-08, EC-139 |
| GS-245 | Loyalty bonus credit funds an evaluation that passes and pays out | The credit posts as `promotional_credit` and **never** as `trader_wallet`; the resulting payout credits the wallet normally; and the first withdrawal containing that value is **held for review** under [M20](../../plans/M20-wallet.md)'s P-1. Pins that loyalty is a new **source** of promotional credit and deliberately not a new **class** of it, so it inherits an existing control rather than needing one. AS-M14-08, EC-139, extends GS-222 |
