// =============================================================================
// apps/api/src/routes/health.ts
// =============================================================================
// API_CONTRACT section 9's liveness row, and the first thing in this repository
// that answers an HTTP request.
//
// | `GET /health` | Liveness | Public, returns `{ status: "ok" }` and nothing
// | else: no version, no dependency list, no build id |
//
// THE RESPONSE IS THAT SENTENCE AND NOTHING MORE, and the exclusions are the
// specification rather than an omission. A version string tells an unauthorised
// caller which advisories apply; a dependency list tells them what is down and
// therefore what to push on. `/internal/health/deep` is the row that enumerates
// dependencies, it is `/internal/*`, and it is therefore never registered on
// the public deployment at all. It is deliberately NOT written here: this
// module owns the row it transcribes.
//
// IT IS SERVED BY BOTH DEPLOYMENTS AND THAT IS NOT A CARVE-OUT. `classifyPath`
// returns `liveness` for exactly this path and `surfaceServes` answers true for
// both surfaces, because a response carrying one constant discloses nothing the
// origin's own reachability does not already disclose. `surface.ts` states the
// argument; this file just declares the route.
// =============================================================================

import { defineRoutes } from '../registry.ts';
import { LIVENESS_PATH } from '../surface.ts';

export default defineRoutes({
  name: 'health',
  routes: [
    {
      method: 'GET',
      // Read from `surface.ts` rather than written as `'/health'`. That module
      // already holds this path as the one `classifyPath` treats as liveness,
      // and a second spelling of it here would be a route the partition does
      // not recognise the day either moves.
      path: LIVENESS_PATH,
      handler: () => ({ status: 'ok' }),
    },
  ],
});
