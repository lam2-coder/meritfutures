---
status: approved
depends_on: [../../MERIT_BUILD_MASTER_PROMPT.md, ../plans/M04-trader-portal.md, ../plans/M09-marketing-site.md, ../plans/M11-certificates-social-proof.md, ../plans/M12-transparency-platform.md, ../testing/STRATEGY.md, ../decisions/README.md]
last_updated: 2026-08-14
---

# Design System

Appendix F instantiated. **Tokens are locked here before any UI work exists**, which is the whole point of writing this in the corpus phase: a palette chosen while looking at a half-built page is a palette chosen to make that page look finished.

**The bar, in the constitution's own words:** a skeptical trader landing on meritfutures.com should read "a real company built this", never "another AI-generated prop firm". Looking generic is a competitive wound rather than a cosmetic one, because the firm holds their payouts and one templated tell makes them wonder what else was left at its default.

**Identifier conventions:** `DT-nn` design tokens groups, `DG-nn` design gates (the hard-fail review checklist), `SS-nn` slop-score automated checks.

---

## 1. The three commitments everything else derives from

Appendix F asks for "specific non-default choices up front". These are the three that are load bearing, and each one is chosen partly because it makes a category of AI tell **structurally unavailable** rather than merely forbidden.

### 1.1 Forest ink and brass. One dominant color, one accent, and nothing near indigo

The base is a **deep desaturated forest ink**, almost black, with enough green in it to be a decision rather than a neutral. The single accent is **brass**, a warm metallic ochre.

**Why brass rather than any of the obvious accents.** Green means profit, red means loss, and amber means warning, so all three are already spoken for on a surface that shows money. Brass is **semantically empty** in a trading context, which means it can carry emphasis and interactive affordance without colliding with a meaning the numbers already own. It also reads institutional rather than technological: brass is ledgers and precision instruments, and it appears in essentially no SaaS template, which is the second requirement.

### 1.2 Merit has two semantic colors, not four

**Positive and negative. There is no warning color and no info color.**

Attention is expressed with **weight, a hairline rule, and position**, never with a third hue. This is a real constraint and it is chosen for three reasons. It removes the amber-versus-brass collision described above. It stops the palette drifting toward the "timid even palette with no dominant color" Appendix F names as a tell. And most importantly, on Merit's surfaces **almost every warning is really a statement about a rule**, and a rule stated in yellow reads as an alarm when it is actually an explanation. The consistency meter, the cadence countdown, and the dominated-gate notice are all information, and they are all rendered in ink with weight.

### 1.3 One layout primitive: the ruled row

**Full-width rows separated by hairline rules, with a fixed-measure label column on the left and the value on the right.** Rules pages, the payout timeline, the eligibility breakdown, the wallet ledger, every admin table, and the plan comparison are all the same object at different densities.

**This is the signature, and it is also the cure.** Appendix F's "cardocalypse" (every block a bordered rounded card with a shadow, cards nested in cards) is not available if the primitive is a row. Neither is the colored-left-border card, which Appendix F calls almost as reliable a sign of AI design as em-dashes are for AI text: a ruled row has no border and no color on its edge, and **the distinction is written down here explicitly so that nobody re-derives the banned thing by adding one accent stripe to a row and calling it a variant.**

---

## 2. Color tokens (DT-01)

Every value is a token. **No component uses a raw hex, ever**, and none uses a library default.

### 2.1 Ink, the dominant scale

| Token | Value | Use |
|---|---|---|
| `ink-950` | `#070C0A` | Page background, dark surfaces |
| `ink-900` | `#0C1512` | Primary text on light, elevated dark surfaces |
| `ink-800` | `#13211D` | Dark surface secondary |
| `ink-700` | `#1C2E28` | Heading text on light |
| `ink-600` | `#2A413A` | Body text on light |
| `ink-500` | `#3D5A50` | Secondary text |
| `ink-400` | `#5C7D72` | Tertiary text, disabled |
| `ink-300` | `#89A79C` | Hairline rules on dark |
| `ink-200` | `#B9CEC6` | Hairline rules on light |
| `ink-100` | `#DCE7E2` | Subtle fills |
| `ink-050` | `#F0F5F3` | Light page background |

