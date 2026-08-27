// =============================================================================
// apps/portal/src/app/(purchases)/purchases/page.ts
// =============================================================================
// SC-M4-06 at `/purchases`.
//
// THE ROUTE GROUP `(purchases)` CARRIES NO URL SEGMENT, which is why this file
// serves `/purchases` and its sibling serves `/certificates`. The group is this
// session's one directory under `app/`; the two screens inside it keep the URLs
// they should have rather than one being nested under the other. It is also a
// shape this repository's own tooling already reads: `repo-invariants.mjs`
// RI-09 strips `(group)` and `@slot` segments before deciding what a path
// spells, so the check sees `/purchases` here, exactly as a browser will.
//
// NEITHER FILE IN THIS SEGMENT IS A ROUTE HANDLER OR A SERVER ACTION. There is
// no `route.ts` and no `'use server'` anywhere under it, so nothing here serves
// `/api/v1` or an operator path (ADR-083 section 3, ADR-095 ruling 3). Session
// 250 is landing the check that makes that a property rather than a promise.
//
// THE IMPORT ON THE NEXT LINE IS THE SEAM AND IT IS DELIBERATELY VISIBLE.
// `GET /purchases` and `GET /plans/:planId/versions/:version` are session 253's
// and had not landed when this branch was cut, so this page reads fixtures and
// says so in the one place a reader cannot miss. ./ports.ts names what is owed.

import type { ReactElement } from 'react';

import { FIXTURE_PORTS } from '../fixtures.ts';
import { purchasesPageModel } from '../model.ts';
import { PurchasesScreen } from '../purchases-screen.ts';

export const metadata = {
  title: 'Purchases',
};

export default async function PurchasesPage(): Promise<ReactElement> {
  return PurchasesScreen({ model: await purchasesPageModel(FIXTURE_PORTS) });
}
