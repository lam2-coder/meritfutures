// =============================================================================
// apps/api/src/admin-source/index.ts
// =============================================================================
// THE COMPOSITION, AND IT IS A SEPARATE FILE FOR EXACTLY ONE REASON.
//
// `AdminReadSource` (`routes/admin-reads.ts`) declares SIX methods and three
// slices in two phases implement different ones: `P7-i` takes `listFlags` and
// `readIdentityGraph`, `P7-j` takes `exportEvidence`, and `P5-l` takes
// `readLiability`. P7 section 9 rows the division as **SERIAL on the index and
// concurrent on everything else**, which is `ADR-100`'s answer reached by hand,
// because each method's real work lives in its own module and only the assembly
// is shared.
//
// -----------------------------------------------------------------------------
// A KEEP-BOTH MERGE OF THIS FILE TYPE-CHECKS WHILE DROPPING A METHOD
// -----------------------------------------------------------------------------
// P7 section 5.5 names the hazard on the worker's barrel and it is the same
// hazard here: a re-export or a composition list resolved by taking one side
// reads as a clean resolution, compiles, and loses a leg, because A TYPE CHECKER
// CANNOT SEE AN EXPORT THAT IS SIMPLY GONE. It happened in this repository, in
// `apps/worker/src/index.ts`, and it passed `pnpm run typecheck`.
//
// SO THE UNIMPLEMENTED METHODS THROW WITH THEIR OWN NAME IN THE MESSAGE rather
// than being absent. A method that was composed and then lost in a merge answers
// "no module supplies `listFlags`" at the first request, which is the loud
// version of the failure; a method that was never composed answers the same
// thing and nothing pretends otherwise. `AdminReadError`'s own no-source message
// makes the same choice one level up.
//
// **WHOEVER RESOLVES A CONFLICT IN THIS FILE KEEPS BOTH KEYS AND RE-READS THE
// FILE AFTERWARDS.** A green typecheck is not evidence here.
// =============================================================================

import type { AdminReadSource } from '../routes/admin-reads.ts';

import { createEvidenceExporter } from './evidence.ts';
import type { EvidenceExporterDeps } from './evidence.ts';

/** A method the deployment has not composed yet. */
export class AdminSourceNotComposed extends Error {
  constructor(method: string) {
    super(
      `no module supplies \`AdminReadSource.${method}\`, so this read has no rows to return. ` +
        'This is a deployment which has not been finished rather than a request that failed: ' +
        'the module lives beside this file and the composition is one key in `composeAdminReadSource`',
    );
    this.name = 'AdminSourceNotComposed';
  }
}

/**
 * The methods a deployment has modules for. One key per slice.
 *
 * PARTIAL BY DESIGN AND NOT BY OVERSIGHT. Three slices in two phases land these
 * at different times, and a required shape would mean the first one to land
 * either waits for the other two or writes stubs for methods it does not own.
 */
export type AdminReadParts = Partial<AdminReadSource>;

/** Fill the gaps with a refusal that names the method. */
export function composeAdminReadSource(parts: AdminReadParts): AdminReadSource {
  return {
    searchAccounts: (query) => {
      if (parts.searchAccounts === undefined) throw new AdminSourceNotComposed('searchAccounts');
      return parts.searchAccounts(query);
    },
    readAccount: (accountId) => {
      if (parts.readAccount === undefined) throw new AdminSourceNotComposed('readAccount');
      return parts.readAccount(accountId);
    },
    readIdentityGraph: (identityId) => {
      if (parts.readIdentityGraph === undefined)
        throw new AdminSourceNotComposed('readIdentityGraph');
      return parts.readIdentityGraph(identityId);
    },
    listFlags: (query) => {
      if (parts.listFlags === undefined) throw new AdminSourceNotComposed('listFlags');
      return parts.listFlags(query);
    },
    readLiability: () => {
      if (parts.readLiability === undefined) throw new AdminSourceNotComposed('readLiability');
      return parts.readLiability();
    },
    exportEvidence: (request) => {
      if (parts.exportEvidence === undefined) throw new AdminSourceNotComposed('exportEvidence');
      return parts.exportEvidence(request);
    },
  };
}

/**
 * `P7-j`'s composition. ONE KEY, and the module beside it does the work.
 *
 * A LATER SLICE ADDS ITS KEY HERE AND CHANGES NOTHING ELSE.
 */
export function adminReadSourceParts(deps: {
  readonly evidence: EvidenceExporterDeps;
}): AdminReadParts {
  return {
    exportEvidence: createEvidenceExporter(deps.evidence).exportEvidence,
  };
}
