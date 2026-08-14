---
status: draft
depends_on: []
last_updated: 2026-08-13
---

# DECISIONS (ADR registry)

Every choice with rationale and alternatives. Constitution amendments are proposed here. ADR format per entry:

```
## ADR-NNN: <title>  (YYYY-MM-DD, status: proposed | accepted | superseded)
- Context:
- Decision:
- Alternatives considered:
- Consequences:
```

The Open Decisions Register (constitution section 10) resolves into entries here during W1 with the founder: queue tech, ORM, Rithmic ingest path, PSP shortlist, auth provider, hosting, restricted-jurisdiction list, Discord bot scope, KYC placement (M19).

---

## ADR-001: Repo root stands in for `merit/`  (2026-08-13, status: proposed)
- Context: Section 0.5 draws the skeleton under a `merit/` directory. The git repo `meritfutures` already holds the constitution at its root.
- Decision: Treat the repo root as `merit/`; the skeleton lives directly at root.
- Alternatives considered: Nesting everything under a `merit/` subdirectory (adds a pointless path segment to every reference).
- Consequences: All constitution paths map 1:1 with the leading `merit/` dropped.

## ADR-002: Rithmic ingest path is SFTP-first, both directions  (2026-08-13, status: proposed)
- Context: Constitution section 10 leaves "Rithmic ingest (reports vs R|API admin)" open pending vendor docs. research/DATA_CAPABILITIES.md section 3 built the comparison.
- Decision (proposed): Outbound provisioning via CSV/SFTP (Rithmic's scriptable bulk interface). Inbound marks via Rithmic EOD report files over SFTP as primary ingest. R|API+ admin pull deferred to a post-v1 enhancement for intraday recon if operations demand it.
- Alternatives considered: R|API+ admin pull as primary (rejected v1: $100/mo per API ID, standing admin credentials in a worker widen the attack surface, and the EOD rule model needs only closed-day data); hybrid from day one (rejected: two ingest paths to test and reconcile before either is proven).
- Consequences: File-based ingest is replayable and quarantinable (B4 #4); EOD report doubles as auto-liquidation evidence for M6 packs. Contingent on the W1 vendor call confirming per-fill granularity in report files; the fills-to-marks pipeline absorbs either file shape. Blocks: M2 plan doc detail. Founder approval closes the section-10 item.
