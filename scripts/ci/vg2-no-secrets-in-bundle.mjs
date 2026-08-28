// =============================================================================
// scripts/ci/vg2-no-secrets-in-bundle.mjs
// =============================================================================
// VG-2. NO SECRETS IN CLIENT OUTPUT.
//
// STRATEGY section 4.2 states this row's implementation as "grep of the built
// bundle for key-shaped strings", and its disposition read "Chained, 2026-08-22,
// on CI-07" because its subject is the BUILT BUNDLE and a bundle is what CI-07's
// stage produces. Until 2026-08-27 no stage produced one: `apps/portal` had no
// `app/` directory and `next build` exited 1. Session 250 created the directory,
// ADR-138 ruled it, and CI-07's stage was written -- which under ADR-080 (d)
// EXPIRED this row's chain, because a chain is available only while the row it
// names is not implemented. So this file is what the expiry demands: the leg
// itself, not a re-chain.
//
// A GREP THAT SCANNED NOTHING LOOKS EXACTLY LIKE A GREP WITH NOTHING TO FIND,
// and that shape has cost this project real time twice. `seed-world.ts` exited 0
// writing ZERO bytes while its `.mjs` sibling wrote 3085 and a session was told
// to swap them "if it runs clean". ADR-103's seed 3 is the same lesson as a
// deliberate falsification: a comparison that compares nothing passes every
// case. So this check REFUSES an empty scan before it reports anything: no
// bundle directory, no scanned files, or no scanned bytes is a FAILURE here and
// never a pass.
//
// -----------------------------------------------------------------------------
// AND A GREP THAT SCANNED A THIRD OF THE ESTATE LOOKS EXACTLY LIKE ONE THAT
// SCANNED ALL OF IT, WHICH IS THE HOLE SESSION 348 CLOSED
// -----------------------------------------------------------------------------
// The paragraph above refuses an EMPTY scan and said nothing about a PARTIAL
// one, and this file spent two commits demonstrating the difference. Until
// session 348 the scan target was a hand-typed pair of paths:
//
//     const BUNDLE_DIRS = ['apps/portal/.next/static', 'apps/portal/.next/server'];
//
// with a comment beside it calling the portal "the one deployable that builds a
// bundle". That was already false when it was read: `apps/site`'s build step
// landed on 2026-08-27 and `apps/admin`'s on 2026-08-28. A LIST OF PATHS IS NOT
// A READING OF THE ESTATE, so the list stayed at one deployable while CI-07 grew
// to three, and the check printed the identical `PASS` line either way. Measured
// on this tree with a real AWS access key id appended to one emitted file in
// EACH of the two unscanned bundles, the committed check exited 0 and reported
// `no key-shaped string in client output`. That is the falsification that
// motivated this rewrite and it was run before a line of it was written.
//
// SO THE TARGET IS DERIVED, AND WHAT IT IS DERIVED FROM IS THE DECISION WORTH
// READING. Three sources were available and they fail in three different ways:
//
//   the job's steps            Parsing `.github/workflows/ci.yml` for the
//   (.github/workflows)        `pnpm --filter @merit/x build` lines makes this
//                              check a MIRROR of the job. A mirror can never
//                              notice the step that is missing, and the missing
//                              step is exactly how this hole opened: session 346
//                              recorded that "CI-07 gaining a third app is an
//                              event no gate in this repository can see".
//                              REFUSED.
//
//   the directories that       Globbing `apps/*/.next` after the builds have run
//   exist after a build        makes the scan silently SHRINK whenever a build
//                              step is dropped or fails upstream, which is the
//                              partial-green shape this whole section is about,
//                              rebuilt with a different mechanism. REFUSED.
//
//   the workspace manifests    Reading `apps/*/package.json` answers "which
//   (this file's choice)       deployables emit a client bundle" from the
//                              declaration rather than from the artifact, so the
//                              expected set is known BEFORE the build and a
//                              bundle that is missing is a FAILURE rather than a
//                              smaller number. TAKEN.
//
// THE THIRD SOURCE IS THE ONLY ONE THAT CAN GO RED ON AN OMISSION, and this file
// makes it do so: a deployable that declares a Next production build and emitted
// no bundle FAILS here, naming itself. That is deliberately a second job for
// this check. `CI-06/gate-inventory` cannot see a new app joining CI-07, because
// CI-07's activation condition was satisfied by the first app and the row is
// Implemented; a fourth UI deployable landing with no build step in CI-07 now
// turns VG-2 red instead of turning nothing red.
//
// WHAT THE DERIVATION STILL CANNOT SEE, stated rather than left to be found: it
// recognises a bundler by the pair "a `build` script and a declared `next`
// dependency", so a deployable that bundled with something else would emit
// client assets this file does not know the shape of. That residue is closed by
// refusing to guess: an `apps/*` carrying a `build` script that this check
// cannot classify is a FAILURE naming the app, not a silent omission.
//
// WHAT IT DOES NOT CLAIM. This is a shape check over emitted client assets. It
// cannot find a secret that is not key-shaped, one an attacker reaches by
// another route, or one that never enters the bundle in the first place because
// it is read at runtime. RI-08 and ADR-096 hold the "which package may open a
// connection" question and this file does not touch it.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

