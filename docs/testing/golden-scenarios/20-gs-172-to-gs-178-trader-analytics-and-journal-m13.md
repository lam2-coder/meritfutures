## 20. GS-172 to GS-178: trader analytics and journal (M13)

Defined by [M13](../../plans/M13-trader-analytics-journal.md) section 8.2. Every adversary in this set is internal: a second implementation, a helpful feature, and a load pattern.

| ID | Name | Pins |
|---|---|---|
| GS-172 | Consistency share rendered on analytics against the engine's value | Equal **to the cent**, and the analytics database role cannot read plan config at all. Asserts that a second rulebook is prevented by permission rather than by care, since a review catches the obvious version and a unit test written by the same engineer tests the same misunderstanding. AS-M13-01, EC-099 |
| GS-173 | A backdated correction lands on a day already snapshotted | The inputs digest changes, `analytics.history_changed` notifies with cause and date range, and the trader is told before they notice. Asserts that told-first-by-Merit and noticed-later-by-them are different products. AS-M13-02, EC-100, extends GS-034 |
| GS-174 | Journal content requested from the risk, admin, evidence, and support paths | All four fail **by database grant**; trader view and trader export succeed. Asserts the privacy promise is an absence of a code path rather than a policy, which is the only form of it worth publishing. AS-M13-03, EC-101 |
| GS-175 | An equity series with a live final point appended | Build failure: a series carrying mixed provenance does not render. Asserts that a label at the foot of a chart does not stop a trader reading a line as a line, on the very number they use to decide whether to keep trading. AS-M13-04, [ADR-020](../../decisions/ADR-020.md) |
| GS-176 | An R-multiple requested with no declared risk | **Absent with a stated reason**, never inferred; with a trader-declared risk it computes and says the risk was trader-supplied. Asserts that a definitionally circular metric is worse than a missing one because it looks rigorous. AS-M13-05, EC-102 |
| GS-177 | A percentile or population comparison requested | No such endpoint exists; self-comparison across the trader's own accounts succeeds. Asserts that a percentile endpoint is an enumerable oracle over the population distribution, which is the raw material for the figures M12 deliberately does not publish. AS-M13-06 |
| GS-178 | Analytics load concurrent with a payout wave | Payout request p95 holds under its target and **analytics degrades first**. Asserts the only interaction that matters, which testing the two suites separately would never have exercised. AS-M13-07, EC-103, pairs with GS-051 |
