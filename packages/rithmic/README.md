# @merit/rithmic

The platform adapter: `provision`, `entitle`, `ingestFills`, `ingestEOD`,
`reconcile`. It isolates every vendor specific behind the interface so that
adapter #2 is additive rather than a rewrite.

**The interface is declared and nothing implements it.** M02 holds at `review`
by [ADR-005](../../docs/decisions/ADR-005.md) pending the Rithmic vendor call: file
naming conventions, delivery acknowledgement, the arrival window, vendor-side
retention and sandbox availability are all provisional. Writing an
implementation against unconfirmed mechanics is how a bounded edit becomes a
redesign, which is the outcome ADR-005 exists to avoid.

The synthetic simulator is the fixture rather than a mock beside it, per
[STRATEGY section 2](../../docs/testing/STRATEGY.md), and it arrives with M02.
