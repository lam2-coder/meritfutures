---
status: approved
depends_on: []
last_updated: 2026-08-18
---

# DECISIONS (ADR registry)

Every choice with rationale and alternatives. Constitution amendments are proposed here. ADR format per entry:

```
## ADR-NNN: <title>  (YYYY-MM-DD, status: proposed | accepted | superseded)
- Context:
- Decision:
- Alternatives considered:
- Consequences:
```

The Open Decisions Register (constitution section 10) resolves into entries here during W1 with the founder: queue tech, ORM, Rithmic ingest path, PSP shortlist, auth provider, hosting, restricted-jurisdiction list, Discord bot scope, KYC placement (M19).

Split to a file per entry on 2026-08-15 by [ADR-043](ADR-043.md). The number
allocation tables live in [ALLOCATION.md](ALLOCATION.md); the gate closures that
grouped these rulings live in [gates/](gates/).

## Architecture decision records

<!--gen:adr_registry-->
| ADR | Title |
|---|---|
| [ADR-001](ADR-001.md) | Repo root stands in for `merit/`  (2026-08-13, status: accepted) |
| [ADR-002](ADR-002.md) | Rithmic ingest path is SFTP-first, both directions  (2026-08-13, status: accepted) |
| [ADR-003](ADR-003.md) | Session-length policy on money vs non-money paths  (2026-08-13, status: accepted) |
| [ADR-004](ADR-004.md) | CLAUDE_CODE_PLAYBOOK.md location (research/ vs docs/)  (2026-08-13, status: accepted) |
| [ADR-005](ADR-005.md) | Rithmic vendor call deferred; M2 ingest specifics are provisional  (2026-08-13, status: accepted) |
| [ADR-006](ADR-006.md) | Queue technology is pg-boss (Postgres-only)  (2026-08-13, status: accepted) |
| [ADR-007](ADR-007.md) | Hosting is managed Postgres (Neon) plus Railway plus Cloudflare  (2026-08-13, status: accepted) |
| [ADR-008](ADR-008.md) | ORM is Drizzle  (2026-08-13, status: accepted) |
| [ADR-009](ADR-009.md) | Payout amount is optional and defaults to the maximum eligible  (2026-08-13, status: accepted) |
| [ADR-010](ADR-010.md) | Dual control on cap, split, gap, and treasury credentials, with both keys founder-held at launch  (2026-08-13, status: accepted) |
| [ADR-011](ADR-011.md) | Reserve funding is weekly-manual with a same-day top-up trigger  (2026-08-13, status: accepted) |
| [ADR-012](ADR-012.md) | Admin console lives on a separate apex domain  (2026-08-13, status: accepted) |
| [ADR-013](ADR-013.md) | The cadence gap anchors on the settled payout's effective day; Rapid Daily becomes Merit Rapid  (2026-08-13, status: accepted) |
| [ADR-014](ADR-014.md) | The floor never resets on settlement; the lock is a permanent stop  (2026-08-13, status: accepted) |
| [ADR-015](ADR-015.md) | Plan parameters come from the founder's lifecycle simulation; funded minimum trading days is zero  (2026-08-13, status: accepted) |
| [ADR-D1](ADR-D1.md) | Corpus phase runs on a single trunk, with pull and push enforced by hooks  (2026-08-14, status: accepted) |
| [ADR-016](ADR-016.md) | A ledger imbalance halts payouts for the implicated identity; only a global mismatch halts everything  (2026-08-13, status: accepted) |
| [ADR-017](ADR-017.md) | Every outbound payment in Merit uses one rail and one transfer table  (2026-08-13, status: accepted) |
| [ADR-018](ADR-018.md) | Merit Rapid requires 3 win days  (2026-08-14, status: accepted) |
| [ADR-019](ADR-019.md) | Merit Wallet, two-leg payouts with the cadence anchor on wallet credit  (2026-08-14, status: accepted) |
| [ADR-020](ADR-020.md) | A two-tier data plane, with an indicative realtime layer over the authoritative EOD engine  (2026-08-14, status: accepted) |
| [ADR-021](ADR-021.md) | KYC placement is a composite trigger set, not a single point  (2026-08-14, status: accepted) |
| [ADR-022](ADR-022.md) | Identity defense is elevated to a scored graph, in three priced tiers  (2026-08-14, status: accepted) |
| [ADR-023](ADR-023.md) | A digital-footprint enrichment vendor at checkout, bought and not built  (2026-08-14, status: accepted) |
| [ADR-024](ADR-024.md) | The ladder and the live invitation are two separate mechanisms  (2026-08-14, status: accepted) |
| [ADR-025](ADR-025.md) | Progressive cap release is rejected for v1 and replaced with cross-account loyalty  (2026-08-14, status: accepted) |
| [ADR-026](ADR-026.md) | The schema-delta reconciliation, and the count correction  (2026-08-14, status: accepted) |
| [ADR-027](ADR-027.md) | `trader_withdrawable` and `trader_wallet` are two distinct positions  (2026-08-14, status: accepted, **reversing an earlier ruling in this same session**) |
| [ADR-028](ADR-028.md) | `payout_requests.status` under the wallet  (2026-08-14, status: accepted) |
| [ADR-029](ADR-029.md) | `dedupe_matches` is the authoritative hard link  (2026-08-14, status: accepted) |
| [ADR-030](ADR-030.md) | Plan-config key names are `max_payouts` and `kyc.triggers`  (2026-08-14, status: accepted) |
| [ADR-031](ADR-031.md) | The published statistic is `bigint` with a unit, and its no-floats exemption is retired  (2026-08-14, status: accepted) |
| [ADR-032](ADR-032.md) | `measure` on `published_statistics`, and the pair invariant as DDL  (2026-08-14, status: accepted) |
| [ADR-033](ADR-033.md) | The reviewer subagent is a citation check, not an adversarial one  (2026-08-14, status: accepted) |
| [ADR-034](ADR-034.md) | ADR numbers are allocated, not guessed, and no document states a derivable count  (2026-08-14, status: accepted) |
| [ADR-035](ADR-035.md) | `0027`'s published-plan-version immutability trigger reads a column that does not exist  (2026-08-15, status: accepted) |
| [ADR-036](ADR-036.md) | Migration numbers are allocated, not guessed, and the allocation gate lives where the number set already lives  (2026-08-15, status: accepted) |
| [ADR-037](ADR-037.md) | A shorthand may not restate a value the config owns  (2026-08-15, status: accepted) |
| [ADR-038](ADR-038.md) | A CI stage states, in its own output, what it currently proves  (2026-08-15, status: accepted) |
| [ADR-039](ADR-039.md) | Auth is passkeys plus email OTP plus SMS OTP, and a verified phone is an identity signal  (2026-08-15, status: accepted) |
| [ADR-040](ADR-040.md) | The payout enforcement window, and zero denial expressed as a state that expires  (2026-08-15, status: accepted) |
| [ADR-041](ADR-041.md) | Identity-level restriction is `restricted`, and this is its enforcement surface  (2026-08-15, status: accepted) |
| [ADR-042](ADR-042.md) | The trading calendar is transcribed from the exchange, and Merit computes nothing in business days  (2026-08-15, status: accepted) |
| [ADR-043](ADR-043.md) | The append-only registries become directory-per-entry  (2026-08-15, status: accepted) |
| [ADR-044](ADR-044.md) | The AI and LLM policy. A permission boundary that adds no scope, and a narration boundary on the trader surface  (2026-08-16, status: accepted) |
| [ADR-045](ADR-045.md) | A `trading_calendar` correction that leaves no prior image is refused by the database  (2026-08-16, status: accepted) |
| [ADR-046](ADR-046.md) | A contact address is held reversibly, and the notification obligation is discharged by evidence  (2026-08-16, status: accepted) |
| [ADR-047](ADR-047.md) | `rule_states` carries the calendar revision, and Appendix B.4's protocol governs a calendar correction  (2026-08-16, status: accepted) |
| [ADR-048](ADR-048.md) | CI-03's polarity is derived per fixture from the rules it cites  (2026-08-16, status: accepted) |
| [ADR-049](ADR-049.md) | `CalendarSlice` is a value, and a lookup miss is a typed refusal  (2026-08-16, status: accepted) |
| [ADR-050](ADR-050.md) | `INV-06` gains a stated `R-31` exception, and it is exactly one rule  (2026-08-17, status: accepted) |
| [ADR-051](ADR-051.md) | `R-32` anchors at `opened_on`, and `phase_eval.max_days` is the column that binds  (2026-08-17, status: accepted) |
| [ADR-052](ADR-052.md) | The locked floor is an assignment, and the engine is wrong because a test was made stricter than the rule it was testing  (2026-08-17, status: accepted) |
| [ADR-053](ADR-053.md) | The high-water bound holds only while the floor is unlocked, and what it stops asserting is the ruling  (2026-08-17, status: accepted) |
| [ADR-054](ADR-054.md) | `R-35` does not run on the row that closes an account, and `GS-064`'s `20,000` is right  (2026-08-17, status: accepted) |
| [ADR-055](ADR-055.md) | A holiday pauses the session belonging to the next trade date, and the exception carries that session's bounds  (2026-08-17, status: accepted) |
| [ADR-056](ADR-056.md) | `INV-07` gains a stated `R-31` exception, and the lock is cleared rather than carried  (2026-08-18, status: accepted) |
| [ADR-057](ADR-057.md) | one refuted sentence in four documents, and the ninth field on a breach row  (2026-08-18, status: accepted) |
| [ADR-058](ADR-058.md) | The calendar source publishes forward-only, so a full forward year never exists and the six-month horizon alarm can never be cleared  (2026-08-18, status: accepted) |
| [ADR-059](ADR-059.md) | The three engine inputs group A is blocked on, framed as three questions, and the disposition of the five registry rows that no answer to them can free  (2026-08-18, status: accepted) |
| [ADR-060](ADR-060.md) | `engine_eligible` contains the six funded gates and not R-38, and the reason it was unrulable is that no document ever enumerated them  (2026-08-18, status: accepted) |
| [ADR-061](ADR-061.md) | A duplicated table key is a repair when a session can state that both rows say the same thing, and an amendment when it cannot  (2026-08-20, status: accepted) |
| [ADR-062](ADR-062.md) | The payout gate reads `identities.status = 'active'`, and three more of section 10's ten duplicated guards were contradictions rather than copies  (2026-08-20, status: accepted) |
| [ADR-063](ADR-063.md) | `SET A` keeps `INV-M5-17`, `18` and `19`, and one of the six rows is not a collision but a duplicate  (2026-08-20, status: accepted) |
| [ADR-064](ADR-064.md) | A session number is an allocation and not an identifier; identity is `(log file, section heading)`, the renumber is declined rather than defaulted into, and a hole is an unspent allocation  (2026-08-20, status: accepted) |
| [ADR-065](ADR-065.md) | One key, one row; a blank line inside a table hides every row below it from every gate; and `CI-06<letter>` has run out of alphabet  (2026-08-20, status: accepted) |
| [ADR-066](ADR-066.md) | Five vendor-parity surfaces admitted, two excluded, and the largest of the five is not new scope but an outstanding commitment nobody had noticed was unsatisfied  (2026-08-20, status: accepted) |
| [ADR-067](ADR-067.md) | An adjustment posts to the wallet and never to withdrawable, a debit may only reverse a credit this table itself posted, and the eligibility pair the fold plan offered is false because the corpus has two exits  (2026-08-20, status: accepted) |
| [ADR-068](ADR-068.md) | impersonation is a distinct session type that cannot elevate, so three of its seven refusals are ones the corpus already makes  (2026-08-20, status: accepted) |
| [ADR-069](ADR-069.md) | Parity is the condition that makes read-only impersonation correct, and the eighteen gaps close at `owner` with the initiative recorded  (2026-08-20, status: accepted) |
| [ADR-070](ADR-070.md) | Plan configuration is first-class versioned config, the `rules` blob stays and its PUBLICATION is constrained instead, and contract limits are Merit-owned with the transport left to the vendor call  (2026-08-20, status: accepted) |
| [ADR-071](ADR-071.md) | `M21`, the Plan Designer and Simulation Console, admitted as a new module after FREEZE, with the Monte Carlo harness named as a dependency that does not exist  (2026-08-20, status: accepted) |
| [ADR-072](ADR-072.md) | A golden fixture is writable when three checkable conditions hold, and every registry row without one carries a stated blocker from a closed vocabulary  (2026-08-20, status: accepted) |
| [ADR-073](ADR-073.md) | A gate-inventory row closes when it is implemented or carries a dated activation condition, `CI-09` ships one leg of four, and `VG-11` is struck from `CI-07`  (2026-08-20, status: accepted) |
| [ADR-074](ADR-074.md) | A definition site is a row or a heading inside a DECLARED register, and `CI-06/identifier-series` reads a written scope rather than a discovered one  (2026-08-20, status: accepted) |
| [ADR-075](ADR-075.md) | the three extraction doors read `identities.status = 'active'`, and the two commerce doors are a different question  (2026-08-21, status: accepted) |
| [ADR-076](ADR-076.md) | none of Tier 2's fourteen needs a second fixture format, because a registry row is a COVERAGE obligation and not a fixture obligation  (2026-08-21, status: accepted) |
| [ADR-077](ADR-077.md) | there is no 25 hour session and there never was a 23 hour one either in the sense the registry means; the DST hour lands in the WEEKEND GAP, and nothing in the tree computes from any of it  (2026-08-22, status: accepted) |
| [ADR-078](ADR-078.md) | `replay` joins the rules engine's public surface, and the site count is not what decides it  (2026-08-22, status: accepted) |
| [ADR-079](ADR-079.md) | the consistency period is bounded against the ANCHOR, not against the row's own trading day  (2026-08-22, status: accepted) |
| [ADR-080](ADR-080.md) | A `VG` row closes on its NEXT link and never on its whole chain, and two of the twelve are unwired for no reason at all  (2026-08-22, status: accepted) |
| [ADR-081](ADR-081.md) | `hash.ts` moves into the engine, and the SHA-256 is hand-rolled because a standing ruling says so  (2026-08-23, status: accepted) |
| [ADR-082](ADR-082.md) | the closed unit vocabulary widens its DEFINITION and never its token list, and `rail clock` names its class after its commonest member  (2026-08-23, status: accepted) |
| [ADR-083](ADR-083.md) | the API is its own deployable, one codebase deployed twice, and Fastify runs it  (2026-08-23, status: accepted) |
| [ADR-084](ADR-084.md) | `ScopedDb` gets a real client, the scope is a DECLARED registry, and one consequence of ADR-008 is superseded  (2026-08-23, status: accepted) |
| [ADR-085](ADR-085.md) | `CI-04`'s artifact was never the Neon branch, and two `VG` chains expire the moment it says so  (2026-08-24, status: accepted) |
| [ADR-086](ADR-086.md) | The job interface is five methods, the transaction is the first argument, and one primitive is foreclosed on purpose  (2026-08-24, status: accepted) |
| [ADR-087](ADR-087.md) | the publish decision resolves to a run that FINISHED and ran over THIS row, and the digest half stays open because it has no producer  (2026-08-24, status: accepted) |
| [ADR-088](ADR-088.md) | the ADR registry and the session index are generated from the files they index, and the CLAIM table never will be  (2026-08-24, status: accepted) |
| [ADR-089](ADR-089.md) | six Railway services, and `portal-api` was a fused process name rather than an origin label  (2026-08-24, status: accepted) |
| [ADR-090](ADR-090.md) | "one rail" binds on the destination and the detector, and the affiliate settlement leg is a sibling table rather than a widened `payout_transfers`  (2026-08-24, status: accepted) |
| [ADR-091](ADR-091.md) | analytics is granted `rule_states`, because denying it FORCES the attack the denial cites, and M13's claim that the thresholds are unreachable does not survive `engine_gates`  (2026-08-24, status: accepted) |
| [ADR-092](ADR-092.md) | `schema.ts` and `scope.ts` are transcribed ONCE PER MODULE, the owner is the TABLE rather than the module, and the queue is the TYPE CHECKER rather than a document  (2026-08-24, status: accepted) |
| [ADR-093](ADR-093.md) | auth is P3's, because the phase whose title already says "identity" is the one whose own stated contents cannot ship without it  (2026-08-24, status: accepted) |
| [ADR-094](ADR-094.md) | a transcription reads a table AS OF THE LAST MIGRATION, and the drift assertion becomes a REPLAY whose vocabulary is one member wide and whose default is FAIL  (2026-08-24, status: accepted) |
| [ADR-095](ADR-095.md) | the UI framework is Next.js App Router in `apps/portal` and `apps/site`, and the decision that outlives it is what it FORECLOSES  (2026-08-24, status: accepted) |
| [ADR-096](ADR-096.md) | an unauthenticated public read goes over HTTP to the public API, and `apps/site` never links `packages/db` at all  (2026-08-24, status: accepted) |
| [ADR-097](ADR-097.md) | OUTCOME 1 OF THE THREE. The vocabulary ALREADY HAS the term, it is `outside-loader-boundary`, and `GS-143` and `GS-144` are MIS-FILED. No seventh term, no row leaves section 39, and the closed six stay closed  (2026-08-24, status: accepted) |
| [ADR-098](ADR-098.md) | the operator path's absence from every UI deployable is a PROPERTY of this repository, and `RI-09` is that property  (2026-08-25, status: accepted) |
| [ADR-099](ADR-099.md) | `ADR-083`'s build-script clause is superseded, and the VG-12 admission for the UI framework is recorded  (2026-08-25, status: accepted) |
| [ADR-100](ADR-100.md) | a route module contributes its routes as a unit and the directory listing is the module list  (2026-08-25, status: accepted) |
| [ADR-101](ADR-101.md) | `derived` is REFUSED where the row carries its own identity column and refused again on a nullable edge, and the refusal is an assertion rather than a sentence  (2026-08-25, status: proposed) |
| [ADR-102](ADR-102.md) | the accessor learns to WRITE inside a transaction it also produces, and a third door serves the rows that belong to nobody  (2026-08-25, status: proposed) |
| [ADR-103](ADR-103.md) | column TYPE and NULLABILITY are COMPARED, so `ALTER COLUMN` stops standing in for a comparison that did not exist  (2026-08-25, status: proposed) |
| [ADR-104](ADR-104.md) | the imbalance is unrepresentable, the posting path is a library both deployables call, and a halt is only a halt because this code path honours it  (2026-08-25, status: proposed) |
| [ADR-105](ADR-105.md) | the PSP port is the ORDER and the vendor is the mechanics, and two fakes are what told them apart  (2026-08-25, status: proposed) |
| [ADR-106](ADR-106.md) | a row whose subject is a PAIR of identities belongs to both and is scoped to neither  (2026-08-25, status: proposed) |
| [ADR-107](ADR-107.md) | the provisioning saga admits nobody it cannot produce evidence for, and five of seven operations have no inverse  (2026-08-26, status: proposed) |
| [ADR-109](ADR-109.md) | the accessor cannot name a row, so the idempotency store is a port and the raw body is a parser (2026-08-26, status: accepted) |
| [ADR-110](ADR-110.md) | the method page is a public read of a versioned definition, and the address of a definition is a pair whose second half the path does not carry (2026-08-26, status: accepted) |
| [ADR-111](ADR-111.md) | two of the three homeless shapes get a contract row and the third gets a home it cannot be given here, because a banner that describes a session must arrive on the response that resolved it (2026-08-26, status: accepted) |
| [ADR-112](ADR-112.md) | the accessor learns to name ONE ROW, and the six writes that could not are removed rather than documented  (2026-08-26, status: proposed) |
| [ADR-113](ADR-113.md) | the creative-submission endpoint enters the contract, and the row is written from the CONSTRAINTS rather than from the plan's sentence  (2026-08-26, status: proposed) |
| [ADR-114](ADR-114.md) | the composite trigger set fires on funnel order because every condition is monotone, and the KYC webhook's contractual anchor names no table  (2026-08-26, status: proposed) |
| [ADR-115](ADR-115.md) | enrichment observes, and the two places observe mode could quietly become enforcement are closed by shape rather than by discipline  (2026-08-26, status: proposed) |
| [ADR-116](ADR-116.md) | Playwright `1.56.1` is admitted under a DELEGATED `VG-12` grant, and `CI-08` becomes a stage that renders fixtures because there is no page  (2026-08-26, status: proposed) |
| [ADR-117](ADR-117.md) | `RI-08` guards every package against an EMPTY admission list, because the two ADR-096 named were five before this session opened  (2026-08-26, status: proposed) |
| [ADR-118](ADR-118.md) | a section headed by a date or a session number is a RECORD, and ADR-034's count rule does not reach it  (2026-08-26, status: proposed) |
| [ADR-119](ADR-119.md) | the demo world is a VALUE at `scripts/demo/world.ts`, not a Postgres seed, and naming it reopens `CI-09` on purpose  (2026-08-26, status: proposed) |
| [ADR-120](ADR-120.md) | `apps/api` joins the admission list, and wiring the auth surface finds that ADR-112 unblocked everything a session can DO and nothing that makes one  (2026-08-27, status: proposed) |
| [ADR-121](ADR-121.md) | "shipped source" for `RI-10` means the directories the node loader loads, and `scripts/` is one of them  (2026-08-27, status: proposed) |
| [ADR-122](ADR-122.md) | `input_digest` is taken over the computation's own argument, and it EXCLUDES the answer  (2026-08-27, status: proposed) |
| [ADR-123](ADR-123.md) | the refusal on `accountsAudited === 0` moves into `runReplayAudit`, and an empty book now REFUSES instead of reporting clean  (2026-08-27, status: proposed) |
| [ADR-128](ADR-128.md) | the audited write, and the table `OI-01` has been waiting on  (2026-08-27, status: proposed) |
<!--/gen-->

## Gate closures

| Closure                                                                                                                                                                                       | Rulings | ADRs |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---- |
| [M1 gate closure (2026-08-13)](gates/m1-gate-closure-2026-08-13.md)                                                                                                                           | 0       | 0    |
| [Wave 3 batch 1 gate closure (2026-08-14)](gates/wave-3-batch-1-gate-closure-2026-08-14.md)                                                                                                   | 9       | 0    |
| [Parameter status: launch candidates versus structural rulings (founder ruling, 2026-08-14)](gates/parameter-status-launch-candidates-versus-structural-rulings-founder-ruling-2026-08-14.md) | 0       | 0    |
| [Consolidated founder addendum and batch 2 gate closure (2026-08-14)](gates/consolidated-founder-addendum-and-batch-2-gate-closure-2026-08-14.md)                                             | 2       | 5    |
| [FREEZE gate closure (2026-08-14)](gates/freeze-gate-closure-2026-08-14.md)                                                                                                                   | 4       | 17   |
| [Unsigned ADR audit (2026-08-18)](gates/unsigned-adr-audit-2026-08-18.md)                                                                                                                     | 0       | 0    |
