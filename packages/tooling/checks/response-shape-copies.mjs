// =============================================================================
// packages/tooling/checks/response-shape-copies.mjs
// =============================================================================
// `RI-18`, AND IT IS A ROW OF `CHECKS` BECAUSE THE BOUNDARY PERMITTED IT.
//
// THE INVARIANT. A response shape the API contract declares, and that more than
// one file in this workspace also declares, carries THE SAME FIELD SET in every
// copy. Every copy is read LIVE on every run, out of its own source, through
// one parser. There is no stored list of fields anywhere in this file, and that
// is the whole point: a list here would be a FOURTH copy of the shape, and a
// fourth copy is the defect rather than the remedy (`ADR-034`, and `ADR-185`
// one document over: generate the value or delete it and point at the source,
// there is no third).
//
// -----------------------------------------------------------------------------
// WHY IT EXISTS
// -----------------------------------------------------------------------------
// `ADR-188` ruled four fields onto `LiabilityResponse` and edited no code, and
// it measured what nothing in this tree would say about the gap: it seeded the
// four fields onto the type and `pnpm vitest run` returned IDENTICAL TO
// BASELINE. `RI-17` is blind to it BY CONSTRUCTION, and says so in its own
// header's first exclusion: "IT COMPARES `METHOD /path` AND NOTHING ELSE."
// So `CI-01`'s `tsc` was the only thing standing between a half-applied field
// addition and silence, and `tsc` only fires where a copy is CONSTRUCTED, never
// where two copies merely disagree: the console's copy in a different package
// has no construction site in `apps/api` and no compiler error can relate them.
//
// -----------------------------------------------------------------------------
// WHY HERE AND NOT IN apps/api/test/, WHICH IS `RI-17`'s PRECEDENT
// -----------------------------------------------------------------------------
// Session 342 wanted `RI-17` in `repo-invariants.mjs` and MEASURED that it
// could not be. Its three disqualifiers were re-measured on this branch and
// EVERY ONE OF THEM IS ABSENT HERE, which is why this check takes the home that
// one could not.
//
//   1. `RI-17` needs `@merit/api`, which `packages/tooling` cannot resolve.
//      THIS CHECK IMPORTS NO DEPLOYABLE. It reads files as data, which is what
//      `RI-08`, `RI-09` and `RI-10` already do across every deployable in the
//      tree; `RI-09` parses `apps/api/src/surface.ts` and says so in its own
//      words.
//   2. `RI-17` needs `fastify`, same failure. THIS CHECK NEEDS NEITHER.
//   3. `Invariant.run` is synchronous and `discoverRouteModules` is not. THIS
//      PARSE IS SYNCHRONOUS.
//
// And the reason session 342 refused the fallback does not reach this check.
// It refused reading `routes/*.ts` as TEXT because a grep over route files has
// been wrong twice here AND because a strictly better input existed: a real
// `compose()` answers "which routes exist" and a regex does not. THERE IS NO
// SUCH BETTER INPUT FOR A TYPE. A TypeScript type is erased before anything
// runs, so no composition, no import and no runtime value can be asked what
// fields `LiabilityResponse` has. The declaration IS the only source.
//
// SO THE READING IS NOT A GREP. This file loads the TypeScript compiler's own
// parser and walks the syntax tree: the same grammar reads the contract's
// fenced block, `apps/api`'s `interface` and `apps/admin`'s `type` alias, and
// a shape none of them can express is a shape none of them can hide. That is
// the half session 342 was refusing when it refused a regex, and it is
// available here because `typescript` is already a devDependency of this
// package (`packages/tooling/package.json`) and `pnpm install --frozen-lockfile`
// installs it in every CI job. Nothing is added to any manifest.
//
// IT IS LOADED LAZILY, INSIDE `run`, THROUGH `createRequire`. A static import
// costs 465ms on every invocation of `repo-invariants.mjs`, including
// `node packages/tooling/checks/repo-invariants.mjs RI-01`, which that file's
// own usage line advertises. Lazy, the cost lands only on the run that needs
// it. `@type {typeof import('typescript')}` keeps the full type surface under
// `checkJs`, so nothing is bought with an `any`.
//
// -----------------------------------------------------------------------------
// A SHAPE IT CANNOT READ IS REPORTED AND NEVER DROPPED
// -----------------------------------------------------------------------------
// This is `api-contract-endpoints.mjs`'s rule and it matters more here, because
// a parser that silently drops a field reports AGREEMENT THAT IS NOT THERE, and
// agreement is the thing this check is asked for. So every position inside a
// declaration it claims to read, from which it derived no field, is a FINDING
// with its `file:line`, in the same list as a genuine divergence:
//
//   * a member that is not a property signature, or whose name is neither an
//     identifier nor a string literal;
//   * a member with no type annotation;
//   * a TYPE REFERENCE it could not resolve. This is the silent truncation that
//     would matter most: `eligible_next_7d: EligibleNext7d` compares as a LEAF
//     if the reference is not followed, so two copies agree on the name and
//     nothing ever looks inside. References are resolved within the declaring
//     source (the whole document for the contract, the whole file for a source
//     file), and one that resolves to nothing is reported rather than treated
//     as a leaf.
//
// And the non-vacuity guards THROW rather than pass, on `RI-09`'s rule that a
// check which cannot reach its inputs is not a check that passed: the contract
// must parse to at least one declaration, the subject must be declared in it,
// at least two copies must exist, and every copy must carry at least one field.
// A subject that parsed to zero fields would make every copy agree with every
// other, which is this check reporting success for having read nothing.
//
// -----------------------------------------------------------------------------
// WHAT IT COMPARES, STATED THE WAY THE READER BESIDE IT STATES ITS COVERAGE
// -----------------------------------------------------------------------------
// A copy is reduced to a SET OF FIELD PATHS: `as_of`, `reserve.rcr_bp`,
// `per_plan[].cusum.statistic`. An optional member carries a `?`, so
// `detail` and `detail?` are different paths and a member that changes
// optionality in one copy alone is a finding.
//
// FOUR THINGS A GREEN RESULT HERE DOES NOT COVER, and each is deliberate:
//
//   1. LEAF TYPES ARE NOT COMPARED. `open_liability_cents: number` in one copy
//      and `open_liability_cents: string` in another is INVISIBLE to this
//      check. The dispatch asked for field sets and this is field sets; a type
//      comparison across a markdown fence, an `interface` and a `type` alias
//      needs a normalisation ruling (`number` against a branded cents type,
//      a string-literal union against a named enum) that no entry has taken.
//   2. MODIFIERS ARE NOT COMPARED. `readonly` is present in both code copies
//      and absent from the contract by house style, so comparing it would
//      report every field of every shape as diverging on day one.
//   3. IT IS NOT A CHECK ABOUT VALUES. A handler that builds a response
//      omitting a field its type declares is `tsc`'s finding, not this one.
//   4. THE POPULATION IS ONE SUBJECT AND THE REASON IS MEASURED, NOT LAZY.
//      See `SUBJECTS`.
// =============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { workspacePackages } from './repo-invariants.mjs';

