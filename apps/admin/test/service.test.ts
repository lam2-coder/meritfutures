import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import * as admin from '../src/index.ts';
import { ADMIN_BARREL_LEGS, ADMIN_MODULES_NOT_RE_EXPORTED, SERVICE, main } from '../src/index.ts';
import * as dataTrustModule from '../src/data-trust.ts';
import * as feedModule from '../src/feed.ts';
import * as figureModule from '../src/figure.ts';
import * as liabilityReadModule from '../src/liability-read.ts';
import * as liabilityModule from '../src/liability.ts';
import * as liveLiabilityModule from '../src/live-liability.ts';
import * as originModule from '../src/origin.ts';
import * as pageModule from '../src/page.ts';
import * as rolesModule from '../src/roles.ts';

// CI-02, the `unit` project.
test('admin deploys as its own Railway service', () => {
  expect(SERVICE).toBe('admin');
});

test('the deployable starts', () => {
  expect(() => main()).not.toThrow();
});

// =============================================================================
// THE READ-ONLY CLAIM, ASSERTED RATHER THAN STATED
// =============================================================================
// This session's regime is non-money BECAUSE the surface is read-only. Every
// mutating admin route writes an `admin_actions` row (INV-M6-01) and several are
// dual controlled (INV-M6-08), so the moment one appears the regime changes and
// the review changes with it.
//
// "There is no write path in this package" is exactly the kind of claim that
// stays true until someone adds a helper on a Friday. So it is a test: the
// public entry point may export no name that reads as an action. A route that
// arrives later fails this and the failure is the reminder that its session
// needed a different regime, an audit row and an RBAC matrix.
//
// IT MATCHES ON THE NAME AND THAT IS A REAL LIMIT. A mutation exported as
// `applyLiabilityView` would pass. The check is a tripwire on the ordinary
// spelling of the thing, not a proof of purity, and saying so is the difference
// between a control and a thing that reads like one.
//
// `W6-b` EXTENDED THE BARREL BY 23 NAMES AND DID NOT MOVE THIS FENCE, which is
// the property WAVE-06 section 9 asks of every slice that touches this file:
// none of the fifteen runtime values added begins with any of the 21 verbs, and
// the eight type-only names never reach `Object.keys` at all. A slice that has
// to weaken this list is a slice in the wrong wave.
// =============================================================================

const MUTATING_VERBS = [
  'create',
  'update',
  'delete',
  'insert',
  'write',
  'save',
  'post',
  'patch',
  'put',
  'approve',
  'freeze',
  'unfreeze',
  'restrict',
  'restore',
  'suppress',
  'override',
  'close',
  'enforce',
  'export',
  'grant',
  'revoke',
];

test('the public entry point exports nothing that reads as a mutation', () => {
  const offenders = Object.keys(admin).filter((name) =>
    MUTATING_VERBS.some((verb) => name.toLowerCase().startsWith(verb)),
  );
  expect(offenders).toEqual([]);
});

test('it does export the read surface the liability home page is built from', () => {
  for (const name of ['buildLiabilityHome', 'theThreeNumbers', 'assessDataTrust', 'render']) {
    expect(Object.hasOwn(admin, name)).toBe(true);
  }
});

// =============================================================================
// THE BARREL, AND WHY IT IS CHECKED TWICE
// =============================================================================
// WAVE-06 section 5.1 measured this package's entry point and found it
// re-exported 51 of the 74 names its modules declare. All fourteen of
// `feed.ts`, because the module was not a leg at all; eight of `liability.ts`;
// and `assertFloatIsNotReserve` from `page.ts`. `package.json` publishes `.`
// and nothing else, so each was a name no consumer in this workspace could
// import, and a module outside the barrel is outside the no-mutation assertion
// above.
//
// `apps/api/src/admin-source/index.ts` carries TWO independent defences against
// the neighbouring defect and its header argues both. **THE `Pick`-OVER-DATA
// HALF DOES NOT TRANSFER TO A BARREL OF RE-EXPORTS** and `apps/worker/src/
// index.ts` says why: there is no runtime value here for a type to be taken
// over. What transfers is the principle, which is that the two defences must
// fail at DIFFERENT TIMES:
//
//   COMPILE TIME, section A. Every name is imported FROM THE BARREL by name and
//   bound to its own module's declaration. Delete a line from `index.ts` and
//   `pnpm run typecheck` fails naming the member. **THAT IS THE GATE THAT WAS
//   GREEN OVER THE 2026-08-28 `apps/worker/src/index.ts` DELETION**, and this is
//   what puts a barrel inside it.
//
//   RUN TIME, section B. Each module's SOURCE is read and the barrel is asserted
//   to re-export every name it declares. The compile half cannot do this: a name
//   nobody has ever imported is a name nobody misses, which is exactly how all
//   23 omissions survived. Only a check that reads the module can see a name
//   that was NEVER ADDED, as opposed to one that was removed.
//
// NEITHER SUBSUMES THE OTHER, and B.4 is a third property neither can reach: the
// barrel's binding must BE the module's binding, so a name re-exported from the
// wrong place fails even though it is present and type-checks.
//
// B.5 keeps section A honest in the one way it could rot silently. A name added
// to a module and to the barrel, but not to section A, would leave the compile
// half covering less than it looks like it covers; the covered set is derived
// from THIS FILE'S OWN SOURCE and compared against the modules, so it cannot.
// =============================================================================

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SRC = join(ROOT, 'apps/admin/src');
const BARREL = readFileSync(join(SRC, 'index.ts'), 'utf8');
const SELF = readFileSync(join(ROOT, 'apps/admin/test/service.test.ts'), 'utf8');

