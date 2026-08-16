// =============================================================================
// merit/no-calendar-in-expiry-path
// =============================================================================
// ADR-042, and it is the strongest of that ruling's three mechanisms because AN
// IMPORT IS CHECKABLE AND AN INTENTION IS NOT.
//
// THE RULING. An obligation Merit binds itself to is measured in exactly one of
// two units. Trading days, answered only by `TradingCalendar`, for every engine
// counter. Wall-clock hours, answered only by `now()`, for every release
// deadline. **Nothing Merit computes is measured in business days**: that is the
// rail's language, quoted where the rail's leg is described and never
// calculated.
//
// THE FAILURE IT EXISTS FOR, and it is specific rather than hypothetical.
// `payout_requests.freeze_expires_at` and `wallet_withdrawals.freeze_expires_at`
// are `timestamptz`, and M05 described them in prose as "10 business days".
// THERE IS NO BUSINESS-DAY CALENDAR ANYWHERE IN THIS SYSTEM. So whoever
// implements the sweep reaches for the only calendar in the database, which is
// the TRADING calendar, which is a different set of days: the exchange trades on
// days banks are shut and shuts on days banks trade. The substitution is wrong
// on roughly 104 days a year and it looks exactly right in review, because the
// import resolves, the types line up, and the code reads as though somebody
// thought about holidays.
//
// ADR-040 and ADR-042 closed the window at 48 WALL-CLOCK hours precisely so
// that no calendar is needed. This rule is what keeps that true after the
// document that ruled it has scrolled out of everyone's memory.
//
// WHY A GLOB AND NOT A HEURISTIC. The rule bans the import outright and the
// eslint.config.js glob says WHERE, which is `merit/engine-purity`'s shape
// pointed the other way and `merit/no-raw-db-client`'s exactly. A rule that
// tried to decide for itself whether a file "is the sweep" would be guessing
// from filenames, and the first refactor that renamed a directory would switch
// it off silently. The glob is a line in the file whose entire subject is which
// rules apply where.
//
// WHAT IT DOES NOT CATCH, stated rather than implied. It reads one file at a
// time with no type information, so it sees the SPELLING of the dependency. A
// calendar value passed IN as an argument, or reached through a re-export under
// another name, is invisible here. That is the same boundary `merit/engine-
// purity` declares, and the answer is the same: this rule closes the accidental
// door. The deliberate one is closed by the fact that a reviewer reading a
// `trading_day` in a freeze sweep has a question to ask.
//
// IT MATCHES ZERO FILES TODAY AND THAT IS THE ARGUMENT FOR WIRING IT NOW. The
// hold, expiry and sweep paths are P2 code that does not exist. A gate wired
// while it is green, and watched failing on a seeded violation, is the cheapest
// it will ever be; wired after the first sweep is written, it is a rule that
// arrives to find a defect already shipped and blamed on the rule for noticing.

/**
 * The calendar, however it is spelled. `TradingCalendar` is named as a shared
 * module in GLOSSARY and M02 and its home is fixed by P1 S-E section 11, so
 * these are the specifiers it can legitimately be reached by. Matched on the
 * module specifier rather than on the imported binding, because renaming the
 * binding on import is the one-character evasion.
 */
const CALENDAR_SPECIFIERS = [
  /(^|\/)trading-calendar$/i,
  /(^|\/)trading-calendar\//i,
  /(^|\/)tradingcalendar$/i,
  /(^|\/)calendar$/i,
  /(^|\/)calendar\.js$/i,
  /(^|\/)calendar\.ts$/i,
];

/** Named exports that are the calendar reached through a barrel file. */
const CALENDAR_BINDINGS = new Set([
  'TradingCalendar',
  'tradingCalendar',
  'tradingDay',
  'tradingDays',
  'nextTradingDay',
  'previousTradingDay',
  'addTradingDays',
  'isTradingDay',
  'tradingDaysBetween',
]);

/** @param {string} s */
const isCalendarSpecifier = (s) => CALENDAR_SPECIFIERS.some((re) => re.test(s));

/** @type {import('eslint').Rule.RuleModule} */
const noCalendarInExpiryPath = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban TradingCalendar imports in the hold, expiry and sweep code path. A release deadline ' +
        'is wall-clock hours (ADR-040, ADR-042); the trading calendar is a different set of days.',
    },
    schema: [],
    messages: {
      calendarImport:
        'The hold, expiry and sweep path may not import the trading calendar ("{{name}}"). ' +
        'A release deadline is measured in WALL-CLOCK HOURS and answered by now() (ADR-040, ' +
        'ADR-042). The trading calendar is a different set of days: the exchange trades on days ' +
        'banks are shut and shuts on days banks trade, so this substitution is wrong on roughly ' +
        '104 days a year. There is no business-day calendar in this system and there is not ' +
        'meant to be one.',
      calendarBinding:
        'The hold, expiry and sweep path may not import "{{name}}" from "{{source}}". ' +
        'A release deadline is wall-clock hours (ADR-040, ADR-042), and reaching the calendar ' +
        'through a barrel file is the same dependency with a shorter specifier.',
    },
  },

  create(context) {
    /**
     * @param {any} node
     * @param {string} source
     */
    const checkSource = (node, source) => {
      if (!isCalendarSpecifier(source)) return false;
      context.report({ node, messageId: 'calendarImport', data: { name: source } });
      return true;
    };

    return {
      ImportDeclaration(node) {
        const source = String(node.source.value ?? '');
        if (checkSource(node, source)) return;
        // Reached through a barrel: `import { nextTradingDay } from '../lib'`.
        for (const spec of node.specifiers) {
          const imported =
            spec.type === 'ImportSpecifier' && spec.imported.type === 'Identifier'
              ? spec.imported.name
              : spec.type === 'ImportDefaultSpecifier' || spec.type === 'ImportNamespaceSpecifier'
                ? spec.local.name
                : null;
          if (imported && CALENDAR_BINDINGS.has(imported)) {
            context.report({
              node: spec,
              messageId: 'calendarBinding',
              data: { name: imported, source },
            });
          }
        }
      },

      // `await import('./trading-calendar')` reaches the same module by a route
      // ImportDeclaration does not see. engine-purity's own pairing.
      ImportExpression(node) {
        if (node.source.type !== 'Literal') return;
        checkSource(node, String(node.source.value ?? ''));
      },

      // `require('./trading-calendar')` in a .cjs corner of a worker.
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;
        const arg = node.arguments[0];
        if (!arg || arg.type !== 'Literal') return;
        checkSource(node, String(arg.value ?? ''));
      },
    };
  },
};

export default noCalendarInExpiryPath;
