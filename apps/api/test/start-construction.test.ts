import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import ts from 'typescript';
import { expect, test } from 'vitest';

// CI-02, the `unit` project. ADR-374.
//
// WHAT THIS SUITE IS FOR. [ADR-372](../../../docs/decisions/ADR-372.md) section 6
// ruled that `start.ts` cannot produce the half-install [ADR-356](../../../docs/decisions/ADR-356.md)
// priced at 200/500 and ruled WORSE than a total refusal, and it gave TWO
// INDEPENDENT REASONS. This file guards the parts of that ruling nothing was
// guarding.
//
// ONE OF THE TWO WAS ALREADY GUARDED AND THE ROW THAT SENT ME HERE SAID IT WAS
// NOT. `start-program.test.ts` asserts that no install sits after `main()` and
// that `main()` is the LAST top-level statement, and ADR-372 section 10 item 1
// records that item as "DISCHARGED as a control". So the placement half of
// reason two is defended, by the file ADR-372 itself landed. What is NOT
// defended, and is defended here, is:
//
//   - REASON ONE IN ITS ENTIRETY. "No adapter factory holds a construction
//     reachable `throw`" was READ, by a session, once. Nothing re-reads it.
//   - THE PREMISE UNDER REASON TWO. "`app.listen` is reached only inside
//     `main`" appears in this repository as prose in ADR-372 section 6 and as a
//     COMMENT at `start-program.test.ts:251`. A comment is not a control.
//
// PARSING IS NOT EXECUTING, which is what lets this file exist beside the
// constraint that importing `start.ts` binds a port. The compiler API builds a
// syntax tree, evaluates nothing, opens no socket and binds no port.
//
// NOTHING HERE INSTALLS A PORT AND NOTHING HERE RESTATES A CARDINAL THE WIRING
// TRIPLE OWNS. `{declared, wired, blocked}` is `wiring.test.ts`' and is not
// touched.

const APP = join(import.meta.dirname, '..');
const SRC = join(APP, 'src');
const START = join(SRC, 'start.ts');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, read(path), ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
}

function parseText(source: string): ts.SourceFile {
  return ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
}

/** Every `.ts` file under a directory, recursively, sorted. */
function sourcesUnder(dir: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourcesUnder(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

function lineOf(node: ts.Node): number {
  const file = node.getSourceFile();
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

// -----------------------------------------------------------------------------
// CONSTRUCTION TIME, DEFINED MECHANICALLY
// -----------------------------------------------------------------------------
// THE DEFINITION. A node is at CONSTRUCTION TIME of a function `f` when it lies
// inside `f` and its NEAREST enclosing function-like ancestor is `f` itself.
// Parameter default initializers count, because a call that omits the argument
// evaluates them: that is the exact path by which `databaseAuthBackend(LIVE_DB)`
// evaluates `postmarkOtpSender(env)`.
//
// WHY THIS IS THE RIGHT LINE. Calling `f` runs everything in that region and
// nothing outside it. A `throw` in the region is a `throw` the install line
// takes; a `throw` inside a closure `f` merely RETURNS is taken by a request,
// per method, which is the fail-closed refusal every one of these adapters is
// built out of and is not a failed install.
//
// WHERE THE DEFINITION IS UNSOUND, NAMED RATHER THAN LEFT TO BE FOUND. A
// function-like node in the region is skipped, so a `throw` inside one is
// invisible here even if something in the region CALLS it: an immediately
// invoked expression, or a callback handed to a construction-time call that
// invokes it. BOTH ESCAPES ARE CLOSED BY ASSERTION RATHER THAN BY ANALYSIS, in
// the second case below: every construction-time callee must be a plain name
// this file can resolve, and no construction-time call may be handed a function.
// A tree that grows either shape reddens that bar and this definition is
// re-opened rather than quietly outrun.
const FUNCTION_LIKE: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.Constructor,
]);

interface Region {
  /** `throw` statements taken when the function is called. */
  readonly throws: readonly ts.ThrowStatement[];
  /** Callees named by a plain identifier, which can be followed. */
  readonly named: readonly string[];
  /** Callees this file cannot follow, each with a label saying why. */
  readonly opaque: readonly string[];
  /** Construction-time calls handed a function to call. */
  readonly functionArguments: readonly string[];
}

function constructionRegionOf(fn: ts.FunctionLikeDeclaration): Region {
  const throws: ts.ThrowStatement[] = [];
  const named: string[] = [];
  const opaque: string[] = [];
  const functionArguments: string[] = [];

  const visit = (node: ts.Node): void => {
    if (FUNCTION_LIKE.has(node.kind)) return;
    if (ts.isThrowStatement(node)) throws.push(node);
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) named.push(callee.text);
      else if (ts.isPropertyAccessExpression(callee))
        opaque.push(`${callee.name.text} (a member call)`);
      else opaque.push(`${ts.SyntaxKind[callee.kind]} (a callee that is not a name)`);
      for (const argument of node.arguments ?? [])
        if (FUNCTION_LIKE.has(argument.kind))
          functionArguments.push(
            ts.isIdentifier(node.expression) ? node.expression.text : '(anonymous)',
          );
    }
    ts.forEachChild(node, visit);
  };

  for (const parameter of fn.parameters) if (parameter.initializer) visit(parameter.initializer);
  if (fn.body !== undefined) ts.forEachChild(fn.body, visit);
  return { throws, named, opaque, functionArguments };
}

