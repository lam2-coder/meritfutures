import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

// =============================================================================
// INV-M4-02 and M04 section 1.2, asserted against the render mode
// =============================================================================
// M04 section 1.2: the portal stores nothing durable, and "no client-side cache
// of a money number survives a navigation". `app/accounts/page.ts` wrote what
// that means for the App Router and it is worth having in one place:
//
//   "A statically rendered account list is one trader's balances baked into an
//   artifact and served to whoever asks next, which is FM-M4-03's shape
//   arriving through a build step rather than through a query."
//
// NINE OF THE TEN DATA-READING ROUTES CARRIED `export const dynamic =
// 'force-dynamic'` AND ONE DID NOT, AND THE ONE WAS `/payouts`: the payout
// centre, the screen M04 section 3.6's own table rows as "authoritative,
// always" (INV-M4-13). `pnpm --filter @merit/portal build` printed it with the
// STATIC marker and the other nine with the dynamic one.
//
// WHY IT WAS NOT CAUGHT BY THE BUILD PASSING. What marks a route dynamic is a
// request-scoped API, and this application's only one is `cookies()` inside
// `serverApiClient`. `resolveApiOrigin` runs before it and throws when
// `MERIT_API_ORIGIN` is unset, so a build environment without that variable
// never reaches the cookie, the screen renders its `unavailable` arm, and Next
// bakes THAT into an artifact. The build exits 0 either way. The render mode of
// the payout centre was therefore decided by whether an environment variable
// happened to be set in the build environment, which is a property no screen
// should have.
//
// -----------------------------------------------------------------------------
// THE PREDICATE IS "REACHES THE CLIENT", NOT AN ALLOWLIST
// -----------------------------------------------------------------------------
// `app/page.tsx` is legitimately static: it imports `shell/app-shell.ts` and
// nothing else, reads no trader data, and forcing it dynamic would assert a
// requirement it does not have. Naming it in an exemption list would be a place
// for the next static money screen to be added quietly, so the exemption is
// DERIVED: a page is required to be dynamic exactly when its transitive import
// closure inside `src/` reaches `src/http/client.ts`, the one file in this
// application that performs a network call (ADR-162, and `surface.test.ts`
// asserts that it is the only one).

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const CLIENT = join(SRC, 'http', 'client.ts');

/** Every `page.ts` and `page.tsx` under `src/app/`, at any depth. */
function pages(dir: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...pages(full));
    else if (entry.name === 'page.ts' || entry.name === 'page.tsx') found.push(full);
  }

  return found;
}

/**
 * The relative-import closure of a file, inside `src/`.
 *
 * IT FOLLOWS RELATIVE SPECIFIERS ONLY. A bare specifier is a package and cannot
 * be `src/http/client.ts`; following one would mean resolving `node_modules`
 * for no reachable answer. The extensions in this application are written out
 * (`./source.ts`), which is `verbatimModuleSyntax`'s shape and what makes this
 * walk a string operation rather than a resolver.
 */
function closure(entry: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);

    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from '(\.[^']*)'/g)) {
      queue.push(resolve(dirname(file), match[1]!));
    }
  }

  return seen;
}

test('every route that reaches the API refuses to be prerendered', () => {
  const found = pages(join(SRC, 'app'));

  // The walk found routes at all. A `pages()` that returned nothing would pass
  // this test by iterating an empty list, which is the shape of a guard that
  // covers less than its own words claim.
  expect(found.length, 'page files under src/app').toBeGreaterThan(9);

  let reachingTheClient = 0;

  for (const page of found) {
    const name = relative(SRC, page);
    if (!closure(page).has(CLIENT)) continue;

    reachingTheClient += 1;
    expect(
      readFileSync(page, 'utf8'),
      `${name} reads the API and must declare force-dynamic`,
    ).toContain("export const dynamic = 'force-dynamic';");
  }

  // AND THE ACCEPTANCE HALF, which the dispatch protocol asks for by name: a
  // probe that only ever attempts forbidden things passes against a guard that
  // rejects everything. If the closure walk silently stopped resolving, every
  // page would look like it reads nothing and the loop above would assert
  // nothing at all.
  expect(reachingTheClient, 'routes whose imports reach src/http/client.ts').toBe(10);
});
