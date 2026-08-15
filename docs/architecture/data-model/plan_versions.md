### plan_versions
The immutable rule contract. Shape of `rules` in §11.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `plan_id` | uuid | fk plans, not null, on delete restrict | |
| `version` | integer | not null, check > 0 | monotonic per plan |
| `status` | `plan_version_status` enum(`draft`,`published`,`retired`) | not null default `draft` | only `published` can be sold |
| `rules` | jsonb | not null | the full config, shape in §11, validated by zod at the write boundary. **[ADR-030](../../decisions/ADR-030.md)'s two key names are load bearing**: the ladder length is `phase_funded.max_payouts` (frozen at 5 / 5 / 4) and `kyc.triggers` is an array |
| `copy_blocks` | jsonb | not null default `'{}'` | published rule text keyed by rule path, so marketing copy and engine parameters ship together. A version cannot be published with copy that describes a different number |
| `public_slug` | text | not null | **`SD-M9-01`.** A stable, permanent public URL that survives being superseded (INV-M9-11). Deriving the URL from the version number would make the archive URL change whenever numbering does, which breaks the link AS-M9-07 depends on: the trader who wants to show someone the rules their account was sold under |
| `public_visible` | boolean | not null default false | **`SD-M9-01`.** A version can be published-for-engine while not yet being the one on sale. Two facts, and one boolean cannot hold both |
| `published_at` | timestamptz | null | |
| `retired_at` | timestamptz | null | retirement stops new sales and never touches live accounts. That distinction is the whole of the retroactive-change protection |
| `created_by` | text | not null | |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `plan_versions_plan_version_uq (plan_id, version)`; unique `plan_versions_public_slug_uq (public_slug)`, unique across every version of every plan rather than within a plan, because the slug is the permanent public URL; `plan_versions_on_sale_idx (plan_id)` where `public_visible`, which is the site's read path.
Constraints: `plan_versions_published_has_timestamp`; `plan_versions_retired_has_timestamp`; `plan_versions_visible_implies_published` (a draft is never on sale, because public visibility on an unpublished version would put an unexecutable contract on the pricing page).
**Rows with `status = 'published'` are immutable**, enforced by the trigger `plan_versions_published_immutable` in `0027` running `assert_published_plan_version_immutable()`, **whose body is replaced by [`0028`](../../../packages/db/migrations/0028_supersede_plan_version_immutability.sql) under [ADR-035](../../decisions/ADR-035.md)**. It rejects any update other than `published` moving to `retired` with `retired_at` set, pins every other column by comparing the whole row rather than a list of names, and **freezes a retired row absolutely** per [STATE_MACHINES section 9](../STATE_MACHINES.md)'s `retired --> [*]`. `public_visible` is permitted to move because `plan_versions_visible_implies_published` forbids a visible non-published row. Publishing a change means creating a new version. This is what makes "the rules at the time" provable (B4 #12).

> **This line named the trigger `plan_versions_immutable_when_published` until 2026-08-15 and `0027` has always called it `plan_versions_published_immutable`.** A citation that does not resolve, in the paragraph describing the corpus's most valuable promise, one line above the trigger that was reading a column that did not exist. Recorded rather than smoothed: **constraint and trigger names cited in prose are not yet checked by any gate**, and CI-06j checks columns rather than object names.
Retention: forever. A retired version is still needed to explain a 2027 payout in 2031.
