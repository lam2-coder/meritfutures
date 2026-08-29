// =============================================================================
// apps/api/src/operator-identity.ts
// =============================================================================
// WHO IS AT THE ADMIN DOOR, SPLIT INTO THE HALF MERIT OWNS AND THE HALF IT BUYS.
//
// `SECURITY` C-08 reads "RBAC on admin, admin on a separate origin, IP
// allowlist, hardware-key SSO", and `routes/admin-reads.ts` read that as putting
// the whole question at the identity provider: "the mapping from a session to an
// actor and a role is the admin identity provider's". ADR-237 rules that ONE
// SENTENCE COVERS TWO DIFFERENT QUESTIONS.
//
//   PROVING WHO SOMEONE IS   is the provider's, it is phishing-resistant
//                            hardware-key SSO by C-08, and it is a purchase.
//   RECORDING WHICH OPERATORS EXIST AND WHAT ROLE EACH HOLDS is a table, and
//                            the role set was closed by API_CONTRACT section 8
//                            before any of this was written.
//
// `0073_operator_directory.sql` is the second half. THIS FILE IS THE JOIN
// BETWEEN THEM: it takes a VERIFIED assertion and a directory row and decides
// whether an operator is standing there, and it takes an operator-session row
// and decides what a presented cookie resolves to. Neither function verifies
// anything and neither reads a database, which is what makes both of them
// testable today, one slice before either supplier exists.
//
// -----------------------------------------------------------------------------
// THERE IS NO LOGIN HERE, AND THAT IS THE RULE RATHER THAN THE STATE OF PLAY
// -----------------------------------------------------------------------------
// Nothing in this file, and nothing in `0073`, accepts a secret and hands back a
// session. Merit is passwordless by ADR-039 and `0002:280` states it in the
// schema: there is no password table anywhere in it, by design. An admin
// password would be that rule broken at the highest-privilege door in the
// system, and it would be worse than the 503 this slice is narrowing, because a
// 503 refuses everybody and a local credential admits whoever learns it.
//
// SO {@link OperatorAssertionVerifier} IS A PORT WITH NO IMPLEMENTATION IN THIS
// REPOSITORY, and {@link refusingAssertionVerifier} is what a deployment gets
// until one exists. It fails CLOSED in both of its arms and neither arm can be
// turned into a pass by configuration alone. See the next block.
//
// -----------------------------------------------------------------------------
// WHAT A DEPLOYMENT MUST SUPPLY, NAMED AND NEVER VALUED (ADR-012)
// -----------------------------------------------------------------------------
// Three variables, on `MERIT_TURNSTILE_SECRET`'s and `MERIT_OTP_MAC_KEY`'s
// precedent (ADR-226, ADR-197, INFRA section 7): the NAME is written here, the
// VALUE is set by the deployment on the `api-admin` service and appears in no
// file in this repository. {@link ADMIN_IDP_ISSUER_VAR},
// {@link ADMIN_IDP_AUDIENCE_VAR} and {@link ADMIN_IDP_JWKS_URL_VAR}.
//
// ABSENT MEANS `unconfigured` AND `unconfigured` IS A 503. The failure this
// control exists to remove is a check that silently does nothing, so the one
// answer it may not give when it cannot run is "fine". That is ADR-226's ruling
// on Turnstile applied to the surface where it matters more.
//
// PRESENT IS NOT ENOUGH, AND THAT IS THE DIFFERENCE FROM `turnstile.ts`. There,
// the secret was the only missing thing and the verifier existed. Here the
// verifier does not, so a deployment that sets all three variables gets
// `unavailable` rather than a pass: THE CONFIGURATION IS NECESSARY AND THE CODE
// SLICE IS ALSO NECESSARY, and saying so in the outcome is the difference
// between a seam and a hole. A future reader who sets the three variables and
// sees a 503 is reading the correct answer.
//
// -----------------------------------------------------------------------------
// NOTHING HERE IS WIRED, AND WIRING IT WOULD BE THE WRONG MOVE
// -----------------------------------------------------------------------------
// `setAdminSessionSource` stays uncalled in `start.ts`. An `AdminSessionSource`
// built out of {@link resolveOperatorSession} would be honest code in front of
// a table no code can write a row into, so every operator would receive 401,
// which the port's own refusal says is the wrong answer: it "would report it as
// the caller being logged out" when what is true is that the deployment is
// unfinished. `usePayoutBackend`'s rule is the general one and it applies here:
// a live-looking route in front of an arm that cannot answer is worse than an
// honest 503.
// =============================================================================

