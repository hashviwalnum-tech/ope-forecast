# Ope — automated accessibility suite

Companion to `UX_FIXES_VERIFIED.md`, which ended with:

> Reading order, tab order through the new bottom bar, and focus trapping in the
> tour and the Manage sheet need a real VoiceOver/TalkBack pass — **there is
> still no axe or Playwright suite in the repo to automate it. UNVERIFIED.**

There is one now: `web/tests/a11y/`.

## What it is

- **Playwright + `@axe-core/playwright`**, added as `web/` dev dependencies.
- `npm run test:a11y` from `web/`. It starts everything it needs — see
  "Running it" below; nothing has to be running first.
  `npm run test:a11y:report` opens the HTML report.
- Two viewport projects: **phone 390×844** (bottom tab bar + Manage sheet) and
  **desktop 1280×800** (wrapped top nav with its dropdowns).
- **axe matrix**: 12 main screens × {light, dark} × {English, Hebrew}, run under
  each viewport — 96 scans — against WCAG 2.0/2.1 A + AA. A test fails on any
  **critical or serious** violation.
  Screens: Home, Forecast, Insights, Monthly Trends, Past Days, My Products,
  Product Status, Regulars, Promos & Events, Advanced Planning, Premium,
  Settings.
- A **second, non-failing scan** of axe's `best-practice` rules runs beside each
  WCAG scan. Those are house style, not conformance, and the suite does not fail
  on them — but recording them is what turns "we leave the landmark advisories
  alone" into a measured decision instead of a rule quietly filtered out.
- **Behavioural checks** for what axe cannot see:
  - bottom tab bar — DOM/tab order matches visual order, `aria-current` on the
    active tab, focus leaves the bar after its last button (no recycling trap),
    the whole page is keyboard-traversable with no focus loop;
  - Manage sheet — focus moves in on open, Escape closes, Tab stays inside the
    `aria-modal` panel;
  - guided tour — same three;
  - a real Settings save populates a `role="status"[aria-live]` region; a real
    invalid Products submit populates a `role="alert"`;
  - **every chart is paired with a screen-reader table** that actually contains
    digits, the chart itself is hidden from assistive technology, and the
    table's caption is translated rather than falling back to English.

Data comes from a business the global setup seeds through the API (~130 days of
history, products, regulars, a promotion), so the screens carry real content
rather than empty states.

## Running it

```bash
cd web
npm run test:a11y
```

That is the whole command. Playwright starts a backend on **port 8100** against
a fresh `backend/a11y.db`, starts Vite pointed at it, seeds, logs in once, and
reuses that session for every spec.

