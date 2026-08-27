// =============================================================================
// apps/site/src/app/chrome.tsx
// =============================================================================
// THE PIECES EVERY PAGE IN THIS APP RENDERS, AND NOTHING THAT DECIDES ANYTHING.
//
// Every function here takes a model that `src/routes/` already built and turns
// it into elements. None of them formats money, derives a cadence, decides
// indexability or picks a canonical address: those are `render/cents.ts`,
// `render/cadence.ts` and `routes/paths.ts`, and a second implementation of any
// of them here is exactly the second transcription INV-M9-01 is about.
// =============================================================================

import type { ReactElement, ReactNode } from 'react';

import type { PageEnvelope } from '../routes/page.ts';
import type { SizeFigures } from '../render/size-label.ts';

/**
 * `PageEnvelope` as the framework's own metadata.
 *
 * `indexable` BECOMES `robots` AND THAT IS GS-148's THIRD CLAIM WIRED. A
 * superseded version's page "is excluded from indexing and from every
 * navigational path", and `versionPageMeta` already decided the boolean off the
 * row. This function is where that decision reaches a crawler, and it is the
 * only place in the app that emits the tag, so a page cannot be indexable by
 * having forgotten to say otherwise.
 *
 * `canonical` IS THE ENVELOPE'S AND NOT THE PATH'S. On a superseded page the
 * two differ on purpose: the page stays reachable forever at its own address
 * and points search at its successor.
 */
export function envelopeMetadata(envelope: PageEnvelope): {
  readonly title: string;
  readonly robots: { readonly index: boolean; readonly follow: boolean };
  readonly alternates: { readonly canonical: string };
} {
  return {
    title: envelope.title,
    robots: { index: envelope.indexable, follow: envelope.indexable },
    alternates: { canonical: envelope.canonical_path },
  };
}

/**
 * INV-M9-03's stamp, rendered.
 *
 * THE BUILD MOMENT IS ON EVERY PAGE AND THE VERSION STAMP IS ON THE PAGES THAT
 * HAVE ONE. `PageEnvelope.renders_version` is `null` "only on a page that
 * renders no plan version", so this component branches on the data rather than
 * on the caller telling it which kind of page it is.
 */
export function VersionStamp({ envelope }: { readonly envelope: PageEnvelope }): ReactElement {
  const stamp = envelope.renders_version;

  return (
    <aside data-testid="version-stamp" data-built-at={envelope.built_at}>
      <p>
        Built at <time dateTime={envelope.built_at}>{envelope.built_at}</time>.
      </p>
      {stamp === null ? null : (
        <p data-testid="renders-version" data-superseded={String(stamp.superseded)}>
          This page describes {stamp.plan_code} version {stamp.version}, published at{' '}
          <code>{stamp.public_slug}</code>.
        </p>
      )}
      {stamp !== null && stamp.superseded && stamp.successor_path !== null ? (
        <p data-testid="supersession-stamp">
          This version has been superseded. The current version is at{' '}
          <a href={stamp.successor_path}>{stamp.successor_path}</a>.
        </p>
      ) : null}
    </aside>
  );
}

/**
 * A surface that has nothing to render, and the reason, in the reader's words.
 *
 * WHY THIS EXISTS AT ALL. Three of M9's five endpoints are in no contract
 * (ADR-096 section 7) and no API answers on this ref, so most of the public
 * surface has no source yet. The two honest options were a page that fails the
 * build and a page that says so, and only one of them is a deployable.
 *
 * IT CARRIES NO CALL TO ACTION AND NO PRICE. A placeholder that guessed at a
 * figure would be INV-M9-01 broken by a stub, which is the same defect as
 * breaking it in earnest and is harder to find later.
 */
export function Unavailable({
  surface,
  reason,
}: {
  readonly surface: string;
  readonly reason: string;
}): ReactElement {
  return (
    <section data-testid="surface-unavailable" data-surface={surface}>
      <h2>This page has no published source yet</h2>
      <p>{reason}</p>
      <p>
        Nothing is shown in place of the missing figures. Every number on this site is read from
        the plan version a trader would be sold and enforced under, so a stand-in number here
        would be the one thing this site exists to prevent.
      </p>
    </section>
  );
}

/** The rendered figures for one size. Every value is already a string. */
export function Figures({ figures }: { readonly figures: SizeFigures }): ReactElement {
  const rows: readonly (readonly [string, string | null])[] = [
    ['Account size', figures.size],
    ['Price', figures.price],
    ['Reset price', figures.reset_price],
    ['Drawdown', figures.drawdown],
    ['Profit target', figures.profit_target],
    ['Buffer', figures.buffer],
    ['Win day floor', figures.win_day_floor],
    ['Daily loss limit', figures.daily_loss_limit],
    ['Floor locks at profit', figures.floor_lock_at_profit],
    ['Floor locks to', figures.floor_lock_floor_at],
  ];

  return (
    <div data-testid="size-figures">
      <table>
        <tbody>
          {rows
            .filter(([, value]) => value !== null)
            .map(([label, value]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{value}</td>
              </tr>
            ))}
        </tbody>
      </table>

      {figures.payout_caps.length === 0 ? null : (
        <table data-testid="payout-caps">
          <caption>Payout caps</caption>
          <thead>
            <tr>
              <th scope="col">From payout</th>
              <th scope="col">Cap</th>
            </tr>
          </thead>
          <tbody>
            {figures.payout_caps.map((step) => (
              <tr key={step.from_ordinal}>
                <th scope="row">{step.from_ordinal}</th>
                <td>{step.cap}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** A page's heading and its stamp, in the order every page uses them. */
export function Surface({
  envelope,
  children,
}: {
  readonly envelope: PageEnvelope;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <>
      <h1>{envelope.title}</h1>
      {children}
      <VersionStamp envelope={envelope} />
    </>
  );
}
