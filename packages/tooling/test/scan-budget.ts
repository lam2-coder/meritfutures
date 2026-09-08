// =============================================================================
// THE PER-CASE BUDGET FOR A TEST WHOSE INPUT IS THIS REPOSITORY (ADR-468)
// =============================================================================
// ONE CONSTANT, IMPORTED, RATHER THAN A NUMBER TYPED INTO SIX SUITES. ADR-466
// declared this figure inside `absence-claims.test.ts` because its fence named
// one file. ADR-468 holds the whole of `packages/tooling/test/` and found the
// same scan called from two files at once: `ri35.run(REPO_ROOT)` runs in
// `absence-claims.test.ts` and again in `repo-invariants.test.ts` through
// `CHECKS`, and `RI-18` runs in `repo-invariants.test.ts` and again in
// `response-shape-copies.test.ts`. A per-FILE figure would hand ONE scan TWO
// budgets according to which suite called it, so the constant belongs to
// neither file and lives here.
//
// RAISING A BUDGET IS NOT WEAKENING A GATE, AND THE ARGUMENT IS ADR-466's.
// What each case asserts, what it reads, the scope it reads over and the verdict
// it computes are byte-identical either side of the diff that added this. A
// timeout is not a control over the tree; it is the wall that stops a hang from
// wedging CI, and 60 seconds stops a hang exactly as well as 5 does. The thing
// the 5000ms default was catching here is the SIZE of this repository, which is
// not a defect.
//
// -----------------------------------------------------------------------------
// THE FOUR FACTORS, EACH MEASURED ON THIS CONTAINER AT `7f7ba90`
// -----------------------------------------------------------------------------
// 4 CPU, 15GB, Node v22.22.2, vitest 4.1.10. Unloaded means a full-suite run
// with nothing else running. Loaded means the same full suite with four
// background CPU spinners on four cores.
//
//   BASE          2797ms   the costliest member of the population in an
//                          unloaded full-suite run: `RI-35 finds nothing`,
//                          which is `ri35.run(REPO_ROOT)`, the same scan that
//                          ABORTED at 5212ms in the loaded run at this base
//   CONTENTION     x1.9    median over 32 population members, unloaded against
//                          loaded, at this base. p90 x2.14, max x2.22. ADR-466
//                          measured x1.61 from a single case
//   MACHINE       x2.21    ADR-465 reports 6183ms in the position where this
//                          container reports 2797ms. NOT rounded down: 6183 is
//                          an ABORT rather than a completion, so it is a lower
//                          bound on that container's true cost. This factor is
//                          a SECONDARY source and is the one number here that
//                          was not measured on this machine
//   GROWTH         x5.0    for five times today's source scope, on a MEASURED
//                          exponent of 1.00. The shipped `ri35.run` costs
//                          2258ms over 18,084,541 byte(s) of source-like files
//                          and 7588ms over 60,793,057, against a scaled copy of
//                          this tree outside the repository. 60,793,057 /
//                          18,084,541 = 3.36 and 7588 / 2258 = 3.36, so the
//                          cost per megabyte does NOT fall as the scope grows.
//                          ADR-466 measured a falling rate and took x3.2 for the
//                          same five-fold horizon; that did not reproduce here
//
//   2797 x 1.9 x 2.21 x 5.0 = 58,723, and 60_000 is that rounded up.
//
// -----------------------------------------------------------------------------
// THE GROWTH ASSUMPTION, WRITTEN OUT SO A LATER READER CAN FALSIFY IT
// -----------------------------------------------------------------------------
// THIS BUDGET HOLDS UNTIL THE SOURCE SCOPE REACHES ABOUT FIVE TIMES ITS
// 18,084,541 BYTES, on a container 2.21 times slower than this one and fully
// contended. To falsify it, scale a copy of the tree and time `ri35.run`
// against it; the claim is that the cost is linear in source bytes with the
// per-megabyte figure flat, and one measurement showing that figure rising
// retires this number.
//
// BOTH GROWTH MECHANISMS ARE LIVE IN THIS POPULATION AND ONLY ONE OF THEM
// BINDS. ADR-466 falsified ADR-465's stated mechanism for `ri35`: the sweep
// excludes `docs&#47;` by construction, so an ADR costs it under half a
// millisecond. That correction holds and it was re-derived here: cloning the
// corpus from 36.6MB to 95.2MB of `docs&#47;` moved `ri35.run` 2258ms to 2492ms,
// which is a factor of 1.10 for a factor of 2.60 of corpus. But this population
// is wider than ADR-466's and it DOES hold members whose input is the corpus:
// over the same clone `RI-16` moved 959ms to 1372ms (7.0ms per corpus
// megabyte), the absence-grammar census 635ms to 1276ms (10.9ms), and `RI-12`
// 158ms to 322ms (2.8ms). At 26,056 bytes per ADR file that is about 0.28ms of
// census per ADR, so a thousand further ADRs buy the costliest corpus reader
// about 284ms. THE CORPUS MOVES THIS POPULATION AND IT DOES NOT SET THIS
// NUMBER: application source does, which is what P1 and P2 are about to add.
//
// -----------------------------------------------------------------------------
// WHO GETS IT: THE BUDGET BELONGS TO THE INPUT, NOT TO THE FILE AND NOT TO THE
// WALL-CLOCK
// -----------------------------------------------------------------------------
// A CASE CARRIES THIS BUDGET WHEN IT WALKS A DIRECTORY OF THIS REPOSITORY THAT
// IT DOES NOT NAME, so its cost grows as the repository grows. A case that
// reads files a register names, or imports two modules by path, keeps the
// 5000ms default: its input is the register or the module, and for it the only
// thing a timeout does is bound a hang.
//
// ADR-466 SPLIT ITS POPULATION BY WALL-CLOCK AND THAT DISCRIMINATOR DOES NOT
// SURVIVE THE WIDER FENCE. There the two groups were separated by a factor of
// twelve, 328ms against 27ms, because they were two KINDS of input. Here the
// costs run continuously from 5212ms down to 1ms with no gap anywhere, because
// `repo-invariants.test.ts` reads ONE kind of input at thirty-five different
// depths inside a single `test.each`. Sorting by milliseconds would put `RI-08`
// at 1ms and `RI-35` at 5212ms in different populations while both are one
// invariant over one tree, generated by one call site.
//
// AND GREP GETS THIS WRONG IN BOTH DIRECTIONS, WHICH IS WHY THE POPULATION WAS
// DERIVED BY READING CALLS RATHER THAN BY SEARCHING FOR A NAME:
//
//   FALSE NEGATIVE  `generated-column-writes.test.ts` names `REPO_ROOT` NOWHERE
//                   and walks the tree in seven cases, because `derivedSet`,
//                   `literalStatements` and `run` take the root as a DEFAULT
//                   PARAMETER and the suite calls them with no argument.
//                   `refusedWrites` shares that default and is NOT a walk: it
//                   imports two named modules, so the five cases that call it
//                   and nothing else keep the default
//   FALSE NEGATIVE  `absence-grammar-census.test.ts` names `REPO_ROOT` nowhere
//                   and walks the tree in three cases, off a root it computes
//                   locally from `import.meta.url`
//   FALSE NEGATIVE  `price-register.test.ts` names `REPO_ROOT` nowhere and
//                   walks the whole of `docs/decisions` in two cases, because
//                   `derive` and `readRegister` default to it and `run()` calls
//                   both. Its default is spelled `DECISIONS`, so even a search
//                   for the identifier `REPO_ROOT` in the CHECKERS misses it
//   FALSE POSITIVE  `repo-invariants.test.ts`'s runner-report block passes
//                   `REPO_ROOT` to `transcript`, whose checks are `held`,
//                   `violated` and `crashes` fixtures whose `run` ignores the
//                   root entirely. It names the constant and scans nothing
//   FALSE POSITIVE  `price-register.test.ts`'s `it takes no argument` calls
//                   `run(['--fix'])`, which returns before it reads anything.
//                   The walking function is called and no walk happens
//   FALSE POSITIVE  `write-guard-set.test.ts` reaches the real tree in every
//                   case and walks none of it: `derive` and
//                   `legConventionShared` default to TWO NAMED FILES, so its
//                   cost is the size of `scoped-db.ts` and not of the tree. Its
//                   costliest case is 165ms and it keeps the default
// =============================================================================

/**
 * Milliseconds a single Vitest case is given when its input is this repository.
 *
 * Passed as the third argument to `test()` and to the invocation of a
 * `test.each` table. It is deliberately NOT a global `testTimeout`: a global
 * moves every case in the workspace, including the fixture cases whose honest
 * budget is a hundred milliseconds.
 */
export const CORPUS_SCAN_MS = 60_000;
