import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { expect, test } from 'vitest';

// CI-02, the `unit` project. ADR-372.
//
// WHAT THIS SUITE IS FOR. `wiring.test.ts` derives its `wired` set by matching
// a setter name at the start of a line over `start.ts` AS TEXT, and it does
// that because importing `start.ts` would bind a port. THAT CONSTRAINT IS
// CORRECT AND THIS FILE DOES NOT LIFT IT. What follows from it is that the
// wiring slice has been measured from the outside only, and a text scanner
// cannot see the three things a wiring slice can get wrong: an install that
// never runs, an install that runs twice, and an install that runs AFTER the
// port is bound.
//
// PARSING IS NOT EXECUTING, which is the whole reason this file can exist
// beside that constraint. The TypeScript compiler API reads the module into a
// syntax tree, evaluates nothing, opens no socket and binds no port, so the
// second measurement costs nothing the first one was avoiding.
//
// THE SCANNER IS READ OUT OF `wiring.test.ts` RATHER THAN COPIED INTO THIS
// FILE. A pattern transcribed into a second file is a fact defended in one
// place and asserted in another, which is the defect this corpus keeps finding
// one level down. The extraction is asserted before it is used, so a scanner
// this file can no longer find is a RED bar rather than a silently empty set.
//
// NOTHING HERE INSTALLS A PORT, AND NOTHING HERE NAMES A CARDINAL THE TRIPLE
// ALREADY ASSERTS. `{declared, wired, blocked}` is `wiring.test.ts`' and is not
// restated: what is bound below is the AGREEMENT of two derivations, so the
// day they part the bar goes red without either number being written twice.

const APP = join(import.meta.dirname, '..');
const SRC = join(APP, 'src');
const ROUTES = join(SRC, 'routes');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, read(path), ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
}

function parseText(source: string): ts.SourceFile {
  return ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
}

/** The callee of a top-level statement that is a bare call, `await` included. */
function calleeOf(statement: ts.Statement): string | undefined {
  if (!ts.isExpressionStatement(statement)) return undefined;
  const expression = ts.isAwaitExpression(statement.expression)
    ? statement.expression.expression
    : statement.expression;
  if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression)) return undefined;
  return expression.expression.text;
}

const IS_SETTER = /^(?:use|set)[A-Z]/;

interface Install {
  readonly port: string;
  readonly index: number;
  readonly line: number;
}

/**
 * The installs a run of this module would actually perform, in order.
 *
 * THREE CLAUSES, AND THE THIRD IS DEFENSIVE AND INERT ON THIS TREE, which is
 * said here rather than discovered later. A statement nested in anything at all
 * is not a top-level statement and never reaches this list; a call sitting in a
 * comment or a string literal is not a statement and never reaches it either;
 * and the `throw` clause discards what a top-level throw has already made
 * unreachable. `start.ts` holds no throw today, so clause three changes no
 * answer about this tree. IT IS EXERCISED ANYWAY, by a fixture whose answer
 * CHANGES when the clause goes, because a clause defended by a case that does
 * not run it is a claim rather than a control.
 */
function installsOf(source: ts.SourceFile): readonly Install[] {
  const found: Install[] = [];
  for (const [index, statement] of source.statements.entries()) {
    if (ts.isThrowStatement(statement)) break;
    const callee = calleeOf(statement);
    if (callee !== undefined && IS_SETTER.test(callee))
      found.push({
        port: callee,
        index,
        line: source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1,
      });
  }
  return found;
}

/** The index of the top-level call to `main`, which is the statement that binds the port. */
function mainIndexOf(source: ts.SourceFile): number {
  return source.statements.findIndex((statement) => calleeOf(statement) === 'main');
}

const START = join(SRC, 'start.ts');
const startTree = parse(START);
const installs = installsOf(startTree);