/**
 * Resolve a name to the function declaration it denotes, following relative
 * imports only. A package import or a global is reported rather than followed:
 * this file reads THIS repository's source and says so when it stops.
 */
type Resolution =
  | { readonly kind: 'function'; readonly file: string; readonly fn: ts.FunctionDeclaration }
  | { readonly kind: 'opaque'; readonly label: string };

function resolveName(file: string, name: string): Resolution {
  const tree = parse(file);
  for (const statement of tree.statements)
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name)
      return { kind: 'function', file, fn: statement };

  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause === undefined) continue;
    const bindings = statement.importClause.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.name.text !== name) continue;
      const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
      if (!specifier.startsWith('.'))
        return { kind: 'opaque', label: `${name} (imported from the package \`${specifier}\`)` };
      return resolveName(resolve(dirname(file), specifier), element.propertyName?.text ?? name);
    }
  }
  return { kind: 'opaque', label: `${name} (a global or an unresolved name)` };
}

/**
 * The factories a run of `start.ts` constructs, taken from the installs that
 * run BEFORE `main()` binds the port, which is the set whose failure could
 * produce the half-install ADR-356 ruled worse.
 *
 * TWO CLAUSES STOP THE WALK AND THE SECOND WAS MISSING UNTIL ADR-379, WHICH
 * MEASURED IT RATHER THAN READ IT. `main()` ends the set because an install
 * below it lands on a server already serving. A top-level `throw` ends it too,
 * because module evaluation aborts there and nothing below it is constructed at
 * all. Without that clause this function returned every factory on a tree whose
 * run constructs a prefix of them, which is its own docstring being false about
 * its own answer. IT IS INERT ON THIS TREE -- `start.ts` holds no throw, and
 * `start-program.test.ts` forbids one outright -- and it is exercised anyway by
 * the fixture case below, because a clause defended by no case is a claim.
 */
