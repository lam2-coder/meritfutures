---
status: review
depends_on: [README.md, ../../plans/M16-notification-center.md, ../../plans/M09-marketing-site.md, ../../DECISIONS.md]
last_updated: 2026-08-14
---

# Incident comms templates

Constitution section 7: **incident comms templates pre-written**. Twelve of them, referenced by id from the runbooks.

**Why they are pre-written.** The message that matters most goes out in the first minutes, when the person writing it knows least and is under the most pressure. A template costs nothing when it is not needed and it is the difference between a notice at minute three and a notice at minute forty, which is the difference between Merit telling traders and traders telling each other.

---

## The five rules every template already obeys

1. **Say what is wrong, what is not affected, and when the next update comes.** All three, in the first three sentences. A message missing the third is a message that generates the questions it was sent to prevent.
2. **Never say "we are investigating" without a time.** It reads as "we do not know how long", which is true and is exactly why the time has to be a commitment to update rather than a commitment to resolve.
3. **Name what was never at risk.** In this market a partial statement is read as a full one, and "your funds were never at risk" is only worth saying when it is true, which is why it is a field rather than a habit.
4. **No detector names, thresholds, patterns, or other identities**, ever, in any trader-facing message ([M16](../../plans/M16-notification-center.md) GS-192, GS-195). The two-tier evidence rule applies to comms.
5. **A parameter is read, never copied.** Any template rendering a plan value reads it from the pinned plan version at send time ([parameter-status ruling](../../DECISIONS.md)). No number is typed into a template.

**And the meta-rule: a template is a starting point that must be edited before sending.** A message that reads as boilerplate during a real incident does more harm than a slightly awkward one that reads as a person.

---

## The templates

| ID | Used by | Audience | Channel |
|---|---|---|---|
| CT-01 | [RB-01](RB-01-nightly-batch-failure.md) | All funded traders | In-app, email |
| CT-02 | [RB-02](RB-02-recon-mismatch.md), [RB-05](RB-05-rithmic-sftp-failure.md) | Affected accounts | In-app, email |
| CT-03 | [RB-02](RB-02-recon-mismatch.md) | Affected account | In-app, email |
| CT-04 | [RB-03](RB-03-mid-freeze.md) | Public, checkout surface | Site banner |
| CT-05 | [RB-04](RB-04-settlement-rail-outage.md) | Traders with pending withdrawals | Status page, in-app, email |
| CT-06 | [RB-04](RB-04-settlement-rail-outage.md) | Same recipients as CT-05 | Same channels |
| CT-07 | [RB-05](RB-05-rithmic-sftp-failure.md) | All funded traders | In-app |
| CT-08 | [RB-06](RB-06-restore-from-backup.md) | All traders | Email, status page |
| CT-09 | [RB-07](RB-07-ledger-imbalance.md) | One identity | Email, in-app |
| CT-10 | [RB-07](RB-07-ledger-imbalance.md) | All traders | Status page, in-app, email |
| CT-11 | [RB-08](RB-08-security-incident.md) | All affected | Email |
| CT-12 | [RB-11](RB-11-verification-provider-outage.md) | Queued verifications | In-app, email |

---

### CT-01: Dashboard data is stale

> **Your dashboard is showing yesterday's session**
>
> Our overnight processing did not finish on schedule, so account states are as of the {last closed trading day} session rather than {expected trading day}.
>
> **Payout requests are unaffected.** They are evaluated against the last closed session in normal operation too, so nothing about your eligibility has changed.
>
> We expect states to be current by {time}. We will update here either way at {time}.

### CT-02: An account is held offline

> **{Account reference} is temporarily offline**
>
> We hold an account out of trading whenever we cannot confirm its risk settings with the trading platform. That confirmation has not come back yet, so the account is offline rather than live without protection.
>
> Nothing about your evaluation progress or your balance has changed, and no trading day is counting against you while this is open.
>
> Next update at {time}.

*Note: the last clause is a commitment about counters and must be true. Confirm the counter treatment before sending.*

### CT-03: Your history changed

