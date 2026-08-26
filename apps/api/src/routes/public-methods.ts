// =============================================================================
// apps/api/src/routes/public-methods.ts
// =============================================================================
// [M12 section 4](docs/plans/M12-transparency-platform.md)'s method page:
//
//   | `GET /public/methods/:statCode` **NEW, public** | Owns | The method
//   | page, ALL VERSIONS, with the ADR reference for every change |
//
// ADR-110 is the ruling that put the row into API_CONTRACT and this file is the
// other half of it. Two words in that row carry the whole design and both are
// ruled there rather than decided here: PUBLIC, which is what the surface
// filter and the absent identity between them mean, and VERSIONED, which is why
// this route answers with a SET and takes no version parameter.
//
// -----------------------------------------------------------------------------
// WHY THE RESPONSE IS EVERY VERSION AND NOT THE CURRENT ONE
// -----------------------------------------------------------------------------
// `:statCode` alone does not name one row and it is not supposed to.
// `0021_transparency.sql` gives `statistic_definitions` a unique index on
// `(stat_code, version)`, so the ADDRESS OF ONE DEFINITION IS THE PAIR, and the
// contract path carries only the first half of it. M12 section 3.2 says what to
// do about that in its own words: when a definition changes "the method page
// shows BOTH", because "a transparency series with an invisible methodology
// break is the most sophisticated way to mislead available to a firm that
// computes its own numbers".
//
// So a version parameter is not added, and the reason it is not added is not
// minimalism. `published_statistics` carries `definition_version` on every row
// and the published aggregate carries a `method_path` that already spells the
// pair (`/methods/ST-01/2`, `apps/site/test/adapter.test.ts`). A version
// selector on THIS path would be a second address for a row that has one, and
// the second address is the one that goes stale.
//
// -----------------------------------------------------------------------------
// `live_version` IS THE SCHEMA'S ANSWER AND IS NOT "THE CURRENT ONE"
// -----------------------------------------------------------------------------
// `statistic_definitions_live_uq` is a partial unique index on `(stat_code)`
// WHERE `superseded_by IS NULL`: the database itself guarantees at most one
// unsuperseded row per statistic, so naming it costs no arithmetic and no
// clock. It is deliberately NOT called `current_version` or `effective_version`,
// because `INV-M12-07` makes `effective_from` always a FUTURE date at write
// time, so the unsuperseded row can be one that has not taken effect yet.
// Every row carries its own `effective_from` and the caller reads it.
//
// NO CLOCK IS READ HERE AT ALL, and that is the property worth keeping. This is
// a cacheable public read: a response that depended on the request's date would
// be a response two callers sharing one cache entry could disagree about, and
// the disagreement would be about which method produced a published number.
//
// -----------------------------------------------------------------------------
// WHAT PUBLIC MEANS, IN THE TWO INDEPENDENT SENSES THAT COINCIDE HERE
// -----------------------------------------------------------------------------
// 1. THE READER IS ANYBODY. `Auth: none`. No session is required and none is
//    trusted, so no identity is resolved and no per-identity handle is opened
//    anywhere in this file.
// 2. THE ROW IS NOBODY'S. `statistic_definitions` is classified `firm` in
//    `packages/db/src/scope.ts`: "there is no identity column and there is no
//    correct one". A firm read is unscoped because the ROW belongs to everybody;
//    this endpoint is unauthenticated because the READER may be anybody.
//
// The two are independent facts and their coincidence is what makes the surface
// safe: there is no field in a definition that an identity filter would have had
// to remove, so nothing is withheld and nothing has to be remembered. ADR-110
// section 3 states the difference against the firm read that merely has no
// identity in hand.
//
// THE SURFACE FILTER STILL APPLIES AND IT IS NOT A NO-OP. `classifyPath`
// answers `public` for this path, so `compose` registers it on the `api`
// deployment and WITHHOLDS it from `api-admin`, which answers 404 by having
// nothing there. Only `/health` is served by both (ADR-083, `surface.ts`).
//
// -----------------------------------------------------------------------------
// THE SOURCE IS A PORT AND NOTHING IN THIS TREE WIRES IT YET
// -----------------------------------------------------------------------------
// `apps/api` declares one runtime dependency, `fastify`, and holds no database
// handle: `index.ts` says so and ADR-100 landed the registry with one route
// that returns a constant. Wiring `packages/db` into this deployable is a
// manifest change and a slice of its own, and it is outside this one's fence.
//
// So the data arrives through `MethodDefinitionSource` and the default is
// UNSET. An unset source is a deployment that has not been finished, and this
// file answers it the way `surface.ts` answers an unset surface: loudly. The
// handler throws, the error handler in `server.ts` renders `internal_error`,
// and the throw is logged with the module named. It does not answer 404, which
// would say the statistic does not exist, and it does not answer 503, which
// would invite a retry against a process that will never succeed.
// =============================================================================

import { defineRoutes } from '../registry.ts';
import { PROBLEM_MEDIA_TYPE, problem } from '../server.ts';
import type { RouteHandler } from '../registry.ts';

