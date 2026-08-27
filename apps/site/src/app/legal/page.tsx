// =============================================================================
// apps/site/src/app/legal/page.tsx
// =============================================================================
// `/legal`. THE INDEX OF LIVE LEGAL DOCUMENTS.
//
// SUPERSEDED VERSIONS ARE NOT LISTED AND ARE NOT GONE, which is `legalIndex`
// deciding rather than this file filtering: "INV-M9-11's shape applied to
// content: reachable by link, unreachable by browsing." Each entry carries both
// addresses, the permanent per-version one a citation uses and the live one a
// reader wants, because `routes/paths.ts` keeps them deliberately different.
//
// M9 DRAFTS NOTHING HERE. M09 section 1.2 gives the words to counsel and the
// acceptance record to M3: "M9 renders versioned legal documents and records
// nothing about acceptance." This page displays a checksum and never compares
// one, which is `ContentDocument`'s own note on why that field is a string.
// =============================================================================

import type { ReactElement } from 'react';

import { legalIndex } from '../../routes/legal.ts';
import { Surface, Unavailable } from '../chrome.tsx';
import { siteBuild, siteDisclosure } from '../build.ts';

export const metadata = {
  title: 'Legal',
};

export default async function LegalIndexSurface(): Promise<ReactElement> {
  const build = siteBuild();

  if (build.kind !== 'wired') {
    return (
      <>
        <h1>Legal</h1>
        <Unavailable surface="/legal" reason={build.reason} />
      </>
    );
  }

  try {
    const documents = await build.ports.content.listAll('legal', 'en');
    const disclosure = await siteDisclosure(build);
    const model = legalIndex(documents, disclosure, build.built_at);

    return (
      <Surface envelope={model.envelope}>
        {model.documents.length === 0 ? (
          <p data-testid="no-legal-documents">
            This build read no published legal document.
          </p>
        ) : (
          <ul data-testid="legal-index">
            {model.documents.map((entry) => (
              <li key={entry.slug}>
                <a href={entry.live_path}>{entry.title}</a>{' '}
                <a href={entry.version_path} data-testid="citation-address">
                  version {entry.version}
                </a>
                {entry.published_at === null ? null : (
                  <span> published {entry.published_at}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Surface>
    );
  } catch (cause) {
    console.error('the legal index could not be read', cause);
    return (
      <>
        <h1>Legal</h1>
        <Unavailable
          surface="/legal"
          reason={
            'The versioned legal documents could not be read for this build. These pages are ' +
            'the text agreements are recorded against, so nothing stands in for them.'
          }
        />
      </>
    );
  }
}