function factoriesInstalledBeforeMain(tree: ts.SourceFile): readonly string[] {
  const calleeOf = (statement: ts.Statement): ts.CallExpression | undefined => {
    if (!ts.isExpressionStatement(statement)) return undefined;
    const expression = ts.isAwaitExpression(statement.expression)
      ? statement.expression.expression
      : statement.expression;
    return ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)
      ? expression
      : undefined;
  };
  const found: string[] = [];
  for (const statement of tree.statements) {
    if (ts.isThrowStatement(statement)) break;
    const call = calleeOf(statement);
    if (call === undefined) continue;
    const name = (call.expression as ts.Identifier).text;
    if (name === 'main') break;
    if (!/^(?:use|set)[A-Z]/.test(name)) continue;
    for (const argument of call.arguments)
      if (ts.isCallExpression(argument) && ts.isIdentifier(argument.expression))
        found.push(argument.expression.text);
  }
  return found;
}

interface Walk {
  readonly throws: readonly string[];
  readonly opaque: ReadonlySet<string>;
  readonly functionArguments: readonly string[];
  readonly walked: ReadonlySet<string>;
}

/** Every function a run reaches at construction time, to a fixed point. */
function walkConstruction(roots: readonly string[], from: string): Walk {
  const throws: string[] = [];
  const opaque = new Set<string>();
  const functionArguments: string[] = [];
  const walked = new Set<string>();
  const seen = new Set<string>();
  const queue: (readonly [string, string])[] = roots.map((name) => [name, from] as const);

  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) break;
    const [name, file] = next;
    if (seen.has(`${file}::${name}`)) continue;
    seen.add(`${file}::${name}`);

    const resolution = resolveName(file, name);
    if (resolution.kind === 'opaque') {
      opaque.add(resolution.label);
      continue;
    }
    walked.add(`${resolution.file.slice(SRC.length + 1)}::${name}`);

    const region = constructionRegionOf(resolution.fn);
    for (const thrown of region.throws)
      throws.push(`${resolution.file.slice(SRC.length + 1)}:${String(lineOf(thrown))} in ${name}`);
    for (const label of region.opaque) opaque.add(label);
    for (const owner of region.functionArguments)
      functionArguments.push(`${owner} (called from ${name})`);
    for (const callee of region.named) queue.push([callee, resolution.file] as const);
  }
  return { throws, opaque, functionArguments, walked };
}

const startTree = parse(START);
const FACTORIES = factoriesInstalledBeforeMain(startTree);
const construction = walkConstruction(FACTORIES, START);

// THE ELEVEN, NAMED RATHER THAN COUNTED, so that one LEAVING the list is a named
// regression rather than a cardinal quietly moving, and so that a new adapter
// cannot be installed without a person editing this line and thereby being asked
// whether the new factory can throw while it is being built.
//
// AND THIS IS WHERE ADR-372 SECTION 5's FOUR SHAPES MEET THIS FILE, on a
// mechanism different from the one `start-program.test.ts` uses. Each of the
// four hides an install from a RUN while a line pattern still counts it: a block
// comment, a call after `main()`, dead code after a top-level `throw`, and a call
// inside a template literal. Three of them remove a name from the list below,
// because this reader is a syntax tree (so a comment and a template literal hold
// no call at all) and it stops at `main()`.
//
// THE THIRD WAS CLAIMED AND IS NOW MEASURED, AND THE CLAIM WAS FALSE HERE
// (ADR-379 section 4). ADR-374 section 5's row for dead code after a top-level
// `throw` said the walk also stopped and the name vanished. It did not: the
// reader broke at `main()` alone, so a `throw` seeded above the last install
// left ALL FOUR CASES IN THIS FILE GREEN while a run of `start.ts` constructed
// nothing at all. The superseded row is NAMED and not reproduced (`RI-14`); the
// reader now breaks at a top-level `throw` as well, which is where its two
// siblings already broke, and the fixture case below is what holds it there.
// THE SHAPE ITSELF WAS NEVER LOOSE: `start-program.test.ts` forbids a top-level
// `throw` outright and `wiring.test.ts` drops the port from `wired`, and both
// were watched RED on that seed. What was wrong was this file's account of its
// own mechanism, which is a claim about a control and is worth the same care.
const EXPECTED_FACTORIES: readonly string[] = [
  'databaseAccountReads',
  'databaseAccountsBackend',
  'databaseAuthBackend',
  'databaseCatalogReads',
  'databaseCertificateBackend',
  'databaseCertificateImageSource',
  'databaseEconomicCalendar',
  'databaseMethodDefinitions',
  'databaseVerifySource',
  'databaseWalletBackend',
  'environmentCertificateRateLimiter',
];

