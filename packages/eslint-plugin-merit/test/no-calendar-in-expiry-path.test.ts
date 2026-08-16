import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import { noCalendarInExpiryPath } from '../index.js';

// =============================================================================
// merit/no-calendar-in-expiry-path, watched rejecting each thing it claims to
// =============================================================================
// ADR-042's strongest mechanism, and the one whose glob matches zero files
// today. THAT IS EXACTLY WHY THIS SUITE IS THE CONTROL: a rule wired to a path
// that does not exist yet is a rule nobody has ever seen fire, and a rule nobody
// has seen fire is indistinguishable from a rule that does not work. Every
// message the rule can emit is emitted here, on purpose, before the first sweep
// is written.
//
// THE `valid` HALF IS NOT FILLER, and it is load-bearing twice over. A rule
// that rejected every import would pass every `invalid` case below and would
// then block the sweep from importing the database accessor, the clock, or its
// own siblings. Each valid case is a construct an expiry sweep is EXPECTED to
// contain, and `now()` appears among them because wall clock is what the ruling
// says a release deadline is measured in.

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
});

ruleTester.run('no-calendar-in-expiry-path', noCalendarInExpiryPath, {
  valid: [
    // The wall clock, which is the unit the ruling REQUIRES here.
    "import { now } from '../clock.js';",
    // The sweep's own neighbours.
    "import { releaseHold } from './release.js';",
    "import { scopedDb } from '@merit/db';",
    // A module whose name merely contains the word, which is not the calendar.
    "import { calendarWidget } from './ui/calendar-widget.js';",
    "import { CalendarIcon } from './icons/calendar-icon.js';",
    // Naming a trading day in a comment or a string is not importing one.
    "export const LABEL = 'next trading day';",
    // The expiry arithmetic the ruling wants: hours, from a timestamp.
    'export const expiresAt = (from) => new Date(from.getTime() + 48 * 60 * 60 * 1000);',
    // A local binding that happens to share a name is not an import of it.
    'export function f(tradingDay) { return tradingDay; }',
  ],

  invalid: [
    {
      name: 'the direct import, which is the defect the rule is named for',
      code: "import { TradingCalendar } from '../trading-calendar';",
      errors: [{ messageId: 'calendarImport' }],
    },
    {
      name: 'a deeper path into the calendar module',
      code: "import { sessionFor } from '@merit/shared/trading-calendar/session.js';",
      errors: [{ messageId: 'calendarImport' }],
    },
    {
      name: 'the engine-style short specifier',
      code: "import * as calendar from './calendar.js';",
      errors: [{ messageId: 'calendarImport' }],
    },
    {
      name: 'reached through a barrel file, which is the one-character evasion',
      code: "import { nextTradingDay } from '../lib/index.js';",
      errors: [{ messageId: 'calendarBinding' }],
    },
    {
      name: 'renaming the binding on import does not help, because the rule reads the specifier',
      code: "import { TradingCalendar as Cal } from './trading-calendar';",
      errors: [{ messageId: 'calendarImport' }],
    },
    {
      name: 'a dynamic import reaches the same module by a route ImportDeclaration cannot see',
      code: "export const load = async () => await import('./trading-calendar');",
      errors: [{ messageId: 'calendarImport' }],
    },
    {
      name: 'require(), for a .cjs corner of a worker',
      code: "const cal = require('../trading-calendar');",
      errors: [{ messageId: 'calendarImport' }],
    },
    {
      name: 'THE SCENARIO THE RULING EXISTS FOR: five trading days from now, in a freeze sweep',
      code:
        "import { addTradingDays } from '../lib/index.js';\n" +
        'export const freezeExpiry = (from) => addTradingDays(from, 5);',
      errors: [{ messageId: 'calendarBinding' }],
    },
  ],
});