/**
 * The shapes this check binds.
 *
 * ONE ENTRY, AND THE POPULATION IS DELIBERATELY NOT THE WHOLE CONTRACT. The
 * mechanism below is general and was RUN general before this list was written
 * down: over the 86 type declarations `API_CONTRACT.md` makes, 70 are also
 * declared somewhere under `apps/` or `packages/`, and 10 of those 70 diverge.
 * Nine of the ten are NOT this check's finding to make today, and they fall
 * into three classes that each need a ruling nobody holds:
 *
 *   * A NAME COLLISION IS NOT A COPY. `apps/worker/src/detectors/identity.ts`
 *     declares an `IdentityGraph` that is the detector's internal walk, and
 *     `apps/api/src/routes/verify.ts` and `.../auth.ts` declare two unrelated
 *     `VerifyResponse`s. Whether a same-named local type is a copy of a wire
 *     shape is a ruling about what the contract's names own.
 *   * A UNION IS NOT A FIELD SET. `CheckoutResponse` and
 *     `CertificateRevokeResponse` are discriminated unions in their route
 *     files and single objects in the contract. Reducing a union to a field set
 *     needs a rule (every arm, the intersection, or the discriminant) and no
 *     entry states one.
 *   * A REAL DIVERGENCE OUTSIDE THIS FENCE IS STILL A REAL DIVERGENCE.
 *     `CheckoutRequest.payment_method?` and `ResetRequest.payment_method?`
 *     exist in code and not in the contract; `PlanVersionResponse.sizes[]`
 *     carries seven figures in two code copies and none in the contract. The
 *     contract is FROZEN, so each of those is an ADR rather than an edit.
 *
 * Widening this array is therefore one entry per ruling, and the measurement
 * above is recorded in this session's log so the next slice starts from a
 * number rather than from a guess. What is NOT deferred is the mechanism: it
 * reads whatever is in this array the same way, so the second entry costs a
 * name and nothing else.
 *
 * @type {readonly string[]}
 */
