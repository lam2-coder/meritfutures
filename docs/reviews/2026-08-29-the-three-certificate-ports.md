# The three certificate ports measured as a set, and what each one is actually waiting on, 2026-08-29

**A review record under [ADR-033](../decisions/ADR-033.md), not a plan and not a ruling.** It sits
outside the corpus ([`gates.mjs`](../../scripts/corpus/gates.mjs) excludes `docs/reviews/` from
`isCorpusDocument`), so it carries no frontmatter, appears in no INDEX, and binds nothing by
existing. **The ruling it feeds is [ADR-246](../decisions/ADR-246.md).**

**EVERY LINE NUMBER AND EVERY COUNT BELOW WAS DERIVED ON THIS BRANCH, WHICH FORKED FROM
`origin/main` AT `52b5202`.** Nothing is carried from row `246`'s dispatch text, from
[ADR-240](../decisions/ADR-240.md), or from the `BLOCKED` entries themselves. Two citations the
entries carried did not survive and section 5 says which.

**THE SCOPE OF THE SEARCH IS STATED BEFORE THE RESULT.** Every claim about what this repository
does not contain was derived over `apps/*/src`, `packages/*/src` and `packages/db/migrations`, which
is every directory holding shipped application source and every migration in the set. Claims about
the ports themselves were derived from
[`apps/api/src/routes/certificates.ts`](../../apps/api/src/routes/certificates.ts),
[`apps/api/src/routes/admin-certificates.ts`](../../apps/api/src/routes/admin-certificates.ts),
[`apps/api/src/routes/verify.ts`](../../apps/api/src/routes/verify.ts),
[`apps/api/src/routes/account-reads.ts`](../../apps/api/src/routes/account-reads.ts) and
[`apps/api/src/start.ts`](../../apps/api/src/start.ts).

---

## 1. The three ports, and the one-line answer for each

| Port | Declared at | What it is waiting on, derived here |
|---|---|---|
| `useCertificateBackend` | [`certificates.ts:665`](../../apps/api/src/routes/certificates.ts) | **THE CARD.** Its read arm is constructible today; the `image_url` half of its signer addresses an object no producer in this repository renders |
| `useCertificateImageSource` | [`certificates.ts:1033`](../../apps/api/src/routes/certificates.ts) | **THE SAME CARD.** Both of its database arms are constructible today; what it owes is the bytes |
| `useCertificateRevokeBackend` | [`admin-certificates.ts:400`](../../apps/api/src/routes/admin-certificates.ts) | **THE OPERATOR DOOR.** `principal(request)` resolves only through an `AdminSessionSource`, and no deployment can install one. NOT this session's, and it does not move when the card lands |

**So the set splits two and one, and it is the split rather than the count that matters.** Two of
the three expire together on one landing. The third expires on a landing that has nothing to do with
certificates.

---

## 2. `useCertificateBackend`, taken apart

The port is two methods ([`certificates.ts:642-647`](../../apps/api/src/routes/certificates.ts)):

```
readCertificates(session): Promise<readonly CertificateRow[]>
links(code): CertificateLinks
```

**THE READ IS CONSTRUCTIBLE AND HAS BEEN FOR SOME TIME.** `databaseCertificateBackend`
([`certificates.ts:692`](../../apps/api/src/routes/certificates.ts)) is
`db.scoped(session.identityId, tx => tx.rows('certificates'))`. `certificates` is scope class
`owned` on `identity_id`, so `scopePredicate` is ANDed before the handler sees a row. Nothing about
this arm is blocked.

**THE SIGNER IS TWO FIELDS AND ONLY ONE OF THEM IS STILL REFUSING.**

| Field | State on this tree |
|---|---|
| `verify_url` | **ONE ENVIRONMENT VARIABLE FROM DONE.** [API_CONTRACT](../architecture/API_CONTRACT.md) section 6.3 carries the `GET /verify/:code` row, `verify.ts` implements it at `VERIFY_PATH` ([`verify.ts:195`](../../apps/api/src/routes/verify.ts)), and `start.ts` installs `databaseVerifySource(LIVE_DB)` today. What is left is an ORIGIN, which [ADR-012](../decisions/ADR-012.md) keeps out of this repository |
| `image_url` | **REFUSES, AND NOT ON THE SIGNER.** See section 3 |

**`CertificateLinks` HAS NO NULLABLE HALF** ([`certificates.ts:378-381`](../../apps/api/src/routes/certificates.ts)),
and `projectCertificate` runs both fields through `assertUrl`. So the discharged half buys nothing
on its own: one refusing field refuses the whole response.

---

## 3. What `image_url` is waiting on, once the signer is out of the deployable

[ADR-240](../decisions/ADR-240.md) clause 8 ruled the URL signing key out of `apps/api` and named
where it belongs: the object store, whose presigner is the store's own, or the edge, whose signed-URL
verification is an edge rule. **That ruling is read forward here rather than re-opened.**

**A signer signs an ADDRESS. An address addresses an OBJECT. There is no object.**

| The thing | Where it would live | Present in this repository |
|---|---|---|
| The card **renderer** | M11's, and the issuer that produces certificates already runs in the **worker** | **NO.** `CertificateCard` is named in one file and it is the port's own declaration; `image/png` is named in one file and it is the route that labels bytes it was handed. Both counts are executed in [`certificate-links.test.ts`](../../apps/api/test/certificate-links.test.ts) |
| The card's **address** | An object store or the edge ([INFRA](../architecture/INFRA.md) section 2) | **NO.** No origin variable for it exists, and [ADR-240](../decisions/ADR-240.md) clause 10 declines to name one while nothing reads it |
| The card's **signer** | With whatever verifies it, never here | **NO, AND CORRECTLY SO.** [ADR-240](../decisions/ADR-240.md) section 5 |
| A **column** to hold any of it | `certificates` | **NO.** The table carries **seventeen** columns and none is an image location, and **no migration in the set of 67 alters the table**. Executed in [`certificate-ports.test.ts`](../../apps/api/test/certificate-ports.test.ts) |