/**
 * Source with every comment removed.
 *
 * THE SWEEPS BELOW RUN OVER THIS AND NOT OVER THE FILE. The barrel's header
 * discusses the names it re-exports at length and this file quotes module names
 * in prose; a sweep over raw text would read a paragraph as a re-export.
 */
function code(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

/** Every top-level name a module declares, read out of the module itself. */
function declaredExports(source: string): readonly string[] {
  return [
    ...code(source).matchAll(
      /^export (?:declare )?(?:const|function|class|interface|type|enum) ([A-Za-z0-9_]+)/gm,
    ),
  ].map((match) => match[1] ?? '');
}

/**
 * Every name the barrel re-exports, read out of the barrel as TEXT.
 *
 * The SOURCE name is what is captured, so a leg re-exported under an alias still
 * counts. `type ` is stripped because this barrel spells its type re-exports
 * inline rather than in a separate `export type { ... }` block.
 */
function barrelReExports(): ReadonlySet<string> {
  return new Set(
    [...code(BARREL).matchAll(/^ {2}(?:type )?([A-Za-z0-9_]+)(?: as [A-Za-z0-9_]+)?,$/gm)].map(
      (match) => match[1] ?? '',
    ),
  );
}

/** Every `from './x.ts'` clause in the barrel. */
function barrelSpecifiers(): readonly string[] {
  return [...code(BARREL).matchAll(/from '(\.\/[^']+\.ts)';/g)].map((match) => match[1] ?? '');
}

const SOURCE_BY_LEG: Readonly<Record<string, string>> = Object.fromEntries(
  ADMIN_BARREL_LEGS.map((leg) => [leg, readFileSync(join(SRC, leg.slice(2)), 'utf8')]),
);

function sourceOf(leg: string): string {
  const source = SOURCE_BY_LEG[leg];
  expect(source, `${leg} is a declared leg and has no source on disk`).toBeDefined();
  return source ?? '';
}

// -----------------------------------------------------------------------------
// A. THE COMPILE-TIME HALF. Every name, imported from the barrel BY NAME.
// -----------------------------------------------------------------------------
// A dropped line in `index.ts` makes `admin.X` a property that does not exist
// and `admin.X` in type position a namespace member that does not exist. Both
// are `tsc` errors that NAME THE MEMBER, which is the whole of what a type
// checker could not do while the names were only ever re-exported.

/** True only when `A` and `B` are the same type, not merely assignable. */
type Identical<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Expect<T extends true> = T;

type _DataTrust = Expect<Identical<admin.DataTrust, dataTrustModule.DataTrust>>;
type _MissingSignal = Expect<Identical<admin.MissingSignal, dataTrustModule.MissingSignal>>;
type _TrustKey = Expect<Identical<admin.TrustKey, dataTrustModule.TrustKey>>;
type _TrustSignal = Expect<Identical<admin.TrustSignal, dataTrustModule.TrustSignal>>;
type _TrustState = Expect<Identical<admin.TrustState, dataTrustModule.TrustState>>;

type _Feed = Expect<Identical<admin.Feed, feedModule.Feed>>;
type _FeedEvent = Expect<Identical<admin.FeedEvent, feedModule.FeedEvent>>;
type _FeedInput = Expect<Identical<admin.FeedInput, feedModule.FeedInput>>;
type _FeedRow = Expect<Identical<admin.FeedRow, feedModule.FeedRow>>;
type _FeedScope = Expect<Identical<admin.FeedScope, feedModule.FeedScope>>;

type _AbsentFigure = Expect<Identical<admin.AbsentFigure, figureModule.AbsentFigure>>;
type _AsOf = Expect<Identical<admin.AsOf, figureModule.AsOf>>;
type _Authority = Expect<Identical<admin.Authority, figureModule.Authority>>;
type _Figure = Expect<Identical<admin.Figure, figureModule.Figure>>;
type _Reading = Expect<Identical<admin.Reading, figureModule.Reading>>;

type _LiabilitySnapshot = Expect<
  Identical<admin.LiabilitySnapshot, liabilityModule.LiabilitySnapshot>
>;
type _ReserveCoverage = Expect<Identical<admin.ReserveCoverage, liabilityModule.ReserveCoverage>>;
type _ReserveCoverageSnapshot = Expect<
  Identical<admin.ReserveCoverageSnapshot, liabilityModule.ReserveCoverageSnapshot>
>;
type _ThreeNumbers = Expect<Identical<admin.ThreeNumbers, liabilityModule.ThreeNumbers>>;
type _TreasurySource = Expect<Identical<admin.TreasurySource, liabilityModule.TreasurySource>>;

type _LiabilityRead = Expect<Identical<admin.LiabilityRead, liabilityReadModule.LiabilityRead>>;
type _UnreadWireField = Expect<
  Identical<admin.UnreadWireField, liabilityReadModule.UnreadWireField>
>;
type _WireGapCause = Expect<Identical<admin.WireGapCause, liabilityReadModule.WireGapCause>>;

type _IndicativeMovement = Expect<
  Identical<admin.IndicativeMovement, liveLiabilityModule.IndicativeMovement>
>;
type _LiveOpenLiability = Expect<
  Identical<admin.LiveOpenLiability, liveLiabilityModule.LiveOpenLiability>
>;
type _SameDayAdjustments = Expect<
  Identical<admin.SameDayAdjustments, liveLiabilityModule.SameDayAdjustments>
>;

type _AdminOrigin = Expect<Identical<admin.AdminOrigin, originModule.AdminOrigin>>;
type _Environment = Expect<Identical<admin.Environment, originModule.Environment>>;
type _SeparationCheck = Expect<Identical<admin.SeparationCheck, originModule.SeparationCheck>>;

type _EligibleNextSevenDays = Expect<
  Identical<admin.EligibleNextSevenDays, pageModule.EligibleNextSevenDays>
>;
type _LiabilityHomeInput = Expect<
  Identical<admin.LiabilityHomeInput, pageModule.LiabilityHomeInput>
>;
type _LiabilityHomePage = Expect<Identical<admin.LiabilityHomePage, pageModule.LiabilityHomePage>>;
type _PanelRendering = Expect<Identical<admin.PanelRendering, pageModule.PanelRendering>>;
type _PendingPanel = Expect<Identical<admin.PendingPanel, pageModule.PendingPanel>>;

type _AdminRole = Expect<Identical<admin.AdminRole, rolesModule.AdminRole>>;

/**
 * Every VALUE the barrel re-exports, beside the module binding it must be.
 *
 * Each `admin.X` here is the compile-time reference for that name, and the pair
 * is what B.4 compares at run time.
 */
const VALUE_LEGS: readonly (readonly [string, string, unknown, unknown])[] = [
  ['./data-trust.ts', 'DataTrustError', admin.DataTrustError, dataTrustModule.DataTrustError],
  ['./data-trust.ts', 'TRUST_KEYS', admin.TRUST_KEYS, dataTrustModule.TRUST_KEYS],
  ['./data-trust.ts', 'assessDataTrust', admin.assessDataTrust, dataTrustModule.assessDataTrust],

  ['./feed.ts', 'FeedError', admin.FeedError, feedModule.FeedError],
  ['./feed.ts', 'WITHHELD', admin.WITHHELD, feedModule.WITHHELD],
  ['./feed.ts', 'assertWithheld', admin.assertWithheld, feedModule.assertWithheld],
  ['./feed.ts', 'buildFeed', admin.buildFeed, feedModule.buildFeed],
  ['./feed.ts', 'mayReadEventFeed', admin.mayReadEventFeed, feedModule.mayReadEventFeed],
  ['./feed.ts', 'namesASubject', admin.namesASubject, feedModule.namesASubject],
  ['./feed.ts', 'renderFeed', admin.renderFeed, feedModule.renderFeed],
  ['./feed.ts', 'renderRow', admin.renderRow, feedModule.renderRow],
  ['./feed.ts', 'thread', admin.thread, feedModule.thread],

  ['./figure.ts', 'FigureError', admin.FigureError, figureModule.FigureError],
  ['./figure.ts', 'absent', admin.absent, figureModule.absent],
  ['./figure.ts', 'authoritative', admin.authoritative, figureModule.authoritative],
  ['./figure.ts', 'figure', admin.figure, figureModule.figure],
  ['./figure.ts', 'formatCents', admin.formatCents, figureModule.formatCents],
  ['./figure.ts', 'readingIsPresent', admin.readingIsPresent, figureModule.readingIsPresent],
  ['./figure.ts', 'render', admin.render, figureModule.render],

  ['./liability.ts', 'LiabilityError', admin.LiabilityError, liabilityModule.LiabilityError],
  ['./liability.ts', 'RCR_BREAKER_BP', admin.RCR_BREAKER_BP, liabilityModule.RCR_BREAKER_BP],
  ['./liability.ts', 'TREASURY_SOURCES', admin.TREASURY_SOURCES, liabilityModule.TREASURY_SOURCES],
  ['./liability.ts', 'formatRatioBp', admin.formatRatioBp, liabilityModule.formatRatioBp],
  [
    './liability.ts',
    'inAdversarialOrder',
    admin.inAdversarialOrder,
    liabilityModule.inAdversarialOrder,
  ],
  [
    './liability.ts',
    'requireTreasurySource',
    admin.requireTreasurySource,
    liabilityModule.requireTreasurySource,
  ],
  ['./liability.ts', 'reserveCoverage', admin.reserveCoverage, liabilityModule.reserveCoverage],
  ['./liability.ts', 'theThreeNumbers', admin.theThreeNumbers, liabilityModule.theThreeNumbers],

  [
    './liability-read.ts',
    'ADMIN_LIABILITY_PATH',
    admin.ADMIN_LIABILITY_PATH,
    liabilityReadModule.ADMIN_LIABILITY_PATH,
  ],
  [
    './liability-read.ts',
    'LiabilityReadError',
    admin.LiabilityReadError,
    liabilityReadModule.LiabilityReadError,
  ],
  [
    './liability-read.ts',
    'TRUST_INPUTS_CARRIED_WITHOUT_A_STATE',
    admin.TRUST_INPUTS_CARRIED_WITHOUT_A_STATE,
    liabilityReadModule.TRUST_INPUTS_CARRIED_WITHOUT_A_STATE,
  ],
  [
    './liability-read.ts',
    'WIRE_FIELDS_THIS_PAGE_DOES_NOT_READ',
    admin.WIRE_FIELDS_THIS_PAGE_DOES_NOT_READ,
    liabilityReadModule.WIRE_FIELDS_THIS_PAGE_DOES_NOT_READ,
  ],
  [
    './liability-read.ts',
    'WIRE_GAP_CAUSES',
    admin.WIRE_GAP_CAUSES,
    liabilityReadModule.WIRE_GAP_CAUSES,
  ],
  [
    './liability-read.ts',
    'gapCauseRemedy',
    admin.gapCauseRemedy,
    liabilityReadModule.gapCauseRemedy,
  ],
  [
    './liability-read.ts',
    'liabilityHomeInputFrom',
    admin.liabilityHomeInputFrom,
    liabilityReadModule.liabilityHomeInputFrom,
  ],
  [
    './liability-read.ts',
    'narrowLiabilityResponse',
    admin.narrowLiabilityResponse,
    liabilityReadModule.narrowLiabilityResponse,
  ],
  [
    './liability-read.ts',
    'readLiabilityHome',
    admin.readLiabilityHome,
    liabilityReadModule.readLiabilityHome,
  ],

  [
    './live-liability.ts',
    'liveOpenLiability',
    admin.liveOpenLiability,
    liveLiabilityModule.liveOpenLiability,
  ],

  ['./origin.ts', 'ADMIN_ORIGIN_VAR', admin.ADMIN_ORIGIN_VAR, originModule.ADMIN_ORIGIN_VAR],
  ['./origin.ts', 'OriginError', admin.OriginError, originModule.OriginError],
  ['./origin.ts', 'PUBLIC_ORIGIN_VARS', admin.PUBLIC_ORIGIN_VARS, originModule.PUBLIC_ORIGIN_VARS],
  ['./origin.ts', 'resolveAdminOrigin', admin.resolveAdminOrigin, originModule.resolveAdminOrigin],

  ['./page.ts', 'PageError', admin.PageError, pageModule.PageError],
  ['./page.ts', 'ageAtRender', admin.ageAtRender, pageModule.ageAtRender],
  [
    './page.ts',
    'assertFloatIsNotReserve',
    admin.assertFloatIsNotReserve,
    pageModule.assertFloatIsNotReserve,
  ],
  [
    './page.ts',
    'assertNamesNoSubject',
    admin.assertNamesNoSubject,
    pageModule.assertNamesNoSubject,
  ],
  ['./page.ts', 'buildLiabilityHome', admin.buildLiabilityHome, pageModule.buildLiabilityHome],
  ['./page.ts', 'renderLiabilityHome', admin.renderLiabilityHome, pageModule.renderLiabilityHome],

  ['./roles.ts', 'ADMIN_ROLES', admin.ADMIN_ROLES, rolesModule.ADMIN_ROLES],
  ['./roles.ts', 'RoleError', admin.RoleError, rolesModule.RoleError],
  [
    './roles.ts',
    'mayReadLiabilityHome',
    admin.mayReadLiabilityHome,
    rolesModule.mayReadLiabilityHome,
  ],
  ['./roles.ts', 'requireAdminRole', admin.requireAdminRole, rolesModule.requireAdminRole],
];

/** The namespace alias each `Identical<>` line above reads a module through. */
const LEG_BY_ALIAS: Readonly<Record<string, string>> = {
  dataTrustModule: './data-trust.ts',
  feedModule: './feed.ts',
  figureModule: './figure.ts',
  liabilityModule: './liability.ts',
  liabilityReadModule: './liability-read.ts',
  liveLiabilityModule: './live-liability.ts',
  originModule: './origin.ts',
  pageModule: './page.ts',
  rolesModule: './roles.ts',
};

/**
 * The `module.ts:name` pairs section A actually covers, derived from THIS FILE.
 *
 * Read out of the source rather than kept in a second list, so the coverage
 * claim and the assertions cannot drift: what is counted here is exactly what
 * `tsc` reads.
 */
function compileTimeCoverage(): ReadonlySet<string> {
  const covered = new Set<string>();
  for (const [leg, name] of VALUE_LEGS) covered.add(`${leg}:${name}`);
  for (const match of code(SELF).matchAll(
    /Identical<admin\.([A-Za-z0-9_]+), ([A-Za-z0-9_]+)\.\1>/g,
  )) {
    const name = match[1] ?? '';
    const alias = match[2] ?? '';
    const leg = LEG_BY_ALIAS[alias];
    expect(leg, `${alias} reads a module this file does not map to a barrel leg`).toBeDefined();
    covered.add(`${leg ?? ''}:${name}`);
  }
  return covered;
}

// -----------------------------------------------------------------------------
// B. THE RUN-TIME HALF. The modules are read, and the barrel is checked against
// them rather than against a list somebody maintains.
// -----------------------------------------------------------------------------

test('B.1 the barrel re-exports every name every module declares, NAME BY NAME', () => {
  // **THE ASSERTION THIS SLICE EXISTS FOR.** WAVE-06 section 5.1's 23 omissions
  // were invisible to `pnpm run typecheck` and to every suite in this package,
  // because a name nobody imports is a name nobody misses. This reads the
  // MODULE, which is the only primary source for what the barrel owes.
  const reExported = barrelReExports();
  for (const leg of ADMIN_BARREL_LEGS) {
    const names = declaredExports(sourceOf(leg));
    expect(names.length, `${leg} declares no exports, which cannot be right`).toBeGreaterThan(3);
    for (const name of names)
      expect(
        reExported,
        `${leg} exports \`${name}\` and the barrel does not re-export it. A type checker cannot ` +
          'see an export that is simply gone, and it cannot see one that was never added at all, ' +
          'so this is the only thing that can',
      ).toContain(name);
  }
});

test('B.2 every module under src/ is a leg or is deliberately absent, and never both', () => {
  // THE SWEEP THAT WOULD HAVE CAUGHT `feed.ts`: a module the barrel has never
  // met. It is not a hypothetical here. `feed.ts` landed as M06 section 1.1's
  // fifth surface, exporting fourteen names, and no check in this package could
  // tell that the entry point had never learned it.
  //
  // **THE WALK IS RECURSIVE AND `src/` IS FLAT TODAY, WHICH IS THE POINT.**
  // `W6-c` adds `src/api/types.ts` and `src/http/client.ts`, so a sweep over the
  // top level alone would stop covering this package on the next slice, silently
  // and while staying green. A control that has to be widened by the slice it
  // was written to catch is not a control. The recursion is exercised by a
  // seeded `src/api/types.ts`, which this test refuses, rather than by the
  // committed tree, which is flat.
  const modules: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(SRC, relative), { withFileTypes: true })) {
      const next = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith('.ts') && next !== 'index.ts') modules.push(`./${next}`);
    }
  };
  walk('');
  expect(modules.length).toBeGreaterThan(5);

  const legs = new Set<string>(ADMIN_BARREL_LEGS);
  const absent = new Set(Object.keys(ADMIN_MODULES_NOT_RE_EXPORTED));

  for (const module of modules) {
    const memberships = [legs.has(module), absent.has(module)].filter(Boolean);
    expect(
      memberships.length,
      `${module} is in ${String(memberships.length)} of the barrel's two lists and must be in ` +
        'exactly one. A module that is neither a leg nor deliberately absent is a module nobody ' +
        'has decided about',
    ).toBe(1);
  }

  // And in the other direction: a stale entry for a module that no longer exists
  // is how an allowlist silently grants more than it names.
  const present = new Set(modules);
  for (const listed of [...legs, ...absent])
    expect(present, `${listed} is listed by the barrel and no longer exists`).toContain(listed);
});

