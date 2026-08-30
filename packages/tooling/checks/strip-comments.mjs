// -----------------------------------------------------------------------------
// ONE COMMENT STRIPPER, FOR EVERY CHECK AND EVERY SUITE THAT PARSES SOURCE
// -----------------------------------------------------------------------------
// ADR-279. This repository's checks read source as TEXT, and nearly all of them
// must remove comments first, because the prose in this tree QUOTES the shapes
// the checks hunt: `RI-25`'s first version reported PASS on a restored defect
// because the file's own header explained the repair and the matcher found the
// explanation.
//
// THE IDIOM THAT SPREAD WAS TWO REPLACEMENTS AND IT IS WRONG:
//
//     source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
//
// The block pass runs FIRST and it cannot tell that a block-comment OPENER sits
// inside a LINE comment. So a header that quotes a glob opens a phantom block
// that runs to the next real closer and takes every line of code between them
// with it. ADR-277 section 7 found it and ADR-279 measured it: on
// `apps/worker/src/index.ts` that idiom strips 55,728 characters to 2,753, the
// largest phantom span is chars 4,096 to 45,294, and a `new Date().getHours()`
// placed inside that span is INVISIBLE to `RI-28`, which reports PASS.
//
// **THAT IS THE WORST DIRECTION A DEFECT CAN FAIL IN.** A presence assertion
// over an emptied file goes red and somebody looks. An ABSENCE check over an
// emptied file goes GREEN and nobody ever does, which is exactly ADR-274's
// warned defect class landing inside a check ADR-274 shipped.
//
// THIS IS A ONE-STATE SCANNER RATHER THAN TWO PASSES, and the difference is
// that it never applies a pass that assumes another has not run. `//` inside a
// block comment is the mirror of the same mistake and it is immune to that too.
// The algorithm is transcribed from `apps/worker/test/trading-day-coverage.ts`,
// where ADR-277 wrote it and proved it with seed 13; that file now imports this
// one, and `RI-30` is the leg that stops a ninth copy appearing.
//
// WHAT IT PRESERVES, and each is load-bearing for some caller:
//
//   1. STRING LITERALS, in all three quotes. `RI-27` reads a table name out of
//      a refusal's detail string, so a stripper that also removed literals
//      would delete the evidence.
//   2. NEWLINES, including the ones inside a block comment. Every caller that
//      reports `file:line` counts newlines in the STRIPPED text, so a stripper
//      that collapsed a block comment to one space would report a line number
//      that is not the line. `RI-28` did exactly that until ADR-279.
//
// A REGULAR EXPRESSION LITERAL IS CODE AND IS MODELLED, AND IT HAD TO BE. Every
// stripper this tree has ever had, this one included until ADR-279 measured it,
// read `/\/\*[\s\S]*?\*\//g` and saw the `//` in its own tail as a line comment,
// then deleted the rest of the line. THAT IS THE WORST POSSIBLE PLACE FOR THAT
// BLIND SPOT: the files carrying such a regex are the files that strip comments,
// which is exactly what `RI-30` reads, so the check that hunts the idiom was
// blind to the idiom. Eleven files in this tree hit it.
//
// WHETHER A `/` OPENS A REGEX OR DIVIDES IS NOT DECIDABLE FROM CHARACTERS ALONE,
// so this is a heuristic and is named one. A `/` divides when the previous
// non-space character could end a value: an identifier character, `)`, `]`, `}`,
// a closing quote, or `<` and `>`, which is what keeps `</div>` in a `.tsx` file
// from opening one. It opens a regex otherwise, and after the keywords that can
// be followed by one. A regex is CODE: it is never blanked under `literals`,
// because a caller hunting a pattern needs to see the pattern.
// -----------------------------------------------------------------------------

/**
 * Source with every comment removed and every newline kept.
 *
 * `literals` decides what happens to string literals, and the default is the
 * conservative one. `'keep'` copies them out verbatim, which `RI-27` needs
 * because it reads a table name out of a refusal's detail string. `'blank'`
 * replaces the CONTENT of every literal with spaces, keeping the quotes, the
 * length and the newlines, and it is what a check hunting for a CALL wants: a
 * `.toLocaleString()` written inside a string is a string and not a call.
 *
 * A TEMPLATE SUBSTITUTION IS CODE AND IS TREATED AS CODE IN BOTH MODES. The
 * text inside `${...}` is not part of the literal, it nests, and it may itself
 * carry a literal or a comment. Under `'blank'` it therefore SURVIVES, which is
 * what stops the mode from being a weakening: `` `${at.getHours()}` `` is a
 * local clock read and every caller must still see it.
 *
 * @param {string} source
 * @param {{ literals?: 'keep' | 'blank' }} [options]
 * @returns {string}
 */
