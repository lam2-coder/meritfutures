# Parameter status: launch candidates versus structural rulings (founder ruling, 2026-08-14)

Recorded here as well as in [STATE](../../STATE.md) and [M01 Appendix A.0](../../plans/M01-rules-engine.md) because twelve module plans are about to cite it, and a ruling that binds a whole wave needs one stable anchor rather than a sentence people remember differently.

**Every plan parameter is a versioned-config launch candidate.** Prices, caps, win-day counts, consistency ratios, buffers, cadence gaps, splits, and ladder counts are **economically validated working values**, produced by the lifecycle simulation and intended for launch. They are **formally confirmed by the founder at the FREEZE gate** and are **tunable up to launch without an engine change**, because each is a row in `plan_version_sizes` rather than a constant in code.

**Structural rulings are fixed absent a new ADR**: that universal per-payout caps exist, that the payout ladder exists and bounds lifetime extraction, [EOD semantics](../../GLOSSARY.md#t1) as the authoritative tier, zero denial, [ADR-014](../ADR-014.md)'s permanent floor lock, and [ADR-019](../ADR-019.md)'s cadence anchor.

**The two binding consequences for every public surface**, which is why this ruling reaches past M01:

1. **A parameter is read, never copied.** Any surface that shows a number must read it at request time from the account's pinned plan version or from the published plan version, never from a literal in a template, a chart axis, a price card, or a piece of blog copy. Binding on [M09](../../plans/M09-marketing-site.md), [M11](../../plans/M11-certificates-social-proof.md), [M12](../../plans/M12-transparency-platform.md), [M13](../../plans/M13-trader-analytics-journal.md), [M17](../../plans/M17-offers-engine.md), and [M18](../../plans/M18-graduation-track.md).
2. **A structural ruling is never marketed as a tunable.** "Caps exist" is not a promotion and may not be offered, waived, or framed as a limited-time condition. The cap's *value* is a config; the cap's *existence* is not. Binding on [M17](../../plans/M17-offers-engine.md) alongside [ADR-019a](../ADR-019.md).

---