/** API_CONTRACT's path for the method page, without the base path. */
export const PUBLIC_METHODS_PATH = '/public/methods/:statCode';

/** `statistic_measure` (`0001_extensions_and_enums.sql`). ADR-032. */
export const STATISTIC_MEASURES = [
  'rate',
  'total',
  'mean',
  'median',
  'p50',
  'p95',
  'count',
] as const;

/** One member of {@link STATISTIC_MEASURES}. */
export type StatisticMeasure = (typeof STATISTIC_MEASURES)[number];

/**
 * One `statistic_definitions` row, as the source hands it over.
 *
 * Transcribed column for column from `0021_transparency.sql`, in the database's
 * own snake_case, for `apps/site/src/stats/published.ts`' stated reason: a
 * paraphrase of the shape is the first step toward a paraphrase of the method.
 * `id` and `superseded_by` are the table's surrogate keys and are the two
 * fields that do NOT reach the response; see {@link MethodPageVersion}.
 */
export interface StatisticDefinitionRow {
  readonly id: string;
  readonly stat_code: string;
  readonly version: number;
  readonly title: string;
  readonly numerator_spec: string;
  readonly denominator_spec: string;
  readonly exclusions: readonly string[];
  readonly window_spec: string;
  readonly grain: string;
  readonly min_sample: number;
  readonly measures: readonly StatisticMeasure[];
  readonly method_body_mdx: string;
  /** The ruling that fixed this definition. Nullable in the DDL. */
  readonly adr_ref: string | null;
  /** `YYYY-MM-DD`. Always in the future at write time (INV-M12-07). */
  readonly effective_from: string;
  /** `statistic_definitions.id` of the successor, or `null` if unsuperseded. */
  readonly superseded_by: string | null;
}

/**
 * Where the definitions come from.
 *
 * ONE METHOD, TAKING THE STAT CODE VERBATIM. The route does not upper-case,
 * trim or otherwise normalise the path segment: an address is exact, the
 * published `method_path` already carries the code as it is stored, and a
 * normalising route makes two addresses into one silently.
 *
 * IT RETURNS EVERY VERSION FOR THE CODE, INCLUDING SUPERSEDED ONES, and an
 * empty array for a code that has none. An empty array is the only "absent"
 * this route knows about, which is what keeps 404 meaning one thing.
 */
export interface MethodDefinitionSource {
  readDefinitions(statCode: string): Promise<readonly StatisticDefinitionRow[]>;
}

/**
 * Thrown when the method page cannot be rendered from what the source returned.
 *
 * Every case below is a DEFECT rather than a request the caller got wrong, so
 * every one becomes a 500 through `server.ts`'s error handler rather than a 4xx
 * this file invents. A caller cannot cause any of them.
 */
export class MethodPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MethodPageError';
  }
}

/**
 * The source, held at module scope because a route module contributes DATA.
 *
 * ADR-100 rule 1 makes a module's whole contribution the object it default
 * exports, and `compose` hands a handler nothing but the request: a module
 * cannot be given a dependency at composition time without being RUN at
 * composition time, which is the shape ADR-100 refused. So the dependency lives
 * beside the module and is set by whoever wires the deployable, and the handler
 * reads it at REQUEST time rather than closing over it, so wiring order cannot
 * silently capture the unset value.
 */
let source: MethodDefinitionSource | null = null;

/**
 * Wire the source, or pass `null` to unwire it.
 *
 * The unwire direction exists for the suite: a test that sets a source and
 * cannot clear it leaves the next test reading a fixture it did not write, and
 * that is a suite that passes for the wrong reason.
 */
export function setMethodDefinitionSource(next: MethodDefinitionSource | null): void {
  source = next;
}

/** What is wired, or `null`. */
export function methodDefinitionSource(): MethodDefinitionSource | null {
  return source;
}

/**
 * One version of a definition, as the response carries it.
 *
 * NEITHER SURROGATE KEY IS HERE. API_CONTRACT section 1's response-shape policy
 * is an allowlist ("a field that is not in the schema is not in the response"),
 * and `id` and `superseded_by` are uuids that name rows rather than facts about
 * a method: a public reader can do nothing with either, and `superseded_by`
 * specifically is resolved into the VERSION it names, which is the half of it
 * that means something on a page.
 */
export interface MethodPageVersion {
  readonly version: number;
  readonly title: string;
  readonly numerator_spec: string;
  readonly denominator_spec: string;
  readonly exclusions: readonly string[];
  readonly window_spec: string;
  readonly grain: string;
  readonly min_sample: number;
  readonly measures: readonly StatisticMeasure[];
  readonly method_body_mdx: string;
  readonly adr_ref: string | null;
  readonly effective_from: string;
  /** The version that superseded this one, or `null` while it is the live one. */
  readonly superseded_by_version: number | null;
}

/**
 * `GET /public/methods/:statCode`.
 *
 * `versions` is ascending by version and holds EVERY version ever written for
 * this code, superseded ones included. A method page that dropped them would be
 * a page that cannot explain a series it spans.
 */
