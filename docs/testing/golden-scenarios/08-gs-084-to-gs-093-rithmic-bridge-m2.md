## 8. GS-084 to GS-093: Rithmic bridge (M2)

Defined by [M02](../../plans/M02-rithmic-bridge.md) section 8.3. These run against the **simulator adapter** until a real vendor file exists, which is itself the subject of GS-084.

| ID | Name | Pins |
|---|---|---|
| GS-084 | Simulator file and vendor file traverse the identical parser | The simulator writes CSV into the ingest path and no downstream code branches on source. The counter to the corpus's own biggest ingest risk: with no vendor sandbox, the simulator is the only spec we have, so it must not be a second code path. AS-M2-01 |
| GS-085 | Hostile-but-legal file shapes | BOM, CRLF, reordered columns, an extra trailing column, a zero-account day, a 200MB file. Each either parses identically or quarantines whole; none partially applies |
| GS-086 | Redelivered file for an already-applied day with no correction markers | Whole-file quarantine, zero rows committed, the alarm names the trading day. Asserts that a silent double-apply is impossible, which is the failure that would corrupt every downstream number at once. AS-M2-02 |
| GS-087 | Day low below the floor with no liquidation record | The behavioral setpoint check fires and `platform.setpoint_unconfirmed` is emitted. Pins the only detection Merit has for an account whose auto-liquidator was never actually configured. AS-M2-03 |
| GS-088 | Entitlement hygiene attempts a disable on an `active` account | Hard error, nothing disabled, alarm. Asserts the asymmetry: leaking cost is a warning, cutting off a live trader is a bug. AS-M2-04 |
| GS-089 | Inbound row citing a retired `platform_account_ref` | Whole-file quarantine, never routed to any account. Asserts that a vendor identifier is burned permanently on close. AS-M2-05 |
| GS-090 | Vendor session date disagrees with calendar containment | Both values stored, the divergence alarms, and our calendar still decides `fills.trading_day`. Asserts we detect the disagreement rather than resolving it silently in our own favor. AS-M2-06 |
| GS-091 | Correction after settlement records its delta against the superseded mark | The absorbed amount stays computable after replay has run, because the original number survives only on the superseded row. AS-M2-07, pairs with GS-057 and GS-058 |
| GS-092 | Balance delta matching no known settlement and no fills | Quarantine. Never classified as realized P&L, never guessed. INV-M2-12, EC-051 |
| GS-093 | Funded reset post-condition | After `phase.passed`, the next opening balance is exactly `size_cents`, asserted by M2 before the engine sees the mark. Pairs with GS-070, which asserts the engine refuses when it is not. DEP-M2-01 |
