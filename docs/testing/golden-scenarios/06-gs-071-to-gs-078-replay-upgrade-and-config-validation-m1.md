## 6. GS-071 to GS-078: replay, upgrade, and config validation (M1)

| ID | Name | Pins |
|---|---|---|
| GS-071 | Replay of a 250-day funded life reproduces every stored state byte-identically | The core determinism claim, asserted on state hashes and then field by field |
| GS-072 | Replay with days delivered in shuffled arrival order | Canonical ordering is by trading day, not by arrival. Same output |
| GS-073 | Replay under a different process timezone and locale | `TZ=Asia/Kolkata` and a non-English locale produce identical output. Guards the banned-construct list |
| GS-074 | Replay after a correction supersedes day 40 of 250 | States from day 40 forward change, states before day 40 do not, and the settled payout on day 60 keeps its original snapshot |
| GS-075 | Engine upgrade that changes historical output is caught, not silently applied | The upgrade protocol produces a diff report and requires approval. An unapproved divergence pages |
| GS-076 | Plan config rejected at publish: cap below the minimum payout | Nobody can ever be paid under this config. Publish fails with the failing validation rule named |
| GS-077 | Plan config rejected at publish: consistency threshold of 0 bp or above 10000 bp | Impossible and meaningless configurations respectively |
| GS-078 | Plan config rejected at publish: intraday trailing drawdown selected in v1 | Config-supported and explicitly unimplemented. Publishing it fails loudly rather than computing something plausible |
