// =============================================================================
// apps/worker/src/batch/state-hash.ts
// =============================================================================
// THE IMPLEMENTATION LEFT THIS FILE (ADR-081). SD-08's canonical serialization
// and digest now live at `packages/rules-engine/src/hash.ts`, where M01 section
// 1.3's layout puts them. What remains here is the ONE thing that could not
// move: the `Buffer` boundary.
//
// This module was written "so that resolving it is a FILE MOVE", and it was.
// Its whole 480-line body -- the framing argument, the nineteen columns in
// ADR-026 C-07's order, the twenty-five gate leaves in declaration order, the
// exclusions with their reasons -- is in the engine unchanged, and the digest
// over a known `rule_states` row is byte-identical across the move. There is
// now ONE implementation of the serialization in this repository, which is what
// M01 section 1.3's rationale asks for and what the second copy defeated.
//
// -----------------------------------------------------------------------------
// WHY A SHIM RATHER THAN NOTHING AT ALL
// -----------------------------------------------------------------------------
// `rule_states.state_hash` is a `bytea` and `ports.ts:141` types it as `Buffer`;
// `replay.ts:161` compares two of them with `.equals()`. The engine cannot
// return a `Buffer`: `packages/rules-engine/tsconfig.json` sets `"types": []`,
// so `Buffer` does not exist there, which is the same constraint that made the
// SHA-256 hand-rolled. The conversion therefore belongs on THIS side of the
// boundary, where `@types/node` is in scope, and this file is that side.
//
// A re-export is not a second implementation. Nothing below computes anything
// the engine does not, and the only executable line wraps thirty-two bytes.
//
// THE THREE CALLERS ARE UNCHANGED BY DESIGN. `nightly.ts:66`, `replay.ts:77`
// and `src/index.ts:52` import from this path and keep compiling untouched,
// which is what let ADR-081's fence hold to one file in `apps/worker/src`.

import { stateHash as engineStateHash, type StateHashSubject } from '@merit/rules-engine';

export {
  canonicalStateSerialization,
  ENGINE_GATE_LEAVES,
  EXCLUDED_COLUMNS,
  HASHED_COLUMNS,
  StateHashError,
} from '@merit/rules-engine';

export type {
  ExcludedColumn,
  GateLeaf,
  HashedColumn,
  HashedState,
  StateHashSubject,
} from '@merit/rules-engine';

/**
 * SD-08. Thirty-two bytes, which is what `rule_states_hash_is_sha256` checks.
 *
 * `Buffer.from` COPIES rather than aliasing the engine's array, which is the
 * right default for a value that goes straight into a `bytea` bind parameter
 * and is compared with `.equals()` afterwards: a view over a buffer the engine
 * still holds is a value whose bytes another call could move.
 */
export function stateHash(subject: StateHashSubject): Buffer {
  return Buffer.from(engineStateHash(subject));
}
