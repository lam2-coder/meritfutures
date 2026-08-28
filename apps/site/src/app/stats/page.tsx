// =============================================================================
// apps/site/src/app/stats/page.tsx
// =============================================================================
// `/stats`. PG-M9-05, and M09 section 1.1's third risky surface: "A number
// Merit publishes about its own honesty is the one number a mistake on is
// unforgivable."
//
// THIS PAGE COMPUTES NOTHING. M09 section 1.2 gives every statistic to M12:
// "M9 renders what M12 publishes. A marketing site that computes its own pass
// rate is a second implementation of the firm's most scrutinized number."
// `renderStatistic` turns one published row into strings and `statsPage`
// assembles them; there is no arithmetic in this file and INV-M9-06 is why.
//
// THE WINDOW TRAVELS WITH THE VALUE AND CANNOT BE DROPPED. `assertWindowAttached`
// is INV-M12-04's control and it is CALLED here, per rendered row, before the
// row reaches an element. A figure whose window went missing takes the page
// down rather than being published naked, which is the direction AS-M9-03's
// counter requires.
// =============================================================================

import type { ReactElement } from 'react';

import { assertWindowAttached, statsPage } from '../../routes/stats.ts';
import { Surface, Unavailable } from '../chrome.tsx';
import { siteBuild, siteDisclosure } from '../build.ts';

export const metadata = {
  title: 'Published statistics',
};

export default async function StatsSurface(): Promise<ReactElement> {
  const build = siteBuild();

  if (build.kind !== 'wired') {
    return (
      <>
        <h1>Published statistics</h1>
        <Unavailable surface="/stats" reason={build.reason} />
      </>
    );
  }

  let model;
  try {
    const publication = await build.ports.stats.readPublishedStats();
    const disclosure = await siteDisclosure(build);
    if (disclosure === null) {
      return (
        <>
          <h1>Published statistics</h1>
          <Unavailable
            surface="/stats"
            reason={
              'This build read no simulated-environment disclosure, and INV-M9-05 makes that ' +
              'block a precondition of a page rather than a decoration on one.'
            }
          />
        </>
      );
    }
    model = statsPage(publication, disclosure, build.built_at);
  } catch (cause) {
    console.error('the published statistics could not be read', cause);
    return (
      <>
        <h1>Published statistics</h1>
        <Unavailable
          surface="/stats"
          reason={
            'M12 publishes these figures and this build read none. A statistic is published ' +
            'here with its window, its as-of trading day and its sample size or it is not ' +
            'published at all.'
          }
        />
      </>
    );
  }

  // INV-M12-04, per row, before any of it renders.
  for (const statistic of model.statistics) assertWindowAttached(statistic);

  return (
    <Surface envelope={model.envelope}>
      <p data-testid="computed-at">
        Computed at <time dateTime={model.computed_at}>{model.computed_at}</time>.
      </p>

      {model.statistics.length === 0 ? (
        <p data-testid="no-statistics">This publication carried no statistics.</p>
      ) : (
        model.statistics.map((statistic) => (
          <section
            key={statistic.stat_code}
            data-testid="statistic"
            data-code={statistic.stat_code}
          >
            <h2>{statistic.stat_code}</h2>
            <p data-testid="statistic-value">
              {statistic.value === null ? statistic.not_meaningful : statistic.value}
            </p>
            <dl>
              <dt>Window</dt>
              <dd>{statistic.window}</dd>
              <dt>As of trading day</dt>
              <dd>{statistic.as_of_trading_day}</dd>
              <dt>Sample size</dt>
              <dd>{statistic.sample_size}</dd>
              <dt>Measure</dt>
              <dd>{statistic.measure}</dd>
            </dl>
            {statistic.numerator === null || statistic.denominator === null ? null : (
              <p data-testid="components">
                {statistic.numerator} of {statistic.denominator}
              </p>
            )}
            {statistic.restates === null ? null : (
              <p data-testid="restates">{statistic.restates}</p>
            )}
            <p>
              <a href={statistic.method_path}>How this is measured</a>
            </p>
          </section>
        ))
      )}
    </Surface>
  );
}