> **A correction was applied to {trading day}**
>
> The trading platform sent us a corrected record for {trading day} and we have recomputed your account from that day forward. Some numbers in your history have changed as a result.
>
> {If a settled payout is affected: "A payout you have already received is not affected. We never reverse a settled payout, in either direction."}
>
> The full before-and-after is on your account timeline. If anything does not look right, reply and we will walk through it.

### CT-04: Purchasing paused

> **New purchases are paused**
>
> We have paused checkout while we resolve an issue with a payment provider.
>
> **Existing accounts, evaluations, funded trading, and payouts are all unaffected and are running normally.**
>
> We expect to reopen by {time} and will update here at {time}.

### CT-05: Withdrawal delay, opening message

> **Bank withdrawals are delayed**
>
> Our settlement provider is having an outage, so withdrawals from your Merit wallet to your bank are queued rather than sending.
>
> **Payouts themselves are working normally.** A payout request still credits your Merit wallet immediately, and that has not changed. What is delayed is moving money from the wallet out to your bank.
>
> Every queued withdrawal is held with its original request time and will send in order when the provider recovers. Nothing is lost and nothing needs resubmitting.
>
> Next update at {time}, whether or not anything has changed.

### CT-06: Withdrawal delay, closing message

> **Withdrawals are sending again**
>
> The queue cleared at {time}. Every withdrawal held during the outage has been sent, in the order it was requested. Bank settlement remains 2 to 3 business days from send.
>
> The outage lasted {duration}. Wallet credits were never affected, no request was lost, and no withdrawal was sent twice. We have reconciled every transfer against the provider's records to confirm that.
>
> {What changed as a result.}

### CT-07: Session data unavailable

> **Live and end-of-session data is behind**
>
> We have not received {trading day}'s session file from the trading platform, so your account states are still showing {last closed trading day}.
>
> Your positions and your trading are unaffected; this is our reporting, not your account. Payout eligibility continues to be evaluated against the last closed session as normal.
>
> Next update at {time}.

### CT-08: After a restore

> **Service restored, and what was lost**
>
> We restored our database to {timestamp} after {one plain sentence}. Data written between {timestamp} and {recovery time} was lost and has been re-processed from the trading platform's own records where possible.
>
> **What this means for you specifically: {precise statement}.**
>
> We have verified that the ledger balances, that no payout was sent twice, and that every account's history re-derives correctly from the trading records. {Anything not yet verified, named.}
>
> If your account does not look right, reply and we will reconstruct it with you.

*Note: this template is the one most likely to be softened under pressure. Do not soften it. A restore described as maintenance is a sentence a trader finds later.*

### CT-09: Payouts paused on your account

> **Payouts on your account are paused while we check something**
>
> An automated check found a discrepancy in our own accounting records involving your account. Payouts on it are paused while we resolve it.
>
> **This is not a flag on you and it is not a review of your trading.** It is our books disagreeing with themselves, and we stop paying out of records we cannot reconcile.
>
> We expect to resolve it within 24 hours. You will hear from us either way, at {time}.

### CT-10: Payouts paused, all traders

> **Payouts are paused**
>
> An automated check found that our internal accounting records do not balance. We have paused all payouts while we resolve it.
>
> **This is a control working, not a failure of one.** We do not pay out of records we cannot reconcile, and the check exists so that we find out rather than discovering it later.
>
> Your balances and your account states are unaffected. Trading continues normally.
>
> Next update at {time}, and every {interval} after that until it is resolved.

### CT-11: Security incident

> **A security incident, and what we know so far**
>
> {What happened, in one sentence, in plain words.}
>
> **What we know:** {facts}.
> **What we do not yet know:** {gaps, stated as gaps}.
> **What we have done:** {containment, rotation}.
> **What you should do:** {action, or explicitly "nothing at this time"}.
>
> Next update at {time}.

*Note: never state that no data was accessed until it can be proven. Say what is known, say what is not, and give a time.*

### CT-12: Verification queued

> **Your verification is queued**
>
> Our identity verification provider is having an outage, so your verification is queued rather than processing. You are at {step} and you will not need to start again.
>
> {If applicable: "Your account is ready and will go live as soon as this completes."}
>
> Next update at {time}.