`0020_public_surface.sql` states the reason in its own words one line above the DDL: **"THE CARD IS
A RENDERING; THE CERTIFICATE IS THE ROW."** The row exists. The rendering does not.

---

## 4. `useCertificateImageSource` is the same absence from the other side

Both database arms are constructible and one of them is already written elsewhere in this
deployable: `databaseVerifySource` reads `certificates` through `db.publicLookup` and appends
`certificate_verifications` through `db.firm`, which is exactly this port's `lookup` and `record`.

**WHAT IS MISSING IS `CertificateLookup.card`** ([`certificates.ts:976`](../../apps/api/src/routes/certificates.ts)),
whose `bytes` are `image/png` ([`certificates.ts:958`](../../apps/api/src/routes/certificates.ts)).
That is the same rendered card `image_url` would address.

**THE TWO PORTS ARE ONE DELIVERABLE.** A renderer plus somewhere to put its output closes both. No
part of it closes either alone, and no environment variable closes any part of it.

**AND A THIRD REFUSAL IN THIS DEPLOYABLE IS ON THE SAME ABSENCE**, which only appears when the ports
are read together: `databaseAccountReads.readCertificate` is **installed** and refuses by name, and
its `CERTIFICATE_BLOCKER` ([`account-reads.ts:878`](../../apps/api/src/routes/account-reads.ts))
reads *"section 6 types `image_url` as a non-nullable 'signed, time-limited' URL and nothing in this
tree can produce one"*. So the card is one measurement worth taking once, not three.

---

## 5. Two citations that did not survive, and one sentence that was false

**`routes/certificates.ts:918-938`** was cited by `useCertificateImageSource`'s entry for
`CertificateLookup.card`. The type is at **`:976`** and the bytes at **`:958`**. Repaired in the
entry rather than deleted.

**`routes/certificates.ts:654`** was cited by `useCertificateBackend`'s entry for
`databaseCertificateBackend`. The factory is at **`:692`**; `:654` is the closing line of
`UNWIRED_CERTIFICATE_BACKEND`'s doc comment, and it was already wrong at `52b5202`, before this
branch changed a byte. Repaired.

**AND ONE SENTENCE IN SHIPPED SOURCE WAS FALSE ABOUT ITS OWN BEHAVIOUR.**
`CertificateBackendUnwired`'s message reads *"so `GET /certificates` answers 503 rather than an
empty list"*, and it is raised by **both** arms of the port. The list handler guarded
`readCertificates` inside a `try` and called `renderCertificates` after the `catch`, so a refusal
raised by `links` was an unhandled error and `server.ts` answered **500**. Watched, before the
repair:

```
AssertionError: expected { status: 500, code: 'internal_error' }
              to strictly equal { status: 503, code: 'service_unavailable' }
```

[ADR-240](../decisions/ADR-240.md) section 4 ruled that exact shape one wave ago, on
`economic-calendar.ts`, and this is the file it read and did not repair.

---

## 6. The half-wiring, measured rather than warned about

**THE REFUSAL IS DECIDED BY THE STATE OF THE CALLER'S OWN ROWS, AND THE STATUS CODE DOES NOT CHANGE
THAT.** `projectCertificate` never calls `links` for a deferred row, which is
[ADR-168](../decisions/ADR-168.md) foreclosure 4 enforced structurally. So a backend with a live
read and a refusing signer behaves like this:

| The caller's certificates | The deployment answers |
|---|---|
| all deferred | **200**, with real rows |
| one issued | **503** after the repair, **500** before it |

Two callers, one deployment, one difference: the state of a row each of them owns. That is the shape
`verify.ts`' `readPresentation` refuses in its own words, and it is why this port stays out of
`start.ts` **independently** of the missing card. Executed in
[`certificate-ports.test.ts`](../../apps/api/test/certificate-ports.test.ts) so that the next
session tempted to raise the wired count meets a failing expectation rather than a sentence.

---

## 7. `useCertificateRevokeBackend`, read and left standing

Its first obstruction is `principal(request)`
([`admin-certificates.ts:353`](../../apps/api/src/routes/admin-certificates.ts)), which resolves
only through an `AdminSessionSource`, and [ADR-237](../decisions/ADR-237.md) measured that condition
as unmet. [`admin-read-constructibility.test.ts`](../../apps/api/test/admin-read-constructibility.test.ts)
already executes the membership: four backends sit behind the resolver and this is one of them.

**IT IS NOT THIS SESSION'S AND NO PART OF IT WAS TOUCHED.** Nothing here invents an admin identity,
and the entry is amended by one sentence only: to record that it is the member of the set that the
card does not release.

---

## 8. What this measurement leaves owed

- **A card renderer and somewhere for its output to live.** One deliverable, M11's, and it releases
  three refusals in this deployable at once.
- **Whether the card's address is a stored column or derived from `code`.** Not ruled here. A
  presigned URL is minted per request and need not be stored, so a migration may or may not be owed,
  and that is the card slice's to decide.
- **An origin variable for `verify_url`.** Still owed, still declined, and
  [ADR-240](../decisions/ADR-240.md) clause 10 is still the reason.
- **The tension between [API_CONTRACT](../architecture/API_CONTRACT.md) section 6's *"signed,
  time-limited"* `image_url` and section 6.3's *"no query"* image row.**
  [ADR-240](../decisions/ADR-240.md) reported it and did not repair it. It is still unrepaired and
  it still belongs with the slice that decides where the card lives.
