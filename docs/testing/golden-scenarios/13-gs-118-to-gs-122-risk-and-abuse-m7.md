## 13. GS-118 to GS-122: risk and abuse (M7)

Defined by [M07](../../plans/M07-risk-abuse.md) section 8.1. The ring rehearsal (GS-050) and the M1 adversarial fixtures it depends on (GS-054, GS-060, GS-062) are shared and stay where they are.

| ID | Name | Pins |
|---|---|---|
| GS-118 | Detection cadence beats extraction on the minimum-variance path | A six-account ring on the 5 trading day path is flagged by fill clustering and group exposure before the first settlement lands, and the inverse-pair detector is asserted **not** to have fired, because its 20 day window has no data yet. Pins the honest conclusion that the flagship correlation detector does not defend the first cycle at all. AS-M7-01 |
| GS-119 | Three-leg rotation defeats pairwise correlation and not group variance | Every pair sits comfortably inside the pairwise threshold while the group's summed variance sits far below the sum of member variances, and the group detector fires. Pins the invariance that makes rotating legs pointless. AS-M7-02 |
| GS-120 | Queue ordering under manufactured noise | Fifty innocent clustering flags do not outrank one identity with three independent detector families implicated, and a detector whose precision collapses is auto-demoted to digest severity as a data change rather than a deploy. Pins attention as the scarce resource an adversary can attack. AS-M7-03 |
| GS-121 | Household signals produce a soft link and never a merge | Shared IP, shared device, and shared card across two identities produce edges below the confidence ceiling, caps do **not** aggregate, and a disputed link renders on the graph before an admin acts. Pins the asymmetry: over-merging harms people who did nothing wrong and who are sympathetic, articulate, and telling the truth. AS-M7-04 |
| GS-122 | A detector run that finds none of its own canaries | Status `degraded`, `detector.run_degraded` emitted, page fired. Synthetic subjects are excluded from every aggregate and are regenerated per run rather than static. Pins the only difference between a broken detector and a quiet night. AS-M7-05 |
