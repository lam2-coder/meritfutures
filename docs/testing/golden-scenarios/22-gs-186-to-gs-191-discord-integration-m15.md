## 22. GS-186 to GS-191: Discord integration (M15)

Defined by [M15](../../plans/M15-discord-integration.md) section 8.2. Every fixture here tests a disclosure, because that is the only thing this module actually does.

| ID | Name | Pins |
|---|---|---|
| GS-186 | Role sync for a trader opted into one role and not another | **Only the consented role** is granted, and no role in the catalogue encodes an amount, size, count, or rank. Asserts that consent to be in a room is not consent to be labeled in it, and that granularity is what turns a badge into a target list ordered by value. AS-M15-01, EC-110 |
| GS-187 | A Discord identity presented to auth, recovery, and support verification | All three refuse and the link table is unreachable from each by grant; a bot state query returns a portal link and no account data. Asserts that a community feature must not import the password-stuffing threat model SECURITY C-01 designed Merit out of. AS-M15-02, EC-111 |
| GS-188 | The bot token used to post an unknown template and a free-text message | **Both refused**; a replayed legitimate template posts and is recorded with its causing event. Asserts that the control bounds what a valid credential can say, since a fake retroactive rule change does its damage at the screenshot rather than at the correction. AS-M15-03, EC-112 |
| GS-189 | Prohibited-arrangement solicitation observed in the community | Moderated as a server matter, producing **no flag, no evidence entry, and no account action**. Asserts the published separation between moderating a room and enforcing against an account. AS-M15-04, EC-113 |
| GS-190 | An enforcement closes an account holding a synced role | Removal is deferred into a batch window containing mixed churn, and the trader was notified first. Asserts that a role vanishing at a timestamp publishes a private enforcement to a public room, bypassing the whole two-tier evidence machinery in one API call. AS-M15-05 |
| GS-191 | An account-specific question asked in a public channel | An automatic routing reply, **no account state disclosed**, and no human answer in channel. Asserts that a public answer is an unlogged support interaction with an audience. AS-M15-06 |
