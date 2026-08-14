---
status: approved
depends_on: [README.md, COMMS_TEMPLATES.md, ../../plans/M02-rithmic-bridge.md, ../../plans/M01-rules-engine.md]
last_updated: 2026-08-14
---

# RB-02: Reconciliation mismatch

**Trigger.** `ingest.quarantined`, `recon.mismatch`, `platform.setpoint_unconfirmed`, or `ingest.correction_received` on a day already closed.
**Severity.** S2, or **S1 if any state was computed from the mismatched data**.
**First move.** Confirm the quarantine held. A quarantine is **whole-file**: zero rows commit, and yesterday's states are untouched (GS-033, GS-085, GS-086).

## The four shapes this takes

| Shape | What happened | Where it goes |
|---|---|---|
| **File quarantine** | A file was malformed, redelivered without correction markers, or cited a retired account reference | Section A |
| **Backdated correction** | A correction arrived for a day already closed | Section B |
| **Setpoint unconfirmed** | Provisioning completed but the risk setting was never acknowledged or read back | Section C |
| **Unattributable balance delta** | A balance moved with no fills and no known settlement | Section D |

## A. File quarantine

1. **Verify zero rows committed.** The quarantine is whole-file or it is a bug.
2. **Diff the file against the last good one** for the same day: column order, encoding, row count, account references.
3. **Request redelivery** rather than repairing the file. A repaired vendor file is a file Merit wrote.
4. If redelivery is not possible today, **leave the day unclosed**. States stay at the prior session, which is a labeled condition rather than an error.

**Never** hand-edit a quarantined file and re-feed it. GS-084 pins that the simulator and a vendor file traverse the identical parser, and a hand-repaired file is a third source nobody tested.

## B. Backdated correction on a closed day

1. **The correction supersedes; replay recomputes forward** (GS-034, GS-074). States from the corrected day change, states before it do not.
2. **A settled payout is never clawed back.** Not by procedure, not by exception, not with the trader's agreement. The absorbed amount is computed, reported, and shows on the admin liability line (GS-057, GS-058).
3. **Both directions are treated identically.** A correction favoring the firm is also absorbed, and this is the half people forget.
4. **The original mark survives on the superseded row** (GS-091), which is what keeps the absorbed delta computable after replay.
5. Notify the trader before they notice (GS-173, `analytics.history_changed`).

## C. Setpoint unconfirmed

**Fail-closed provisioning is design law** (batch 1 gate). An account with no acknowledged or read-back risk setting **does not trade**. This is a visible bounded outage, not a marker on a dashboard.

1. Confirm the account is held out of trading (GS-138). If it is trading, that is **S1**.
2. Retry `set_risk` and the read-back.
3. If the vendor cannot confirm, the account stays offline and the trader is told why, with a time.
4. **Log it against `V-M2-15`.** Without an acknowledgement artifact or a readable risk setting, this failure has no fix, which is why it is a commercial precondition of the vendor relationship rather than an engineering item.

## D. Unattributable balance delta

**Quarantine. Never classify as realized P&L, never guess** (GS-092, `INV-M2-12`, EC-051). Escalate to the vendor with the account reference and the trading day. Until it is explained, the account's states do not advance.

## Comms

**CT-02** for an account held offline. **CT-03** for a corrected history. Both name the trading day.

## Exit criteria

Every quarantined file is either redelivered and applied or formally abandoned with the day left unclosed and recorded. No account is trading with an unconfirmed setpoint.
