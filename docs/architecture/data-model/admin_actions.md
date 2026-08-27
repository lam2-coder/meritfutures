### admin_actions

**The audit surface every mutating admin endpoint writes to.** Created by [`0017`](../../../packages/db/migrations/0017_events_and_audit.sql), extended by [`0043`](../../../packages/db/migrations/0043_admin_attributed_actions.sql) with `SD-M6-11`'s two columns, its biconditional `CHECK` and its fourth index, under [ADR-069](../../decisions/ADR-069.md) and [M06 section 11](../../plans/M06-admin-ops-console.md). **Not money path, and the adjacency is why the record is exact:** the money-path admin routes (payout release, payout enforce, wallet correct) write here, and none of them depends on this table for what it may do.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | |
| `actor` | text | not null | **Who performed it.** Not the same question as `initiative` or `on_behalf_of_identity_id`, and the three are answered separately on purpose |
| `action` | text | not null | |
| `subject_kind` | text | not null | The **object** the action touched. Polymorphic and deliberately not a foreign key, on [`events`](events.md)' precedent one table up |
| `subject_id` | uuid | not null | The object again, and **never the identity whose act it was**: for most of [ADR-069](../../decisions/ADR-069.md)'s eighteen parity routes the subject is a session, a request or a plan version rather than an identity |
| `reason` | text | **not null** | **no unexplained admin action, ever.** The `NOT NULL` is the whole control, and it is the first thing any enforcement dispute asks for ([`0017`](../../../packages/db/migrations/0017_events_and_audit.sql):82). It is the precedent [`impersonation_sessions.reason_code`](impersonation_sessions.md) and [`account_adjustments.reason_note`](account_adjustments.md) are both written against |
| `before` | jsonb | not null | so the action is reconstructable without replaying the system that produced it |
| `after` | jsonb | not null | the other half of the same reason. Two columns rather than one row of prose, because a diff nobody can compute is not evidence |
| `evidence_refs` | jsonb | not null default `'[]'` | The evidence pack's hooks. Empty is a legitimate value and `NULL` is not, so a row never has to be interrogated about which it meant |
| `initiative` | text | **not null**, no default, check in (`enforcement`, `trader_request`, `operational`) | **On whose initiative, which is load bearing on `reason`'s own precedent.** *"Merit did this to the trader"* and *"the trader asked and Merit did it"* are different defences in a dispute or a chargeback representment, and **a reviewer two years out cannot reconstruct which was meant from free text**. The vocabulary is **not invented here**: it is `CloseRequest.kind`'s from [API_CONTRACT](../API_CONTRACT.md), unchanged and in its order, so eighteen new routes inherit one discriminator instead of each inventing one. **A `CHECK` rather than an enum type**, because an enum value cannot be removed and [ADR-069](../../decisions/ADR-069.md)'s founder read may still narrow this set. **No default**, because a default lets the nineteenth admin route omit the answer and receive a plausible one, which is the failure `reason`'s `NOT NULL` exists to prevent one column over |
| `on_behalf_of_identity_id` | uuid | null, references `identities(id)` on delete restrict | **The identity whose OWN ACT this was**, set exactly when `initiative = 'trader_request'`. This is what makes the trader half of the dual-timeline audit **one index scan** rather than a join per `subject_kind`. `ON DELETE RESTRICT` on the append-only precedent: an identity with an operator action recorded against it cannot be deleted out from under its own audit trail |
| `ip` | inet | null | |
| `created_at` | timestamptz | not null default now() | |

Indexes: `admin_actions_subject_idx (subject_kind, subject_id, created_at desc)`; `admin_actions_actor_idx (actor, created_at desc)`; `admin_actions_action_idx (action, created_at desc)`; partial **`admin_actions_on_behalf_idx (on_behalf_of_identity_id, created_at desc) where on_behalf_of_identity_id is not null`**, which is the dual-timeline read. Partial on [`0041`](../../../packages/db/migrations/0041_contact_channel_complaints.sql)'s and [`0019`](../../../packages/db/migrations/0019_notifications_and_community.sql)'s precedent: indexing the nulls would index every enforcement and configuration action Merit has ever taken in order to answer a question about the ones it did not.

Constraints: **`admin_actions_on_behalf_matches_initiative`**, `(on_behalf_of_identity_id IS NOT NULL) = (initiative = 'trader_request')`.

**The constraint is a biconditional and the backward direction is the one that matters.** Forward, a `trader_request` with no identity is a claim that a trader asked with no record of which trader, which is a claim unable to support itself. Backward, an `enforcement` or `operational` row carrying an on-behalf-of identity is **an act against a trader dressed as an act for one**, and that is the exact misattribution [ADR-069](../../decisions/ADR-069.md) exists to prevent, arriving from the admin side instead of the impersonation side.

**`initiative` is `NOT NULL` with no default because the table is empty and this was the last cheap moment.** This table is append-only and its retention is forever, so a discriminator added after rows exist leaves every historical row `NULL`, and `NULL` is then ambiguous between *"Merit's own act"* and *"written before the column existed"*. The column is only unambiguous if it is never null, and it is only never null if it arrives before the first row does.

**What is deliberately absent.** No column records **how the requester was verified**. That is a support-process question [ADR-069](../../decisions/ADR-069.md) leaves open rather than guesses at, and `reason` plus `evidence_refs` carry it as prose until somebody rules a vocabulary. A `CHECK` naming values nobody has agreed on would be a control in an audit's eyes and a coin flip in practice, which Appendix D warns is worse than nothing.

Append-only: [`0026`](../../../packages/db/migrations/0026_roles_and_grants.sql) revokes `UPDATE` and `DELETE` from `merit_app` **and from `PUBLIC`**. Retention: forever.

Every row also emits an event; this table exists **alongside** [`events`](events.md) rather than instead of it, so the audit query never depends on event-payload shape. The duplication is the point.
