### attributions
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `purchase_id` | uuid | fk purchases, not null, **unique**, on delete restrict | one attribution per purchase. The unique is what stops two affiliates being paid for one sale |
| `affiliate_id` | uuid | fk affiliates, not null, on delete restrict | |
| `model` | text | not null, check in (`last_touch`,`code_override`) | |
| `click_id` | bigint | fk affiliate_clicks, null, on delete restrict | |
| `voided` | boolean | not null default false | self-purchase voids attribution and raises a flag (B4 #16). Voiding rather than deleting, because the attempt is the signal |
| `void_reason` | text | null | |
| `buyer_identity_id` | uuid | fk identities, not null, on delete restrict | **`SD-M8-05`** |
| `affiliate_identity_id` | uuid | fk identities, not null, on delete restrict | **`SD-M8-05`.** Both identities are stored rather than joined, because the check is a statement about the two of them **at the moment of purchase**, and an affiliate can be reassigned or an identity merged afterwards |
| `self_deal_link_confidence_bp` | integer | null, check between 0 and 10000 | **`SD-M8-05`.** The link-graph score ([ADR-022](../../decisions/ADR-022.md)) that produced the verdict. Null when the two identities are literally the same row, because that case needs no score |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: unique on `(purchase_id)` (inline); `attributions_affiliate_idx (affiliate_id, created_at desc)`; `attributions_buyer_idx (buyer_identity_id)`; `attributions_self_deal_review_idx (self_deal_link_confidence_bp desc)` where scored and not yet voided.
Constraints: `attributions_void_is_explained`; **`attributions_literal_self_deal_is_void`** (`buyer_identity_id <> affiliate_identity_id OR voided = true`).
The literal self-deal cannot be attributed at all, and that one is arithmetic. A graph-score self-deal is a judgment, voided by the detector with its confidence recorded. INV-M8-03: the check must record **what it found**, not only its verdict, or an argument about a voided commission has no evidence on either side.