import type { AdminPrincipal, AdminSessionLookup } from './routes/admin-reads.ts';
import { resolveAdminRole } from './routes/admin-reads.ts';
import type { Environment } from './surface.ts';

// -----------------------------------------------------------------------------
// The configuration, named and never valued
// -----------------------------------------------------------------------------

/**
 * The issuer the admin identity provider asserts, as this deployment expects it.
 *
 * IT IS CONFIGURATION AND NOT A CONSTANT, which is the opposite of
 * `TURNSTILE_SITEVERIFY_URL`'s ruling and for the stated reason: that URL is a
 * fact about a vendor's API and the same for every tenant, and an issuer is a
 * fact about WHICH provider Merit bought, which no session may decide for
 * itself. An assertion whose issuer is not this value is another provider's.
 */
export const ADMIN_IDP_ISSUER_VAR = 'MERIT_ADMIN_IDP_ISSUER';

/**
 * The audience the provider must have minted the assertion FOR.
 *
 * SEPARATE FROM THE ISSUER BECAUSE IT ANSWERS A SEPARATE QUESTION. The issuer
 * says who vouched; the audience says who they vouched TO. Without it, an
 * assertion the same provider minted for a different relying party is accepted
 * here, which is the confused-deputy shape and it needs no attacker inside
 * Merit.
 */
export const ADMIN_IDP_AUDIENCE_VAR = 'MERIT_ADMIN_IDP_AUDIENCE';

/**
 * Where the provider's signing keys are fetched from.
 *
 * A URL RATHER THAN A KEY, deliberately. A pinned public key is a rotation that
 * takes a deploy, and a provider that rotates on its own schedule then locks
 * every operator out at a moment nobody chose. NO MERIT HOSTNAME AND NO VENDOR
 * HOSTNAME IS WRITTEN HERE (ADR-012): the value is the deployment's.
 */
export const ADMIN_IDP_JWKS_URL_VAR = 'MERIT_ADMIN_IDP_JWKS_URL';

/**
 * Every variable a deployment must set before an assertion can be verified.
 *
 * DERIVED FROM THE THREE CONSTANTS AND NOT RETYPED. A fourth name added above
 * and forgotten here would be a requirement no refusal reports.
 */
export const ADMIN_IDP_VARS = [
  ADMIN_IDP_ISSUER_VAR,
  ADMIN_IDP_AUDIENCE_VAR,
  ADMIN_IDP_JWKS_URL_VAR,
] as const;

/**
 * Which of {@link ADMIN_IDP_VARS} this environment does not set.
 *
 * A BLANK IS ABSENT. An empty string is what a platform writes when a secret was
 * declared and never filled in, and reading it as configured is how a control
 * comes to be pointed at nothing.
 */
export function missingAdminIdpVars(env: Environment): readonly string[] {
  return ADMIN_IDP_VARS.filter((name) => (env[name] ?? '').trim() === '');
}

// -----------------------------------------------------------------------------
// The seam
// -----------------------------------------------------------------------------