**There is no pure white and no pure black in the system.** `ink-050` is the lightest surface and `ink-950` the darkest, which is Appendix F's "pure #fff/#000 with no depth" tell removed at the token layer rather than in review.

### 2.2 Brass, the single accent

| Token | Value | Use |
|---|---|---|
| `brass-600` | `#7A5314` | Accent text on light, pressed states |
| `brass-500` | `#9A6A1F` | Accent hover |
| `brass-400` | `#BE862C` | **The accent.** Primary action, focus ring, active state |
| `brass-300` | `#D6A657` | Accent on dark surfaces |
| `brass-200` | `#EBD3A4` | Accent fill at low emphasis |

**Brass appears at most twice per viewport.** That is a rule rather than a guideline: an accent used freely is not an accent, and the "every-other-word bolded or recolored until nothing is emphasized" tell has a visual twin.

### 2.3 The two semantic colors

| Token | Value | Use |
|---|---|---|
| `moss-500` | `#2F6F4F` | Positive: a passing gate, a settled payout, a win day |
| `moss-100` | `#DCEAE2` | Positive fill |
| `oxide-500` | `#96322B` | Negative: a breach, a failing gate, a declined action |
| `oxide-100` | `#F2DEDC` | Negative fill |

**Both are desaturated on purpose.** A bright red breach screen is a dark pattern with a color picker: it manufactures urgency at the exact moment [M04](../plans/M04-trader-portal.md) GS-103 requires the surface to be calm, ordered, and free of a pre-selected reset option.

**And neither is ever the only carrier of meaning.** Every positive and negative state also carries a word and a shape, because a trader with a color-vision deficiency is reading a screen about their money.

### 2.4 Contrast

Every text-on-surface pair ships at **WCAG AA or better**, and the primary reading pairs (`ink-600` on `ink-050`, `ink-100` on `ink-950`) at **AAA**. A contrast test runs in CI over the token matrix rather than over rendered pages, so a failing pair cannot be introduced by a component.

---

## 3. Type (DT-02)

| Role | Face | Why this one |
|---|---|---|
| **Headings and display** | **Newsreader** | A reading serif rather than a display serif, so it carries authority without looking like a luxury-brand template. It is not on Appendix F's banned list and it is not what a model reaches for |
| **Body, UI, labels** | **Public Sans** | A civic typeface, designed for government service pages. It is legible at small sizes, has a real italic, and is close to absent from commercial SaaS, which is exactly the property wanted |
| **Tabular figures** | **IBM Plex Mono**, **numerals only** | Money columns, ledger rows, and the eligibility breakdown, where digit alignment is functional. **Never for prose, never for headings, never "for the hacker vibe"** |

**Banned faces, by name:** Inter, Poppins, Space Grotesk, Geist, Montserrat, and the untouched shadcn default stack. SS-03 checks the shipped font stack against this list.

**Scale.** A restricted set, because a scale with fourteen sizes is a scale nobody follows.

| Token | Size / line height | Use |
|---|---|---|
| `text-display` | 44 / 48 | One per page, at most |
| `text-h1` | 32 / 38 | Section openers |
| `text-h2` | 24 / 30 | Subsections |
| `text-h3` | 18 / 26 | Row group labels |
| `text-body` | 16 / 26 | Everything |
| `text-small` | 14 / 22 | Secondary, table density |
| `text-micro` | 12 / 18 | Legal, as-of labels, disclosure lines |

**Weight is used with purpose and there are three of them:** 400 for body, 500 for labels and emphasis, 700 for headings. **No all-caps section labels anywhere**, which Appendix F names directly and which is also unreadable at `text-micro` where disclosure lines live.

---

## 4. Shape, elevation, and space (DT-03)

### 4.1 Radius

| Token | Value | Use |
|---|---|---|
| `radius-none` | 0 | **Data tables, ruled rows, inputs.** The default |
| `radius-sm` | 2px | Buttons, chips, avatars |
| `radius-md` | 4px | The primary action only |

**Uniform 16px radius on everything is a named tell.** Merit's shapes are nearly square, which reads as an instrument rather than a consumer app, and it is a choice a reviewer can verify in one screenshot.

### 4.2 Elevation