export const SUBJECTS = ['LiabilityResponse'];

/** The document that specifies the shapes, repo-relative for messages. */
export const CONTRACT_REL = 'docs/architecture/API_CONTRACT.md';

/**
 * Directories a source walk never enters.
 *
 * A second copy of `repo-invariants.mjs`'s `SKIP_DIRS`, which is NOT exported
 * from there. The divergence is bounded and stated rather than hidden: this
 * walk is over workspace package directories only, where `.git` cannot appear.
 */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.next']);

/**
 * Generic type references this reader UNWRAPS rather than resolving.
 *
 * `Array<T>` and `ReadonlyArray<T>` are the array spelling the contract uses
 * where the code writes `readonly T[]`, and `Readonly<T>` is a modifier this
 * check does not compare. Each maps to its single type argument.
 */
const UNWRAPPED = new Set(['Array', 'ReadonlyArray', 'Readonly']);

/**
 * References that are LEAVES rather than object shapes, so an unresolved one is
 * not a truncation and is not reported as one.
 *
 * Kept to the ones a wire shape can legitimately carry. Anything else that does
 * not resolve is a finding, which is the direction that costs least to be wrong
 * in: a name added here silences a truncation forever, a name missing from here
 * produces one noisy finding somebody reads once.
 */
const LEAF_REFERENCES = new Set(['Record', 'Date', 'Map', 'Set', 'Promise', 'Partial']);

/**
 * The TypeScript parser, loaded once, on the first run that needs it.
 *
 * @type {typeof import('typescript') | undefined}
 */
let cachedTs;

/** @returns {typeof import('typescript')} */
function typescript() {
  if (cachedTs === undefined) {
    cachedTs = /** @type {typeof import('typescript')} */ (
      createRequire(import.meta.url)('typescript')
    );
  }
  return cachedTs;
}

/**
 * One parsed source the reader can resolve names against.
 *
 * `lineBase` is the file line the source's own line 0 sits on, so a fenced
 * block inside a markdown document cites the DOCUMENT's line numbers and not
 * the fence's.
 *
 * @typedef {object} ParsedSource
 * @property {import('typescript').SourceFile} sf
 * @property {number} lineBase
 * @property {string} rel  repo-relative path, for messages
 */

/**
 * One declaration the reader can walk.
 *
 * @typedef {object} Declared
 * @property {'alias' | 'interface'} kind
 * @property {import('typescript').TypeNode | import('typescript').InterfaceDeclaration} node
 * @property {ParsedSource} source
 * @property {number} line
 */

/**
 * One copy of a shape, reduced to what this check compares.
 *
 * @typedef {object} Copy
 * @property {string} rel
 * @property {number} line
 * @property {Set<string>} paths
 * @property {string[]} anomalies
 */