/**
 * What a verified assertion says, reduced to what this system needs from it.
 *
 * FOUR FIELDS AND NO CLAIMS BAG. A provider hands over whatever it likes and the
 * temptation is to carry all of it; what the directory joins on is the issuer
 * and the subject, and everything else would be a value some later route reads
 * and trusts without anybody having decided it may.
 *
 * THERE IS NO ROLE HERE AND THAT IS THE WHOLE RULING. A role asserted by the
 * provider would put Merit's authorization model in the provider's console,
 * where it is invisible to `admin_actions`, unversioned, and changeable by
 * whoever administers the tenant. The role is Merit's, it lives in
 * `operators.role`, and a role change is an `admin_actions` row.
 */
export interface OperatorAssertion {
  /** The provider that vouched. Compared against {@link ADMIN_IDP_ISSUER_VAR}. */
  readonly issuer: string;
  /** The provider's own identifier for the human. Opaque, and never a secret. */
  readonly subject: string;
  /** The provider's identifier for THIS assertion. `operator_sessions.idp_assertion_id`. */
  readonly assertionId: string;
}

/**
 * What one verification decided.
 *
 * FOUR OUTCOMES AND THREE OF THEM REFUSE, which is `TurnstileOutcome`'s shape
 * and for its stated reason: they are different facts about the world, an
 * operator needs to tell them apart in a log, and the caller is told only that
 * it did not work.
 *
 *   `verified`     the provider vouched and this file believes it.
 *   `rejected`     the provider was asked and said no, or the assertion is not
 *                  for this relying party. The caller's problem.
 *   `unconfigured` this deployment names no provider, so no assertion CAN be
 *                  checked. Merit's problem, and never a pass.
 *   `unavailable`  the check could not be completed. Nobody's problem and still
 *                  not a pass.
 */
export type AssertionOutcome =
  | { readonly outcome: 'verified'; readonly assertion: OperatorAssertion }
  | { readonly outcome: 'rejected'; readonly detail: string }
  | { readonly outcome: 'unconfigured'; readonly detail: string }
  | { readonly outcome: 'unavailable'; readonly detail: string };

/**
 * The seam. One method, because there is one question the provider answers.
 *
 * A PORT RATHER THAN A FUNCTION, on `TurnstileVerifier`'s precedent: a suite can
 * install a verifier that vouches, refuses or hangs without a socket and without
 * a network policy, and the slice that buys the provider implements this
 * interface rather than rewriting its callers.
 */
export interface OperatorAssertionVerifier {
  verify(presented: string): Promise<AssertionOutcome>;
}

/**
 * What every deployment gets until somebody implements the port.
 *
 * BOTH ARMS REFUSE AND NEITHER IS REACHABLE BY CONFIGURATION. An environment
 * missing any of {@link ADMIN_IDP_VARS} is `unconfigured` and names exactly what
 * is missing; an environment that sets all three is `unavailable`, because the
 * variables describe a provider this repository holds no code to talk to.
 *
 * IT IS A REFUSAL AND NOT A STUB. A stub returns a plausible value; this returns
 * the reason, so the day a route is wired in front of it the 503 explains
 * itself, and the day the verifier lands this function is deleted rather than
 * edited around.
 */
export function refusingAssertionVerifier(
  env: Environment = process.env,
): OperatorAssertionVerifier {
  return {
    verify(): Promise<AssertionOutcome> {
      const missing = missingAdminIdpVars(env);
      if (missing.length > 0)
        return Promise.resolve({
          outcome: 'unconfigured',
          detail:
            `this deployment sets no ${missing.join(', ')}, so no assertion can be checked ` +
            'against an identity provider. There is deliberately no fallback and deliberately ' +
            'no pass: a provider absent from one environment must not be the way the control ' +
            'switches itself off in another. ADR-237',
        });
      return Promise.resolve({
        outcome: 'unavailable',
        detail:
          'this deployment names an identity provider and no code in this repository can talk ' +
          'to one. The three variables are necessary and are not sufficient: C-08 requires ' +
          'hardware-key SSO, the verifier that checks it is unwritten, and until it exists ' +
          'every assertion is unverifiable rather than invalid. ADR-237',
      });
    },
  };
}

