---
status: approved
depends_on: [README.md, ../../architecture/API_CONTRACT.md, ../../plans/M10-integrations.md, ../../DECISIONS.md]
last_updated: 2026-08-14
---

# RB-10: Support, and the trader who swears the account id is right

**Read this line first: the system is not broken, and support never resolves an account from a trader-supplied id.**

That sentence is the runbook. Everything below explains it, and the explanation is for a calm afternoon rather than for the conversation you are in.

**Trigger.** A trader reports a `404` on an account, a payout, or a timeline, and is certain the identifier is correct.
**Severity.** S4. It is a support interaction, not an incident.

## Why the API answers `404`

**`404` rather than `403` when a trader addresses another trader's resource** was ruled at the M1 gate and it is deliberate: **existence is not confirmed to a stranger.** A `403` tells an enumerating attacker that the object exists and belongs to somebody else, which is precisely the information an IDOR sweep is looking for (GS-247, D0-2). The support cost is real, it was accepted with this runbook as the mitigation, and the ruling says so in as many words.

**So a `404` means one of three things** and support cannot tell which from the response, by design:

1. The resource does not exist.
2. It exists and belongs to somebody else.
3. It exists, belongs to this trader, and they are authenticated as a different identity.

## The procedure

1. **Authenticate the trader** through the normal support-verification path. **A Discord account is not a credential** (GS-187) and neither is knowing an account id.
2. **Look the identity up in the admin console.** Not the id. The identity.
3. **Read the account list from there** and work with what it says.
4. If the id the trader supplied is not in that list, the correct sentence is that **the id is not on their account**, not that it does not exist. You do not know whether it exists and you must not find out on their behalf.
5. If they insist it is theirs, check for a **second identity**: a different email at checkout, a linked household member, or a merge that has not happened. That is the common benign cause and it is resolved by identity rather than by id.

## The support console's own boundary

The support tool carries **no identity parameter to tamper with**; the contact reference resolves server side, and every read is audited with the exact field list returned (GS-149). **The tool is minimized in the data rather than in the agent's training**, because agents are hired to be helpful under time pressure and a helpful agent with a broad tool is the attack in [M10](../../plans/M10-integrations.md) AS-M10-01.

## Never

- Never paste a trader-supplied id into an admin route to "check".
- Never confirm or deny that an id exists.
- Never answer an account-specific question in a public channel (GS-191). Route it to the ticket and answer there.
