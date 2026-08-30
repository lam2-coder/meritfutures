---
status: approved
depends_on: []
last_updated: 2026-08-30
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
| [ADR-124](ADR-124.md) | the global ledger halt is a MECHANISM and it is not a `ledger_halts` row  (2026-08-27, status: proposed) |
| [ADR-125](ADR-125.md) | `no-fixture-format` is one sentence written 227 times, this document's own `GS-030` row refutes it, and seven of the 227 are asserted and passing today  (2026-08-27, status: proposed) |
| [ADR-126](ADR-126.md) | the vocabulary that moves is the TABLE and never the REASON, and mint and resolve are not the same shape  (2026-08-27, status: proposed) |
| [ADR-127](ADR-127.md) | Stryker is admitted under a DELEGATED `VG-12` grant, `CI-09`'s third leg is built, and the trend-only ruling is expressed by writing NO threshold at all  (2026-08-27, status: proposed) |
| [ADR-128](ADR-128.md) | the audited write, and the table `OI-01` has been waiting on  (2026-08-27, status: proposed) |
| [ADR-130](ADR-130.md) | A derivable count can belong to ONE DOCUMENT, and the count vocabulary could not say so  (2026-08-27, status: proposed) |
| [ADR-131](ADR-131.md) | the `CI-06<letter>` series is CLOSED at `w`, the last letter is retired UNUSED, and the retirement is a gate rather than a convention  (2026-08-27, status: proposed) |
| [ADR-132](ADR-132.md) | a registry README indexes by ROW, and `CI-06n` stops accepting a sentence  (2026-08-27, status: proposed) |
| [ADR-133](ADR-133.md) | the fixture backlog is DERIVED and not SUBTRACTED, and a summary table row is inside ADR-034's scope even though the gate excludes it  (2026-08-27, status: proposed) |
| [ADR-134](ADR-134.md) | a design record names exactly the columns its table carries, and the check that says so lands unregistered  (2026-08-27, status: proposed) |
| [ADR-135](ADR-135.md) | `OQ-F3-01` and `OQ-F3-02` were ruled on 2026-08-20 and the wallet exit was shut on 2026-08-21, so a credit to a `closed` identity is an obligation Merit records and currently cannot pay  (2026-08-27, status: proposed) |
| [ADR-137](ADR-137.md) | `OI-16` never held `GS-004` and `GS-031`'s expected end state, and the blocker on both is the calendar record's missing `halted` key  (2026-08-27, status: proposed) |
| [ADR-138](ADR-138.md) | a Server Action has no path, so the refusal is TOTAL, and the first rendered document is what makes it reachable  (2026-08-27, status: proposed) |
| [ADR-139](ADR-139.md) | the dispatch named four endpoints, `API_CONTRACT` has two of them free, and `AccountDetail.progress` is refused by the contract's own nullability  (2026-08-27, status: proposed) |
| [ADR-140](ADR-140.md) | the identity-status term of `G-ELIGIBLE` is a named refusal and never a gate result, and the contradiction this session was dispatched to rule was CLOSED six days earlier  (2026-08-27, status: proposed) |
| [ADR-141](ADR-141.md) | a trader-scoped response that names a catalogue row is TWO reads in one direction, and the compiler already refuses the version of that mistake everybody looks for  (2026-08-27, status: proposed) |
| [ADR-144](ADR-144.md) | an admin route is an ordinary route module, and the surface that serves it is selected by the partition that already exists  (2026-08-27, status: proposed) |
| [ADR-145](ADR-145.md) | `admin_actions.reason` is a PRECONDITION, so the audit row is written first and the route never supplies one (2026-08-27, status: proposed) |
| [ADR-146](ADR-146.md) | two date vocabularies meet on one object, so the contract's suffix rule stops being a convention and becomes a refusal (2026-08-27, status: proposed) |
| [ADR-147](ADR-147.md) | `M04` section 3.3's consistency meter names five figures, three of them reach no client, and two of those three are `R-29`'s own operands  (2026-08-27, status: proposed) |
| [ADR-148](ADR-148.md) | `G-ELIGIBLE` conjoins two terms the eligibility response declares no gate for, so the differentiator screen can render ten passing gates beside a refusal  (2026-08-27, status: proposed) |
| [ADR-152](ADR-152.md) | an as-of stamp's staleness is a claim the SERVER makes and the portal ORDERS, never one the portal computes, and no account-state contract publishes the fact today  (2026-08-27, status: proposed) |
| [ADR-153](ADR-153.md) | `API_CONTRACT` section 12 names `GET /auth/otp`, the contract defines no such endpoint, and the row means `POST` (2026-08-27, status: proposed) |
| [ADR-154](ADR-154.md) | tier 1's boundary is an ARTIFACT and tier 2 has none, so the simulator implements `streamLive` and the shared thing becomes the TYPE  (2026-08-27, status: proposed) |
| [ADR-155](ADR-155.md) | `ADR-022`'s v1 tier names a LINK CLASS, and "auto-enforce" is the edge being written without review rather than a transition on the flag machine  (2026-08-27, status: proposed) |
| [ADR-156](ADR-156.md) | `OI-28` was closed by a ruling and dispatched as open, and `0047` proves the publish decision sound AT THE WRITE and nothing preserves it after  (2026-08-27, status: proposed) |
| [ADR-157](ADR-157.md) | a read may narrow by a RANGE and by IS NULL and a write may not, the lock is a ROW lock rather than an advisory one, and the aggregate P7 asked for is refused on evidence  (2026-08-27, status: proposed) |
| [ADR-158](ADR-158.md) | the wallet surface enters the contract, and every row that disagreed with a plan was written from the CHECK  (2026-08-27, status: proposed) |
| [ADR-159](ADR-159.md) | an event NAME becomes a catalogue ROW only where every field is a column or a named mirror, and the reservation that funded this entry named a different catalogue  (2026-08-27, status: proposed) |
| [ADR-161](ADR-161.md) | the live tier enters `API_CONTRACT` as a PAYLOAD rather than as an endpoint, its degradation is one object rather than two messages, and `feed.*` is produced by the sweep and never by the feed  (2026-08-27, status: proposed) |
| [ADR-162](ADR-162.md) | the portal's HTTP client is one server-side file that forwards one cookie, stores nothing, and asserts no wire shape  (2026-08-27, status: proposed) |
| [ADR-163](ADR-163.md) | the live tier's address is `apps/api` on both existing surfaces, so the estate gains no sixth deployable and no seventh service, and the container diagram gains three arrows and no live-cache node  (2026-08-27, status: proposed) |
| [ADR-164](ADR-164.md) | the live cache is a Postgres table reachable only by a fifth role, and the grant that makes `INV-M2-14` structural is a REVOKE against `0026`'s own default  (2026-08-27, status: proposed) |
| [ADR-165](ADR-165.md) | `apps/worker` is admitted to the trader database, the reason it runs at existed before the door did, and the deployable takes ONE door because a scheduled job has nobody to resolve  (2026-08-27, status: proposed) |
| [ADR-166](ADR-166.md) | the evidence export's audience is a required parameter with no default, and section 8's three-path heading becomes three rows because one of the three is built and two are not  (2026-08-27, status: proposed) |
| [ADR-167](ADR-167.md) | the pass-rate CUSUM is RECOMPUTED and never stored, `plan_breaker_state` keeps its one-row-per-plan-day key, and the migration number reserved for a table returns to the pool  (2026-08-27, status: proposed) |
| [ADR-168](ADR-168.md) | three reads `apps/portal` names and `API_CONTRACT` does not define, and they do not have the same answer (2026-08-27, status: proposed) |
| [ADR-169](ADR-169.md) | the payout-destination cooling window gets a registry, and `cooling_until` is `NOT NULL` because a nullable one fails OPEN  (2026-08-27, status: proposed) |
| [ADR-170](ADR-170.md) | the verification page enters the contract, and the field that addressed it for two weeks now resolves (2026-08-27, status: proposed) |
| [ADR-171](ADR-171.md) | the third door is REFUSED, and the reason is a measurement rather than the argument it was allocated against: it unblocks none of the five ports (2026-08-28, status: proposed) |
| [ADR-172](ADR-172.md) | the ledger handle a request handler cannot hold, and the store that was already built (2026-08-28, status: proposed) |
| [ADR-173](ADR-173.md) | the correction's reference is the adjustment, the corrected entry is in `admin_actions`, and no column is missing  (2026-08-28, status: proposed) |
| [ADR-174](ADR-174.md) | `LT-07` is not a posting with one bad leg, it is a posting whose two legs are on the wrong sides, so no code is minted and `0052` returns to the pool unspent  (2026-08-28, status: proposed) |
| [ADR-175](ADR-175.md) | the two ledger idempotency conventions are one rule under two spellings, and the rule is that a key names the EVENT and never the DOOR  (2026-08-28, status: proposed) |
| [ADR-176](ADR-176.md) | the request path records the approval and does not post it, and the key it must store to make that safe (2026-08-28, status: proposed) |
| [ADR-177](ADR-177.md) | the chart of accounts is seeded and four of its seven kinds are ruled, and `firm_treasury` is refused because the corpus contradicts itself about it rather than because it is silent  (2026-08-28, status: proposed) |
| [ADR-178](ADR-178.md) | the flag queue sorts by corroboration first, the contract's severity-then-age is kept as the order within a band, and the depth goes on the wire because the assertion cannot check a key it cannot see (2026-08-28, status: proposed) |
| [ADR-179](ADR-179.md) | the redaction vocabulary is closed at two members, it was open at exactly one line rather than at a call site, and each member's promise is written per member because the corpus states it three times in three different lengths (2026-08-28, status: proposed) |
| [ADR-180](ADR-180.md) | `firm_treasury` is an asset, so the prose is right, the three postings written against it are backwards, and `M05` section 2.1 is amended rather than left standing  (2026-08-28, status: proposed) |
| [ADR-181](ADR-181.md) | the external leg's in-flight obligation is a firm-scoped liability and none of the seven codes can hold it, so the shape is ruled and `0054` returns to the pool unspent  (2026-08-28, status: proposed) |
| [ADR-182](ADR-182.md) | `apps/admin` renders in Next.js App Router, and the ruling that costs something is the one underneath it: the console SERVES HTTP, so the operator surface's 27 routes are its data source and never its alternative (2026-08-28, status: proposed) |
| [ADR-183](ADR-183.md) | an identity's three ledger positions are opened by the database when the identity is created, and `0054` is spent  (2026-08-28, status: proposed) |
| [ADR-184](ADR-184.md) | the admin event feed gets its contract row, and the ruling underneath it is that the read belongs on `AdminReadSource` as a seventh method while `INV-M6-10`'s two modes move into the REQUEST (2026-08-28, status: proposed) |
| [ADR-185](ADR-185.md) | `EVENTS` section 11 carries TWELVE triggers, so the count moves and the table stands; and the repair is to DELETE the number rather than correct it, because a corrected number re-arms the identical trap  (2026-08-28, status: proposed) |
| [ADR-186](ADR-186.md) | the last two codes are both assets, the `ELSE true` closes to `ELSE false`, and shape (iii) becomes unrepresentable rather than merely refused  (2026-08-28, status: proposed) |
| [ADR-187](ADR-187.md) | the eighth ledger code is minted, it is `withdrawals_in_flight`, and the shape was not chosen but left  (2026-08-28, status: proposed) |
| [ADR-188](ADR-188.md) | the liability response is one snapshot row column for column, the shared name is KEPT, and the total is the reader's  (2026-08-28, status: proposed) |
| [ADR-189](ADR-189.md) | the ninth ledger transaction is `LT-09`, it reverses `LT-06` when the rail is exhausted, and `0057` is taken because a reversal nobody checks is a promise  (2026-08-28, status: proposed) |
| [ADR-190](ADR-190.md) | an operator route answers eight things and none of them is 503, the uncomposed source keeps its 500, and a console renders no status it did not receive (2026-08-28, status: proposed) |
| [ADR-191](ADR-191.md) | a row that reaches an identity two DIFFERENT ways is scoped by both, and the sixth class is `either`  (2026-08-28, status: proposed) |
| [ADR-192](ADR-192.md) | the thirteen keep their 503 and stop disclosing it before authenticating, because ADR-190's ground is two grounds and only one of them reaches here (2026-08-28, status: proposed) |
| [ADR-193](ADR-193.md) | a reversal may not chain onto another reversal, the rule refuses the LINK and not the operation, and it lives in a trigger because the builder is not weak here but incapable  (2026-08-28, status: proposed) |
| [ADR-194](ADR-194.md) | a search term is a VALUE THE ESTATE HOLDS and never a pattern the operator composed, so the name fragment is removed from the contract rather than expressed (2026-08-28, status: proposed) |
| [ADR-195](ADR-195.md) | the in-flight obligation is a TERM IN Open Liability and not a figure beside it, `INV-M5-15` does not move, and the column the term needs does not exist  (2026-08-28, status: proposed) |
| [ADR-196](ADR-196.md) | an identity comes into existence at the first VERIFIED contact, in one unit of work with its `users` row, and the row it writes carries nothing  (2026-08-28, status: proposed) |
| [ADR-197](ADR-197.md) | the OTP key is a deployment secret, the digest binds the address as typed, and the establishment door is one verb  (2026-08-28, status: proposed) |
| [ADR-198](ADR-198.md) | a `_cents` value inside `events.payload` is a DECIMAL STRING  (2026-08-28, status: proposed) |
| [ADR-199](ADR-199.md) | `reserve_coverage_snapshots` is `firm` and registering it is the whole of what `packages/db` owed `readLiability`, because the other three figures are DERIVABLE and `0062` returns unspent  (2026-08-28, status: proposed) |
| [ADR-200](ADR-200.md) | a verified code creates the identity, the consumption is ruled and guarded, and the two pre-identity doors are narrowed at the door rather than refused  (2026-08-28, status: proposed) |
| [ADR-201](ADR-201.md) | the payout-velocity window is seven trading days against thirty scaled to seven, and the settled threshold PROVES that reading rather than this entry choosing it  (2026-08-28, status: proposed) |
| [ADR-202](ADR-202.md) | the required `cusum` object yields to the absence ruling, because a shape may not promise a value a ruling forbids producing  (2026-08-28, status: proposed) |
| [ADR-203](ADR-203.md) | a liability figure that is not there is a `null` whose reason rides on the body, in a closed vocabulary of three, because the corpus already built this shape twice and neither copy was on the wire  (2026-08-28, status: proposed) |
| [ADR-204](ADR-204.md) | the per-account eligibility forecast is a projection of ONE gate under five stated assumptions, because ten of the eleven conditions that decide eligibility have inputs no stored row can know seven days out  (2026-08-28, status: proposed) |
| [ADR-205](ADR-205.md) | `detector.run_completed` is blocked by two DIFFERENT defects, and only one of them is its own row's  (2026-08-28, status: proposed) |
| [ADR-206](ADR-206.md) | `engine_gates` stores the engine's own value in the engine's own names, with cents as base-10 strings, because the storage constrains nothing and the three shapes already in this tree disagree  (2026-08-29, status: proposed) |
| [ADR-207](ADR-207.md) | `rule_states` stores `lifetime_settled_cents`, `breached` and `breach_kind`, and the state hash is the question this entry declines to answer  (2026-08-29, status: proposed) |
| [ADR-208](ADR-208.md) | `GET /admin/eligible-forecast` declines with a body and never with a 404, because on its own heading a 404 already means a route nobody has built  (2026-08-29, status: proposed) |
| [ADR-209](ADR-209.md) | a `TableKey` may name a VIEW, its scope class is the class of the relation it PROJECTS, and it is never addressable -- so `economic_calendar_current` is registered and `affiliate_statements` needed no ruling at all  (2026-08-29, status: proposed) |
| [ADR-211](ADR-211.md) | one transaction does not make two reads consistent, so the crossing is two transactions keyed by the scoped result -- and the payout port stays blocked anyway, because nothing in this database pins the numbers `ResolvedPlan` is built from  (2026-08-29, status: proposed) |
| [ADR-212](ADR-212.md) | a citation proves the cited line is PART OF WHAT THE SENTENCE NAMES, so `RI-15` gains an anchor, a vacancy rule and the comma list -- and the window it was built on turns out to move nothing at all  (2026-08-29, status: proposed) |
| [ADR-213](ADR-213.md) | a published plan version's size grid is immutable, and the `INSERT` is refused on the same evidence as the `UPDATE` -- because `validatePlan` runs at the publish transition and takes the whole grid  (2026-08-29, status: proposed) |
| [ADR-214](ADR-214.md) | a reason's existence claim DOES reach schema objects, and because no runner can tell a column name from prose, the reason supplies the command that settles it  (2026-08-29, status: proposed) |
| [ADR-216](ADR-216.md) | `rule_states.phase` moves onto `account_phase`, and the argument against a `CHECK` is a copy count nobody had taken  (2026-08-29, status: proposed) |
| [ADR-217](ADR-217.md) | the wallet gains an `error` arm, and the boundary between "we do not serve this" and "this failed" is the contract's 404 ruling  (2026-08-29, status: proposed) |
| [ADR-219](ADR-219.md) | the portal's first write verb, and the CSRF control it does not mint because the one the corpus already has is on the wrong side of a fence  (2026-08-29, status: proposed) |
| [ADR-221](ADR-221.md) | the constitution's CSRF control, taken as an Origin check because the cookie the corpus trusted is scoped to a site and the attack is scoped to an origin  (2026-08-29, status: proposed) |
| [ADR-223](ADR-223.md) | the constitution's `strict CSP/HSTS/frame-deny`, taken at the origin on all four surfaces, with `script-src`'s one weakness named and priced rather than papered over  (2026-08-29, status: proposed) |
| [ADR-224](ADR-224.md) | `.env` is ignored by a three-line rule and the rule is asserted by running git, because an entry anybody can delete is not a control and the gate that claimed to verify it reads no gitignore  (2026-08-29, status: proposed) |
| [ADR-225](ADR-225.md) | `zod at every boundary` names a mechanism this workspace has never had, so the six citations are separated from the control they claim, and the one thing zod uniquely supplies turns out not to be validation at all  (2026-08-29, status: proposed) |
| [ADR-226](ADR-226.md) | the Turnstile token is verified, because a required field that is never checked teaches every caller that any string works  (2026-08-29, status: proposed) |
| [ADR-227](ADR-227.md) | an approval line is three different objects, and only one of them is a signature  (2026-08-29, status: proposed) |
| [ADR-228](ADR-228.md) | The dual-control threshold is `500000` integer cents, it needed a ceiling before it needed a value, and it is undischarged on the path the question named  (2026-08-29, status: proposed) |
| [ADR-229](ADR-229.md) | a code is delivered, because a product nobody can sign in to is a product with one defect and it is this one (2026-08-29, status: proposed) |
| [ADR-230](ADR-230.md) | The `pair` class gets a WRITE door and keeps its read refusal, the narrowness is a stamp rather than a check, and the route it was built for still does not serve  (2026-08-29, status: proposed) |
| [ADR-231](ADR-231.md) | The public lookup door, and the enumeration control it rests on is asserted by the corpus and enforced by nothing  (2026-08-29, status: proposed) |
| [ADR-232](ADR-232.md) | The approval edge exists and is dual controlled above `500000` cents on an operator's hand alone, and it is not what ends a per-trader lockout  (2026-08-29, status: proposed) |
| [ADR-233](ADR-233.md) | A `firm`-class read on the scoped transaction, because the objection that governs a `pair` row is absent for a row that belongs to nobody (2026-08-29, status: proposed) |
| [ADR-234](ADR-234.md) | The terminal edge is `cancelled`, because it is the only exit money never travels down, and a rail that cannot report cannot be settled by an operator either  (2026-08-29, status: proposed) |
| [ADR-235](ADR-235.md) | The code is the only credential, and the corpus asserted its strength in five places while no function in the repository produced one  (2026-08-29, status: proposed) |
| [ADR-236](ADR-236.md) | The admin read port is behind the SSO purchase after all, its shape reason is retired as measured false for six of seven, and the one read that is genuinely unbuilt waits on a rule-state writer  (2026-08-29, status: proposed) |
| [ADR-237](ADR-237.md) | Authentication and the operator directory are two different things, so the directory is built, `admin_actions.actor` gains a referent, and what is left of the SSO blocker is one named function and three named variables  (2026-08-29, status: proposed) |
| [ADR-238](ADR-238.md) | The account cap is the firm's number and no plan version can hold it, the cross-identity read is refused a second time with the remedy named, and the checkout ledger arm is foreclosed by the corpus rather than by the accessor  (2026-08-29, status: proposed) |
| [ADR-239](ADR-239.md) | The API reads a rule state the worker wrote, and the reason this deployment can produce none is that nothing runs the worker at all  (2026-08-29, status: proposed) |
| [ADR-240](ADR-240.md) | a horizon a deployment sets is configuration and a signing key this deployable would hold is not, so one of three ports is wired and the other two have their absences measured (2026-08-29, status: proposed) |
| [ADR-241](ADR-241.md) | the worker is a one-shot job whose exit code is its only signal, the schedule is external, and the first `BatchPorts` value over Postgres serves four of ten methods and refuses six by name  (2026-08-29, status: proposed) |
| [ADR-242](ADR-242.md) | an ops plane is four different questions, and one of them is a database read whose blocker is a door somebody already ruled (2026-08-29, status: proposed) |
| [ADR-243](ADR-243.md) | four money-path approvals are earned rather than granted, and the classifier that sized the queue is over-inclusive at the tier that matters most  (2026-08-29, status: proposed) |
| [ADR-244](ADR-244.md) | tier 1 is classified entire, its class C residue is ONE entry of twenty-one, and the classifier that sized it is not measuring the same object rather than measuring it wrongly  (2026-08-29, status: proposed) |
| [ADR-245](ADR-245.md) | the worker landing closed two of the payout port's four links and moved neither of the other two, so the port still refuses, and `PayoutSubject`'s third field has never had a clause  (2026-08-29, status: proposed) |
| [ADR-246](ADR-246.md) | three certificate ports are two questions, the card is one deliverable and not three, and a port whose own message promised a 503 was answering 500 (2026-08-29, status: proposed) |
| [ADR-247](ADR-247.md) | tiers 2 and 3 classified entire, the class C residue is TWO of fifteen, and one of the two is established by running the falsifier rather than by arguing it  (2026-08-29, status: proposed) |
| [ADR-248](ADR-248.md) | `ExternalGates` is external to the REPLAYED STATE and not to this estate, three of its five facts resolve off registered tables, and the in-flight leg has no predicate to read because M01 states R-38's grain both ways  (2026-08-29, status: proposed) |
| [ADR-249](ADR-249.md) | the certificate card is rendered on fetch, stored nowhere, addressed by the code and signed by nothing, so the two remaining certificate ports wait on a renderer and no migration is owed (2026-08-29, status: proposed) |
| [ADR-250](ADR-250.md) | the `engine_gates` codec is a transcription of a ruling that already existed, it is a ROUND TRIP because the port that waits on the column reads it, and the wire shape that was nearest to hand would have lost three leaves into the replay hash  (2026-08-29, status: proposed) |
| [ADR-251](ADR-251.md) | an instant is not a trading day, the gap was narrower than the sentence, and the port that named it asked a three-armed question with one arm (2026-08-29, status: proposed) |
| [ADR-252](ADR-252.md) | the base account cap gets the firm's row ADR-238 named, its vocabulary is closed at the database, and both ports stay refused for reasons that have stopped being the same reason  (2026-08-29, status: proposed) |
| [ADR-253](ADR-253.md) | a table the registry cannot name, and the ruling ADR-106 said was owed turns out to be a REFUSAL (2026-08-29, status: proposed) |
| [ADR-254](ADR-254.md) | `R-38` is ACCOUNT grained, the index that already enforces it is right and is M01's own delta, and the identity rule it was confused with is a different rule on a different table that is already served  (2026-08-29, status: proposed) |
| [ADR-255](ADR-255.md) | `0038`'s reversal pointer is not the linkage the reason wanted, the absent column is absent by ruling, and the entry named the one of four that was discharged (2026-08-29, status: proposed) |
| [ADR-256](ADR-256.md) | the card that was ruled and not built is built, its refusals are state-independent so a revocation cannot become a failure, and the two ports it unblocks are one SLICE from wireable rather than one VARIABLE from wired (2026-08-30, status: proposed) |
| [ADR-257](ADR-257.md) | four fields arrive at two slots, `ok` is the engine's and is not recomputed, and the field with nowhere to go is integer cents (2026-08-29, status: proposed) |
| [ADR-258](ADR-258.md) | the fold's blocker was one field and not six, `prior` is a smaller read than the port ADR-250 left refusing, and the plan decoder this slice needed already exists one deployable over (2026-08-30, status: proposed) |
| [ADR-259](ADR-259.md) | the probe is run, the seed that reported it unwatched cannot be installed at all, and the gap that is real is that nothing binds scope to code (2026-08-30, status: proposed) |
| [ADR-260](ADR-260.md) | the resolver nobody had written, the seventh account status refused rather than admitted, and the nightly fold that now completes because of it  (2026-08-30, status: proposed) |
| [ADR-261](ADR-261.md) | the composition ADR-256 named is written and the image port is wired, its refusal is moved in front of the door so a deferral cannot decide it, and the list port turns out to wait on a guard rather than on a variable (2026-08-30, status: proposed) |
| [ADR-262](ADR-262.md) | the affiliate is resolved inside `packages/db` and leaves as a bit, the counterparty stamp is a registry field rather than an assumption, and the two `AffiliateRef` declarations were never one shape (2026-08-30, status: proposed) |
| [ADR-263](ADR-263.md) | the edge had a guard, a clock and a database behind it and no door, and what moves is one paragraph of a frozen contract rather than a route this session invented  (2026-08-30, status: proposed) |
| [ADR-264](ADR-264.md) | the fold was run rather than reasoned about, the row it wrote is read back by `apps/api`, and what stands between the payout port and 200 is now a deployment and one read on the wrong door  (2026-08-30, status: proposed) |
| [ADR-265](ADR-265.md) | the cap gets a door that hands out one number, the catalogue admission its own sizing called for is refused because it would have built the trap, and the two ports become one finding again  (2026-08-30, status: proposed) |
| [ADR-266](ADR-266.md) | the guard ADR-261 named is written, the list port's refusal is moved into the read arm so a deferral cannot decide it, and the second of the two card ports is wired (2026-08-30, status: proposed) |
| [ADR-267](ADR-267.md) | the remedy does not transfer, because LT-01 credits the wallet and LT-06 debits it, and the corpus separates the two legs by exactly that fact  (2026-08-30, status: proposed) |
| [ADR-268](ADR-268.md) | the day is a named door, because a catalogue read would hand the payout route R-06 itself and a second transaction would compute a verdict from a calendar the recording transaction never read  (2026-08-30, status: proposed) |
| [ADR-269](ADR-269.md) | a blocker whose every term is spent while its figure stays absent was stated one layer too high, the fold that names the layer underneath, and a liability figure that says which of its terms are measured  (2026-08-30, status: proposed) |
| [ADR-270](ADR-270.md) | what posts a ledger entry is decided by who the transaction's opener serves, a posting may move to a clock exactly where its pinned check resolves no caller, and both refusals stand  (2026-08-30, status: proposed) |
| [ADR-271](ADR-271.md) | a calendar day has no timezone, so the `date` type parser hands back the wire text and the crossing two libraries were performing has nowhere left to happen  (2026-08-30, status: proposed) |
| [ADR-272](ADR-272.md) | a suffix that lies inside the temporal vocabulary is the defect, and a name that says nothing is not  (2026-08-30, status: proposed) |
| [ADR-273](ADR-273.md) | the coverage check lives in the caller and that is safe exactly where a TYPE makes forgetting a compile error, so the split is ruled rather than moved and the census is closed by `RI-27`  (2026-08-30, status: proposed) |
| [ADR-274](ADR-274.md) | five clocks and an operator was told about none of them, so `TZ` is written down as the one that decides nothing and a check keeps it that way  (2026-08-30, status: proposed) |
| [ADR-275](ADR-275.md) | the register that names every invariant in this tree was read by nothing, so a check could land without its row with every gate green  (2026-08-30, status: proposed) |
| [ADR-276](ADR-276.md) | one word, two temporal types, and the estate already tells them apart in six of nine places, so the finding is the three that say nothing rather than the collision  (2026-08-30, status: proposed) |
| [ADR-277](ADR-277.md) | the worker's guard asked the right question of the wrong table, and the repair is a refusal plus a type, because the sharper half of the defect was on the branch that looked safe  (2026-08-30, status: proposed) |
| [ADR-278](ADR-278.md) | the rename ADR-272 specified, and the reader that could not have seen it land (2026-08-30, status: proposed) |
| [ADR-279](ADR-279.md) | a stripper that eats the file, and the count in the row was seven where the tree holds twenty-nine (2026-08-30, status: proposed) |
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
