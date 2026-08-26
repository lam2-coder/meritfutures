// =============================================================================
// e2e/extract.ts
// =============================================================================
// THE ONE TRIP INTO THE BROWSER. Everything SS-01 to SS-08 needs is read in a
// single `page.evaluate`, and every judgment is made afterwards in Node.
//
// WHY THE SPLIT IS THIS ONE. A check that runs inside the page can only report
// a boolean across a bridge that erases stack, selector and value; a check that
// runs in Node over a serialized report can say WHICH element, WHICH property
// and WHAT the browser actually computed. The failure message is most of a
// gate's value, and DESIGN_SYSTEM section 7's whole argument for numbering the
// gates is that "a failure has a name rather than a taste".
//
// WHAT IS DELIBERATELY NOT READ, AND WHY IT WOULD BE A FALSE POSITIVE.
// Chromium reports a border color on an element with no border, an outline
// color on an element with no outline, and a text-decoration color on
// undecorated text: each defaults to the used `color`. Reading those would
// report every element three extra times with a value it does not paint, and a
// gate whose findings are mostly noise is a gate somebody turns off. So a
// border color is read only where that side has width and a style, an outline
// color only where the outline has a style, and a decoration color only where
// a line is drawn.
//
// `fill` AND `stroke` ARE READ ON SVG SHAPES AND NOWHERE ELSE, for the same
// reason with sharper teeth: on an HTML element Chromium computes `fill` as
// `rgb(0, 0, 0)` whether or not anything is filled, so reading it everywhere
// would report pure black on every element in the tree. On an SVG shape the
// same value is REAL, is exactly DG-06, and is the default a component ships
// with when nobody looked, which is what SS-04 exists to catch.
// =============================================================================

/** One color a browser actually paints, with the property that paints it. */
export interface ColorUse {
  readonly property: string;
  readonly value: string;
}

/** What SS-01 to SS-05 need about one element. */
export interface ElementReport {
  readonly selector: string;
  readonly fontFamily: string;
  readonly backgroundImage: string;
  readonly boxShadow: string;
  readonly maxRadiusPx: number;
  readonly borderLeftWidthPx: number;
  readonly borderLeftStyle: string;
  readonly borderLeftColor: string;
  readonly colors: readonly ColorUse[];
}

/** What SS-06 to SS-08 need about one run of rendered text. */
export interface TextReport {
  readonly selector: string;
  readonly text: string;
  /**
   * The element holding this text declares itself an icon: `[data-icon]`, a
   * class named `icon`, or `role="img"`. SS-07's rule is about "a position
   * occupied by an icon", and this is the half of that position a page can
   * declare.
   */
  readonly declaredIconSlot: boolean;
}

/** One rendering, at one viewport, in one theme. */
export interface PageReport {
  readonly elements: readonly ElementReport[];
  readonly texts: readonly TextReport[];
}

/**
 * Runs INSIDE the page. It is serialized to the browser by Playwright, so it
 * closes over nothing and imports nothing: every helper it uses is declared in
 * its own body. That constraint is why this function is long rather than
 * composed, and breaking it up would break it.
 */
export function extractPageReport(): PageReport {
  const NON_RENDERING = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TEMPLATE',
    'HEAD',
    'META',
    'TITLE',
    'LINK',
    'BASE',
  ]);

  const SVG_SHAPES = new Set([
    'path',
    'circle',
    'rect',
    'line',
    'polygon',
    'polyline',
    'ellipse',
    'text',
  ]);

  /** A short, stable address for a finding to name. */
  const selectorFor = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    let depth = 0;
    while (node && depth < 4 && node.nodeName !== 'HTML') {
      let part = node.nodeName.toLowerCase();
      if (node.id) {
        part += `#${node.id}`;
        parts.unshift(part);
        break;
      }
      const cls = (node.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean);
      if (cls.length > 0) part += `.${cls.join('.')}`;
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter((c) => c.nodeName === node?.nodeName);
        if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentElement;
      depth += 1;
    }
    return parts.join(' > ');
  };

  const px = (value: string): number => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  };

  const rendered = (el: Element, style: CSSStyleDeclaration): boolean => {
    if (NON_RENDERING.has(el.nodeName)) return false;
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    return true;
  };

  const elements: ElementReport[] = [];
  const texts: TextReport[] = [];
  const hidden = new WeakSet<Element>();

  for (const el of Array.from(document.querySelectorAll('*'))) {
    const style = window.getComputedStyle(el);
    if (!rendered(el, style)) {
      hidden.add(el);
      continue;
    }
    // A descendant of a hidden element is hidden, and `display: none` on an
    // ancestor does not show up in the descendant's own computed `display`.
    const parent = el.parentElement;
    if (parent && hidden.has(parent)) {
      hidden.add(el);
      continue;
    }

    const colors: ColorUse[] = [{ property: 'color', value: style.color }];
    colors.push({ property: 'background-color', value: style.backgroundColor });

    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const width = px(style.getPropertyValue(`border-${side}-width`));
      const kind = style.getPropertyValue(`border-${side}-style`);
      if (width > 0 && kind !== 'none' && kind !== 'hidden') {
        colors.push({
          property: `border-${side}-color`,
          value: style.getPropertyValue(`border-${side}-color`),
        });
      }
    }

    if (style.outlineStyle !== 'none' && px(style.outlineWidth) > 0) {
      colors.push({ property: 'outline-color', value: style.outlineColor });
    }

    if (style.textDecorationLine !== 'none') {
      colors.push({ property: 'text-decoration-color', value: style.textDecorationColor });
    }

    if (el.namespaceURI === 'http://www.w3.org/2000/svg' && SVG_SHAPES.has(el.localName)) {
      if (style.fill !== 'none') colors.push({ property: 'fill', value: style.fill });
      if (style.stroke !== 'none') colors.push({ property: 'stroke', value: style.stroke });
    }

    const radii = [
      px(style.borderTopLeftRadius),
      px(style.borderTopRightRadius),
      px(style.borderBottomRightRadius),
      px(style.borderBottomLeftRadius),
    ];

    elements.push({
      selector: selectorFor(el),
      fontFamily: style.fontFamily,
      backgroundImage: style.backgroundImage,
      boxShadow: style.boxShadow,
      maxRadiusPx: Math.max(...radii),
      borderLeftWidthPx: px(style.borderLeftWidth),
      borderLeftStyle: style.borderLeftStyle,
      borderLeftColor: style.borderLeftColor,
      colors,
    });
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.nodeValue ?? '';
    if (text.trim() === '') continue;
    const holder = node.parentElement;
    if (!holder) continue;
    const style = window.getComputedStyle(holder);
    if (!rendered(holder, style) || hidden.has(holder)) continue;
    const cls = (holder.getAttribute('class') ?? '').split(/\s+/);
    texts.push({
      selector: selectorFor(holder),
      text,
      declaredIconSlot:
        holder.hasAttribute('data-icon') ||
        cls.includes('icon') ||
        holder.getAttribute('role') === 'img',
    });
  }

  return { elements, texts };
}
