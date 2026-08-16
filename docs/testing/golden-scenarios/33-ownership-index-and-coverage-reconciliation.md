## 33. Ownership index and coverage reconciliation

### 33.1 Scenarios by primary owner

**Every scenario has exactly one primary owner and this table is a partition**, so the counts sum to the registry total rather than to something larger. That is the property that makes the table checkable: a co-ownership table would double-count, and a coverage figure nobody can add up is a coverage figure nobody should quote. Co-owned scenarios are listed in 33.2, and each such row in its own section already says which assertion belongs to which module.

| Primary owner | Scenarios | Count |
|---|---|---|
| **M1 rules engine** | GS-001 to GS-032, GS-034 to GS-035, GS-042, GS-044, GS-047, GS-049, GS-052 to GS-083, GS-141, GS-241 to GS-242 | 73 |
| **M2 Rithmic bridge** | GS-033, GS-043, GS-084 to GS-093, GS-138 | 13 |
| **M3 billing and checkout** | GS-038 to GS-041, GS-094 to GS-099, GS-239, GS-250, GS-252 | 13 |
| **M4 trader portal** | GS-100 to GS-105, GS-132 to GS-133, GS-246 to GS-247 | 10 |
| **M5 payout system** | GS-036 to GS-037, GS-048, GS-051, GS-106 to GS-111, GS-128 to GS-129, GS-131, GS-139, GS-248 to GS-249 | 16 |
| **M6 admin and ops console** | GS-112 to GS-117, GS-130, GS-251 | 8 |
| **M7 risk and abuse** | GS-046, GS-050, GS-118 to GS-122, GS-134 to GS-137, GS-235 to GS-238 | 15 |
| **M8 affiliate system** | GS-045, GS-123 to GS-127, GS-140 | 7 |
| **M9 marketing site** | GS-142 to GS-148 | 7 |
| **M10 integrations** | GS-149 to GS-154, GS-254 | 7 |
| **M11 certificates and social proof** | GS-155 to GS-161 | 7 |
| **M12 transparency platform** | GS-162 to GS-171 | 10 |
| **M13 analytics and journal** | GS-172 to GS-178 | 7 |
| **M14 loyalty and retention** | GS-179 to GS-185, GS-243 to GS-245 | 10 |
| **M15 Discord integration** | GS-186 to GS-191 | 6 |
| **M16 notification center** | GS-192 to GS-197 | 6 |
| **M17 offers engine** | GS-198 to GS-204, GS-253 | 8 |
| **M18 graduation track** | GS-205 to GS-211, GS-240 | 8 |
| **M19 KYC and identity** | GS-212 to GS-221, GS-232 to GS-234, GS-256 to GS-257 | 15 |
| **M20 Merit Wallet** | GS-222 to GS-231 | 10 |
| **INFRA and cross-cutting** | GS-255 | 1 |
| | | **257** |

**Numbering is contiguous from GS-001 to GS-257 with no gaps and no duplicates**, which CI-06d asserts on every push ([STRATEGY](../STRATEGY.md) section 4.4). The count in this file's closing line, the count quoted in [STATE](../../STATE.md), the sum of the column above, and the number of rows across sections 3 to 32 are the same number or the build fails.

### 33.2 Co-owned scenarios

These carry an assertion in more than one module's suite. The primary owner in 33.1 is the module that owns the fixture; the participants own an assertion inside it.

| Scenario | Primary | Participants |
|---|---|---|
| GS-034 backdated correction for a closed day | M1 | M2 |
| GS-035 payout at 23:59:59 versus the batch | M1 | M5 |
| GS-039 chargeback after a settled payout | M3 | M5 |
| GS-041 plan v2 published while checkout is open on v1 | M3 | M1 |
| GS-047 batch crash at account 2,341 | M1 | M2 |
| GS-050 six-account hedged syndicate rehearsal | M7 | M1 |
| GS-131 account takeover against a funded wallet | M5 | M4 |
| GS-132 indicative data never reaches a money decision | M4 | M6, M2 |
| GS-133 streaming feed loss degrades to last closed | M4 | M2 |
| GS-140 affiliate destination cooling window | M8 | M5 |
| GS-141 the publish diff types co-binding apart from dominated | M1 | M3 |
| GS-248 destination swap from a hijacked session | M5 | M4, M19 |
| GS-252 compromised operator edits a live plan version | M3 | M6 |
| GS-253 mass coupon redemption with price probing | M3 | M17 |

