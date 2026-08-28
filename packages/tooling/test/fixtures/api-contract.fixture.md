---
status: fixture
last_updated: 2026-08-28
---

# Fixture Contract

THIS IS NOT `docs/architecture/API_CONTRACT.md` AND THAT IS THE WHOLE POINT.
A test pinned to the live document goes red every time a contract row lands,
which is a check that punishes the work it exists to support. Every shape the
live document has is reproduced here at one twentieth the size, plus three
shapes the live document does NOT have, because a reader is only trusted on a
malformed input once it has been given one.

## 1. Conventions

Prose naming `POST /accounts/:id/reset` and `/openapi.json`. NEITHER IS READ.
The first is the live document's own spelling drift, `:id` where the heading
below says `:accountId`; the second is a path that must 404. A reader that took
paths from sentences would report both.

| Code | Status |
|---|---|
| `not_found` | 404 |
| `forbidden` | 403 |

The table above is keyed on `Code`. It is skipped, and its two rows are counted
as skipped rather than ignored.

## 2. Auth

### POST /auth/otp

One heading, one endpoint, the ordinary case.

### POST /auth/passkey/register/options, /auth/passkey/register/verify

TWO endpoints under one heading, and the second states NO method. It inherits
`POST` from the segment to its left. Reading one entry per heading loses the
second silently.

#### POST /phone/change, GET /phone/change, POST /phone/change/:id/cancel

THREE endpoints, each stating its own method, and two of them share a path.
`METHOD /path` is the key, so `POST /phone/change` and `GET /phone/change` are
two entries and not one.

### GET /accounts/:accountId/certificate?kind=pass|payout

A query string, which is stripped. A route is registered on a PATH. The pipe
inside the query string is also the character a table splits on.

### 2.1 The live channel

**This subsection specifies a PAYLOAD and deliberately carries no
`METHOD /path` heading**, exactly as the live document's section 6.1 does. It
is skipped by having nothing to read, not by being named in a list here.

```ts
// A FENCE. Nothing inside is read, including the two lines below, which are
// written to look like the structures this reader does read.
#### GET /inside-a-fence
| Endpoint | Purpose |
```

### 2.2 Two malformed endpoint headings

### GET

### POST /admin/plans/:planId/versions, publish

Both are ANOMALIES and neither is a silent drop, because both sit inside a
structure this reader claims to read. The first is a heading whose whole text is
a bare method. The second states a method and then names an ACTION where a path
belongs, so its first segment is read and its second is reported. A reader that
dropped either would report full coverage of a document it had not fully read.

## 3. Ops

| Endpoint | Purpose | Notes |
|---|---|---|
| `POST /internal/batch/run` | Trigger the batch | Guarded |
| `GET /health` | Liveness | Public |
| `GET /health` | Liveness, said twice | A DUPLICATE DECLARATION, reported |
| Queue depth | A row of an endpoint table stating no `METHOD /path` | An ANOMALY |
| `GET /internal/pipe` | A cell carrying `a|b` inside backticks | The pipe is content |

## 4. Rate limits

| Surface | Limit |
|---|---|
| `POST /auth/otp` | 5/hour/IP |
| Authenticated reads | 120/minute/identity |
| Webhooks | not rate limited |

Keyed on `Surface`. Its first row RESTATES a heading and its other two rows are
not endpoints at all. Reading it would add nothing and invent two.
