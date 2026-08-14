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
