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
// WHAT IT DOES NOT CLAIM. This is a shape check over emitted client assets. It
// cannot find a secret that is not key-shaped, one an attacker reaches by
// another route, or one that never enters the bundle in the first place because
// it is read at runtime. RI-08 and ADR-096 hold the "which package may open a
// connection" question and this file does not touch it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

// The client-visible output of the one deployable that builds a bundle. The four
// non-UI apps run their entry module directly under ADR-083 and emit nothing.
const BUNDLE_DIRS = ['apps/portal/.next/static', 'apps/portal/.next/server'];

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
  ['generic secret assignment', /\b(?:api[_-]?key|secret|passwd|password|private[_-]?key)\s*[:=]\s*["'][A-Za-z0-9/+=_-]{24,}["']/i],
];

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

const present = BUNDLE_DIRS.filter((d) => {
  try {
    return statSync(join(ROOT, d)).isDirectory();
  } catch {
    return false;
  }
});

if (present.length === 0) {
  console.error(
    'FAIL VG-2: no built bundle to scan. Expected at least one of ' +
      BUNDLE_DIRS.join(', ') +
      '.\n' +
      '  Run `pnpm --filter @merit/portal build` first. A pass over an absent\n' +
      '  bundle is the vacuous-green shape this check exists to refuse.'
  );
  process.exit(1);
}

const files = present.flatMap((d) => walk(join(ROOT, d)));
let bytes = 0;
const findings = [];

for (const f of files) {
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  bytes += Buffer.byteLength(text);
  for (const [label, re] of PATTERNS) {
    const m = text.match(re);
    if (m) {
      const line = text.slice(0, m.index).split('\n').length;
      findings.push({ file: relative(ROOT, f), line, label, sample: m[0].slice(0, 12) });
    }
  }
}

if (files.length === 0 || bytes === 0) {
  console.error(
    `FAIL VG-2: the bundle directory exists but the scan read ${files.length} file(s) ` +
      `and ${bytes} byte(s).\n` +
      '  A grep that scanned nothing reports the same green as a grep with nothing\n' +
      '  to find. Refused rather than reported.'
  );
  process.exit(1);
}

console.log(
  `VG-2 note: ${files.length} emitted file(s), ${bytes} byte(s), ` +
    `${PATTERNS.length} key shape(s) asserted, over ${present.length} bundle director(ies).`
);

if (findings.length > 0) {
  console.error(`FAIL VG-2: ${findings.length} key-shaped string(s) in client output.`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.label}  (begins "${f.sample}...")`);
  }
  console.error(
    '\n  A secret in the client bundle is readable by every visitor and cannot be\n' +
      '  un-published. Rotate it, then remove it from the build input. Never\n' +
      '  narrow a pattern here to get green: that is weakening a gate to pass it.'
  );
  process.exit(1);
}

console.log('PASS VG-2: no key-shaped string in client output.');