test('no factory a run of `start.ts` constructs can throw while it is being constructed', () => {
  // REASON ONE OF ADR-372 SECTION 6, WHICH WAS READ ONCE AND RE-READ BY NOTHING.
  // If any of these threw at construction, module evaluation would abort. On
  // TODAY's tree that is still not the half-install, because `await main()` is
  // last and nothing would serve; it becomes the half-install the moment the
  // placement property this file's sibling guards is broken. TWO INDEPENDENT
  // REASONS ARE ONLY INDEPENDENT WHILE BOTH ARE CHECKED.
  expect(
    construction.throws,
    'a factory `start.ts` constructs can throw while it is being constructed, so an install ' +
      'line can fail. ADR-372 section 6 reason one no longer holds and the half-install ' +
      'ADR-356 priced at 200/500 is one statement move away. Move the throw inside the method ' +
      'that refuses, which is what every other adapter in this tree does',
  ).toStrictEqual([]);

  // NON-VACUITY, AND IT IS THREE SEPARATE CLAIMS BECAUSE THE CASE CAN GO GREEN
  // THREE WAYS WITHOUT READING ANYTHING.
  //
  // FIRST, the roots are the eleven and they are named.
  expect(
    [...FACTORIES].sort(),
    'the set of factories `start.ts` constructs before `main()` has changed. If an adapter was ' +
      'added, add it below and satisfy yourself it cannot throw at construction. If one ' +
      'VANISHED, a run installs less than the wiring triple reports',
  ).toStrictEqual([...EXPECTED_FACTORIES].sort());

  // SECOND, every one of them resolved to a body this case actually read. A
  // resolver that silently returned nothing would report zero throws forever.
  for (const factory of EXPECTED_FACTORIES)
    expect(
      [...construction.walked].some((entry) => entry.endsWith(`::${factory}`)),
      `\`${factory}\` was never resolved to a function body, so nothing about it was read`,
    ).toBe(true);

  // THIRD, the walk is TRANSITIVE and reached past the roots. ADR-372 followed
  // one hop by hand and named `postmarkOtpSender`; the closure has THREE hops
  // past the eleven, the other two being `blocked` and `databaseVerifySource`
  // reached a second time from `databaseCertificateImageSource`. A walk that
  // stopped at the roots would still report zero throws and would be reading a
  // third less than it claims to.
  expect(
    construction.walked.size,
    'the construction walk no longer reaches past the factories themselves, so it is no longer ' +
      'transitive and a throw one hop away would be invisible',
  ).toBeGreaterThan(EXPECTED_FACTORIES.length);

  // FOURTH, THE PARAMETER DEFAULT PATH IS READ, NAMED AT THE ONE FUNCTION THAT
  // PROVES IT. `postmarkOtpSender` is reachable ONLY as the default value of
  // `databaseAuthBackend`'s fourth parameter, which `start.ts` omits. Drop the
  // parameter loop from the reader and every assertion above stays green while
  // an entire construction-time path goes unread. ADR-372 named this function by
  // hand for the same reason.
  expect(
    [...construction.walked].some((entry) => entry.endsWith('::postmarkOtpSender')),
    'the walk no longer reads parameter default initializers, so `postmarkOtpSender` is never ' +
      'reached. `start.ts` omits that argument, so the default IS what a deployment constructs',
  ).toBe(true);
});

