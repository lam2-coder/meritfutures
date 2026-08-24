#!/usr/bin/env node
// =============================================================================
// .claude/hooks/block-dangerous-shell.mjs
// =============================================================================
// VG-8's `PreToolUse` half (STRATEGY section 4.2; INFRA sections 6 and 10;
// constitution C10). ADR-080 section 6 ruled this a FINDING rather than a
// waiting row: three citations name the hook as VG-8's implementation and
// `.claude/settings.json` carried `SessionStart` and `Stop` only.
//
// WHAT THIS BLOCKS, AND WHY EXACTLY THESE THREE.
// The corpus enumerates the patterns in exactly one place and repeats it in
// two: VIBE_FAILURE_POSTMORTEMS:55 (VG-8's own source) says "Destructive shell
// patterns (`rm -rf`, prod connection strings, force-push)", and INFRA:191 and
// constitution C10 repeat that triple verbatim. So the predicate here is those
// three and nothing else. INFRA:191 and C10 carry a FOURTH clause, "any write
// into `payout/` or `ledger/` paths without the confirm flag", and it is
// deliberately NOT implemented here: neither VG-8 row carries it, no `payout/`
// or `ledger/` path exists in this tree yet, and "the confirm flag" is named in
// those two lines and DEFINED NOWHERE: a grep over the repository returns exactly
// the two lines that name it and no definition. Implementing an undefined
// predicate would be inventing specification, so it is reported as a finding
// instead, and it belongs to C10's hook set rather than to VG-8.
//
// THAT CLAUSE IS LIVE WORK RATHER THAN A HYPOTHETICAL, and session 156's first
// draft of this comment said the opposite. It claimed no such path exists yet.
// `packages/rules-engine/src/payout/` HAS EXISTED SINCE 2026-08-21 and holds
// clamp.ts, evaluate.ts, gates.ts and settle.ts. There is no `ledger/`
// directory; the ledger is `packages/db/migrations/0009_ledger.sql`. So the
// only thing standing between C10's fourth clause and an implementation is the
// undefined flag, which makes defining it a real next step and not housekeeping.
//
// THE TRADEOFF THIS FILE TAKES, STATED ONCE.
// A hook that matches nothing to avoid false positives is decoration. A hook
// that blocks ordinary work is disabled inside a day, and then VG-8 is a
// finding again with a settings file that claims otherwise. So every rule below
// is a PREDICATE OVER BLAST RADIUS rather than over a command name: `rm -rf`
// inside the worktree is ordinary and passes, `rm -rf` that can reach outside it
// does not; a database URI pointed at localhost passes, one pointed at a
// routable host does not; `--force` is refused and `--force-with-lease` is not,
// because the lease is precisely the property the ban on force-push exists to
// obtain. Each refusal names the rule, the token that fired it, and the way
// through.
//
// FAIL LOUD, NEVER FAIL SHUT. Exit 2 blocks the tool call. Every internal
// failure (unparseable payload, unexpected shape) exits 1 with a `VG-8 HOOK
// DEGRADED` line instead, because a hook that blocks EVERY call on a payload
// shape change wedges the session with no way out but editing settings.json,
// and that is a worse control than the one it replaces. A degraded run is
// visible; a shut one is a self-inflicted outage.
//
// SELF TEST. `node .claude/hooks/block-dangerous-shell.mjs --selftest` runs the
// case table at the bottom and exits nonzero on any disagreement. Both
// directions are asserted: every BLOCK case must block and every ALLOW case must
// not, because a rule proved only in the blocking direction is a rule that could
// be `return true` and still pass.