// `apps/*` ARE THE DEPLOYABLES AND `packages/*` ARE THE LIBRARIES, which is
// `pnpm-workspace.yaml`'s own split and not this file's opinion. The directory
// name is checked against that manifest rather than trusted, so a workspace that
// moved its deployables fails here loudly instead of scanning an empty tree.
const APPS = 'apps';
const WORKSPACE = 'pnpm-workspace.yaml';

// The two directories `next build` writes. `.next/static` is what the browser
// downloads and `.next/server` is what the server sends; a source map in either
// carries the original text verbatim, so both are in scope.
const NEXT_OUTPUT = ['.next/static', '.next/server'];

// Text-bearing emitted assets. A source map carries the original text verbatim,
// so it is scanned rather than skipped.
const SCANNED = /\.(js|mjs|cjs|css|html|json|txt|map)$/i;

// KEY-SHAPED, not "looks secret". Each pattern is anchored on a vendor prefix or
// an unambiguous PEM header, because a rule matching any long random string
// flags every content hash Next emits and is then turned off by whoever it wakes.
const PATTERNS = [
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/],
  ['Stripe secret key', /\bsk_(live|test)_[A-Za-z0-9]{16,}\b/],
  ['Stripe restricted key', /\brk_(live|test)_[A-Za-z0-9]{16,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9]{32,}\b/],
  ['PEM private key', /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  ['Postgres connection URI with a password', /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/],
  [
    'generic secret assignment',
    /\b(?:api[_-]?key|secret|passwd|password|private[_-]?key)\s*[:=]\s*["'][A-Za-z0-9/+=_-]{24,}["']/i,
  ],
];

function isDirectory(path) {
  try {
    return statSync(join(ROOT, path)).isDirectory();
  } catch {
    return false;
  }
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (SCANNED.test(e.name)) out.push(p);
  }
  return out;
}

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

// -----------------------------------------------------------------------------
// THE DERIVATION
// -----------------------------------------------------------------------------
let workspace;
try {
  workspace = readFileSync(join(ROOT, WORKSPACE), 'utf8');
} catch {
  fail([
    `FAIL VG-2: ${WORKSPACE} is unreadable from ${ROOT}.`,
    '  The set of deployables to scan is DERIVED from the workspace rather than',
    '  typed here, so an unreadable manifest is a check that cannot run and',
    '  never a check that passed.',
  ]);
}

if (!workspace.includes(`'${APPS}/*'`)) {
  fail([
    `FAIL VG-2: ${WORKSPACE} no longer lists '${APPS}/*' as a workspace package.`,
    `  This check reads every deployable out of ${APPS}/ on that declaration. A`,
    '  workspace that moved its deployables must move this constant with it,',
    '  which is a decision to make rather than an empty scan to report.',
  ]);
}