test('every construction-time call is a name this case resolved, and none is handed a function', () => {
  // THIS IS THE CASE THAT KEEPS THE ONE ABOVE FROM PASSING VACUOUSLY, and it is
  // where the two known unsoundnesses of the definition at the top of this file
  // are closed by assertion.
  //
  // THE WALK IS ALLOWED TO STOP, but only at something named here. Everything
  // else it cannot follow is a hole through which a construction-time throw
  // reaches a deployment unread, so the set is PINNED rather than filtered.
  expect(
    [...construction.opaque].sort(),
    'a construction-time call reaches something this case cannot read. Until it is followed or ' +
      'ruled harmless and named here, ADR-372 section 6 reason one is unmeasured for that path',
  ).toStrictEqual(['Map (a global or an unresolved name)']);

  // AND NOTHING AT CONSTRUCTION TIME IS HANDED A FUNCTION TO CALL, which is the
  // other escape: this reader skips function-like nodes, so a `throw` inside a
  // callback that a construction-time call INVOKES would be invisible. There is
  // no such call on this tree and the day there is one, this bar is red and the
  // definition is re-opened rather than outrun.
  expect(
    construction.functionArguments,
    'a construction-time call is handed a function. This reader does not follow a function into ' +
      'a callee that might invoke it, so a throw inside it is unmeasured. Re-open the ' +
      'construction-time definition at the top of this file rather than widening this list',
  ).toStrictEqual([]);
});

test('the reader tells a throw in a factory body from a throw in the closure it returns', () => {
  // THE DETECTOR HAS NO POSITIVE ON THIS TREE. Every case above is an assertion
  // that a list is EMPTY, so a reader that found nothing ever would be green
  // forever. ADR-369 section 10's lesson, and ADR-372 seed 6's: a clause
  // defended by a case that does not run it is a claim rather than a control.
  //
  // SO THE DEFINITION IS EXERCISED IN BOTH DIRECTIONS OVER FIXTURES, and the
  // fixtures are synthetic. No file under `src/` is touched to produce them.
  const fixtures: readonly (readonly [string, string, boolean])[] = [
    ['a throw in the factory body', 'function f(db) {\n  throw new Error("x");\n}\n', true],
    [
      'a throw inside an `if` in the factory body',
      'function f(db) {\n  if (db === null) throw new Error("x");\n  return {};\n}\n',
      true,
    ],
    [
      'a parameter default that is a function value which throws',
      'function f(db, env = (() => { throw new Error("x"); })) {\n  return {};\n}\n',
      false,
    ],
    [
      'a throw inside a returned arrow closure',
      'function f(db) {\n  return { read: () => { throw new Error("x"); } };\n}\n',
      false,
    ],
    [
      'a throw inside a method of the returned object',
      'function f(db) {\n  return { read() { throw new Error("x"); } };\n}\n',
      false,
    ],
    [
      'a throw inside an arrow bound to a const',
      'function f(db) {\n  const read = () => { throw new Error("x"); };\n  return { read };\n}\n',
      false,
    ],
  ];

  const wrong: string[] = [];
  for (const [label, source, constructionTime] of fixtures) {
    const declaration = parseText(source).statements[0];
    expect(declaration).toBeDefined();
    const region = constructionRegionOf(declaration as ts.FunctionDeclaration);
    if (region.throws.length > 0 !== constructionTime) wrong.push(label);
  }

  expect(
    wrong,
    'the construction-time reader no longer draws the line this file defines. A throw in the ' +
      'body is an install that can fail; a throw in a closure the factory returns is the ' +
      'per-request refusal every adapter here is built out of',
  ).toStrictEqual([]);

  // AND THE TWO DIRECTIONS ARE BOTH POPULATED, so the fixture list cannot decay
  // into one that only ever expects `false` and passes with a reader that has
  // been gutted.
  expect(fixtures.filter(([, , yes]) => yes).length).toBeGreaterThan(0);
  expect(fixtures.filter(([, , yes]) => !yes).length).toBeGreaterThan(0);
});

