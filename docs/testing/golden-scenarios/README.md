---
status: approved
depends_on: [../../decisions/README.md, ../../edge-cases/README.md]
last_updated: 2026-08-16
---

# GOLDEN SCENARIOS

# Golden Scenarios

Hand-built scenario fixtures, numbered. **Tests cite scenario numbers**, never prose. Per [GLOSSARY](../../GLOSSARY.md#golden-file) and constitution C10, every scenario here derives from a plan doc or an approved constitution scenario and **never** from implementation output. That rule is the whole defence against the self-grading trap: if a fixture was written by reading the code, it proves only that the code agrees with itself.

**Seeded in Wave 3 by [M01](../../plans/M01-rules-engine.md), and GS-001 to GS-083 approved with it at the M1 gate on 2026-08-13.** Each later module plan appends its own block and those scenarios carry that plan's status. Constitution section 5.2 requires at least 40 golden files and the registry defines <!--gen:gs_count-->272<!--/gen-->. **GS-001 to GS-083 are M1's**, of which 67 are executable against the pure engine with zero I/O, plus 5 (GS-034, GS-035, GS-041, GS-047, GS-050) where M1 owns an assertion inside a scenario another module drives. The numbering map below is the current total and section 33 is the reconciliation behind it.

**Five scenarios were added and four rewritten by the M1 gate rulings** ([ADR-013](../../decisions/ADR-013.md), [ADR-014](../../decisions/ADR-014.md), [ADR-015](../../decisions/ADR-015.md)). **Fourteen more were added and four rewritten by the Wave 3 batch 1 gate rulings** ([ADR-016](../../decisions/ADR-016.md) through [ADR-020](../../decisions/ADR-020.md)). A golden file that pinned a behavior the founder overruled is not quietly deleted: it is rewritten to pin what was actually decided, and the row says so, because a fixture that silently changes meaning is how a suite stops being a specification.

**Consolidated in Wave 4, and the registry now holds <!--gen:gs_count-->272<!--/gen-->** (section 33 carries that pass's reconciliation, the ownership partition, and the coverage map; sections added after it carry their own). Four things were repaired in that pass and each is worth naming, because a registry whose defects are fixed silently is a registry nobody can trust the next count from. **The section numbering was duplicated at 25, 26 and 27** and is now contiguous through 33. **Section 6's stated range said GS-071 to GS-083 while its table ended at GS-078**, which overlapped section 7. **GS-139 to GS-141 were listed out of order.** And **GS-206 through GS-209 were claimed by two different blocks at once**, the M18 graduation scenarios and the addendum's verification-UX scenarios; the verification-UX pair is renumbered to GS-256 and GS-257, and the collision note stays in section 28 rather than being erased.

**Two blocks were added in the same pass.** GS-246 to GS-255 are the **Appendix D0 attack battery**, discharging the obligation [SECURITY section 9](../../architecture/SECURITY.md) recorded for Wave 4. GS-243 to GS-245 carry [ADR-025](../../decisions/ADR-025.md).

**A fifth defect was repaired at the S-D read and it is a different class from the four above, which is why it is named separately.** Section 3's plan shorthand **restated thirteen parameter values from [M01 Appendix A.1](../../plans/M01-rules-engine.md#a1-core-eod-core_eod) in the same sentence that named Appendix A as the only place they are defined**, and one of the thirteen had drifted: the ladder read 8 against Appendix A.1's 5 ([ADR-024](../../decisions/ADR-024.md)). The four earlier repairs were numbering; this one is a **value a running system reads from config**, which is the first time this registry has been found disagreeing with the specification rather than with itself. **The thirteen copies are deleted and the section points at the appendix** ([ADR-037](../../decisions/ADR-037.md)); GS-066 and GS-067 carried the same stale 8 in their pins and now name `max_payouts` rather than a number.

**GS-055 is the one to read if you read only one row of that rewrite.** It pinned the extraction ceiling under the settlement anchor and carried the basis-anchored case as an expected-to-fail counterfactual. [ADR-019](../../decisions/ADR-019.md) made the counterfactual live, so the fixture now pins the opposite direction. That is exactly the situation this file's rule about rewriting rather than deleting exists for: the number changed because a decision changed, and both the number and the decision are on the record.

The fixture registry, one file per SECTION since [ADR-043](../../decisions/ADR-043.md).
Per section rather than per entry because the identifiers outnumber the sections by
two orders of magnitude and live as table rows: a row is not a document, and the
batteries only mean anything read together. **The count is <!--gen:gs_count-->272<!--/gen-->
and the row total is not stated**, because it is the one of the two that no query in
`gates.mjs` derives, and this line carried both as hand-maintained numerals until
the FOLD-01 registries session added a section and made them wrong.

## Entries

| | |
|---|---|
| [1. Numbering map](01-numbering-map.md) |  |
| [2. Fixture format](02-fixture-format.md) |  |
| [3. GS-001 to GS-029](03-gs-001-to-gs-029-rule-and-boundary-scenarios-m1.md) | rule and boundary scenarios (M1) |
| [4. GS-030 to GS-051](04-gs-030-to-gs-051-the-appendix-b4-battery.md) | the Appendix B4 battery |
| [5. GS-052 to GS-070](05-gs-052-to-gs-070-adversarial-scenarios-m1-section-7.md) | adversarial scenarios (M1 section 7) |
| [6. GS-071 to GS-078](06-gs-071-to-gs-078-replay-upgrade-and-config-validation-m1.md) | replay, upgrade, and config validation (M1) |
| [7. GS-079 to GS-083](07-gs-079-to-gs-083-scenarios-created-by-the-m1-gate-rulings-m1.md) | scenarios created by the M1 gate rulings (M1) |
| [8. GS-084 to GS-093](08-gs-084-to-gs-093-rithmic-bridge-m2.md) | Rithmic bridge (M2) |
| [9. GS-094 to GS-099](09-gs-094-to-gs-099-billing-and-checkout-m3.md) | billing and checkout (M3) |
| [10. GS-100 to GS-105](10-gs-100-to-gs-105-trader-portal-m4.md) | trader portal (M4) |
| [11. GS-106 to GS-111](11-gs-106-to-gs-111-payout-system-m5.md) | payout system (M5) |
| [12. GS-112 to GS-117](12-gs-112-to-gs-117-admin-and-ops-console-m6.md) | admin and ops console (M6) |
| [13. GS-118 to GS-122](13-gs-118-to-gs-122-risk-and-abuse-m7.md) | risk and abuse (M7) |
| [14. GS-123 to GS-127](14-gs-123-to-gs-127-affiliate-system-m8.md) | affiliate system (M8) |
| [15. GS-128 to GS-141](15-gs-128-to-gs-141-scenarios-created-by-the-wave-3-batch-1-gat.md) | scenarios created by the Wave 3 batch 1 gate rulings |
| [16. GS-142 to GS-148](16-gs-142-to-gs-148-marketing-site-m9.md) | marketing site (M9) |
| [17. GS-149 to GS-154](17-gs-149-to-gs-154-integrations-m10.md) | integrations (M10) |
| [18. GS-155 to GS-161](18-gs-155-to-gs-161-certificates-and-social-proof-m11.md) | certificates and social proof (M11) |
| [19. GS-162 to GS-171](19-gs-162-to-gs-171-transparency-platform-m12.md) | transparency platform (M12) |
| [20. GS-172 to GS-178](20-gs-172-to-gs-178-trader-analytics-and-journal-m13.md) | trader analytics and journal (M13) |
| [21. GS-179 to GS-185](21-gs-179-to-gs-185-loyalty-and-retention-m14.md) | loyalty and retention (M14) |
| [22. GS-186 to GS-191](22-gs-186-to-gs-191-discord-integration-m15.md) | Discord integration (M15) |
| [23. GS-192 to GS-197](23-gs-192-to-gs-197-notification-center-m16.md) | notification center (M16) |
| [24. GS-198 to GS-204](24-gs-198-to-gs-204-offers-engine-m17.md) | offers engine (M17) |
| [25. GS-205 to GS-211](25-gs-205-to-gs-211-graduation-track-m18.md) | graduation track (M18) |
| [26. GS-212 to GS-221](26-gs-212-to-gs-221-kyc-and-identity-verification-m19.md) | KYC and identity verification (M19) |
| [27. GS-222 to GS-231](27-gs-222-to-gs-231-merit-wallet-m20.md) | Merit Wallet (M20) |
| [28. GS-232 to GS-239](28-gs-232-to-gs-239-the-consolidated-founder-addendum.md) | the consolidated founder addendum |
| [29. GS-240 to GS-242](29-gs-240-to-gs-242-the-ladder-and-invitation-separation.md) | the ladder and invitation separation |
| [30. GS-243 to GS-245](30-gs-243-to-gs-245-the-cap-release-rejection-and-cross-account.md) | the cap-release rejection and cross-account loyalty (M14) |
| [31. GS-246 to GS-255](31-gs-246-to-gs-255-the-appendix-d0-attack-battery.md) | the Appendix D0 attack battery |
| [32. GS-256 to GS-257](32-gs-256-to-gs-257-verification-ux-m19.md) | verification UX (M19) |
| [33. Ownership index and coverage reconciliation](33-ownership-index-and-coverage-reconciliation.md) |  |
| [34. GS-258 to GS-272](34-gs-258-to-gs-272-phone-identity-and-the-authority-boundary.md) | phone identity and the authority boundary (FOLD-01) |