test('`start.ts` is a straight-line program, which is what makes reading it as text sound', () => {
  // THE ROW WAS DISPATCHED TO ASK WHETHER A SETTER COULD BE COUNTED AS WIRED
  // WHILE INSTALLING NOTHING: inside a conditional, inside a function nobody
  // calls, behind an early return, or in dead code. NONE OF THOSE SHAPES CAN
  // EXIST HERE, and this case is that answer rather than a paragraph claiming
  // it. The module holds no branch, no function of any kind, no loop and no
  // throw, so every statement in it runs exactly once on every run.
  //
  // THE DAY ONE OF THESE APPEARS, THE TEXT DERIVATION STOPS BEING SOUND AND
  // THIS BAR IS WHERE THAT IS NOTICED. The remedy is to re-derive `wired`
  // against the syntax tree, never to widen the pattern: a pattern taught to
  // recognise a conditional still cannot tell a taken branch from an untaken
  // one.
  const forbidden = new Map<string, ts.SyntaxKind>([
    ['a conditional statement', ts.SyntaxKind.IfStatement],
    ['a conditional expression', ts.SyntaxKind.ConditionalExpression],
    ['a `try` block', ts.SyntaxKind.TryStatement],
    ['a `throw`', ts.SyntaxKind.ThrowStatement],
    ['a `switch`', ts.SyntaxKind.SwitchStatement],
    ['a `return`', ts.SyntaxKind.ReturnStatement],
    ['a `for` loop', ts.SyntaxKind.ForStatement],
    ['a `for ... of` loop', ts.SyntaxKind.ForOfStatement],
    ['a `while` loop', ts.SyntaxKind.WhileStatement],
    ['a function declaration', ts.SyntaxKind.FunctionDeclaration],
    ['a function expression', ts.SyntaxKind.FunctionExpression],
    ['an arrow function', ts.SyntaxKind.ArrowFunction],
    ['a class', ts.SyntaxKind.ClassDeclaration],
  ]);

  const present = new Set<ts.SyntaxKind>();
  const walk = (node: ts.Node): void => {
    present.add(node.kind);
    ts.forEachChild(node, walk);
  };
  walk(startTree);

  expect(
    [...forbidden]
      .filter(([, kind]) => present.has(kind))
      .map(([label]) => label)
      .sort(),
    'the wiring slice has grown a construct a line pattern cannot read, so `wired` is no ' +
      'longer derivable from text alone. Re-derive it from the syntax tree rather than widening ' +
      "`wiring.test.ts`' pattern",
  ).toStrictEqual([]);

  // NON-VACUITY. A file that parsed to nothing would satisfy every clause above.
  expect(installs.length).toBeGreaterThan(0);
});

test("`wiring.test.ts`' text-matched `wired` set is the set a run would install", () => {
  // THE SECOND DERIVATION, BY A DIFFERENT METHOD, OVER THE SAME FILE. The
  // pattern is lifted out of the file that owns it so that this case follows a
  // change there rather than preserving a stale copy of it.
  const scanner = /^const CALLS = \/(.+)\/([a-z]*);$/m.exec(
    read(join(APP, 'test', 'wiring.test.ts')),
  );
  expect(
    scanner,
    '`wiring.test.ts` no longer declares a `CALLS` pattern this case can read. It is the ' +
      'derivation under test and an unreadable one must not silently become an empty one',
  ).not.toBeNull();

  const byText = new Set(
    [...read(START).matchAll(new RegExp(scanner?.[1] ?? '', scanner?.[2] ?? 'gm'))].map(
      (match) => match[1] ?? '',
    ),
  );
  const byProgram = new Set(installs.map((install) => install.port));

  expect(
    [...byText].sort(),
    'the ports the scanner reports and the ports a run would install have parted. The scanner ' +
      'is the input to the wiring triple, so the triple is now reporting something other than ' +
      'what a deployment serves',
  ).toStrictEqual([...byProgram].sort());
});

test('every install runs BEFORE the call that binds the port, and that call is last', () => {
  // THE HALF-INSTALL CONTROL, AND IT IS THE ONE THING IN THIS FILE THAT WAS
  // RULED IN PROSE AND ASSERTED BY NOBODY. `start.ts`' own header rules that
  // the installs sit before `main()` because "a window in which the process is
  // listening and the backend is still the fail-closed default would serve 503
  // to real traffic". `main` is where `app.listen` is reached, so an install
  // placed after it is an install that lands on a server already serving.
  //
  // AND THE EDIT THAT WOULD DO IT IS THE EDIT THIS FILE INSTRUCTS THE NEXT
  // SESSION TO MAKE. The same header rules the conflict shape for concurrent
  // route slices as an APPEND, "keep every line"; an append that lands past the
  // final statement is exactly this defect, and the scanner cannot see it
  // because a line pattern has no notion of before.
  const mainIndex = mainIndexOf(startTree);
  expect(
    mainIndex,
    '`start.ts` no longer calls `main` at the top level, so nothing in it binds a port and ' +
      'this deployable does not start',
  ).toBeGreaterThanOrEqual(0);

  expect(
    installs.filter((install) => install.index > mainIndex).map((install) => install.port),
    'a port is installed after `main()`, so a deployment binds the port with that backend still ' +
      'at its fail-closed default and serves the window between the two. Move the install above ' +
      '`main()`',
  ).toStrictEqual([]);

  expect(
    mainIndex,
    'a statement follows `main()`. Nothing may run after the process begins serving: put it ' +
      'above the call',
  ).toBe(startTree.statements.length - 1);
});

test('no port is installed twice, which the `wired` set cannot report because it is a set', () => {
  // `wired` IS A `Set`, so a port installed twice enters it once and the second
  // install is invisible to every count derived from it. What a second install
  // does at run time is decided by the setter it calls and not by this file:
  // some overwrite, and a reader of the triple has no way to tell that a choice
  // was made at all.
  const counted = new Map<string, number>();
  for (const install of installs) counted.set(install.port, (counted.get(install.port) ?? 0) + 1);

  expect(
    [...counted]
      .filter(([, times]) => times > 1)
      .map(([port]) => port)
      .sort(),
    'a port is installed more than once and the wiring triple counts it once. Two installs of ' +
      'one port is a choice about which backend serves, and it must be one line',
  ).toStrictEqual([]);
});

