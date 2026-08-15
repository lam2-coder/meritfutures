### affiliate_creatives
**`SD-M8-03`**, INV-M8-08.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `affiliate_id` | uuid | fk affiliates, not null, on delete restrict | |
| `kind` | text | not null, check in (`landing`,`video`,`post`,`email`,`other`) | |
| `url_or_ref` | text | not null | the URL, or a storage reference for something that has none. Merit reviews what it can reach |
| `submitted_at` | timestamptz | not null default now() | |
| `status` | text | not null default `pending`, check in (`pending`,`approved`,`rejected`,`withdrawn`) | |
| `reviewed_by`, `reviewed_at` | text, timestamptz | null | |
| `disclosure_version_id` | uuid | fk tos_versions, null, on delete restrict | which disclosure version accompanied this claim. The disclosure is the compliance artifact and it moves; pinning it per creative is what makes a 2027 review of a 2026 post answerable |
| `notes` | text | null | |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: `affiliate_creatives_affiliate_idx (affiliate_id, submitted_at desc)`; `affiliate_creatives_pending_idx (submitted_at)` where `status = 'pending'`, the review queue.
Constraints: `affiliate_creatives_decision_has_author`; `affiliate_creatives_approved_has_disclosure`, which is what makes INV-M8-08 hold rather than merely be asserted.
Why the boolean was not enough: `affiliates.creative_approved` has no record of **what** was approved, which is worthless in a compliance conversation. NFA I-26-12 requires the disclosure to accompany the claim, and that is a **per-creative** fact: one approved landing page says nothing about the video posted three months later.
