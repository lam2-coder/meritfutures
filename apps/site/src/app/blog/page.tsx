// =============================================================================
// apps/site/src/app/blog/page.tsx
// =============================================================================
// `/blog`. ONE OF THE TWO CONTENT INDEXES WITH NO PAGE MODEL OF ITS OWN, AND
// THAT IS REPORTED RATHER THAN INVENTED.
//
// `routes/legal.ts` carries `legalIndex`, and it is `legal`'s alone by
// construction: it filters `d.kind === 'legal'` and stamps its envelope at
// `/legal`. There is no `faqIndex` and no `blogIndex` in `src/routes/`, so this
// page assembles its list from `isLive`, which is the same predicate
// `legalIndex` uses and is exported for exactly this reason: it "restates the
// index's condition in one function rather than at each call site", so the
// site's idea of live and the database's cannot drift.
//
// WHAT IS NOT DONE HERE IS THE INDEX MODEL ITSELF. Writing a `faqIndex` into
// `src/routes/` would be this session adding render logic to a module set the
// fence tells it to call rather than rewrite. It is carried as a finding.
// =============================================================================

import type { ReactElement } from 'react';

import { isLive } from '../../content/documents.ts';
import { page } from '../../routes/page.ts';
import { Surface, Unavailable } from '../chrome.tsx';
import { siteBuild, siteDisclosure } from '../build.ts';

export const metadata = {
  title: 'Blog',
};

export default async function BlogSurface(): Promise<ReactElement> {
  const build = siteBuild();

  if (build.kind !== 'wired') {
    return (
      <>
        <h1>Blog</h1>
        <Unavailable surface="/blog" reason={build.reason} />
      </>
    );
  }

  try {
    const documents = await build.ports.content.listAll('post', 'en');
    const disclosure = await siteDisclosure(build);
    const envelope = page({
      path: '/blog',
      title: 'Blog',
      indexable: true,
      built_at: build.built_at,
      disclosure,
    });
    const live = documents.filter(isLive);

    return (
      <Surface envelope={envelope}>
        {live.length === 0 ? (
          <p data-testid="no-blog-documents">This build read no published post.</p>
        ) : (
          live.map((document) => (
            <section key={document.slug} data-testid="blog-entry">
              <h2>{document.title}</h2>
              <p>{document.body_mdx}</p>
            </section>
          ))
        )}
      </Surface>
    );
  } catch (cause) {
    console.error('the published posts could not be read', cause);
    return (
      <>
        <h1>Blog</h1>
        <Unavailable
          surface="/blog"
          reason="The published posts could not be read for this build."
        />
      </>
    );
  }
}