// -----------------------------------------------------------------------------
// The directory
// -----------------------------------------------------------------------------

/**
 * One `operators` row, as an authorization decision needs it.
 *
 * IT CARRIES THE JOIN COLUMNS AND NOT ONLY THE ANSWER, so
 * {@link operatorFromAssertion} can re-check the match it was handed. See that
 * function for why.
 */
export interface OperatorRecord {
  /** `operators.actor`. What `admin_actions.actor` records, and its foreign key. */
  readonly actorId: string;
  /** `operators.role`. TEXT here for `AdminPrincipal.role`'s stated reason. */
  readonly role: string;
  /** `operators.status`. `active` or `suspended`, by `0073`'s CHECK. */
  readonly status: string;
  /** `operators.idp_issuer`. NULL for an operator who cannot sign in at all. */
  readonly idpIssuer: string | null;
  /** `operators.idp_subject`. NULL for an operator who cannot sign in at all. */
  readonly idpSubject: string | null;
}

/**
 * What a verified assertion plus a directory row resolves to.
 *
 * THE REFUSALS ARE SEPARATED BECAUSE THEY ARE DIFFERENT FACTS, and the one that
 * matters most is `mismatched`: it is the only arm that can only be reached by
 * a defect in the caller's own query.
 */
export type OperatorResolution =
  | { readonly kind: 'operator'; readonly principal: AdminPrincipal }
  | { readonly kind: 'no-such-operator'; readonly detail: string }
  | { readonly kind: 'suspended'; readonly detail: string }
  | { readonly kind: 'unusable-role'; readonly detail: string }
  | { readonly kind: 'mismatched'; readonly detail: string };

/**
 * THE SEAM'S OTHER HALF: a verified assertion becomes an operator, or it does
 * not and the reason is named.
 *
 * @param assertion an assertion a {@link OperatorAssertionVerifier} RETURNED
 *                  `verified` for. This function verifies nothing and must
 *                  never be handed a presented one.
 * @param row       the `operators` row the caller's query matched, or `null`.
 *
 * IT RE-CHECKS THE JOIN IT WAS HANDED, AND THAT IS NOT BELT AND BRACES. The
 * query that produces `row` matches on `(idp_issuer, idp_subject)`, and the
 * available defect is matching on the subject alone: a subject claim is unique
 * only WITHIN an issuer, so a one-predicate query resolves a second provider's
 * subject to an operator the first provider provisioned. `0073`'s partial unique
 * index constrains the pair and cannot constrain a query, and a `mismatched`
 * result here is that defect arriving as a refusal rather than as a session.
 *
 * A NULL PAIR ON THE ROW IS `mismatched` AND NOT AN ADMISSION. `0073` uses NULL
 * for an operator who cannot sign in at all, and SQL equality never matches
 * NULL, so a row carrying one reached this function through a query that did
 * something other than equality.
 *
 * THE ROLE IS RESOLVED THROUGH `resolveAdminRole` AND IS NEVER DEFAULTED. An
 * unrecognised value refuses, which is `admin-reads.ts`'s own rule: a string
 * that quietly becomes `readonly` is a typo that granted a session.
 */
