# YONDE — Brand Charter

**Summon your Japanese.** · Differentiator: *It learns how you learn* · 呼んで (summon) · 読んで (read)

The charter in five pages, plus a summary board and a pairings annex.
Rendered pages live in this folder; `make_charte_en.py` regenerates them.
Every value below is the product's own brand data (`src/lib/brand.js`,
`tailwind.config.js`, Doc 13) — nothing here is decorative invention.

| File | Page |
| --- | --- |
| `charte-0-board.png` | The board — the whole charter on one page |
| `charte-1-logos.png` | 1 · The Logos |
| `charte-2-palette.png` | 2 · The Palette |
| `charte-3-typography.png` | 3 · Typography |
| `charte-4-elements.png` | 4 · Graphic Elements |
| `charte-5-composition.png` | 5 · Composition |
| `charte-6-pairings.png` | Annex · The Good Pairings (contrast scores) |

## 1 · The Logos

Four versions, each with its place:

- **Wordmark alone** — "Yonde" set bold in the system typeface. Space is tight: headers, footers, app chrome.
- **Wordmark + slogan** — with "SUMMON YOUR JAPANESE". There is room to say what Yonde does: covers, first screens, print.
- **Wordmark + icon** — Koe beside the wordmark. The default signature: profiles, documents, partnerships.
- **Icon alone** — Koe, the Sensei mascot. The name is already known: avatars, the app icon, favicons, stickers.

**Black & white:** one-color printing, engraving, stamps, legal documents — the identity survives in pure black and white.
Never recolor the mascot, never outline the wordmark, never place the color logo on a busy photograph.

## 2 · The Palette

| Color | HEX | RGB | Role |
| --- | --- | --- | --- |
| Night | #0F1220 | 15 · 18 · 32 | The ground. Every surface starts here. |
| Panel | #1B1F36 | 27 · 31 · 54 | Cards and panels on the Night ground. |
| Coral | #FF6B57 | 255 · 107 · 87 | The one accent — the primary action, and Koe. |
| Ink | #F5F2EA | 245 · 242 · 234 | Text on dark grounds. |
| Mustard | #E5B83B | 229 · 184 · 59 | Tsuku, the Maker. |
| Plum | #71368A | 113 · 54 · 138 | Michi, the Coach — the family anchor. |

Fleet accents, one per agent: Koe #FF6B57 · Nao #58B368 · Saki #4FA8E0 · Tsuku #E5B83B · Hori #E07B39 · Michi #71368A.
The family outline is deep plum #2A1A33.

**Pairing rules** (contrast ratios computed, WCAG):

- DO — Ink text on Night (16.6) and on Panel (14.5): body text lives there.
- DO — Night text on Coral (6.6) and on Mustard (10.0): buttons and badges.
- DO — One accent per surface. A fleet color appears with its agent, nowhere else.
- NEVER — Mustard on Coral (1.5) or Ink on Mustard (1.7): unreadable at any size.
- NEVER — Coral text on Ink (2.5): Coral is a ground and an accent, not a text color on light.

## 3 · Typography

One typeface per script:

- **Latin** — the system stack: `system-ui · Segoe UI · Roboto`. Interface and print.
- **Japanese** — `Noto Sans JP · Hiragino Sans · Yu Gothic`. The same hierarchy, the same spacing.

| Level | Setting |
| --- | --- |
| Display | Bold · line height 1.1 · one per screen |
| Title | Bold · line height 1.15 · screen and card titles |
| Body | Regular · line height 1.5 · paragraphs |
| Caption | Regular · Slate on dark · labels and footers |

Spacing rules: titles breathe tight (1.1–1.2); body breathes open (1.5, always);
a new paragraph starts after a gap of three quarters of the body size, never an indent;
numbers are always tabular and never truncated — labels flex, digits do not.

## 4 · Graphic Elements

**Illustrations — the fleet.** Flat solid fills, one bold plum outline (#2A1A33),
no gradients, no shadows, no glow. The same art serves on dark and on light grounds; only the tile changes.

**Pictograms — the fleet kanji** （声 直 先 作 掘 道）. Rounded corners always, a bold even stroke,
one color per pictogram — its agent's color. Never mix two agents' colors in one mark.

**The motif — the fleet bar and the stroke strip.** The bar closes a composition at the bottom;
the stroke strip (a kanji, stroke by stroke, the current stroke in Coral) sits inside its card.
The motif lives at the edges: never behind text, never across a photograph, never stretched to fill a page.

## 5 · Composition

One model layout; every Yonde communication is a variation of it:

1. **The title comes first** — top-left, Display size, two lines at most.
2. **One Coral action** — exactly one Coral element: the button.
3. **The body stays quiet** — two or three lines under the title, Body size, line height 1.5.
4. **Proof, framed** — the product appears as a framed card: a real passage, a real card, never a decoration.
5. **The mascot serves** — bottom-right, clear of the text.
6. **The bar closes** — the fleet bar signs the bottom edge.

Duplicate this composition for every support — posts, pages, print. Same order, same calm.

---

*Charter v1 — November 2026. Source of truth for the values: `src/lib/brand.js` and `tailwind.config.js` in this repo; the fleet system is Doc 13.*