**There is exactly one shadow in the system and it is used only for overlays.**

| Token | Value | Use |
|---|---|---|
| `shadow-overlay` | `0 8px 24px -8px rgba(7,12,10,0.35)` | Modals, menus, popovers. Nothing else |

Everything else separates with a **hairline rule** (`1px` at `ink-200` on light, `ink-300` at 30 percent on dark). No card shadows, no hover lift, no "shadow for depth". This is the second structural defense against cardocalypse: **there is no shadow token a card could use.**

### 4.3 Spacing

A 4px base with a restricted scale: `4, 8, 12, 16, 24, 32, 48, 64, 96`. **No arbitrary values in components**, lint-enforced.

**Measure is capped at 68 characters** for prose and the label column in a ruled row is a fixed `220px` at desktop, which is what makes the primitive read as one system across seven surfaces rather than as seven tables.

---

## 5. The layout rules

| Rule | Detail |
|---|---|
| **Break the template order** | The banned sequence, verbatim from Appendix F, is hero, three icon-top feature cards, testimonials, pricing with the middle plan elevated, FAQ accordion, footer. Merit's marketing pages open with a **number and its window**, because [M12](../plans/M12-transparency-platform.md) gives Merit real ones and no competitor can copy the surface without rebuilding their data plane |
| **No centered hero with a pill badge above the H1** | Named tell. Merit's page openers are left-aligned and asymmetric |
| **No floating social-proof badge in a corner** | Named tell, and it is also a claim with no window attached, which [M09](../plans/M09-marketing-site.md) GS-144 fails the build over |
| **No middle-plan elevation in the pricing comparison** | The three plans are a ruled comparison table with no visual recommendation. Merit does not have a recommended plan; it has three plans with different cadences, and elevating one is a nudge the firm's whole positioning disclaims |
| **Asymmetry with intent** | The ruled row's fixed label column produces a consistent asymmetric rhythm at every density. That is the intent, and it is why there is one primitive rather than seven treatments |

---

## 6. Copy rules

Appendix F calls generic copy "the textual purple gradient" and the rules are enforceable, so they are enforced.

| Rule | Check |
|---|---|
| **No sentence opens with Empower, Unlock, Transform, Elevate, Revolutionize, or Discover** | SS-06, a lint over MDX and component copy |
| **No feature titled with two abstract nouns** ("Seamless Integration", "Powerful Analytics") | Review gate DG-14 |
| **No vague aspirational headline.** Every headline makes **one concrete claim, ideally with a number** | Review gate DG-15. Merit has real numbers: pass rates, payout speed, lifetime figures, and they are read from config rather than typed ([M09](../plans/M09-marketing-site.md) GS-143) |
| **No emoji as icons**, anywhere | SS-07 |
| **At least one sentence per section that sounds like a person wrote it** | Review gate DG-16. It is a judgment and it is the difference between correct copy and copy somebody wrote |
| **No em-dashes**, in any Merit prose, site or docs | SS-08. Appendix F names it and the corpus already obeys it |
| **A parameter is read, never copied** | The [parameter-status ruling](../decisions/gates/parameter-status-launch-candidates-versus-structural-rulings-founder-ruling-2026-08-14.md). A number in a headline, a chart axis, a price card, or blog copy is read from the pinned plan version at request time. GS-143 fails the build on a bare value |

---

## 7. The review gates (DG-01 to DG-16)

**Every item is a hard fail.** This is Appendix F's list turned into numbered gates so a review can cite one, and so a failure has a name rather than a taste.

| ID | Hard fail |
|---|---|
| DG-01 | Purple-to-blue or indigo gradient anywhere |
| DG-02 | Lavender or "vibecode purple" in any token |
| DG-03 | Untouched shadcn gray or Tailwind blue defaults shipped |
| DG-04 | A gradient applied to a large number "for impact" |
| DG-05 | A timid even palette with no dominant color |
| DG-06 | Pure `#fff` or `#000` used as a surface |
| DG-07 | **A colored left border on a card or blockquote.** Any width, any color |
| DG-08 | Cardocalypse: every block a bordered rounded card with a shadow, or cards nested in cards |
| DG-09 | The untouched default card component repeated |
| DG-10 | Inter, Poppins, Space Grotesk, Geist, or Montserrat as the default face |
| DG-11 | All-caps section labels |
| DG-12 | Decorative monospace, or a single serif-italic accent word on a sans page |
| DG-13 | Centered hero with a pill badge above the H1, or the banned section order |
| DG-14 | A feature titled with two abstract nouns |
| DG-15 | A headline making no concrete claim |
| DG-16 | A section with no sentence a person would have written |