/**
 * Every ` ```ts ` fenced block in a markdown document, with its first content
 * line.
 *
 * The opening fence is matched EXACTLY, so a ` ```tsx ` or a ` ```text ` block
 * is not read as TypeScript, and the closing fence is any ` ``` ` line. An
 * unterminated block is dropped by construction and the caller's non-vacuity
 * guard is what would notice; that is stated rather than left implicit.
 *
 * @param {string} text
 * @returns {{ startLine: number, body: string }[]}
 */
export function typescriptFences(text) {
  /** @type {{ startLine: number, body: string }[]} */
  const out = [];
  /** @type {{ startLine: number, lines: string[] } | undefined} */
  let open;
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    if (open === undefined) {
      if (/^```ts\s*$/.test(line)) open = { startLine: index + 1, lines: [] };
    } else if (/^```/.test(line)) {
      out.push({ startLine: open.startLine, body: open.lines.join('\n') });
      open = undefined;
    } else {
      open.lines.push(line);
    }
  }
  return out;
}

/**
 * Parse one source's text.
 *
 * @param {string} rel
 * @param {string} text
 * @param {number} lineBase
 * @returns {ParsedSource}
 */
function parse(rel, text, lineBase) {
  const ts = typescript();
  return {
    sf: ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
    lineBase,
    rel,
  };
}

/**
 * The 1-based file line a node position sits on.
 *
 * @param {ParsedSource} source
 * @param {number} pos
 * @returns {number}
 */
function lineOf(source, pos) {
  return source.lineBase + source.sf.getLineAndCharacterOfPosition(pos).line + 1;
}

/**
 * Every type alias and interface these sources declare, by name.
 *
 * The sources are ONE declaration space: for a markdown document that is every
 * fence in it, because the contract writes `LiveFreshness` in section 6.1 and
 * refers to it from section 8. A name declared twice in one space is the LAST
 * one, and the duplicate is reported AT THE POINT THE WALK FOLLOWS THE NAME
 * rather than for the whole space. `API_CONTRACT.md` declares `VerifyResponse`
 * twice, at section 4 and again at section 6, and that is a real finding about
 * that document; it is not a finding about a subject whose shape never reaches
 * it, and reporting it here would put it in front of whoever is reading about
 * something else.
 *
 * @param {ParsedSource[]} sources
 * @returns {{ scope: Map<string, Declared>, duplicates: Map<string, string> }}
 */
function declarationScope(sources) {
  const ts = typescript();
  /** @type {Map<string, Declared>} */
  const scope = new Map();
  /** @type {Map<string, string>} */
  const duplicates = new Map();
  for (const source of sources) {
    for (const statement of source.sf.statements) {
      /** @type {Declared | undefined} */
      let declared;
      /** @type {string | undefined} */
      let name;
      if (ts.isTypeAliasDeclaration(statement)) {
        name = statement.name.text;
        declared = {
          kind: 'alias',
          node: statement.type,
          source,
          line: lineOf(source, statement.name.pos),
        };
      } else if (ts.isInterfaceDeclaration(statement)) {
        name = statement.name.text;
        declared = {
          kind: 'interface',
          node: statement,
          source,
          line: lineOf(source, statement.name.pos),
        };
      }
      if (declared === undefined || name === undefined) continue;
      const already = scope.get(name);
      if (already !== undefined) {
        duplicates.set(
          name,
          `${source.rel}:${declared.line}: \`${name}\` is declared here and again at ` +
            `${already.source.rel}:${already.line}, so which of the two this reader followed ` +
            'is an accident of document order',
        );
      }
      scope.set(name, declared);
    }
  }
  return { scope, duplicates };
}

/**
 * Walk a declaration into field paths.
 *
 * @param {Declared} declared
 * @param {string} prefix
 * @param {Set<string>} paths
 * @param {string[]} anomalies
 * @param {Map<string, Declared>} scope
 * @param {Set<string>} seen  reference name plus prefix, so a cycle terminates
 * @param {Map<string, string>} duplicates  names this space declares twice
 * @returns {void}
 */