export interface MethodPageResponse {
  readonly stat_code: string;
  /** The unsuperseded version. `statistic_definitions_live_uq` makes it unique. */
  readonly live_version: number;
  readonly versions: readonly MethodPageVersion[];
}

/**
 * Render the response from the rows, refusing rather than guessing.
 *
 * Exported so the suite can assert on the refusals directly. Each of the four
 * below is a shape the DATABASE cannot produce: two unique indexes and a
 * foreign key rule them all out. They are checked anyway because the source is
 * an interface rather than the database, and because the failure that reaches a
 * reader is not "the query was wrong", it is "Merit published the wrong method
 * beside a number".
 */
export function renderMethodPage(
  statCode: string,
  rows: readonly StatisticDefinitionRow[],
): MethodPageResponse {
  const foreign = rows.find((row) => row.stat_code !== statCode);
  if (foreign !== undefined)
    throw new MethodPageError(
      `\`${statCode}\`'s method page received a row for \`${foreign.stat_code}\`. This address ` +
        'publishes the method a figure was computed under, so a row from another statistic is ' +
        'the wrong method beside a number rather than an extra row',
    );

  const byVersion = new Map<number, StatisticDefinitionRow>();
  for (const row of rows) {
    if (byVersion.has(row.version))
      throw new MethodPageError(
        `\`${statCode}\` has two rows at version ${String(row.version)}. ` +
          '`statistic_definitions_code_version_uq` makes the pair unique, so the pair is the ' +
          'address of one definition and two answers to it name neither',
      );
    byVersion.set(row.version, row);
  }

  // `superseded_by` names an `id`, and the response names a VERSION. Resolved
  // within this code's own set: a pointer out of it cannot be rendered, and
  // rendering `null` instead would say the superseded version is the live one.
  const versionById = new Map<string, number>();
  for (const row of rows) versionById.set(row.id, row.version);

  const versions: MethodPageVersion[] = [];
  let live: number | null = null;
  for (const row of [...rows].sort((a, b) => a.version - b.version)) {
    let supersededByVersion: number | null = null;
    if (row.superseded_by === null) {
      if (live !== null)
        throw new MethodPageError(
          `\`${statCode}\` has two unsuperseded versions, ${String(live)} and ` +
            `${String(row.version)}. \`statistic_definitions_live_uq\` is a partial unique ` +
            'index over exactly this case, so a second one is a claim the database refuses',
        );
      live = row.version;
    } else {
      const named = versionById.get(row.superseded_by);
      if (named === undefined)
        throw new MethodPageError(
          `\`${statCode}\` version ${String(row.version)} is superseded by a definition that is ` +
            "not among this statistic's own versions. A method page cannot render a " +
            'supersession it cannot name, and rendering `null` would publish a superseded ' +
            'definition as the live one',
        );
      supersededByVersion = named;
    }
    versions.push({
      version: row.version,
      title: row.title,
      numerator_spec: row.numerator_spec,
      denominator_spec: row.denominator_spec,
      exclusions: row.exclusions,
      window_spec: row.window_spec,
      grain: row.grain,
      min_sample: row.min_sample,
      measures: row.measures,
      method_body_mdx: row.method_body_mdx,
      adr_ref: row.adr_ref,
      effective_from: row.effective_from,
      superseded_by_version: supersededByVersion,
    });
  }

  if (live === null)
    throw new MethodPageError(
      `\`${statCode}\` has ${String(rows.length)} version(s) and every one of them is ` +
        'superseded. A statistic whose whole chain points onward has no live definition, which ' +
        'is a cycle or a pointer out of the set rather than a state a reader can be shown',
    );

  return { stat_code: statCode, live_version: live, versions };
}

/**
 * The handler.
 *
 * THE 404 IS THE ONLY ANSWER A CALLER CAN CAUSE, and here it means exactly one
 * thing: no statistic is published under this code. That is a true statement
 * about a public registry, and it is worth contrasting with the 404 the same
 * status code carries on a trader surface, where API_CONTRACT section 1 makes
 * it deliberately ambiguous between "absent" and "not yours" so the API does
 * not confirm the existence of other people's resources. There is nobody whose
 * definition this could be, so there is nothing to be ambiguous about.
 */
export const handler: RouteHandler = async (request, reply) => {
  const { statCode } = request.params as { statCode: string };

  const wired = source;
  if (wired === null)
    throw new MethodPageError(
      'no method definition source is wired, so `GET /public/methods/:statCode` cannot read the ' +
        'definitions it publishes. This is a deployment that has not been finished rather than a ' +
        'request that failed: `apps/api` holds no database handle yet, and the process that ' +
        'builds this server is what supplies one',
    );

  const rows = await wired.readDefinitions(statCode);
  if (rows.length === 0)
    return reply
      .code(404)
      .type(PROBLEM_MEDIA_TYPE)
      .send(problem('not_found', 404, request.id));

  return renderMethodPage(statCode, rows);
};

export default defineRoutes({
  name: 'public-methods',
  routes: [{ method: 'GET', path: PUBLIC_METHODS_PATH, handler }],
});
