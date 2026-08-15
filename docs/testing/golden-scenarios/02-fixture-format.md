## 2. Fixture format

Each scenario is a YAML file at `packages/rules-engine/fixtures/GS-NNN-<slug>.yaml` with an expected end-state JSON sibling. The format is fixed so a fixture is readable by a human and loadable by a test without a parser of its own.

```yaml
id: GS-011
name: trailing floor does not trail on an intraday spike
source: M01 R-13, R-18
plan: CORE-50K              # resolves to fixtures/plans/CORE-50K.json, a full plan_version + size row
account:
  phase: funded
  opened_on: 2026-11-02
  size_cents: 5000000
calendar: cme-2026          # fixtures/calendars/cme-2026.json, real sessions including half days
days:                       # one row per trading day, in order; the exact daily_marks input
  - trading_day: 2026-11-03
    opening_balance_cents: 5000000
    closing_balance_cents: 5020000
    high_balance_cents: 5090000
    low_balance_cents: 4995000
    realized_pnl_cents: 20000
    fill_count: 4
    adjustment_cents: 0
settlements: []             # payout settlements folded into the day stream, see M01 section 3.1
expect:
  end_state:
    phase: funded
    floor_cents: 4770000
    high_water_balance_cents: 5020000
    breached: false
  events: [day.closed]
  pins: "floor trails the closing balance, never the intraday high"
```

`expect.pins` is prose stating **which operator or ordering the scenario exists to protect**. A fixture without a pin is a regression test, not a golden file, and gets rejected in review.