`web/.env.local` must carry `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
(the config fails with an explicit message if not). Email confirmation must be
**off** on the Supabase project.

**Nothing here touches production.** Port 8100 is deliberately not 8000, so the
suite can never reach a dev backend you have running, let alone the deployed
one, and the database file is deleted before every run.

Supabase auth is the one exception — there is no throwaway auth project, so the
suite signs in as **one fixed account** (`ope-a11y-suite@example.com`, override
with `A11Y_EMAIL` / `A11Y_PASSWORD`). It is created the first time it is ever
needed and signed into every run after. It used to sign up
`a11y+<timestamp>@example.com` each run, leaving another dead user in production
auth for ever; that no longer happens.

Findings land in `test-results/a11y-findings/*.json` — one file per scan, the
full violation list at every severity, WCAG and best-practice separately. That
directory is what to grep when asking "what did all 96 scans find". (It lives
under `test-results/`, not `playwright-report/`, because the HTML reporter wipes
its own folder when it writes — which is why `results.json` used to vanish too.)

## What the runs found, and what was fixed

### Serious / critical (all fixed)

| Rule | Where | Root cause | Fix |
|---|---|---|---|
| `color-contrast` (serious) | Header slogan "Know Tomorrow, Today.", **every screen, desktop only** | `text-teal-600` `#2c7470` on the teal-100 header = **3.91:1**. The element is `hidden` below `lg:`, so the 390 px pass that produced "0 contrast failures" never rendered it. | `text-teal-600` → `text-teal-700` |
| `select-name` (critical) | Settings — opening-hour and closing-hour `<select>` | No accessible name — only an adjacent `<span>`. | `aria-label` from the group label + "Opens"/"Closes" |
| `label` (critical) | Settings — three number inputs (avg service time, max wait, max queue) | Same: visual `<span>`, no association. | `aria-label` from the group label + unit |
| `scrollable-region-focusable` (serious) | Monthly Trends — month table wrapper, **phone, both languages** | `overflow-x-auto` box scrolls sideways at 390 px with no keyboard access. | `role="region"` + `aria-label` + `tabIndex={0}` (same applied to the Past Days and CSV-preview table wrappers) |
| `color-contrast` (serious) | Past Days — desktop table header, **dark mode only, both languages, 7 cells** | `<tr class="… text-slate-600 …">` with **no `dark:` variant** → `#45556c` on slate-900 = **2.35:1**. Lives in a `hidden sm:block` table, so 390 px never rendered it. | added `dark:text-slate-300` |
| `aria-hidden-focus` (serious) | Monthly Trends, both charts | Introduced by the chart work below: Recharts 3 defaults `accessibilityLayer` to true, putting `tabIndex={0}` and `role="application"` on the chart surface — so the new `aria-hidden` wrapper was hiding a focusable element. | `accessibilityLayer={false}` on every wrapped chart |

### Keyboard / focus

- **Bottom tab bar** — passed unchanged. Tab order follows the visual order,
  `aria-current="page"` marks the active tab, and focus exits the bar after the
  last button. No trap, no fix needed.
- **Manage sheet** — had focus-in and Escape, but **no Tab trap**: focus could
  Tab out to the page behind an `aria-modal` panel. Trap added.
- **Guided tour** — `role="dialog" aria-modal="true"` with **no focus
  management at all**. Focus-in on open, Escape to dismiss, and a Tab trap were
  all added.

### Charts — the gap axe cannot see

Recharts draws series values, axis ticks and legends as SVG `<path>` and
`<text>`. Markup can be perfectly valid and the chart still meaningless without
sight; axe does not judge chart meaning. The forecast chart is the product's
primary output, so this was a real hole, not a nicety.

Every chart in the app is now wrapped in `ChartFigure`, which hides the drawing
from assistive technology and renders the same rows as an `sr-only` `<table>`
with a caption. Both come from the same array, so they cannot drift apart.
Covered: week prediction, the switchable demand chart, per-product demand, busy
hours, prediction history, monthly customers, full customer history, regular
profitability, and regular visit frequency. The tap screen's hourly chart is
hidden *without* adding a table, because the visible `HourlyTable` directly
below it already carries every number — a second copy would just be read out
twice.

### Best-practice findings (recorded, then triaged)

The first best-practice scan reported 196 nodes. Fixed:

| Rule | Nodes | What it was | Fix |
|---|---|---|---|
| `landmark-unique` | 48 | The two side ad slots are both `<aside>` with no name — a screen reader's landmark list showed two identical "complementary" entries. | distinct `aria-label` on each |
| `region` | 48 of 136 | The bottom ad banner was a bare `<div>` outside every landmark. | made it an `<aside>` with a label (it *is* complementary content) |
| `heading-order` | 8 | Premium jumped `h1` → `h3`, leaving a hole in the heading list. | the two plan-column headings are `h2` |
| `empty-table-header` | 4 | Past Days' row-actions column had a blank `<th>`, announced as an unnamed column on every row. | `sr-only` "Actions" label |

**Deliberately left: the free-trial banner's `region` advisory (88 nodes, on
every screen where the banner shows).** It is a one-line page-level notice
sitting above `<main>` — exactly the app-shell chrome this rule is noisiest
about. Giving it its own landmark would add an entry to a screen reader's
landmark list for a single sentence, which is worse than the advisory. It is not
a WCAG failure. This is the **only** best-practice finding remaining.

### Found while investigating; fixed; not accessibility

- **A `<form>` nested inside another `<form>`** on Settings: `FeedbackPanel`'s
  form sat inside the settings form. Invalid HTML — the browser drops the inner
  one, so pressing Enter in the feedback box submitted the *settings* form
  instead of sending feedback. React warned about it on every render. The
  settings form now closes after its Save button.
- **The English `{s}` pluraliser leaked into 27 translated strings** in German,
  Hebrew and Turkish — none of which pluralise with an "s". They rendered
  literally: "29 Tags", "29 güns", and Hebrew's `יום{ים}`, which was not even a
  placeholder the code fills. All 27 now use a form correct for their language.
  (Spanish, Portuguese and French keep `{s}`, where it happens to be right.)
- The tap-screen chart's tooltip said `'taps'` in hardcoded English, and the
  three ad slots said `'Ad'`. Both go through i18n now, in all 15 languages.

## Current state

**96 axe scans — 12 screens × 2 themes × 2 languages × 2 viewports — report zero
WCAG A/AA violations at any severity** (critical, serious, moderate *and*
minor), plus the one best-practice advisory deliberately left above. All
behavioural tests pass. 114 tests in total.

## What this suite does NOT cover — still needs a real screen reader

axe verifies markup and computed properties, never what an assistive technology
narrates. An NVDA / JAWS / VoiceOver / TalkBack pass is still required for:

- whether the aria-live regions are actually **spoken**, at the right politeness,
  without clobbering one another or being dropped during fast updates;
- **browse / virtual-cursor reading order** versus visual order — especially RTL
  Hebrew;
- whether each AT honours `aria-modal` + the JS keydown trap, or needs `inert` /
  focus-guards on the background (the tour's spotlight overlay especially);
- **whether the new chart tables actually read well.** The suite proves each one
  exists, sits in the accessibility tree, and holds digits — it cannot tell you
  whether hearing "Monday, 92, 84 to 101" seven times over is a *useful* way to
  understand a forecast. That judgement needs a real user, not a checker;
- `aria-describedby` hint text being read together with its field;
- the `<html lang>` switch being announced.

Also still UNVERIFIED, and out of reach of this suite: real devices (thumb
reach, the iOS home indicator, over-scroll), real network / Render cold-start
timing, the guided tour in the other thirteen languages, and the mobile app.
