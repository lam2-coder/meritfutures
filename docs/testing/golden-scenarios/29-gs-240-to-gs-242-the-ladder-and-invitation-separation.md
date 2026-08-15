## 29. GS-240 to GS-242: the ladder and invitation separation

[ADR-024](../../decisions/ADR-024.md).

| ID | Scenario | Pins |
|---|---|---|
| GS-240 | Ladder completion graduates without inviting | The fifth settlement sets phase `graduated`, closes the account, and sets `graduation_eligible`. **No invitation event is emitted.** Asserts R-49's split, which is the mechanical half of the decoupling |
| GS-241 | INV-17's bound at the shortened ladder | No sequence of settlements exceeds `5 * max cap`. At Core EOD 50K that is 750,000c gross and 675,000c to the trader; at Merit Rapid 500,000c and 450,000c. Replaces the 8-rung expectations in GS-067's neighbourhood |
| GS-242 | Percent-of-size scaling holds at 150K | Every bp-expressed parameter derives correctly at 15,000,000c, and `min_payout_cents` does **not** scale. Pins that adding a size is a row rather than a redesign ([ADR-024](../../decisions/ADR-024.md)) |