function walkDeclaration(declared, prefix, paths, anomalies, scope, seen, duplicates) {
  if (declared.kind === 'interface') {
    const node = /** @type {import('typescript').InterfaceDeclaration} */ (declared.node);
    for (const clause of node.heritageClauses ?? []) {
      for (const base of clause.types) {
        const name = base.expression.getText(declared.source.sf);
        const target = scope.get(name);
        if (target === undefined) {
          anomalies.push(
            `${declared.source.rel}:${lineOf(declared.source, base.pos)}: ` +
              `\`${prefix || '<root>'}\` extends \`${name}\`, which this source does not ` +
              'declare, so the fields it contributes are invisible here',
          );
          continue;
        }
        const duplicate = duplicates.get(name);
        if (duplicate !== undefined) anomalies.push(duplicate);
        const key = `${name}|${prefix}`;
        if (seen.has(key)) continue;
        seen.add(key);
        walkDeclaration(target, prefix, paths, anomalies, scope, seen, duplicates);
      }
    }
    for (const member of node.members) {
      walkMember(member, prefix, paths, anomalies, scope, seen, declared.source, duplicates);
    }
    return;
  }
  walkType(
    /** @type {import('typescript').TypeNode} */ (declared.node),
    prefix,
    paths,
    anomalies,
    scope,
    seen,
    declared.source,
    duplicates,
  );
}

/**
 * Record one member and descend into its type.
 *
 * @param {import('typescript').TypeElement} member
 * @param {string} prefix
 * @param {Set<string>} paths
 * @param {string[]} anomalies
 * @param {Map<string, Declared>} scope
 * @param {Set<string>} seen
 * @param {ParsedSource} source
 * @param {Map<string, string>} duplicates
 * @returns {void}
 */
function walkMember(member, prefix, paths, anomalies, scope, seen, source, duplicates) {
  const ts = typescript();
  const at = `${source.rel}:${lineOf(source, member.pos)}`;
  const under = prefix || '<root>';
  if (!ts.isPropertySignature(member) || member.name === undefined) {
    anomalies.push(
      `${at}: a member of \`${under}\` is not a property signature, so this reader cannot ` +
        'say whether the copies agree about it',
    );
    return;
  }
  const name =
    ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) ? member.name.text : undefined;
  if (name === undefined) {
    anomalies.push(`${at}: a member of \`${under}\` has a computed name and cannot be compared`);
    return;
  }
  const path = prefix ? `${prefix}.${name}` : name;
  paths.add(member.questionToken === undefined ? path : `${path}?`);
  if (member.type === undefined) {
    anomalies.push(`${at}: \`${path}\` carries no type annotation, so it has no shape to compare`);
    return;
  }
  walkType(member.type, path, paths, anomalies, scope, seen, source, duplicates);
}

/**
 * Descend into a type node, unwrapping the array and modifier spellings.
 *
 * @param {import('typescript').TypeNode} node
 * @param {string} prefix
 * @param {Set<string>} paths
 * @param {string[]} anomalies
 * @param {Map<string, Declared>} scope
 * @param {Set<string>} seen
 * @param {ParsedSource} source
 * @param {Map<string, string>} duplicates
 * @returns {void}
 */