test('`start.ts` is the only module under `apps/api/src` that installs a port on import', () => {
  // THE PREMISE THE WHOLE `wired` MEASUREMENT RESTS ON, AND IT WAS NEVER
  // ASSERTED. The scanner reads ONE file. A route module that called a setter
  // at its own module scope would install that port on import, in the suite as
  // well as in a deployment, and it would appear in neither `wired` nor
  // `BLOCKED`: it would be wired and recorded nowhere.
  const offenders: string[] = [];
  for (const dir of [SRC, ROUTES])
    for (const name of readdirSync(dir)
      .filter((entry) => entry.endsWith('.ts'))
      .sort()) {
      const path = join(dir, name);
      if (path === START) continue;
      const tree = parse(path);
      for (const statement of tree.statements) {
        const callee = calleeOf(statement);
        if (callee !== undefined && IS_SETTER.test(callee))
          offenders.push(
            `${name}:${String(
              tree.getLineAndCharacterOfPosition(statement.getStart(tree)).line + 1,
            )} ${callee}`,
          );
      }
    }

  expect(
    offenders,
    'a module other than `start.ts` installs a port at module scope, so it is installed by ' +
      'IMPORT rather than by the wiring slice. The wiring triple reads `start.ts` alone and ' +
      'would report that port as blocked while a deployment serves it',
  ).toStrictEqual([]);
});

test('the four shapes a line pattern counts as wired and a run does not install', () => {
  // WHAT `wiring.test.ts` OWES, EXECUTED RATHER THAN ARGUED. `RI-25` exists in
  // this repository because a control passed while the thing it guarded was
  // merely commented out, and the row was sent to look for that class here.
  //
  // THE ANSWER IS THAT THE CLASS IS REAL AND NO INSTANCE OF IT IS ON THIS TREE.
  // The pattern is anchored to the start of a line, so it refuses a `//`
  // comment and refuses anything indented, which is every nested shape while
  // `format:check` keeps the formatter's indentation. IT DOES NOT REFUSE FOUR
  // OTHERS. Each fixture below is a whole module, scanned by the same pattern
  // `wiring.test.ts` uses and parsed by the same reader the cases above use,
  // and the two disagree on exactly four of the seven.
  //
  // THE FIXTURE IS SYNTHETIC AND `start.ts` IS NOT TOUCHED TO PRODUCE IT.
  const scanner = /^const CALLS = \/(.+)\/([a-z]*);$/m.exec(
    read(join(APP, 'test', 'wiring.test.ts')),
  );
  expect(scanner).not.toBeNull();
  const pattern = (): RegExp => new RegExp(scanner?.[1] ?? '', scanner?.[2] ?? 'gm');

  const shapes: readonly (readonly [string, string, boolean])[] = [
    ['an honest top-level install', 'useGhostBackend(ghost());\nawait main();\n', true],
    ['a line comment', '// useGhostBackend(ghost());\nawait main();\n', true],
    [
      'a call nested in a conditional',
      'if (flag)\n  useGhostBackend(ghost());\nawait main();\n',
      true,
    ],
    ['a BLOCK comment', '/*\nuseGhostBackend(ghost());\n*/\nawait main();\n', false],
    ['a call AFTER `main()`', 'await main();\nuseGhostBackend(ghost());\n', false],
    [
      'dead code after a top-level `throw`',
      "throw new Error('x');\nuseGhostBackend(ghost());\nawait main();\n",
      false,
    ],
    [
      'a call inside a template literal',
      'const s = `\nuseGhostBackend(ghost());\n`;\nawait main();\n',
      false,
    ],
  ];

  const disagreed: string[] = [];
  for (const [label, source, agrees] of shapes) {
    const byText = [...source.matchAll(pattern())].map((match) => match[1] ?? '');
    const tree = parseText(source);
    const mainIndex = mainIndexOf(tree);
    const byProgram = installsOf(tree)
      .filter((install) => mainIndex < 0 || install.index < mainIndex)
      .map((install) => install.port);
    const same = byText.join(',') === byProgram.join(',');
    if (same !== agrees) disagreed.push(label);
  }

  expect(
    disagreed,
    'a shape the scanner was measured to miscount now behaves differently. The census of what ' +
      "`wiring.test.ts`' derivation cannot see is the finding, so a change here is a change to " +
      'the finding',
  ).toStrictEqual([]);

  // AND THE FOUR ARE NAMED RATHER THAN COUNTED, so that one leaving the list is
  // a named regression and not a cardinal quietly moving.
  expect(shapes.filter(([, , agrees]) => !agrees).map(([label]) => label)).toStrictEqual([
    'a BLOCK comment',
    'a call AFTER `main()`',
    'dead code after a top-level `throw`',
    'a call inside a template literal',
  ]);
});
