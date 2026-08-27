// =============================================================================
// apps/portal/src/app/calendar/rules-screen.tsx
// =============================================================================
// SC-M4-05, THE RULES PAGE, DRAWN. M04 section 3.1's one thing it must get
// right: "Rendered from the account's PINNED `copy_blocks`. THE WHOLE RULE,
// WITH ITS OPERATOR."
//
// -----------------------------------------------------------------------------
// EVERY SENTENCE ON THIS SCREEN THAT IS A RULE IS A `CopyBlock`
// -----------------------------------------------------------------------------
// INV-M4-08: "Every rule sentence on any screen comes from `copy_blocks` on the
// account's pinned plan version | No rule text is authored in the portal. This
// is the mechanism behind constitution 0.4's 'marketing must equal
// implementation to the tick'."
//
// `RuleClauseView.sentence` is typed `CopyBlock`, whose brand is private to
// `copy/copy-block.ts`, so a builder who types a rule out here does not get a
// failing test, they get a file that does not compile. What this renderer adds
// is the discipline that the branded value is rendered WHOLE and never sliced:
// there is no truncation, no ellipsis and no "read more" on a clause, because a
// half-rendered rule is a rule with its operator missing, which is the exact
// thing section 3.1 says this screen must get right.
//
// The screen's other sentences are chrome (a heading, a status line, a table
// caption) and are the same class as `shell/app-shell.ts`'s error vocabulary:
// they describe the surface and never the contract.
//
// -----------------------------------------------------------------------------
// A RETIRED VERSION IS A STATE AND IT IS RENDERED PROMINENTLY
// -----------------------------------------------------------------------------
// `view/rules.ts`: "`retired` IS A STATE AND NOT AN ERROR. The endpoint serves
// retired versions deliberately, and a trader on a retired contract is reading
// the right page." The renderer's share of that is where the notice goes: above
// the clauses rather than in a footnote. A trader who scrolls a retired
// contract without meeting the word "superseded" has been shown the right
// document and the wrong impression, and the version number alone does not
// carry it because a trader has no reason to know which version is current.
//
// -----------------------------------------------------------------------------
// EVERY NUMBER IS A STRING THE VIEW MODEL ALREADY FORMATTED
// -----------------------------------------------------------------------------
// INV-M4-01, and `view/rules.ts` states the module rule this file inherits: "NO
// `_cents` FIELD SURVIVES INTO THIS VIEW". `RuleSizeView` is nine strings, so
// there is no integer on this screen for arithmetic to be done to, and the one
// nullable field renders as an absence rather than as a zero because "a zero
// profit target is a rule and an absent one is a DIFFERENT rule".
//
// THE SIZE ORDER IS THE SERVER'S. `toRulesView` deliberately does not re-sort
// `sizes`, and neither does this file, for the reason it gives: a numeric sort
// would be arithmetic on a `_cents` field in the one place it looks innocent.

import type { ShellView } from '../../shell/app-shell.ts';
import type { RulesPageView } from '../../view/rules.ts';
import { AsOfStamp, type AsOfFreshness } from './as-of-stamp.tsx';
import { ScreenFrame } from './screen-frame.tsx';

/** The nine columns of `RuleSizeView`, in one place so the head and the body cannot drift. */
const SIZE_COLUMNS = [
  ['size', 'Account size'],
  ['price', 'Price'],
  ['reset_price', 'Reset price'],
  ['drawdown', 'Drawdown'],
  ['profit_target', 'Profit target'],
  ['buffer', 'Buffer'],
  ['win_day_floor', 'Win day floor'],
  ['payout_cap', 'Payout cap'],
  ['min_payout', 'Minimum payout'],
] as const;

export type RulesScreenProps = {
  readonly shell: ShellView;

  /** The account's PINNED version. Never the current one: M04 section 4's obligation. */
  readonly rules: RulesPageView;

  /**
   * The account's last closed trading day, and how fresh the server says it is.
   *
   * A PLAN VERSION HAS NO AS-OF DAY OF ITS OWN, which is why this arrives beside
   * it rather than off it. `PlanVersionResponse` carries `published_at` and
   * `retired_at` and does not extend `AccountState`: a contract is not account
   * state and does not go stale. What the trader still needs on this screen is
   * which session the ACCOUNT this contract is pinned to is being read as of,
   * because the rules page is reached from an account and is read alongside one.
   */
  readonly as_of_trading_day: string;
  readonly freshness: AsOfFreshness;
};

/** SC-M4-05. The contract this account was sold under. */
export function RulesScreen({ shell, rules, as_of_trading_day, freshness }: RulesScreenProps) {
  return (
    <ScreenFrame shell={shell} title="Your account rules">
      <p>
        Plan <code>{rules.plan_id}</code>, version {rules.version}, published{' '}
        <time>{rules.published_at}</time>.
      </p>

      {rules.superseded ? (
        <p className="merit-stale" data-status={rules.status}>
          <strong>This version has been superseded and it is still your contract.</strong> Merit has
          published a newer version of this plan
          {rules.retired_at === null ? '' : ` and retired this one on ${rules.retired_at}`}. The
          rules below are the ones your account was sold under and the ones it is judged by.
        </p>
      ) : (
        <p data-status={rules.status}>This is the version your account is pinned to.</p>
      )}

      <AsOfStamp
        subject="The account reading this contract"
        as_of_trading_day={as_of_trading_day}
        freshness={freshness}
      />

      <h2>The rules</h2>
      <div data-clause-count={rules.clauses.length}>
        {rules.clauses.map((clause) => (
          <p className="merit-clause" key={clause.rule_path} data-rule-path={clause.rule_path}>
            <span className="merit-clause__path">{clause.rule_path}</span>
            {clause.sentence}
          </p>
        ))}
      </div>

      <h2>Sizes</h2>
      <table className="merit-sizes" data-size-count={rules.sizes.length}>
        <caption>Every figure below is the number this plan version published.</caption>
        <thead>
          <tr>
            {SIZE_COLUMNS.map(([key, heading]) => (
              <th key={key} scope="col">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rules.sizes.map((size) => (
            <tr key={size.size}>
              {SIZE_COLUMNS.map(([key]) => (
                <td key={key} data-column={key}>
                  {size[key] === null ? 'none' : size[key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScreenFrame>
  );
}