function walkType(node, prefix, paths, anomalies, scope, seen, source, duplicates) {
  const ts = typescript();
  let current = node;
  let path = prefix;
  for (;;) {
    if (ts.isParenthesizedTypeNode(current)) {
      current = current.type;
      continue;
    }
    if (ts.isTypeOperatorNode(current) && current.operator === ts.SyntaxKind.ReadonlyKeyword) {
      current = current.type;
      continue;
    }
    if (ts.isArrayTypeNode(current)) {
      path += '[]';
      current = current.elementType;
      continue;
    }
    if (ts.isTypeReferenceNode(current)) {
      const name = current.typeName.getText(source.sf);
      const args = current.typeArguments;
      if (UNWRAPPED.has(name) && args !== undefined && args.length === 1 && args[0] !== undefined) {
        if (name !== 'Readonly') path += '[]';
        current = args[0];
        continue;
      }
      if (LEAF_REFERENCES.has(name)) return;
      const target = scope.get(name);
      if (target === undefined) {
        anomalies.push(
          `${source.rel}:${lineOf(source, current.pos)}: \`${path}\` is \`${name}\`, which ` +
            'this source does not declare, so its fields are compared as a LEAF and a ' +
            'divergence inside it would be invisible',
        );
        return;
      }
      const duplicate = duplicates.get(name);
      if (duplicate !== undefined) anomalies.push(duplicate);
      const key = `${name}|${path}`;
      if (seen.has(key)) return;
      seen.add(key);
      walkDeclaration(target, path, paths, anomalies, scope, seen, duplicates);
      return;
    }
    break;
  }
  if (ts.isTypeLiteralNode(current)) {
    for (const member of current.members) {
      walkMember(member, path, paths, anomalies, scope, seen, source, duplicates);
    }
    return;
  }
  // An intersection is every arm's fields together, which is what the type
  // means. A UNION is deliberately NOT reduced: see this file's `SUBJECTS`.
  if (ts.isIntersectionTypeNode(current)) {
    for (const arm of current.types)
      walkType(arm, path, paths, anomalies, scope, seen, source, duplicates);
  }
}

/**
 * One subject's field paths as one declaration space states them.
 *
 * @param {string} name
 * @param {ParsedSource[]} sources
 * @param {string} rel  the copy's repo-relative path, for messages
 * @returns {Copy | undefined}  undefined when this space does not declare it
 */
function copyOf(name, sources, rel) {
  const { scope, duplicates } = declarationScope(sources);
  const declared = scope.get(name);
  if (declared === undefined) return undefined;
  /** @type {Set<string>} */
  const paths = new Set();
  /** @type {string[]} */
  const anomalies = [];
  const subjectDuplicate = duplicates.get(name);
  if (subjectDuplicate !== undefined) anomalies.push(subjectDuplicate);
  walkDeclaration(declared, '', paths, anomalies, scope, new Set(), duplicates);
  return { rel, line: declared.line, paths, anomalies };
}

/**
 * Every `.ts` file in the workspace packages, repo-relative.
 *
 * Walked out of `workspacePackages` rather than a written list of directories,
 * for `RI-04`'s reason: a fixture or a check that keeps its own copy of the
 * package set goes stale in step with nothing noticing.
 *
 * @param {string} root
 * @returns {string[]}
 */
function workspaceSources(root) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} rel */
  const walk = (rel) => {
    for (const entry of readdirSync(join(root, rel)).sort()) {
      if (SKIP_DIRS.has(entry)) continue;
      const child = `${rel}/${entry}`;
      if (statSync(join(root, child)).isDirectory()) walk(child);
      else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(child);
    }
  };
  for (const pkg of workspacePackages(root)) {
    if (existsSync(join(root, pkg.dir))) walk(pkg.dir);
  }
  return out;
}

/**
 * Every copy of one subject in the tree, contract first.
 *
 * Exported so a caller can read the comparison rather than only its verdict.
 *
 * @param {string} root
 * @param {string} name
 * @returns {Copy[]}
 */
export function copiesOf(root, name) {
  const contractPath = join(root, CONTRACT_REL);
  if (!existsSync(contractPath))
    throw new Error(`${CONTRACT_REL} does not exist; RI-18 has no specification and cannot run`);
  const contractText = readFileSync(contractPath, 'utf8');
  const fences = typescriptFences(contractText);
  if (fences.length === 0)
    throw new Error(
      `${CONTRACT_REL} holds no \`\`\`ts block; RI-18's fence rule has stopped matching and ` +
        'every shape in this tree would then agree with an empty specification',
    );
  const contractSources = fences.map((f) => parse(CONTRACT_REL, f.body, f.startLine));

  /** @type {Copy[]} */
  const copies = [];
  const contract = copyOf(name, contractSources, CONTRACT_REL);
  if (contract === undefined)
    throw new Error(
      `${CONTRACT_REL} declares no \`${name}\`; RI-18's subject is not in the specification ` +
        'it is checked against, so either the name moved or the fence reader did',
    );
  copies.push(contract);

  for (const rel of workspaceSources(root)) {
    const text = readFileSync(join(root, rel), 'utf8');
    // A whole-text `includes` rather than a declaration-shaped regex: the
    // filter exists to keep the parse count down and nothing else, so it is
    // strictly wider than the thing it filters for and cannot drop a
    // declaration this reader would have understood.
    if (!text.includes(name)) continue;
    const copy = copyOf(name, [parse(rel, text, 0)], rel);
    if (copy !== undefined) copies.push(copy);
  }
  return copies;
}