export function stripComments(source, options = {}) {
  const blank = options.literals === 'blank';

  /** @typedef {'code' | 'line' | 'block' | 'single' | 'double' | 'template' | 'regex'} State */

  /**
   * The enclosing states, innermost last. A template substitution pushes
   * `'code'` on top of `'template'` and its closing brace pops back.
   *
   * @type {State[]}
   */
  const stack = ['code'];
  /** Characters that can END a value, after which a `/` is division. */
  const DIVIDES_AFTER = /[A-Za-z0-9_$)\]}'"`<>]/;
  /** Keywords a regex may directly follow, where the character rule says division. */
  const REGEX_KEYWORDS =
    /(?:^|[^A-Za-z0-9_$])(?:return|typeof|instanceof|case|in|of|new|delete|void|do|else|yield|await)$/;

  /**
   * Does the `/` at `index` open a regular expression literal?
   *
   * @param {number} index
   * @returns {boolean}
   */
  const opensRegex = (index) => {
    let j = index - 1;
    while (j >= 0 && /\s/.test(/** @type {string} */ (source[j]))) j -= 1;
    if (j < 0) return true;
    const prev = /** @type {string} */ (source[j]);
    if (!DIVIDES_AFTER.test(prev)) return true;
    return REGEX_KEYWORDS.test(source.slice(Math.max(0, j - 12), j + 1));
  };

  /** Inside a character class of the regex currently being read. */
  let inClass = false;
  /** Open braces inside the current substitution, so a nested object literal does not close it. */
  const depth = [0];
  let out = '';
  let i = 0;

  /** @param {string} char */
  const emit = (char) => {
    const state = /** @type {State} */ (stack[stack.length - 1]);
    const inLiteral = state === 'single' || state === 'double' || state === 'template';
    if (blank && inLiteral && char !== '\n') out += ' ';
    else out += char;
  };

  while (i < source.length) {
    const state = /** @type {State} */ (stack[stack.length - 1]);
    const char = /** @type {string} */ (source[i]);
    const pair = source.slice(i, i + 2);

    if (state === 'code') {
      if (pair === '//') {
        stack.push('line');
        i += 2;
        continue;
      }
      if (pair === '/*') {
        stack.push('block');
        i += 2;
        continue;
      }
      // A SUBSTITUTION'S CLOSING BRACE POPS BACK INTO THE TEMPLATE, and only
      // the one that is not an object literal's or a block's does.
      if (stack.length > 1) {
        if (char === '{') depth[depth.length - 1] = /** @type {number} */ (depth.at(-1)) + 1;
        else if (char === '}') {
          const open = /** @type {number} */ (depth.at(-1));
          if (open === 0) {
            stack.pop();
            depth.pop();
            out += char;
            i += 1;
            continue;
          }
          depth[depth.length - 1] = open - 1;
        }
      }
      if (char === "'") stack.push('single');
      else if (char === '"') stack.push('double');
      else if (char === '`') stack.push('template');
      else if (char === '/' && opensRegex(i)) {
        stack.push('regex');
        inClass = false;
      }
      out += char;
      i += 1;
      continue;
    }

    if (state === 'line') {
      if (char === '\n') {
        stack.pop();
        out += '\n';
      }
      i += 1;
      continue;
    }

    if (state === 'block') {
      // NEWLINES ARE KEPT so a line-oriented caller still reads true lines.
      if (pair === '*/') {
        stack.pop();
        i += 2;
        continue;
      }
      if (char === '\n') out += '\n';
      i += 1;
      continue;
    }

    if (state === 'regex') {
      // A REGEX IS CODE: copied out verbatim in both modes. An escape carries
      // its next character, and a `/` inside a character class does not end it.
      out += char;
      if (char === '\\') {
        const next = source[i + 1];
        if (next !== undefined) out += next;
        i += 2;
        continue;
      }
      if (char === '[') inClass = true;
      else if (char === ']') inClass = false;
      else if (char === '/' && !inClass) stack.pop();
      else if (char === '\n') stack.pop();
      i += 1;
      continue;
    }

    // Inside a string literal.
    if (char === '\\') {
      emit(char);
      const next = source[i + 1];
      if (next !== undefined) emit(next);
      i += 2;
      continue;
    }
    if (state === 'template' && pair === '${') {
      out += '${';
      stack.push('code');
      depth.push(0);
      i += 2;
      continue;
    }
    if (
      (state === 'single' && char === "'") ||
      (state === 'double' && char === '"') ||
      (state === 'template' && char === '`')
    ) {
      stack.pop();
      out += char;
      i += 1;
      continue;
    }
    emit(char);
    i += 1;
  }

  return out;
}
