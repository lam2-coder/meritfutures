### trading_calendar
The trading day is data, never arithmetic.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `trading_day` | date | pk | |
| `session_open_at`, `session_close_at` | timestamptz | not null | UTC instants derived from CT session definitions, so DST is a row rather than a calculation (B4 #1). No engine rule ever derives a trading day from a timestamp's UTC date |
| `is_half_day` | boolean | not null default false | counts as a **full day** (B4 #3). A half day counting as half a day would make the minimum-trading-days gate a different promise in November |
| `is_holiday` | boolean | not null default false | not a trading day at all |
| `halted` | boolean | not null default false | day counters advance, win days do not (B4 #2). A trader cannot earn a win day on a session the exchange halted, and cannot be penalised for one either |
| `notes` | text | null | |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Constraints: `trading_calendar_session_ordered`; `trading_calendar_holiday_not_half_day` (a holiday has no session to contain fills in).
Seeded years ahead, maintained as data, reviewed annually. Retention: forever.