/**
 * Compare one subject's copies.
 *
 * @param {string} root
 * @param {string} name
 * @returns {string[]}  findings, empty when every copy carries the same fields
 */
export function compareSubject(root, name) {
  const copies = copiesOf(root, name);
  if (copies.length < 2)
    throw new Error(
      `\`${name}\` is declared once, in ${CONTRACT_REL}. RI-18 compares copies and there is ` +
        'nothing to compare it with, so it would report agreement for having read one thing',
    );
  for (const copy of copies) {
    if (copy.paths.size === 0)
      throw new Error(
        `${copy.rel}:${copy.line}: \`${name}\` parsed to ZERO fields. Every other copy would ` +
          'then be reported as diverging from nothing, or agree with it vacuously; RI-18 ' +
          'cannot run against a shape it did not read',
      );
  }

  /** @type {string[]} */
  const findings = [];
  for (const copy of copies) {
    for (const anomaly of copy.anomalies) findings.push(anomaly);
  }

  /** @type {Set<string>} */
  const union = new Set();
  for (const copy of copies) for (const path of copy.paths) union.add(path);
  const sites = copies.map((c) => `${c.rel}:${c.line}`).join(', ');
  for (const path of [...union].sort()) {
    const absent = copies.filter((c) => !c.paths.has(path));
    if (absent.length === 0) continue;
    const present = copies.filter((c) => c.paths.has(path));
    findings.push(
      `\`${name}.${path}\` is declared in ${present.map((c) => `${c.rel}:${c.line}`).join(', ')} ` +
        `and is ABSENT from ${absent.map((c) => `${c.rel}:${c.line}`).join(', ')}. ` +
        `The ${copies.length} declaration(s) of this shape are ${sites}`,
    );
  }
  return findings;
}

/** @type {import('./repo-invariants.mjs').Invariant} */
export const ri18 = {
  id: 'RI-18',
  // COMPUTED FROM `SUBJECTS`, for the reason `RI-04`'s title and `RI-09`'s are
  // computed: a count written beside a list is a hand-maintained count in a
  // different costume and it drifts the same way.
  title:
    `Every declaration of ${SUBJECTS.length === 1 ? 'the response shape' : 'each of the ' + SUBJECTS.length + ' response shapes'} ` +
    `${SUBJECTS.map((s) => `\`${s}\``).join(', ')} carries the same field set`,
  covers:
    `${SUBJECTS.join(', ')}, read live from every declaration of the name: the \`\`\`ts ` +
    `blocks of ${CONTRACT_REL} as one declaration space, and every \`.ts\` file under every ` +
    'workspace package, parsed with the TypeScript compilerrather than matched with a ' +
    'regex. Field PATHS only, with `?` carried and array element shapes carried through ' +
    '`[]`. It does NOT compare leaf types, does NOT compare `readonly`, does NOT reduce a ' +
    'union, and does NOT read any value a handler builds; and its population is the ' +
    'SUBJECTS list rather than every shape the contract declares, for the three measured ' +
    'reasons that list states. A reference it cannot resolve is a FINDING, never a leaf, ' +
    'because a truncated shape reports agreement that was never checked.',
  run(root) {
    /** @type {string[]} */
    const findings = [];
    if (SUBJECTS.length === 0)
      throw new Error('RI-18 has no subject and would report agreement about nothing');
    for (const name of SUBJECTS) findings.push(...compareSubject(root, name));
    return findings;
  },
};
