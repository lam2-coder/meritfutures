// =============================================================================
// apps/site/src/app/plans/[slug]/rules/[size]/page.tsx
// =============================================================================
// `/plans/:public_slug/rules/:size_cents`. PG-M9-03, THE PAGE M09 SECTION 1.1
// CALLS THE IMPLEMENTATION RATHER THAN A DESCRIPTION OF ONE:
//
//   "The published `copy_blocks` are the contract a trader will be enforced
//    against. This page is the implementation, not a description of it."
//
// SO EVERY WORD OF RULE TEXT ON IT IS A `copy_blocks` VALUE, and `ruleBlocks`
// is what produces them. INV-M9-02 is that there is no prose of this page's own,
// and `assertRuleTextIsPublished` is the control: it is CALLED here, on the
// model, before anything is returned. A block this file wrote would fail it.
//
// THE SEGMENT IS `size_cents` AND NEVER THE LABEL (M09 section 2.1), and
// `sizeSegment` is the one function that derives it. This page matches an
// incoming segment against `sizeSegment` of each of the version's own sizes
// rather than parsing the segment into a number, because parsing it would be a
// second derivation of an address that `render/size-label.ts` already owns.
// =============================================================================

import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import { sizeSegment } from '../../../../../render/size-label.ts';
import { rulesPage, assertRuleTextIsPublished } from '../../../../../routes/rules.ts';
import { Figures, Surface, Unavailable, envelopeMetadata } from '../../../../chrome.tsx';
import { siteBuild, siteCatalog, siteDisclosure } from '../../../../build.ts';

interface SizeParams {
  readonly params: Promise<{ readonly slug: string; readonly size: string }>;
}

/**
 * Every size of every version, which is `derivedPaths`' own tail.
 *
 * The pair is generated from the rows rather than from a range, so a version
 * that carries four sizes produces four pages and a version that carries one
 * produces one.
 */
export async function generateStaticParams(): Promise<
  readonly { readonly slug: string; readonly size: string }[]
> {
  const read = await siteCatalog(siteBuild());
  if (read.kind !== 'read') return [];

  return read.catalog.versions.flatMap((version) =>
    version.sizes.map((size) => ({ slug: version.public_slug, size: sizeSegment(size) })),
  );
}

export async function generateMetadata({ params }: SizeParams): Promise<Metadata> {
  const { slug, size } = await params;
  const model = await resolve(slug, size);
  return model === null ? { title: 'Rules' } : envelopeMetadata(model.envelope);
}

export default async function SizeRulesPage({ params }: SizeParams): Promise<ReactElement> {
  const { slug, size } = await params;
  const model = await resolve(slug, size);

  if (model === null) {
    return (
      <>
        <h1>Rules</h1>
        <Unavailable
          surface={`/plans/${slug}/rules/${size}`}
          reason={
            'This build has no published rules at this address. Every rule on this page is a ' +
            '`copy_blocks` value from the plan version a trader is enforced under, and this ' +
            'build read none.'
          }
        />
      </>
    );
  }

  return (
    <Surface envelope={model.envelope}>
      {model.supersession_notice === null ? null : (
        <p data-testid="supersession-notice">{model.supersession_notice}</p>
      )}

      <h2 data-testid="size-label" data-marketed={String(model.size_label_is_marketed)}>
        {model.size_label}
      </h2>
      <p>{model.cadence_copy}</p>

      <Figures figures={model.figures} />

      <nav aria-label="Account sizes" data-testid="size-selector">
        <ul>
          {model.size_choices.map((choice) => (
            <li key={choice.path} data-selected={String(choice.selected)}>
              {choice.selected ? choice.label : <a href={choice.path}>{choice.label}</a>}
            </li>
          ))}
        </ul>
      </nav>

      <section data-testid="rule-blocks">
        {model.blocks.map((block) => (
          <article key={block.rule_path} data-rule-path={block.rule_path}>
            <h3>{block.rule_path}</h3>
            <p>{block.body}</p>
          </article>
        ))}
      </section>
    </Surface>
  );
}

/**
 * The rules model for one version at one size, or nothing.
 *
 * `assertRuleTextIsPublished` RUNS HERE AND ITS FAILURE IS NOT CAUGHT INTO A
 * PRETTY STATE. INV-M9-02 is the invariant that a rules page carries no prose
 * of its own, and a page that rendered anyway after failing that check would be
 * publishing unpublished rule text at a trader. It is allowed to take the
 * request down, which is the same direction `routes/rules.ts` chose when it
 * made the assertion throw rather than return a boolean.
 */
async function resolve(slug: string, size: string): Promise<ReturnType<typeof rulesPage> | null> {
  const build = siteBuild();
  const read = await siteCatalog(build);
  if (read.kind !== 'read') return null;

  const version = read.catalog.versions.find((candidate) => candidate.public_slug === slug);
  if (version === undefined) return null;

  const chosen = version.sizes.find((candidate) => sizeSegment(candidate) === size);
  if (chosen === undefined) return null;

  const disclosure = await siteDisclosure(build).catch(() => null);
  if (disclosure === null) return null;

  const model = rulesPage({ version, size: chosen, disclosure }, read.catalog.built_at);
  assertRuleTextIsPublished(model, version);
  return model;
}