### 33.2 How the registry reached 257

| Source | Range | Added | Running total |
|---|---|---|---|
| M01, seeded in Wave 3 and approved at the M1 gate | GS-001 to GS-078 | 78 | 78 |
| M1 gate rulings ([ADR-013](../../decisions/ADR-013.md) to [ADR-015](../../decisions/ADR-015.md)) | GS-079 to GS-083 | 5 | 83 |
| Wave 3 batch 1 module plans (M02 to M08) | GS-084 to GS-127 | 44 | 127 |
| Wave 3 batch 1 gate rulings ([ADR-016](../../decisions/ADR-016.md) to [ADR-020](../../decisions/ADR-020.md)) | GS-128 to GS-141 | 14 | 141 |
| Wave 3 batch 2 module plans (M09 to M20) | GS-142 to GS-231 | 90 | 231 |
| Consolidated founder addendum ([ADR-021](../../decisions/ADR-021.md) to [ADR-023](../../decisions/ADR-023.md)) | GS-232 to GS-239 | 8 | 239 |
| [ADR-024](../../decisions/ADR-024.md), ladder and invitation separation | GS-240 to GS-242 | 3 | 242 |
| [ADR-025](../../decisions/ADR-025.md), cap-release rejection | GS-243 to GS-245 | 3 | 245 |
| **Wave 4: the Appendix D0 attack battery** | GS-246 to GS-255 | 10 | 255 |
| **Wave 4: verification UX, renumbered out of a collision** | GS-256 to GS-257 | 2 | **257** |

**The registry was quoted at 242 going into Wave 4 and stands at 257 leaving it.** The fifteen are not scope creep: ten discharge an obligation [SECURITY](../../architecture/SECURITY.md) recorded for this wave, three carry a founder ruling, and two fix a collision in which one number answered to two fixtures.

### 33.3 Constitution and research coverage

| Source battery | Where it lands | Complete |
|---|---|---|
| Appendix B4, 22 evil-brain scenarios | GS-030 to GS-051, `GS-(029 + n)` is B4 item `n` | yes |
| Appendix D0, 10 attack scenarios | GS-246 to GS-255, `GS-(245 + n)` is D0 item `n` | yes |
| Appendix A adversary taxonomy, 9 schemes | Distributed across M7 (GS-118 to GS-122, GS-134 to GS-137), M19 (GS-212 to GS-221), M20 (GS-222 to GS-231), and M1's adversarial set (GS-052 to GS-070) | yes |
| Constitution section 5.2's named examples | GS-020, GS-028, GS-041, GS-050, GS-059, GS-063, GS-065, GS-082 | yes |
| Section 5.2's minimum of 40 golden files | 257 defined | yes |

### 33.4 What is not here yet, and why

Three deliberate absences, each recorded so it reads as a decision rather than a gap.

1. **No fixture exists for the live-graduation program.** [OQ-M18-01](../../decisions/gates/consolidated-founder-addendum-and-batch-2-gate-closure-2026-08-14.md) ruled that no live program exists at launch and that zero live-program copy is written until counsel rules. A fixture pinning behavior for a program that does not exist would be the marketing-versus-implementation gap arriving through the test suite, which is the one direction nobody watches.
2. **No fixture pins the vendor's real file format.** GS-084 pins that the simulator and a vendor file traverse the identical parser, which is the strongest assertion available before the [Rithmic vendor call](../../STATE.md) happens. Sixteen `V-M2-nn` items are its agenda, and fixtures written against a guessed format would be a specification of the guess.
3. **The v1.x and post-launch identity-defense tiers carry fixtures that cannot yet run.** GS-237 and GS-238 describe the signal-weight table and the graph explorer, and [ADR-022](../../decisions/ADR-022.md) requires each tier to arrive with the fixture proving it does what the tier above assumed. They are written now and executed when the tier ships, which is the ordering that stops a promoted defense from arriving unproven.

Scenarios owned by M9 through M20 are numbered where they intersect the B4 battery and are otherwise added by each module plan as it is written. The rule for every wave that follows: **a scenario enters this file before its implementation exists, or it is not a golden file.**
