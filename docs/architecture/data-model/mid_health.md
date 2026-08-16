### mid_health
**`SD-M3-03`.** Failover needs a decision record, not a live computation.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `psp` | text | not null, pk part | |
| `window_start` | timestamptz | not null, pk part | |
| `window_end` | timestamptz | not null | |
| `attempts` | integer | not null default 0, check >= 0 | card-volume denominator for `decline_rate_bp` |
| `declines` | integer | not null default 0, check >= 0 | |
| `card_settled_count` | integer | not null default 0, check >= 0 | card-volume denominator for `chargeback_rate_bp` |
| `chargebacks` | integer | not null default 0, check >= 0 | |
| `decline_rate_bp` | integer | not null, check between 0 and 10000 | |
| `chargeback_rate_bp` | integer | not null, check between 0 and 10000 | the 65bp threshold that threatens the processor relationship needs to be a tracked series rather than a query someone remembers to run |
| `state` | text | not null, check in (`healthy`,`degraded`,`unhealthy`) | |
| `state_changed_at` | timestamptz | not null | |
| `created_at` | timestamptz | not null default now() | |

Primary key: composite `(psp, window_start)`.
Indexes: `mid_health_state_idx (psp, window_start desc)`.
Constraints: `mid_health_window_ordered`; `mid_health_declines_within_attempts`; `mid_health_chargebacks_within_settled`.
**The denominator rule, and it is the dangerous part of this table.** Both rates are computed against **card volume**, never total volume. Wallet-funded purchases carry no chargeback exposure whatsoever, so as wallet adoption grows the denominator of a total-volume ratio shrinks while the numerator does not: a **healthy** shift toward wallet funding would look like a deteriorating chargeback ratio and trip failover in AS-M3-02's direction for no reason at all. The columns are named to make the mistake hard to make silently. "Firms die from PSP freezes" is a named risk in constitution section 0, and a firm with one MID has no working version of [RB-03](../../ops/runbooks/RB-03-mid-freeze.md).