test('B.3 every specifier the barrel re-exports is a declared leg', () => {
  // `tsc` catches a re-export of a name that is gone. It does not catch a LEG
  // added without its data entry, and a leg outside the list is outside B.1.
  const declared = new Set<string>(ADMIN_BARREL_LEGS);
  for (const specifier of new Set(barrelSpecifiers()))
    expect(declared, `${specifier} is re-exported and is not in ADMIN_BARREL_LEGS`).toContain(
      specifier,
    );
});

test('B.4 the barrel binding IS the module binding, and not merely a name that resolves', () => {
  // NEITHER OTHER HALF CAN SEE THIS. A name re-exported from the wrong module is
  // present in the text and, where the shapes agree, type-checks.
  for (const [leg, name, fromBarrel, fromModule] of VALUE_LEGS)
    expect(fromBarrel, `the barrel's \`${name}\` is not the binding ${leg} declares`).toBe(
      fromModule,
    );
});

test('B.5 the compile-time half covers every name, so it cannot shrink unnoticed', () => {
  // Section A is hand-written and a name added to a module and to the barrel but
  // not to section A would leave `tsc` covering less than it appears to. The
  // covered set is derived from this file's own source, so the claim is measured
  // rather than asserted.
  const covered = compileTimeCoverage();
  const declared = ADMIN_BARREL_LEGS.flatMap((leg) =>
    declaredExports(sourceOf(leg)).map((name) => `${leg}:${name}`),
  );

  for (const pair of declared)
    expect(
      covered,
      `${pair} is exported by its module and section A does not import it from the barrel. ` +
        'Without that line a deletion of it from `index.ts` is not a typecheck failure',
    ).toContain(pair);

  // And no entry for a name no module declares, which is how a stale line makes
  // the coverage count look larger than the surface it covers.
  const real = new Set(declared);
  for (const pair of covered)
    expect(real, `section A covers ${pair} and no module declares it`).toContain(pair);
});

test('B.6 every module the barrel deliberately omits states a reason', () => {
  for (const [module, reason] of Object.entries(ADMIN_MODULES_NOT_RE_EXPORTED))
    expect(reason.trim().length, `${module} is absent with no stated reason`).toBeGreaterThan(40);
});

test('B.7 the surface is 86 names over 9 modules, and the count is the tree`s', () => {
  // WAVE-06 section 5.1's measurement, re-derived. THE COUNT IS NOT WRITTEN
  // TWICE: the cardinal below is compared against what the modules declare, so a
  // module that grows a name moves it, and moving it is a diff a reviewer reads.
  //
  // 74 OVER 8 UNTIL `liability-read.ts` LANDED, and the move is the diff this
  // case exists to make a reviewer read: one module, twelve names, and the count
  // re-derived at the moment of writing rather than carried from the entry that
  // set it.
  const declared = ADMIN_BARREL_LEGS.flatMap((leg) => declaredExports(sourceOf(leg)));
  expect(new Set(declared).size).toBe(declared.length);
  expect(declared.length).toBe(86);
  expect(ADMIN_BARREL_LEGS.length).toBe(9);
});