export function operatorFromAssertion(
  assertion: OperatorAssertion,
  row: OperatorRecord | null,
): OperatorResolution {
  if (row === null)
    return {
      kind: 'no-such-operator',
      detail:
        'the provider vouched for a subject that is in no `operators` row. Provisioning is a ' +
        'directory write and is deliberately not something an assertion can perform: a first ' +
        "sign-in that creates its own operator is a login wearing a directory's clothes",
    };

  if (row.idpIssuer === null || row.idpSubject === null)
    return {
      kind: 'mismatched',
      detail:
        'the matched operator carries no identity-provider pair at all, which `0073` uses for ' +
        'an operator who cannot sign in. Equality never matches NULL, so the query that ' +
        'returned this row did not match on the pair',
    };

  if (row.idpIssuer !== assertion.issuer || row.idpSubject !== assertion.subject)
    return {
      kind: 'mismatched',
      detail:
        "the matched operator's provider pair is not the asserted one. A subject claim is " +
        'unique only within its issuer, so this is a query matching on the subject alone',
    };

  if (row.status !== 'active')
    return {
      kind: 'suspended',
      detail:
        `this operator's status is \`${row.status}\`. The row is never deleted, because an ` +
        'operator named in an append-only audit trail cannot be removed from under it, so ' +
        'refusing on the status IS the offboarding',
    };

  if (resolveAdminRole(row.role) === null)
    return {
      kind: 'unusable-role',
      detail:
        `\`${row.role}\` is not one of API_CONTRACT section 8's roles. It is refused rather ` +
        'than defaulted: the whole value of a closed set is the refusal',
    };

  return { kind: 'operator', principal: { actorId: row.actorId, role: row.role } };
}

// -----------------------------------------------------------------------------
// The session read
// -----------------------------------------------------------------------------

/**
 * One `operator_sessions` row joined to its operator, as a lookup needs it.
 *
 * THERE IS NO TOKEN ON IT. The caller finds the row by the hash of what was
 * presented; this type describes what was found, and carrying the token into a
 * decision function would be the one shape that lets a comparison happen in the
 * wrong place.
 */
export interface OperatorSessionRecord {
  readonly operator: OperatorRecord;
  /** `operator_sessions.expires_at`. */
  readonly expiresAt: Date;
  /** `operator_sessions.revoked_at`, or `null` while the session is live. */
  readonly revokedAt: Date | null;
  /** `operator_sessions.idp_assertion_id`. The assertion this session came from. */
  readonly idpAssertionId: string;
}

/**
 * What a presented admin cookie resolves to.
 *
 * THIS IS `AdminSessionSource.lookup`'s DECISION WITHOUT ITS QUERY, and the
 * split is `csrf.ts`'s: the verdict is testable without a route, without a
 * database and without the operator door ADR-171 declined to open.
 *
 * THE THREE ARMS ARE THE PORT'S AND NOT NEW ONES.
 *
 *   `unknown`          no row, an expired row or a revoked row. 401, on
 *                      `admin-reads.ts`'s stated order: an expired session and
 *                      an unrecognised token are the same fact to a caller, and
 *                      distinguishing them tells an anonymous prober that a
 *                      token was once real.
 *   `not-an-operator`  a live session belonging to somebody who may not act:
 *                      suspended, or holding a role outside the closed set. 403,
 *                      which is authenticated-but-not-permitted.
 *   `operator`         everything else.
 *
 * EXPIRY IS COMPARED AGAINST A PASSED CLOCK AND NEVER `Date.now()`, so the
 * boundary case is a test rather than a wait. `expiresAt` is exclusive: a
 * session at exactly its expiry is over, which is the direction that refuses.
 *
 * A REVOKED SESSION IS `unknown` EVEN BEFORE ITS EXPIRY, and the order of the
 * two checks does not matter because both arms answer the same way. What would
 * matter is treating revocation as `not-an-operator`: an operator whose session
 * was revoked mid-incident would then be told the door exists and their role is
 * wrong, which is a different and false statement.
 */
export function resolveOperatorSession(
  row: OperatorSessionRecord | null,
  now: Date,
): AdminSessionLookup {
  if (row === null) return { kind: 'unknown' };
  if (row.revokedAt !== null) return { kind: 'unknown' };
  if (row.expiresAt.getTime() <= now.getTime()) return { kind: 'unknown' };
  if (row.operator.status !== 'active') return { kind: 'not-an-operator' };
  if (resolveAdminRole(row.operator.role) === null) return { kind: 'not-an-operator' };
  return {
    kind: 'operator',
    principal: { actorId: row.operator.actorId, role: row.operator.role },
  };
}