import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// -----------------------------------------------------------------------------
// Segmenting
// -----------------------------------------------------------------------------
// A shell command is many commands. `pnpm build && rm -rf /` is not an `rm`
// invocation by its first word, and a rule reading only the first word of the
// line would pass it. Split on the operators that start a new command, then read
// each segment's own first word.
//
// This is deliberately NOT a shell parser. It over-approximates: a `;` inside a
// quoted string splits a segment that should not have split, which can only
// produce an extra segment whose first word is not `rm`, `git` or a URI carrier,
// so it costs nothing. The one thing it must never do is MISS a segment.
function segments(command) {
  return command
    .split(/(?:\|\||&&|[;\n|&])/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Strip one layer of surrounding quotes. `rm -rf "dist"` and `rm -rf dist` are
// the same call and the target comparison below must see the same string.
function unquote(token) {
  const m = /^(['"])(.*)\1$/s.exec(token);
  return m ? m[2] : token;
}

function words(segment) {
  // Tokens, keeping quoted runs together. Same over-approximation note as above.
  return segment.match(/(?:[^\s'"]|'[^']*'|"[^"]*")+/g) ?? [];
}

// The command word of a segment, past any leading `VAR=value` assignments and
// past `sudo`, `env`, `command`, `time` and `nohup`. `sudo rm -rf /` is an `rm`.
const PREFIXES = new Set(['sudo', 'env', 'command', 'time', 'nohup', 'exec', 'xargs']);
function invocation(segment) {
  const toks = words(segment);
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) {
      i++;
      continue;
    }
    const bare = unquote(t).split('/').pop();
    if (PREFIXES.has(bare)) {
      i++;
      continue;
    }
    return { name: bare, args: toks.slice(i + 1).map(unquote) };
  }
  return { name: '', args: [] };
}

// -----------------------------------------------------------------------------
// DS-1  `rm -rf` that can reach outside the worktree
// -----------------------------------------------------------------------------
// The Replit lesson is an agent deleting data it was never asked to touch. The
// blast radius, not the command name, is the thing worth refusing: `rm -rf
// node_modules` and `rm -rf dist` are ordinary build hygiene and run several
// times a week, so a rule that refuses them is a rule that gets removed.
//
// A target is refused when it is not statically provable to sit strictly inside
// the working directory (or strictly inside a temp directory, where the
// scratchpad lives). `$VAR`, backticks and `$(...)` are refused for the same
// reason: their value is not knowable here, so containment cannot be proved, and
// an unprovable target under `-rf` is the case this rule exists for.
//
// `.git` is refused although it IS inside the worktree. It is the one path in
// the tree whose loss is not recoverable from the tree.
const RM_ALWAYS = new Set(['/', '.', './', '..', '../', '*', '~', '~/', '-rf']);

function rmTargetVerdict(target, cwd) {
  const t = target.trim();
  if (t === '') return null;
  if (RM_ALWAYS.has(t)) return `target \`${t}\` is the working directory, its parent or the root`;
  if (/[$`]/.test(t)) return `target \`${t}\` expands at runtime, so containment cannot be proved`;
  if (t.startsWith('~')) return `target \`${t}\` is under the home directory`;

  const abs = resolve(cwd, t);
  const inCwd = abs.startsWith(cwd + sep);
  // `/tmp/<something>/...` is allowed because the session scratchpad lives
  // there. `/tmp` itself is not: it is shared with every other process.
  const inTmp = /^(?:\/tmp|\/var\/tmp|\/private\/var\/folders)\/[^/]+/.test(abs);
  if (!inCwd && !inTmp) return `target \`${t}\` resolves to \`${abs}\`, outside the worktree`;
  if (inCwd) {
    const rel = abs.slice(cwd.length + 1);
    if (rel === '.git' || rel.startsWith(`.git${sep}`)) {
      return `target \`${t}\` is the git directory, the one path in the tree that the tree cannot restore`;
    }
  }
  return null;
}

function checkRm(segment, cwd) {
  const { name, args } = invocation(segment);
  if (name !== 'rm') return null;

  let recursive = false;
  let force = false;
  const targets = [];
  let endOfFlags = false;
  for (const a of args) {
    if (!endOfFlags && a === '--') {
      endOfFlags = true;
      continue;
    }
    if (!endOfFlags && a.startsWith('--')) {
      if (a === '--recursive') recursive = true;
      if (a === '--force') force = true;
      continue;
    }
    if (!endOfFlags && /^-[A-Za-z]+$/.test(a)) {
      if (/[rR]/.test(a)) recursive = true;
      if (a.includes('f')) force = true;
      continue;
    }
    targets.push(a);
  }
  if (!recursive || !force) return null;

  if (targets.length === 0) {
    return 'DS-1 `rm -rf` with no target that this hook could read';
  }
  for (const t of targets) {
    const why = rmTargetVerdict(t, cwd);
    if (why) return `DS-1 recursive forced delete: ${why}`;
  }
  return null;
}

// -----------------------------------------------------------------------------
// DS-2  A production connection string typed into a shell command
// -----------------------------------------------------------------------------
// A literal database URI in a command is a credential in the transcript and,
// when its host is routable, a live production connection held by the agent.
// VG-7 says the agent never holds production credentials; this is the same rule
// at the shell.
//
// The host, not the scheme, decides. `postgres://merit@localhost:5432/merit` is
// how every developer runs the local database and refusing it would refuse the
// ordinary case. A host with a dot in it is a name that resolves somewhere else.
// A bare single-label host is a container service name on a compose network.
// `psql "$DATABASE_URL"` carries no literal host and is not this rule's subject:
// where that variable is allowed to point is VG-7's question and the platform's.
const URI = /\b(postgres|postgresql|mysql|mariadb|mongodb\+srv|mongodb|redis|rediss|amqp|amqps|clickhouse|mssql|sqlserver):\/\/([^\s'"`;|&)]+)/gi;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]', 'host.docker.internal']);

function checkConnectionString(command) {
  for (const m of command.matchAll(URI)) {
    const authority = m[2].split(/[/?#]/)[0];
    const hostPort = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority;
    const host = hostPort.replace(/:\d+$/, '').toLowerCase();
    if (host === '') continue;
    if (LOCAL_HOSTS.has(host) || host.endsWith('.localhost')) continue;
    if (!host.includes('.')) continue; // single-label compose service name
    return (
      `DS-2 connection string for a routable host: \`${m[1]}://...@${host}\`. ` +
      'A literal remote database URI in a shell command is a production credential in the transcript'
    );
  }
  return null;
}

// -----------------------------------------------------------------------------
// DS-3  force-push
// -----------------------------------------------------------------------------
// `--force-with-lease` and `--force-if-includes` are NOT refused, and that is
// the deliberate line rather than an oversight. The reason force-push is banned
// is that it destroys a commit somebody else has: the lease refuses exactly when
// the remote moved, which is exactly when that would happen. Refusing the lease
// form as well would refuse the safe way to do the thing and leave only the
// unsafe one, and the branch-restart procedure in ADR-D1's harness case needs
// it. Bare `--force`, `-f` inside any short-flag cluster, and the `+refspec`
// form are all refused.
function checkForcePush(segment) {
  const { name, args } = invocation(segment);
  if (name !== 'git') return null;
  const sub = args.find((a) => !a.startsWith('-'));
  if (sub !== 'push') return null;

  for (const a of args) {
    if (a === '--force-with-lease' || a === '--force-if-includes') continue;
    if (a.startsWith('--force-with-lease=') || a.startsWith('--force-if-includes=')) continue;
    if (a === '--force' || a === '-f' || a.startsWith('--force=')) {
      return `DS-3 force-push: \`${a}\` discards commits on the remote. Use \`--force-with-lease\`, which refuses when the remote has moved`;
    }
    if (/^-[A-Za-z]+$/.test(a) && a.includes('f')) {
      return `DS-3 force-push: \`${a}\` carries \`-f\`. Use \`--force-with-lease\`, which refuses when the remote has moved`;
    }
    if (/^\+[^\s]+/.test(a) && a.includes(':') === false && a.length > 1) {
      return `DS-3 force-push: refspec \`${a}\` is the \`+\` form of a forced update`;
    }
    if (/^\+[^\s]+:[^\s]+$/.test(a)) {
      return `DS-3 force-push: refspec \`${a}\` is the \`+\` form of a forced update`;
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// The predicate
// -----------------------------------------------------------------------------
export function verdict(command, cwd) {
  if (typeof command !== 'string' || command.trim() === '') return null;
  const connection = checkConnectionString(command);
  if (connection) return connection;
  for (const seg of segments(command)) {
    const rm = checkRm(seg, cwd);
    if (rm) return rm;
    const push = checkForcePush(seg);
    if (push) return push;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Self test
// -----------------------------------------------------------------------------
const CWD = '/home/user/meritfutures';
const CASES = [
  // --- DS-1, blocked -------------------------------------------------------
  ['block', 'rm -rf /'],
  ['block', 'sudo rm -rf /'],
  ['block', 'rm -rf ~'],
  ['block', 'rm -rf ~/Documents'],
  ['block', 'rm -rf $HOME/notes'],
  ['block', 'rm -rf /etc'],
  ['block', 'rm -rf /home/user'],
  ['block', 'rm -rf ..'],
  ['block', 'rm -rf ../other-repo'],
  ['block', 'rm -rf .'],
  ['block', 'rm -rf *'],
  ['block', 'rm -rf .git'],
  ['block', 'rm -rf .git/objects'],
  ['block', 'rm -fr /'],
  ['block', 'rm -r -f /'],
  ['block', 'rm --recursive --force /'],
  ['block', 'pnpm run build && rm -rf /'],
  ['block', 'rm -rf "$TARGET"'],
  ['block', 'rm -rf /tmp'],
  // --- DS-1, allowed -------------------------------------------------------
  ['allow', 'rm -rf node_modules'],
  ['allow', 'rm -rf dist'],
  ['allow', 'rm -rf packages/db/dist coverage'],
  ['allow', 'rm -rf ./test-results'],
  ['allow', 'rm -rf dist/*'],
  ['allow', 'rm -rf /tmp/claude-0/scratch/x'],
  ['allow', 'rm -f docs/INDEX.md.bak'],
  ['allow', 'rm docs/INDEX.md.bak'],
  ['allow', 'git rm -r --cached node_modules'],
  ['allow', "trap 'rm -rf \"$work\"' EXIT"],
  ['allow', 'grep -rn "rm -rf" docs/'],
  // --- DS-2, blocked -------------------------------------------------------
  ['block', 'psql postgres://merit:pw@ep-cool-name.us-east-2.aws.neon.tech/merit'],
  ['block', 'DATABASE_URL=postgresql://u:p@db.prod.railway.app:5432/merit pnpm test'],
  ['block', 'redis-cli -u rediss://default:pw@fly-merit.upstash.io:6379'],
  // --- DS-2, allowed -------------------------------------------------------
  ['allow', 'psql postgres://merit:merit@localhost:5432/merit'],
  ['allow', 'psql "$DATABASE_URL" -c "select 1"'],
  ['allow', 'psql postgres://merit@postgres:5432/merit'],
  ['allow', 'grep -rn "postgres://" docs/'],
  // --- DS-3, blocked -------------------------------------------------------
  ['block', 'git push --force origin main'],
  ['block', 'git push -f origin main'],
  ['block', 'git push origin +main'],
  ['block', 'git push origin +HEAD:main'],
  ['block', 'git push -uf origin HEAD'],
  // --- DS-3, allowed -------------------------------------------------------
  ['allow', 'git push -u origin HEAD'],
  ['allow', 'git push origin HEAD'],
  ['allow', 'git push --force-with-lease origin claude/s156-vg8-pretooluse-hook'],
  ['allow', 'git push --force-with-lease=main origin main'],
  ['allow', 'git commit -m "fix: force a rebuild"'],
  ['allow', 'git log --oneline -5'],
];

function selftest() {
  let failed = 0;
  for (const [want, cmd] of CASES) {
    const got = verdict(cmd, CWD);
    const ok = want === 'block' ? got !== null : got === null;
    if (!ok) failed++;
    const mark = ok ? 'ok  ' : 'FAIL';
    const detail = got ? `  <- ${got}` : '';
    console.log(`${mark} ${want.padEnd(5)} ${cmd}${ok && got ? detail : ''}${ok ? '' : detail}`);
  }
  console.log(`\n${CASES.length - failed} of ${CASES.length} case(s) pass.`);
  return failed === 0 ? 0 : 1;
}

// -----------------------------------------------------------------------------
// Entry
// -----------------------------------------------------------------------------
function main() {
  if (process.argv.includes('--selftest')) return selftest();

  let payload;
  try {
    payload = JSON.parse(readFileSync(0, 'utf8'));
  } catch (err) {
    process.stderr.write(`VG-8 HOOK DEGRADED: PreToolUse payload did not parse (${String(err)}). Not blocking.\n`);
    return 1;
  }
  if (payload?.tool_name !== 'Bash') return 0;
  const command = payload?.tool_input?.command;
  if (typeof command !== 'string') {
    process.stderr.write('VG-8 HOOK DEGRADED: Bash payload carried no `tool_input.command`. Not blocking.\n');
    return 1;
  }

  const why = verdict(command, payload?.cwd || process.cwd());
  if (!why) return 0;

  process.stderr.write(
    `BLOCKED by VG-8 (.claude/hooks/block-dangerous-shell.mjs): ${why}\n` +
      'VG-8 is "no DDL or DELETE for the app role; dangerous shell blocked" (STRATEGY section 4.2, ' +
      'INFRA section 10, constitution C10). This is a deterministic control, not advice: it cannot ' +
      'be argued with and it must not be worked around by rephrasing the command. If the command is ' +
      'genuinely correct and the rule is genuinely wrong, that is an ADR against INFRA section 10, ' +
      'not an edit to this run.\n',
  );
  return 2;
}

process.exit(main());