let appNames;
try {
  appNames = readdirSync(join(ROOT, APPS), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
} catch {
  appNames = [];
}

const bundlers = [];
const unclassified = [];

for (const name of appNames) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(ROOT, APPS, name, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  const buildScript = manifest.scripts?.build;
  if (typeof buildScript !== 'string' || buildScript.trim() === '') continue;

  // ADR-095 rules Next.js for the UI deployables and ADR-083 rules the two that
  // run an entry module directly and emit nothing. The declaration is what is
  // read, in either dependency block, because that is what makes the output
  // shape knowable.
  const declaresNext =
    manifest.dependencies?.next !== undefined || manifest.devDependencies?.next !== undefined;
  if (declaresNext) bundlers.push(name);
  else unclassified.push({ name, buildScript });
}

if (unclassified.length > 0) {
  fail([
    `FAIL VG-2: ${unclassified.length} deployable(s) build something this check cannot locate.`,
    ...unclassified.map((u) => `  ${APPS}/${u.name}  "build": ${JSON.stringify(u.buildScript)}`),
    '',
    '  A deployable with a build script emits artifacts, and VG-2 knows where',
    '  only a Next.js build writes them. Guessing would be a scan that reports',
    '  green over output nobody read, which is what this file exists to refuse.',
    '  Teach this check the new output directory, or say in the manifest why the',
    '  build emits nothing client-visible.',
  ]);
}

if (bundlers.length === 0) {
  fail([
    `FAIL VG-2: no deployable under ${APPS}/ declares a client bundle to scan.`,
    '  A grep with no target reports the same green as a grep with nothing to',
    '  find. Refused rather than reported.',
  ]);
}

// EVERY DECLARED BUNDLER MUST HAVE BUILT, AND A MISSING ONE IS RED RATHER THAN A
// SMALLER NUMBER. This is the half that would have caught the original defect:
// the expected set comes from the manifests, so an app CI-07 forgot to build is
// an absence this check can see.
const missing = bundlers.filter((name) =>
  NEXT_OUTPUT.every((out) => !isDirectory(join(APPS, name, out))),
);

if (missing.length > 0) {
  fail([
    `FAIL VG-2: ${missing.length} of ${bundlers.length} declared bundle(s) were never built.`,
    ...missing.map((name) => `  ${APPS}/${name}  expected ${NEXT_OUTPUT.join(' and ')}`),
    '',
    '  Run `pnpm --filter @merit/<app> build` before this check, and if the app',
    '  has no build step in CI-07 then that is the finding: a deployable whose',
    '  client output nothing greps is the hole this check was rewritten to close,',
    '  not an app to drop from the list.',
  ]);
}

const targets = bundlers.flatMap((name) =>
  NEXT_OUTPUT.map((out) => join(APPS, name, out)).filter((d) => isDirectory(d)),
);

// -----------------------------------------------------------------------------
// THE SCAN
// -----------------------------------------------------------------------------
const findings = [];
const perApp = [];
let files = 0;
let bytes = 0;

for (const name of bundlers) {
  const appDirs = NEXT_OUTPUT.map((out) => join(APPS, name, out)).filter((d) => isDirectory(d));
  const appFiles = appDirs.flatMap((d) => walk(join(ROOT, d)));
  let appBytes = 0;
  for (const f of appFiles) {
    let text;
    try {
      text = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    appBytes += Buffer.byteLength(text);
    for (const [label, re] of PATTERNS) {
      const m = text.match(re);
      if (m) {
        const line = text.slice(0, m.index).split('\n').length;
        findings.push({ file: relative(ROOT, f), line, label, sample: m[0].slice(0, 12) });
      }
    }
  }
  perApp.push({ name, files: appFiles.length, bytes: appBytes });
  files += appFiles.length;
  bytes += appBytes;
}

if (files === 0 || bytes === 0) {
  fail([
    `FAIL VG-2: the bundle directories exist but the scan read ${files} file(s) ` +
      `and ${bytes} byte(s).`,
    '  A grep that scanned nothing reports the same green as a grep with nothing',
    '  to find. Refused rather than reported.',
  ]);
}

// THE NOTE NAMES EVERY DEPLOYABLE AND ITS OWN FIGURES, so a scan that covered a
// third of the estate cannot print the same line as one that covered all of it.
// The old note reported one total over "2 bundle director(ies)" and read
// identically whether the list held one app or three, which is how a partial
// scan survives a reader.
console.log(
  `VG-2 note: ${files} emitted file(s), ${bytes} byte(s), ${PATTERNS.length} key shape(s) ` +
    `asserted, over ${targets.length} bundle director(ies) of ${bundlers.length} ` +
    `deployable(s) derived from ${APPS}/*/package.json.`,
);
for (const a of perApp) {
  console.log(`  ${APPS}/${a.name}  ${a.files} file(s)  ${a.bytes} byte(s)`);
}

if (findings.length > 0) {
  console.error(`FAIL VG-2: ${findings.length} key-shaped string(s) in client output.`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.label}  (begins "${f.sample}...")`);
  }
  console.error(
    '\n  A secret in the client bundle is readable by every visitor and cannot be\n' +
      '  un-published. Rotate it, then remove it from the build input. Never\n' +
      '  narrow a pattern here to get green: that is weakening a gate to pass it.',
  );
  process.exit(1);
}

console.log('PASS VG-2: no key-shaped string in client output.');
