# Ope — automated accessibility suite

Companion to `UX_FIXES_VERIFIED.md`, which ended with:

> Reading order, tab order through the new bottom bar, and focus trapping in the
> tour and the Manage sheet need a real VoiceOver/TalkBack pass — **there is
> still no axe or Playwright suite in the repo to automate it. UNVERIFIED.**

There is one now: `web/tests/a11y/`.

## What it is

- **Playwright + `@axe-core/playwright`**, added as `web/` dev dependencies.
- `npm run test:a11y` (from `web/`, against a local backend — see the suite
  README). `npm run test:a11y:report` opens the HTML report.
- Two viewport projects: **phone 390×844** (bottom tab bar + Manage sheet) and
  **desktop 1280×800** (wrapped top nav with its dropdowns).
- **axe matrix**: 12 main screens × {light, dark} × {English, Hebrew}, run under
  each viewport — 96 scans — against WCAG 2.0/2.1 A + AA. A test fails on any
  **critical or serious** violation; the full list at every severity is attached
  to the report.
  Screens: Home, Forecast, Insights, Monthly Trends, Past Days, My Products,
  Product Status, Regulars, Promos & Events, Advanced Planning, Premium,
  Settings.
- **Hand-written behavioural checks** (14 more tests):
  - bottom tab bar — DOM/tab order matches visual order, `aria-current` on the
    active tab, focus leaves the bar after its last button (no recycling trap),
    the whole page is keyboard-traversable with no focus loop;
  - Manage sheet — focus moves in on open, Escape closes, Tab stays inside the
    `aria-modal` panel;
  - guided tour — same three;
  - a real Settings save populates a `role="status"[aria-live]` region; a real
    invalid Products submit populates a `role="alert"`.

Data comes from a throwaway account the global setup seeds through the API
(~130 days of history, products, regulars, a promotion), so the screens carry
real content rather than empty states.

## What the first run found and what was fixed

All violations below were **serious or critical**, all found by the matrix, all
fixed. After the fixes the full matrix — 96 axe scans, 12 screens × 2 themes × 2
languages × 2 viewports — reports **zero violations at any severity** (critical,
serious, moderate *and* minor), and the 14 behavioural tests all pass.

| Rule | Where | Root cause | Fix |
|---|---|---|---|
| `color-contrast` (serious) | Header slogan "Know Tomorrow, Today.", **every screen, desktop only** | `text-teal-600` `#2c7470` on the teal-100 header = **3.91:1**. The element is `hidden` below `lg:`, so the 390 px pass that produced "0 contrast failures" never rendered it. | `text-teal-600` → `text-teal-700` |
| `select-name` (critical) | Settings — opening-hour and closing-hour `<select>` | No accessible name — only an adjacent `<span>`. | `aria-label` from the group label + "Opens"/"Closes" |
| `label` (critical) | Settings — three number inputs (avg service time, max wait, max queue) | Same: visual `<span>`, no association. | `aria-label` from the group label + unit |
| `scrollable-region-focusable` (serious) | Monthly Trends — month table wrapper, **phone, both languages** | `overflow-x-auto` box scrolls sideways at 390 px with no keyboard access. | `role="region"` + `aria-label` + `tabIndex={0}` (same applied to the Past Days and CSV-preview table wrappers) |
| `color-contrast` (serious) | Past Days — desktop table header, **dark mode only, both languages, 7 cells** | `<tr class="… text-slate-600 …">` with **no `dark:` variant** → `#45556c` on slate-900 = **2.35:1**. Lives in a `hidden sm:block` table, so 390 px never rendered it. | added `dark:text-slate-300` |

### Keyboard / focus

- **Bottom tab bar** — passed unchanged. Tab order follows the visual order,
  `aria-current="page"` marks the active tab, and focus exits the bar after the
  last button. No trap, no fix needed.
- **Manage sheet** — had focus-in and Escape, but **no Tab trap**: focus could
  Tab out to the page behind an `aria-modal` panel. Trap added.
- **Guided tour** — `role="dialog" aria-modal="true"` with **no focus
  management at all**: focus stayed on the page behind it, no Escape, no trap.
  Focus-in on open, Escape to dismiss, and a Tab trap were all added.

### aria-live

Verified behaviourally, not just by markup count: the suite performs a real save
and a real invalid submit and asserts the live region / alert actually receives
text. Both pass.

## What this suite does NOT cover — still needs a real screen reader

axe verifies markup and computed properties, never what an assistive technology
narrates. A NVDA / JAWS / VoiceOver / TalkBack pass is still required for:

- whether the aria-live regions are actually **spoken**, at the right politeness,
  without clobbering one another or being dropped during fast updates;
- **browse / virtual-cursor reading order** versus visual order — especially RTL
  Hebrew;
- whether each AT honours `aria-modal` + the JS keydown trap, or needs `inert` /
  focus-guards on the background (the tour's spotlight overlay especially);
- **Recharts charts** — the numbers in the SVGs on Forecast, Insights and
  Monthly Trends are almost certainly not perceivable without sight and likely
  need a table alternative; axe cannot judge chart meaning;
- `aria-describedby` hint text being read together with its field;
- the `<html lang>` switch being announced.

Also still UNVERIFIED, and out of reach of this suite: real devices (thumb
reach, the iOS home indicator, over-scroll), real network / Render cold-start
timing, the guided tour in the other thirteen languages, and the mobile app.
