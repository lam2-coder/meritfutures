### offer_experiments
**`SD-M17-04`**, INV-M17-07. Created before `offers` because `offers.experiment_id` references it.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `name` | text | not null, unique | |
| `hypothesis` | text | not null | |
| `arms` | jsonb | not null | |
| `varies` | text | not null, check in (`price`,`presentation`,`bundle_contents`) | **the rule, in DDL.** An experiment may vary what a thing costs, how it is shown, or what is in it. It may never vary a rule, a gate, or a plan parameter, and the check has no value that would let it try |
| `started_at` | timestamptz | not null default now() | |
| `ended_at` | timestamptz | null | |
| `winner_arm` | text | null | |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique on `(name)` (inline); `offer_experiments_live_idx (started_at)` where `ended_at is null`.
Constraints: `offer_experiments_winner_needs_end`.
Why the check is the delta: it makes "we do not A/B test the rulebook" a structural fact rather than a policy someone has to remember under conversion pressure. An experiment that varies a rule **cannot be written down**, let alone run (AS-M17-07). Adding a fourth value is an ADR.