test('`app.listen` is reached only inside `main`, which is the premise under ADR-372 reason two', () => {
  // THE PREMISE UNDER REASON TWO, WHICH LIVES IN THIS REPOSITORY AS PROSE AND AS
  // A COMMENT. ADR-372 section 6 says "`app.listen` is reached only inside
  // `main`, and `await main()` is the last of the twenty-six top-level
  // statements". The SECOND half is asserted by `start-program.test.ts`. The
  // first half is asserted by nothing, and it is the half that decides whether
  // "the last statement" means anything at all: a `listen` anywhere else, at
  // module scope in any module `start.ts` imports, binds the port DURING the
  // import block, which is BEFORE every install line runs. That is the
  // half-install ADR-356 ruled worse, arrived at without moving one install.
  const bindings: string[] = [];
  for (const path of sourcesUnder(SRC)) {
    const tree = parse(path);
    const enclosing: ts.Node[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'listen'
      ) {
        const owner = [...enclosing]
          .reverse()
          .find((candidate) => FUNCTION_LIKE.has(candidate.kind));
        const name =
          owner !== undefined && ts.isFunctionDeclaration(owner)
            ? (owner.name?.text ?? '(an anonymous function)')
            : owner === undefined
              ? '(module scope)'
              : '(a nested function)';
        bindings.push(`${path.slice(SRC.length + 1)}::${name}`);
      }
      enclosing.push(node);
      ts.forEachChild(node, visit);
      enclosing.pop();
    };
    visit(tree);
  }

  expect(
    bindings,
    'a call to `listen` sits somewhere other than inside `main`. Everything ADR-372 section 6 ' +
      'reason two rests on is that the ONLY thing which binds the port is reached from the last ' +
      'top-level statement of `start.ts`. A bind anywhere else runs before the installs and ' +
      'serves the window they exist to close',
  ).toStrictEqual(['index.ts::main']);
});

test('an install below a top-level `throw` is not a factory a run constructs', () => {
  // THE CLAUSE ADDED IN ADR-379, EXERCISED RATHER THAN ASSERTED. It is inert on
  // this tree, so nothing about `start.ts` can hold it: only a fixture whose
  // ANSWER CHANGES when the clause goes can, which is the rule both sibling
  // files in this slice already follow for their own reachability clause.
  //
  // AND THE DIRECTION MATTERS. Without the clause this reader reported the
  // factory below the `throw` as constructed, so it over-reported what a run
  // builds and its own docstring was false about its own answer. That is the
  // direction in which a guard goes quiet: everything it names is still there,
  // every list it asserts is still empty, and nothing says the run stopped.
  const before = 'useAlphaBackend(alphaFactory());\n';
  const after = 'useOmegaBackend(omegaFactory());\n';
  const main = 'await main();\n';

  expect(
    factoriesInstalledBeforeMain(parseText(before + after + main)),
    'the reader no longer collects the factories of consecutive top-level installs, so every ' +
      'assertion in this file is being made about a set it did not read',
  ).toStrictEqual(['alphaFactory', 'omegaFactory']);

  expect(
    factoriesInstalledBeforeMain(parseText(before + "throw new Error('x');\n" + after + main)),
    'a factory installed BELOW a top-level `throw` is still reported as constructed. Module ' +
      'evaluation aborts at the throw, so a run constructs nothing past it, and this reader is ' +
      'over-reporting what a deployment builds',
  ).toStrictEqual(['alphaFactory']);

  // AND THE `throw` DOES NOT MERELY SHORTEN THE LIST BY ONE, WHICH A CLAUSE
  // PLACED ONE STATEMENT LATE WOULD ALSO DO. A throw above everything leaves
  // nothing.
  expect(
    factoriesInstalledBeforeMain(parseText("throw new Error('x');\n" + before + after + main)),
    'a top-level `throw` above every install still leaves factories in the list, so the reader ' +
      'stops somewhere other than at the statement that ends module evaluation',
  ).toStrictEqual([]);
});