**And one gate that is not in Appendix F and belongs here anyway:**

| ID | Hard fail |
|---|---|
| DG-17 | **A trader-facing number rendered without its as-of trading day, window, or sample.** [M04](../plans/M04-trader-portal.md) INV-M4-02 and [M12](../plans/M12-transparency-platform.md) INV-M12-04 both already require it, and it is a design failure as much as a data one, because the label's placement decides whether anybody reads it |

---

## 8. The slop-score pass (SS-01 to SS-08)

A Playwright pass, a **merge blocker on any UI change** ([STRATEGY](../testing/STRATEGY.md) section 4.5). It renders each page at 375px and 1280px, in light and dark, and asserts:

| ID | Check | Detects |
|---|---|---|
| SS-01 | No computed `background-image` containing a gradient between a blue-family and a purple-family hue | DG-01, DG-04 |
| SS-02 | No element with a left border wider than 2px whose color is outside the ink scale | DG-07 |
| SS-03 | The resolved font stack contains none of the banned faces | DG-10 |
| SS-04 | No color outside the token set appears in the computed styles of any element | DG-02, DG-03, DG-05, DG-06 |
| SS-05 | Fewer than a configured number of elements per viewport carry both a border radius above `radius-sm` and a box shadow | DG-08, DG-09 |
| SS-06 | No text node opens with a banned verb | Copy rules |
| SS-07 | No emoji character in a position occupied by an icon | Copy rules |
| SS-08 | No em-dash in any rendered text | Copy rules, Appendix F |

**SS-04 is the strongest one and it is worth saying why.** Checking that every rendered color is in the token set catches DG-02, DG-03, DG-05, and DG-06 at once, and it catches the thing all four have in common, which is a component that shipped with a library default nobody looked at. **A design system that is enforced by taste is a design system that survives until the first rushed week.**

**What the pass cannot check** is DG-14 through DG-16 and DG-13's section order, which are judgments. Those are review gates with a named reviewer, and pretending a script could do them would produce a check that fails on good copy and passes on bland copy, which is the wrong direction.

---

## 9. Certificates and social cards

[M11](../plans/M11-certificates-social-proof.md)'s cards are the surface most likely to be screenshotted and the least likely to be reviewed, so the tokens apply to them without exception, and two extra rules apply:

1. **The verify code is inside the image**, and the verification page is the authority while the image never is (GS-102, GS-156).
2. **Every card carries its as-of trading day and the simulated-environment disclosure** (DG-17, constitution section 6). A card cropped to remove them is a card somebody edited, and the verify code is what settles that.

---

## 10. Open questions for the founder

**OQ-DS-01. Is the brass accent right?** It is the one choice here that is aesthetic rather than derived. The argument is that green, red, and amber are already spoken for by money semantics, and brass is semantically empty, institutional, and absent from SaaS templates. The alternative worth considering is a **cool signal blue at a value dark enough not to read as Tailwind's default**, which is safer and closer to the category norm, and being closer to the category norm is exactly what Appendix F is written against. Recommendation: **brass**, and it is cheap to change now and expensive after the certificates ship.

**OQ-DS-02. Two semantic colors or three?** Section 1.2 removes the warning color deliberately and it is a real constraint that a designer will push back on the first time a genuinely urgent non-negative state appears. Proposed: **hold at two**, and treat the first case that seems to need a third as evidence that the state is being over-dramatized rather than under-colored.

**OQ-DS-03. Does the marketing site ship dark-first or light-first?** The tokens support both and the portal is dark-first, because a trader is looking at it during a session next to a chart. The site's default is the question. Proposed: **light-first for the site, dark-first for the portal and admin**, which is a deliberate seam rather than an inconsistency, and it matches when each surface is actually read.
