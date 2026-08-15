## 23. GS-192 to GS-197: notification center (M16)

Defined by [M16](../../plans/M16-notification-center.md) section 8.2. The module's entire failure surface is the class boundary, so four of these six are negative fixtures.

| ID | Name | Pins |
|---|---|---|
| GS-192 | A freeze notice for an account inside an active investigation | The notice **sends on time**, carrying the ToS clause and the expiry date, and contains no detector, threshold, pattern description, or other identity. Asserts the tension is resolved by changing what the notice contains rather than whether it is sent, because the alternative is the "under review" anti-pattern Merit defined itself against. AS-M16-01, EC-114 |
| GS-193 | Contact change, then preference mute, then destination change | The **prior contact** receives every security notice, the preference change confirmed to the old contact before taking effect, and the sequence raises a high-severity risk signal. Asserts that a cooling window protects nobody if the person it exists to warn cannot be reached. AS-M16-02, EC-115, pairs with GS-104 |
| GS-194 | The nightly batch is replayed after a mid-run crash | One coalesced message per **identity**, and zero duplicates on replay; security and money classes stay exempt from coalescing. Asserts that recovery from a batch failure must not itself be a broadcast to the entire trader base. AS-M16-03, pairs with GS-047 |
| GS-195 | A template referencing a detector name and a population comparison | **Lint failure**; a template referencing published rule values and the trader's own facts passes. Asserts that the boundary is rules versus detection rather than secrecy versus openness, and that it derives from M7's strip registry so the two lists cannot drift. AS-M16-04 |
| GS-196 | A notice disputed with `read_at` null, and again with `read_at` set | Both answered from **dispatch plus delivery**, and `read_at` is never cited. Asserts that the convenient field is the one that cannot bear the weight a dispute puts on it. AS-M16-05, EC-116 |
| GS-197 | A migration adds a new notification kind | Marketing defaults **off**, the class is stated in the migration, and an unclassified kind fails the registry test. Asserts that class assignment is a policy decision that otherwise looks like a data row and gets no review. AS-M16-06 |
