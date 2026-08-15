# Consolidated founder addendum and batch 2 gate closure (2026-08-14)

The founder returned a consolidated addendum covering the M19 placement question, an elevation of Merit's identity defenses, the legal disclosure skeletons, four primary-source intelligence folds, a checkout enrichment vendor, the verification UX, and rulings on the five open batch 2 questions. Three became ADRs because they choose between alternatives or amend an approved decision. The rest are recorded in the closure table below.

## Architecture decision records closed at this gate

- [ADR-021](../ADR-021.md): KYC placement is a composite trigger set, not a single point  (2026-08-14, status: accepted)
- [ADR-022](../ADR-022.md): Identity defense is elevated to a scored graph, in three priced tiers  (2026-08-14, status: accepted)
- [ADR-023](../ADR-023.md): A digital-footprint enrichment vendor at checkout, bought and not built  (2026-08-14, status: accepted)
- [ADR-024](../ADR-024.md): The ladder and the live invitation are two separate mechanisms  (2026-08-14, status: accepted)
- [ADR-025](../ADR-025.md): Progressive cap release is rejected for v1 and replaced with cross-account loyalty  (2026-08-14, status: accepted)

## Batch 2 gate closure table (2026-08-14)

The five open batch 2 questions, plus the two verification items. Each confirms or directs rather than choosing between architectures, so they are recorded here rather than as ADRs.

| Ruling | Where it was asked | Outcome |
|---|---|---|
| **OQ-M18-01: which graduation path, and does a live program exist?** | [M18](../../plans/M18-graduation-track.md) | **No live program exists at launch.** The ladder ends in **graduation eligibility plus continuation**, which is GP-M18-03, the path that requires nothing and is honest. **Zero live-program copy is written until counsel rules**, and that includes the marketing site, the portal, certificates, and Discord. The working structure, if one is ever built, is a **ring-fenced affiliated entity** on the MFFU pattern. **The module is renamed to match shipped behavior** rather than describing an aspiration. **Counsel packet item 1** |
| **OQ-M20-03: is the wallet a payable or a regulated stored-value product?** | [M20](../../plans/M20-wallet.md) | **Proceed on the payable-balance framing**, with a named invariant so the framing cannot erode by accident: **`INV-WALLET-NO-DEPOSITS`. Wallet funds originate only from payouts, promotional credit, and refunds. No external loading, ever, without a new ADR and counsel sign-off.** The closed credit list is confirmed to **exclude deposits explicitly** rather than merely omitting them, because an omission is a gap someone fills and an exclusion is a decision someone must reverse. **Counsel packet item 2** |
| **OQ-M19-01: does the corpus-coverage finding change placement?** | [M19](../../plans/M19-kyc-identity.md) | **Resolved by [ADR-021](../ADR-021.md).** The finding does change it, and the answer is a composite trigger set rather than a different single point. The corpus-coverage telemetry and the pre-agreed per-plan escalation are both adopted as proposed |
| **OQ-M12-01: the seven public statistic definitions** | [M12](../../plans/M12-transparency-platform.md) | **Draft them as a founder sign-off table for the Wave 4 gate.** Each statistic gets **both a trailing-window and a lifetime form**, **denominators always stated** on the surface itself and never only in a methodology page, and a **future-dated `effective_from`** per M12's existing design so a definition change is announced before it takes effect rather than discovered after. The unflattering readings M12 proposed stand as the drafting basis |
| **OQ-M20-04: dormancy and escheatment** | [M20](../../plans/M20-wallet.md) | **Dormancy tracking and 12-month notices are designed now**, in v1, because retrofitting a notice schedule onto balances that have already gone quiet means reconstructing when they went quiet. **Escheatment state-mapping is counsel packet item 3**: trigger dates vary by jurisdiction, and the mapping belongs on a calendar rather than in anyone's memory |
| **The docs link-check joins the CI gate inventory** | [SESSION_LOG](../../SESSION_LOG.md) landmine | **Accepted.** A corpus whose cross-references are its navigation needs the check that proves they resolve. The 59-link fix is verified in this session's closing check, and the gate is added to the inventory so the next 59 are caught by a robot |
| **Calibration source** | [STATE](../../STATE.md) | **Workbook committed, engine still outstanding.** `research/calibration/futures_prop_firm_model.xlsx` is in the repository with a provenance [README](../../../research/calibration/README.md). `mc_lifecycle.py` is not: the accompanying upload was an unrelated database dump. The STATE item **narrows rather than clears** |

## The counsel packet

Three items now have a named home rather than being scattered across module plans, because they are the questions engineering cannot answer and they all need the same lawyer at the same time.

| # | Question | Blocking what |
|---|---|---|
| 1 | The live-program structure: does a ring-fenced affiliated entity on the MFFU pattern change Merit's regulatory character, and what may be said about graduation before one exists? | All live-program copy. Nothing in code |
| 2 | Is the wallet a payable rather than a regulated stored-value product, given `INV-WALLET-NO-DEPOSITS`, no interest, no transfer, no deposit, payable on demand? | Launch, and the answer may add conditions rather than a prohibition, which is why it is cheap now |
| 3 | Escheatment mapping per jurisdiction, and the BIPA plus GDPR lawful-basis mapping for the biometric and monitoring disclosures | The privacy policy leaving draft, and the dormancy calendar |
