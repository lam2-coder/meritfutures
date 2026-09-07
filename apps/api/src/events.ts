// =============================================================================
// apps/api/src/events.ts
// =============================================================================
// THE PRODUCER MOVED TO `packages/ledger/src/events.ts` (ADR-410). WHAT IS LEFT
// HERE IS THIS DEPLOYABLE'S NAME FOR IT AND NOTHING ELSE.
//
// The header that stood here argued, correctly, that the producer could not be
// installed from either deployable: `apps/api` holds no system door (ADR-171
// clause 1, whose section 9 condition is still unmet) and `apps/worker` holds
// the only `systemDb` in the workspace and could reach this file in neither
// spelling, an `@merit/api` manifest line being refused by `RI-04` and a
// relative specifier by `node-linker=isolated`. [ADR-408](../../../docs/decisions/ADR-408.md)
// section 6 then priced the remedy and found it costs no manifest edge, because
// `@merit/db`, `@merit/ledger` and `@merit/rules-engine` are each already a
// dependency of BOTH deployables. ADR-410 re-derived that intersection, ruled
// the home and took the move.
//
// -----------------------------------------------------------------------------
// WHY THIS FILE STILL EXISTS, WHICH IS A MEASUREMENT AND NOT A COURTESY
// -----------------------------------------------------------------------------
// NOTHING UNDER `apps/api/src` IMPORTS THIS MODULE AND NOTHING EVER DID. The
// producer's only consumers in this tree are suites. One of them,
// `apps/worker/test/replay-adapter.test.ts`, reaches it by RELATIVE PATH through
// this deployable, and that file is in no fence ADR-410 was granted. So this
// module is a compatibility name for exactly one consumer and it publishes
// exactly what that consumer takes.
//
// IT DELIBERATELY DOES NOT RE-EXPORT `makeEventSink` OR
// `TRANSACTION_EVENT_WRITER`, AND THE REASON IS NOT TIDINESS. Re-exporting the
// install pair from a deployable that cannot install anything would say this
// deployable holds the writer, which is the sentence ADR-348 spent a whole entry
// establishing is false. `RI-35`'s `event-sink-caller` probe reads a use of
// either name in a value position as an INSTALL, so a wide re-export here would
// also be read that way by the one check that watches for one. Both reasons
// point the same direction and the narrow surface is what they agree on.
//
// -----------------------------------------------------------------------------
// THE ABSENCE THIS FILE STILL CARRIES, WHICH `RI-35` IS ANCHORED TO
// -----------------------------------------------------------------------------
// `makeEventSink` is called by NO file under any `src/` in this workspace, so
// `UNWIRED_EVENT_SINK` is not merely the DEFAULT sink, it is the only sink any
// deployment could reach, and EVENTS' universal rule 1 is unsatisfied by every
// transition this estate performs rather than by some of them. **THE MOVE DID
// NOT CHANGE THAT AND IS NOT CLAIMED TO.** What it changes is that the sentence
// now describes work somebody can do: `apps/worker` can name the producer from
// this commit, and installing it there is a slice with its own verification
// which ADR-410 explicitly did not take.
//
// `RI-35`'s register anchors that claim to THIS PATH, so the sentence stays here
// while the register does. ADR-410 section 7 records that the anchor would read
// better at the producer's new home and that moving it was outside the fence
// that row was granted.
// =============================================================================

export { EVENT_NAMES, type EventName } from '@merit/ledger';
