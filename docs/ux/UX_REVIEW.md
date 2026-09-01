# Ope — UX evaluation

**Date:** 2026-09-01 · **Scope:** web app only (mobile app not evaluated) · **Nothing was changed.** This is a
findings document.

Every finding is tagged:

- **MEASURED** — something I actually checked, with the number and how I got it.
- **JUDGED** — my reasoned opinion, walking the app as a persona. Opinion, not evidence.
- **UNVERIFIED** — something I suspect but could not check here.

---

## 0. How this was tested (so you can trust or discount the numbers)

I ran the real app against two real accounts:

| Account | How | What it holds |
|---|---|---|
| **Fresh account** | New empty database on a second backend (`serve_fresh.py`, port 8001) | Nothing. Signed up from scratch as a new owner. |
| **Year-long account** | The existing simulation database (`python -m tests.simulation.serve_sim`) | Brooklyn Burger Co — 311 logged days, 2025-08-01 → 2026-07-31, 11 products, 8 regulars, 20 promos/events |

The web app was the real dev build. Screen sizes were real viewports (the app was loaded in a
frame sized exactly 360×640, 390×844, 768×1024, 1280×800 and 1440×900), not a desktop window
squeezed by eye. Both themes, and English, Hebrew, Arabic and German were all exercised.

Measurements (touch-target sizes, WCAG contrast ratios including opacity and modern `oklch`
colours, font sizes, page heights, element counts, sideways-overflow) came from a script run
inside the live page on each screen. Contrast is computed against the real composited background.

**Two caveats on my own numbers.** (1) Load timings were taken against a local backend with no
network — treat them as relative, not as what a real user on Render will see. (2) One capture
(`360×640 home`) was taken slightly before the page finished loading, so its element counts are
lower than reality; its header measurement is still valid.

---

## 1. Top 10 problems

Ranked by severity × how many people hit them.

### 1. On a phone, the navigation bar eats 40–60% of the screen — permanently

**MEASURED.** The header is `position: sticky` and is **339px tall on a 390×844 phone** and
**381px tall on a 360×640 phone**. It stays pinned while you scroll: after scrolling 1,400px down
the home page, the header still occupied the top 339px. That is 40% of a standard phone screen and
**60% of a small phone screen**, gone, on every screen, at all times.

It only collapses to a normal bar on desktop:

| Width | Header height |
|---|---|
| 360px | 381px |
| 390px | 339px |
| 768px (tablet) | 287px |
| 900px | 242px |
| 1024px | 154px |
| 1100px | 110px |
| 1280px+ | 70px |

The cause is that the desktop nav simply wraps — there is no phone navigation (no hamburger, no
bottom bar). On the fresh account the header is followed by a 97px trial banner, so **the first
content on a new owner's phone starts at y=392 — 46% of the screen used before anything begins.**

**Who hits it:** everyone on a phone. Personas 1, 2, 4, 6.
**Suggested fix:** a real mobile nav — collapse to a logo + hamburger (or the 4-tab bottom bar the
spec already designed for the mobile app) below ~1024px. This one change fixes a large share of the
scrolling problems below.

### 2. The busy owner can't reach the tap buttons without scrolling

**MEASURED.** From home, tapping "Record a Sale" expands the tap panel — but the first product
button sits at **y = 1,099px on an 844px-tall phone screen**, 255px below the fold, and **the page
does not scroll to it** (scroll position stayed at 0 after expanding). The buttons themselves are
good (108×123px, 12px apart); you just can't see them.

Also **MEASURED:** the quick-action row itself ("Record a Sale / Log Today / Record a Regular")
starts at y = 648 of an 844px screen — in the bottom quarter — with the fixed 56px ad bar
overlapping its last 31px. The spec says quick actions should be the most prominent thing at the
very top.

**Who hits it:** persona 2 (mid-rush) every single time; this is the app's most frequent action.
**Suggested fix:** scroll the tap panel into view when it opens (or make "Record a Sale" open a
full-screen tap sheet). Move the quick-action row above the "New to forecasting terms?" card.

### 3. The app and the server disagree about what day it is

**MEASURED.** The backend answers `/sale-events/today` with **`{"date": "2026-08-01", "timezone":
"America/New_York"}`** — it correctly uses the business's own timezone. At the same moment, the tap
screen's heading read **"Today — 2026-08-31"**, because the frontend computes the date from the
browser.

In the code, **16 places compute "today" from the device clock**, and six of them use
`new Date().toISOString().slice(0, 10)`, which is **UTC**, not even the device's local date
(`ForecastDashboard.tsx:577`, `MergedForecastPanel.tsx:71,88`, `ProductForecastPanel.tsx:104`,
`ProductStatusPanel.tsx:119`, `BookedCountsPanel.tsx:7`). The entry-timing rules use
`new Date().getHours()` — the device's hour, not the shop's.

Real consequences: a New York café at 8pm is already "tomorrow" in UTC; an Israeli owner at 1am is
still "yesterday". "Ordered today", "log today", and the after-closing-time rules can all land on
the wrong day, silently.

**Who hits it:** every owner not sitting in UTC — i.e. nearly all of them — some of the time.
**Suggested fix:** have the backend return the business's today/now (it already computes it in
`app/clock.py`) and use that everywhere instead of `new Date()`.

### 4. Errors are shown as "you have no data"

**MEASURED.** I forced the API to return 500 and walked the app with the year-long account loaded:

| Screen | What the owner is told |
|---|---|
| My Regulars | "**No regulars yet** — Add your loyal customers to track how valuable they are over time." (they have 8) |
| Home — forecast | "**Keep logging days to see your forecast.**" (they have 311 days) |
| Home — ordering | "**ApiError: boom**" — the raw server error string |
| Home — busy hours | "Couldn't load hourly data — **is the backend running?**" |
| Insights | "Couldn't load insights — **is the backend running?**" |

Three separate failures: an outage is displayed as an empty account; raw error text reaches the
user; and the wording that isn't raw is developer-speak. A non-technical owner seeing "No regulars
yet" concludes their data is gone.

**MEASURED, related:** on a *network* failure the client retries 6 times at 8-second intervals
(`client.ts`: `RETRY_MAX = 6`, `RETRY_DELAY_MS = 8_000`). I confirmed the screen just sits on
"Loading insights…". The friendly "Waking up…" message exists but only covers the initial
business load, not per-screen loads — so the owner watches a spinner for up to ~48 seconds with no
explanation.

**Who hits it:** everyone, whenever Render is cold or the connection drops — which on a free tier
is often.
**Suggested fix:** one honest error state — "We couldn't reach Ope just now. Your data is safe. Try
again" + a Try again button — never an empty-state, never a raw exception. Show the "waking up"
message on any screen that is retrying.

### 5. The most important card on the phone renders one word per line

**MEASURED.** In "What to order now", each product row is a `flex … justify-between`: the text
column is squeezed to **96px** while the "Order ~348 burgers" pill takes 136px. The result on a
390px phone is that "~166 burgers a day · takes ~2 days · 457 burgers in stock" wraps to roughly ten
lines, one word each ("days / . / 54.62 / kg / in / stock").

This is the main reason the home page is **5,783px tall — 6.9 phone screens** with a year of data
(Predictions: 6.3 screens).

**Who hits it:** every phone owner with more than a couple of products. Persona 4 worst.
**Suggested fix:** on narrow screens stack the row (details above, order pill below full-width)
instead of side-by-side.

### 6. "Busiest at 1 pm–2 pm: 12 people" — the headline number is ambiguous, and contradicts the line under it

**MEASURED.** The Predictions/home hero banner renders, in 2xl bold:

> **Busiest at 12 pm–1 pm: 12 people**
> ~72 customers/hr at peak

"12 people" is the *staffing recommendation*; nothing says so. Read plainly, it says twelve
customers will come at the busiest hour, and the small line directly beneath says seventy-two.
Two contradictory numbers, in the most prominent element of the screen.

**JUDGED:** every persona misreads this; the skeptic (5) concludes the app is broken.
**Suggested fix:** "Your busiest hour tomorrow is 12–1pm — about 72 customers. You'd need about 12
people on to keep the wait under 6 minutes."

### 7. The app never says, in words, how busy tomorrow will be

**MEASURED.** The slogan is "Know Tomorrow, Today." The only tomorrow-specific words anywhere on
home are the busy-hours banner. The "Demand forecast" card is a chart, a 12-button series picker
(Customers + 11 products), and one caveat sentence — no number. To answer "how busy is tomorrow?"
the owner must read a bar off an axis.

**JUDGED:** for persona 1, this is the whole product promise, and it's the one thing the home screen
doesn't say. A single sentence — "Tomorrow (Wednesday) looks like about 620 customers, usually
between 540 and 700" — would deliver more value than the chart does.

### 8. Text is small and low-contrast, systematically, in both themes

**MEASURED.** The same two style tokens fail across the whole app:

| Where | Colour on background | Size | Ratio | AA needs |
|---|---|---|---|---|
| Helper text everywhere (light) | `#94a3b8` on `#e8f4f1` | 12px | **2.33:1** | 4.5:1 |
| Helper text on cards (light) | `#94a3b8` on `#ffffff` | 12px | **2.63:1** | 4.5:1 |
| Helper text (dark mode) | `#64748b` on `#253347` | 12px | **2.69:1** | 4.5:1 |
| Body helper (dark mode) | `#64748b` on `#1d293b` | 12px | **3.07:1** | 4.5:1 |
| Slogan under logo | `#3a8c87` on `#c4e0dc` | 12px | **2.85:1** | 4.5:1 |
| "AD" label | `#72b5af` on `#e8f4f1` | 10px | **2.08:1** | 4.5:1 |
| "Upgrade" button | white on `#fe9a00` | 12px | **2.13:1** | 4.5:1 |
| "Order ~348 burgers" pill | white on `#fb2c36` | 12px | **3.81:1** | 4.5:1 |
| Delete "✕" in Past Days | `#cbd5e1` on `#e8f4f1` | 12px | **~1.35:1** | 4.5:1 |
| "Edit" in Past Days | `#3a8c87` on `#e8f4f1` | 12px | **~3.4:1** | 4.5:1 |

Failure counts per screen are in §3. Home alone has **51 failing text elements** in light mode and
**42** in dark.

**MEASURED, text size:** across the screens audited, **724 distinct strings render at 12px and 631
at 14px on a phone**; chart axis labels are **10–11px**; the "AD" labels are 10px. iOS/Android
guidance for body text is ~16px.

**Who hits it:** persona 6 (glare, tired eyes, older vision) always; everyone else in bright light.
**Suggested fix:** raise helper text to 14px minimum and darken the token to at least `#64748b` on
light / `#94a3b8` on dark; make chart labels 12px.

### 9. Touch targets — including destructive ones — are far below the minimum

**MEASURED** (iOS guidance 44×44px, Android 48×48dp):

| Control | Rendered size | Where |
|---|---|---|
| Delete a whole day "✕" | **10 × 16 px** | Past Days (×311 rows) |
| "Edit" a day | **20 × 16 px** | Past Days |
| Favourite star "★" | 15 × 18 px | Products, Regulars |
| Tour "Skip tour" / "← Back" / "Skip [section]" | **~48 × 16 / 38 × 16 / 67 × 16 px** | the whole guided tour |
| "Cancel order" | 67 × 16 px | Home, Predictions |
| "Mark arrived" | 84 × 22 px | Home, Predictions, Product Status |
| Settings gear / dark-mode toggle | 32 × 32 px | header, every screen |
| "Upgrade" | 71 × 28 px | trial banner |
| "Not now" (simple-language card) | 46 × 16 px | home |
| Open-day chips (Mon…Sun) | 41–55 × 34 px | onboarding, settings |

45 of 55 interactive elements on the home screen are under 44px in at least one dimension.
The worst case is the **10px-wide, near-invisible ✕ that deletes a day's data** — it's `text-slate-300`
and only turns red on hover, and phones have no hover (`DayList.tsx:249-255`). It does ask for
confirmation, which is the only thing saving it.

**Who hits it:** personas 2 and 6 hardest; everyone on a phone.

### 10. Past Days becomes unusable with a year of data

**MEASURED,** year-long account on a 390px phone:

- **12,025px tall — 14.2 phone screens**, 6,250 DOM nodes, 633 interactive elements.
- **The page itself scrolls sideways to 896px** (a 14-column table on a 390px screen), so the whole
  layout — header included — slides left and right.
- **311 rows are all rendered at once.** There is no pagination, no search, no date filter, no
  month grouping — the only control on the screen is the language selector.
- 342 failing-contrast text elements (the same small grey per row, multiplied by 311).

**Who hits it:** persona 4, and every owner eventually. It gets worse every day the app is used.
**Suggested fix:** default to the last 30 days with a month picker; put the table in its own
horizontally-scrolling container so the page doesn't move; on phones show a card per day rather
than a 14-column table.

---

## 2. Full findings by screen

### Sign-up and onboarding (fresh account)

- **MEASURED — steps to first value: 3 screens, 6 required decisions, and then nothing to see.**
  Business name → open days + hours + currency → products → "You're ready!". After that the home
  screen honestly reports: "Need at least 14 days of data for ordering recommendations (0 so far)",
  "Need at least 2 logged days before Ope can estimate anything (0 so far)", "hourly patterns appear
  after 7 days of data". **JUDGED:** the honesty is right and the wording is good, but day one
  delivers zero output. That is the single biggest retention risk and nothing in the product tries
  to bridge it (no sample data, no "here's what this will look like" preview).
- **MEASURED — the upsell appears before the owner has entered anything.** On the very first
  onboarding step, a 97px amber banner reads "Your free trial ends in 29 days — upgrade to keep
  premium features" with an orange "Upgrade" button. **JUDGED:** on a 390px phone it is the most
  visually saturated element on the screen, above the setup wizard, on a business with no data in
  it. It reads as nagging on minute one and works against the calm, low-saturation design language.
- **MEASURED — step 2 sends you away and gives you no way back.** "Go to My Products →" navigates to
  the Products screen; that screen contains **zero elements referencing the setup flow**. The wizard
  does remember you visited (localStorage) and resumes at step 3 when you press Home, but the owner
  has to guess that. **JUDGED:** a stranded new user is very likely here.
- **MEASURED — the currency picker is a 160-option native `<select>`** with a "Choose a currency…"
  placeholder, and the guess is shown with the honest note "We have guessed this from your device —
  change it if it's wrong" (2.63:1 contrast, 12px). Good behaviour, unreadable text.
- **JUDGED — wording throughout onboarding is genuinely good.** "Select only the days you're
  actually open — days you don't pick are completely skipped by the forecast and never counted as
  zero" is exactly the right register.
- **MEASURED — the disabled "Get started" button** renders at 2.55:1 (white on teal at 60% opacity).
  Disabled controls are exempt from WCAG, but it is hard to see that it *is* a button.

### Guided tour

- **MEASURED — 35 steps across 9 sections** (counted from `GuidedTour.tsx`: 1 + 2 + 3 + 3 + 6 + 4 +
  5 + 10 + 1). I walked it end to end on the fresh account. **JUDGED:** far too long for the
  audience. The Settings section alone is 10 steps. Most first-day owners will hit "Skip tour",
  which means they see none of it.
- **MEASURED — the tour's own controls are 16px tall** ("Skip tour" 48×16, "← Back" 38×16,
  "Skip Insights" 67×16). Only "Next" (86×36) is reachable. **JUDGED:** the escape hatch is the
  hardest thing on the screen to hit — the opposite of what it should be.
- **Good, verified:** the "Skip [section]" button really is named after the section ("Skip Insights",
  "Skip Manage"); the language switcher is on the tour card itself and works; dark mode and simple
  language are offered near the start; it auto-launches for new users and is replayable from
  Settings ("שחזר סיור" in Hebrew).
- **MEASURED — bidi bug in Hebrew:** the welcome title renders as "**!ברוכים הבאים ל-Ope**" — the
  exclamation mark jumps to the left-hand (start) side because the string ends with Latin text.
  Needs a directional mark.
- **MEASURED — the popover is a fixed 340px wide** (`POP_W = 340`) and is clamped with
  `Math.max(10, Math.min(popLeft, vpW - POP_W - 10))`. At 360px it just fits; **below ~360px it
  overflows the right edge**. Its position also assumes a ~280px tall card; longer translated text
  can push it past the bottom with no internal scroll. **UNVERIFIED** on a 320px device.
- **MEASURED — tour promises something the data can't deliver:** the year-over-year step says "Once
  you have a year…", but with exactly 12 months logged the Insights screen still shows no
  year-over-year (`yoy_growth_pct: null` — it needs two years).

### Home

- Findings 1, 2, 5, 6, 7, 8, 9 above all land here.
- **MEASURED — vertical order on a 390px phone (year account):** header 0–339, page title 371,
  "New to forecasting terms?" card 423, quick actions 648, "What to order now" 852, demand forecast
  1057, busy hours 1195, peak-hours-by-day 2787. **JUDGED:** a dismissible promo for a settings
  toggle sits above the three actions the product exists for.
- **MEASURED — "10 needs ordering"** is the badge text on the demand-forecast card. Ungrammatical.
- **MEASURED — the forecast card's series picker is one button per product** (12 today, 34px tall).
  **JUDGED:** at the 30-product shop the spec anticipates, this becomes a wall of small buttons.
- **MEASURED — home customisation cannot work on a phone.** The reorder handles use HTML5
  `draggable` + `onDragStart`/`onDrop` only (`HomeScreen.tsx:523-524`), with no touch or pointer
  fallback, while the panel instructs "Toggle cards on/off and **drag to reorder**". HTML5
  drag-and-drop is not implemented by mobile browsers. **UNVERIFIED** on a physical device, but the
  code has no touch path at all. The on/off toggles do work, and "Add to home" correctly flips to
  "Remove from home" (verified).
- **MEASURED — dark mode never repaints the page background.** `index.css` sets
  `body { background: var(--color-teal-50) }` (a light mint) and nothing overrides it for dark; the
  dark surface comes from an inner `min-h-screen` container. **UNVERIFIED:** on iOS this should show
  as a bright mint band when the page is over-scrolled ("rubber-banding").

### Predictions / What to order

- **MEASURED — a projection is labelled as fact.** The card says "Soft Drink · ~290 cups a day ·
  takes ~4 days · **393 cups in stock**". The API's `current_stock` for that product is **1,375**;
  393 is `projected_stock`. The code renders `projected_stock ?? current_stock` under the label
  `{qty} in stock` (`MergedForecastPanel.tsx:74`, `ForecastDashboard.tsx:370`,
  `ProductStatusPanel.tsx:179`). **JUDGED:** telling an owner they have 393 when the app's own
  record says 1,375 is the fastest way to lose a skeptic.
- **MEASURED — the numbers on one card don't visibly reconcile.** Soft Drink shows "393 in stock",
  then "In transit: 1,642 arriving 08-03", "In transit: 1,319 arriving 08-02", then "Order ~2,107".
  The maths may well be right (in-transit outside the lead-time window), but nothing on screen
  explains it, and it reads as "order 2,107 more of the 2,961 already coming".
- **MEASURED — a broken label appears on two screens.** Products near the reorder point show the
  badge "⚠ Order more when you drop below" with no number — the code reuses the
  `reorderWhenBelow` string, which expects a value appended, as a standalone badge
  (`ForecastDashboard.tsx:430`, `ProductStatusPanel.tsx:187`). It should read something like
  "Getting low".
- **MEASURED — grammar:** "takes ~1 days".
- **MEASURED — the prediction range is 28–62% wide.** For the next six days: 31%, 28%, 39%, 28%,
  35%, and **62%** (Sunday: predicted 479, range 362–661). The spec asks for the *probable* band,
  not the possible one. The caption is honest and well-written ("Expect to land in this range about
  4 days out of 5 — it's a likely range, not a promise") but a ±30% band doesn't help anyone order.
- **MEASURED — staffing advice is technically true and practically useless:** "Adding a 13th person
  cuts the wait from 2 min to 1 min." **JUDGED:** advice to hire when the wait is already 2 minutes
  should not be shown at all.

### Insights

- **MEASURED — 1,306px, 1.5 phone screens, 6 items, from 311 days of data.** The whole screen is:
  days/months logged, "typically accurate to within 10.0% / currently ~10.6%", two weekday trends,
  "All your regulars are active. Great!", and "Monday busiest · Peak 12–1pm".
- **MEASURED — the API is returning empty for the parts that matter:** `seasonal_alerts: []`,
  `declining_regulars: []`, `yoy_growth_pct: null`. **JUDGED:** this is the screen the spec calls a
  moat feature, and with a full year of real patterns it produces two sentences of change-detection.
- **MEASURED — accuracy is going backwards and the screen doesn't say so.** `accuracy_early_mape:
  9.6`, `accuracy_recent_mape: 10.6`, `accuracy_improved: false`. **JUDGED:** the "it gets better as
  you teach it" retention story isn't true for this account, and showing "typically accurate to
  within 10.0%" immediately above "currently at ~10.6% average error" reads as two numbers for the
  same thing.
- **MEASURED — three screens disagree about the same facts.** Insights: "311 days logged" and
  "accurate to within 10.0%". Monthly Trends: "Total days logged **309**". Prediction history:
  "Average error **11.57%**".

### Prediction history ("How our predictions did")

- **MEASURED — jargon presented to the owner as an alert:** "Forecast is biased — model may need
  recalibration (|tracking signal| > 4)" and "Drift check · **32.073** · ±4 or more = worth a look".
  **JUDGED:** the app is telling the owner its forecast is badly biased (8× the threshold), in
  language they cannot act on, and offers nothing to do about it.
- **MEASURED — "Off by 64.98 customers, on average."** Customers are whole people; the spec's
  whole-unit rule is broken here (Monthly Trends likewise: "567.3 avg customers/day").

### Past Days

- Finding 10 above.
- **MEASURED — two different delete patterns in one app.** Past Days, Regulars, Recurring Patterns
  and Telegram use a native `window.confirm()` dialog; Products and Promos & Events use an inline
  "click again to confirm". Some confirms are bare — `confirm(t('removeBtn') + '?')` renders as
  "Remove?".
- **Good:** the one-step undo for an overwritten day exists ("↩ Undo … restore to previous").

### Add Past Day / Import

- **MEASURED — 1,444px, 21 undersized targets** (mostly the seven day chips at ~48×34).
- **JUDGED — the Import screen is the best-written screen in the app.** Plain, specific,
  reassuring: how dates are read, that the template's `#` row is skipped automatically, an Excel
  `=SUM(` tip, and how to add older history. Nothing to fix here.

### Products

- **MEASURED — 3,973px (4.7 screens), 48 undersized targets**, mostly the per-product "Edit" (45×28)
  and "Remove" (68×28) pairs, plus 15×18 favourite stars.
- **MEASURED — the same field is named two ways.** The form asks "How many days to restock?"; the
  product list shows "Days to arrive: 1d".
- **MEASURED — German breaks the layout.** On a 390px phone in German, the page scrolls sideways to
  **468px**, with 25 elements pushed outside the viewport. The cause is that `<main>` is a flex
  child with the default `min-width: auto`, so it cannot shrink below its widest German word.
  Hebrew and Arabic were clean on the same screen. The same mechanism produces the sideways scroll
  on Past Days (896px), Promos & Events (410px) and Monthly Trends (518px) in English.

### Product Status

- **Good:** the plain-language rewrite has landed — "In stock: 457 burgers", "Order more when below
  472 burgers", "Keep at least 139 burgers", "You're good". This is exactly the register the spec
  asks for, and status is carried by words, not colour alone.
- Inherits the "in stock" mislabel and the broken "⚠ Order more when you drop below" badge above.

### Regulars

- **Good:** profitability *is* surfaced — This month / This year / All time, plus a per-regular
  revenue chart. The spec's note that it's missing is out of date.
- **MEASURED — "CLV $5,772.00" sits directly above "All time $1,636.89".** **JUDGED:** an
  unexplained acronym, formatted like money, three times larger than the real figure beneath it. An
  owner will read $5,772 as earnings.
- **MEASURED — untranslated in Hebrew:** `CLV`, `×/week · $`, `/visit ·` all stay English on an
  otherwise fully-Hebrew screen.
- **MEASURED — 35 of 36 interactive elements under 44px.**

### Promos & Events

- **MEASURED — 8,547px, 10.1 phone screens** for 20 saved events, all rendered at once, with
  sideways overflow to 410px.
- **MEASURED — three names for one thing:** the screen is "Promos & Events", the button is "Save
  this period", the list is "Saved Periods". "Period" is app-invented vocabulary.
- **MEASURED — jargon:** "Cost ($) (optional — enables **ROI**)", "we'll keep it out of your normal
  **baseline**", "The **lift chart** will measure the effect on this specific **metric**".
- **MEASURED — cosmetic:** dates run into the cost with no separator — "7 Aug 2025 – 10 Aug
  2025cost: 400".
- **MEASURED — "event" leaks untranslated** into the Hebrew list as a type badge.

### Settings

- **Good:** clear, plain, well-explained; the gear is on the dashboard as intended; every option has
  a one-line explanation of what it does.
- **MEASURED — "Keep servers busy (default — 85% utilisation)".** **JUDGED:** "servers" reads as
  computers to a shop owner, and "utilisation" is a term of art. This is the single most technical
  string left in the app's main surface.
- **MEASURED — invalid HTML: a form inside a form.** The browser console reports the Feedback
  panel's `<form>` nested inside the Settings `<form>` (`BusinessSettings` → `FeedbackPanel`).
  **UNVERIFIED:** what a submit actually does in each nesting case — but nested forms are invalid
  and submit behaviour is not dependable.
- **MEASURED — Settings and the Premium page contradict each other.** Settings says "Your plan:
  **Premium** — unlimited history and ads/events"; the Premium & Billing page says "**FREE** — You
  are on the free plan." (The business record says premium; the subscription record says the trial
  expired.) **UNVERIFIED** whether real paying accounts hit the same split.

### Premium & Billing

- **Good:** the free/paid split is laid out clearly and honestly, including "Real payment coming
  soon — tap below to simulate a successful checkout (test mode)".
- **MEASURED — prices are hard-coded in shekels** ("₪30 / month", "₪300 / year") for a business
  whose currency is USD and whose every other figure is shown in dollars.

### Planning toolbox

- **Good:** the plain-language goal is met — "Which option is better?", "Get the most from my
  budget", "My action list", and an intro that says most owners won't need it. No jargon.
- **MEASURED — duplicated explanation:** the first tool carries two different one-line descriptions,
  one after the other.

---

## 3. Measurements

### Screen density and load

Year-long account unless noted. "Screens to scroll" = page height ÷ viewport height.

| Screen | Viewport | Page height | Screens | DOM nodes | Tap targets | Under 44px | Contrast fails | Sideways scroll |
|---|---|---|---|---|---|---|---|---|
| Home | 390×844 | 5,783px | 6.9 | 608 | 55 | 45 | 51 | no |
| Home (dark) | 390×844 | 5,783px | 6.9 | 657 | 55 | 45 | 42 | no |
| Home (Hebrew) | 390×844 | 5,604px | 6.6 | 648 | 55 | 45 | 58 | no |
| Predictions | 390×844 | 5,294px | 6.3 | 576 | 49 | 42 | 49 | no |
| Insights | 390×844 | 1,306px | 1.5 | 111 | 11 | 10 | 8 | no |
| Past Days | 390×844 | **12,025px** | **14.2** | **6,250** | 633 | 60 | 342 | **896px** |
| Add Past Day | 390×844 | 1,444px | 1.7 | 142 | 26 | 21 | 9 | no |
| Monthly Trends | 390×844 | 2,361px | 2.8 | 459 | 12 | 11 | 40 | **518px** |
| Import | 390×844 | 1,155px | 1.4 | 99 | 13 | 11 | 5 | no |
| My Products | 390×844 | 3,973px | 4.7 | 384 | 53 | 48 | 10 | no |
| My Products (German) | 390×844 | 3,813px | 4.5 | 397 | 53 | 30 | 10 | **468px** |
| Product Status | 390×844 | 2,868px | 3.4 | 248 | 21 | 20 | 2 | no |
| My Regulars | 390×844 | 2,121px | 2.5 | 211 | 36 | 35 | 13 | no |
| Recurring Patterns | 390×844 | 844px | 1.0 | 101 | 13 | 12 | 4 | no |
| Promos & Events | 390×844 | 8,547px | 10.1 | 679 | 40 | 38 | 19 | **410px** |
| Prediction history | 390×844 | 1,314px | 1.6 | 523 | 12 | 11 | 12 | no |
| Planning toolbox | 390×844 | 1,734px | 2.1 | 160 | 24 | 19 | 6 | no |
| Premium & Billing | 390×844 | 1,653px | 2.0 | 168 | 13 | 10 | 5 | no |
| Settings | 390×844 | 3,562px | 4.2 | 420 | 44 | 35 | 25 | no |
| Home (fresh account) | 390×844 | 1,963px | 2.3 | 143 | 20 | 16 | 7 | no |
| Home | 360×640 | 3,526px | 5.5 | 396* | 23* | 13* | 27* | no |
| Home | 768×1024 | 4,165px | 4.1 | 639 | 55 | 30 | 51 | no |
| Home | 1280×800 | 3,771px | 4.7 | 640 | 55 | 30 | 51 | no |
| Home | 1440×900 | 3,771px | 4.2 | 641 | 55 | 30 | 51 | no |

\* captured before the page finished loading — under-counts.

**Time until a screen stopped showing "Loading…"** (local backend, no network; includes ~0.4s of
harness delay — use these as relative figures only): Predictions 3.6s, Prediction history 2.5s,
Product Status 2.4s, Premium 2.2s, Toolbox 2.2s, Import 2.1s, Recurring 2.0s, Events 2.0s,
Trends 2.0s, Products 2.0s, Regulars 1.9s, Insights 1.6s, Past Days 1.5s, Add Past Day 1.5s.
**UNVERIFIED:** what these become on Render with a cold start — the client is built to wait up to
48 seconds for it.

### Tap counts (390px phone, year-long account, starting on Home)

| Task | Taps | Scrolling needed |
|---|---|---|
| Log one sale | **2** (Record a Sale → product) | ~1,100px down, not automatic |
| Log five different products | **6** | same, then all 12 buttons fit one screen |
| See tomorrow's forecast | **0** — but only as a chart | ~1,000px down; no number in words |
| See what to order | **0** | ~850px down |
| Add a past day | **2** (History → Add Past Day) | then a form |

### Touch targets under the 44×44px minimum

See finding 9. Across the audited screens, **45 of 55** interactive elements on Home, **48 of 53** on
Products, **35 of 36** on Regulars and **60+** on Past Days are under 44px in at least one dimension.
No pairs closer than 8px were found.

### Text sizes rendered on a phone

| Size | Distinct strings found | Examples |
|---|---|---|
| 10px | 35 | "AD", chart hour labels |
| 11px | 19 | chart axis labels |
| 12px | 724 | all helper text, badges, "Edit", "✕", "Cancel order" |
| 14px | 631 | nav items, most body copy |

### Colour independence

**MEASURED:** no place was found where colour alone carries meaning. Stock status is always worded
("Order now", "You're good", "⚠ …", "No stock tracked"); charts have text labels; success and error
messages carry text. The red order pill and amber warning tint are reinforcement, not the signal.
This one is genuinely fine.

### Localisation

**MEASURED.** I scanned every visible text node on each screen for Latin text while the app was in
Hebrew. Coverage is very good — Home, Settings, Predictions, Products and the toolbox came back
clean apart from the owner's own data, and **Recharts chart labels are translated** (weekday names
render in Hebrew). RTL mirroring is correct, including the tour's "←" pointing the right way for
Hebrew, and money formats as `5,772.00 $` under `he`.

Remaining leaks: `CLV`, `×/week · $`, `/visit ·` (Regulars); `min` (Products); `event` (Events
list); and the bidi exclamation mark in the tour title.

### Accessibility (basic pass — no axe/Playwright suite exists)

- **MEASURED — labels:** 79 form controls in the web app; **2 uses of `htmlFor`** and **4
  `aria-label`s** in total. On the Products form, the name / unit / lead-time inputs have no `id`,
  no `<label for>`, no `aria-label` and are not wrapped in a label — a screen reader has only the
  placeholder, which vanishes on typing. Radio buttons *are* wrapped in labels (good).
- **MEASURED — landmarks and live regions:** **no `role=` attributes and no `aria-live` regions
  anywhere** in the app. Loading, saving and error messages are not announced.
- **MEASURED — keyboard focus works, via the browser default.** Only 1 of 164 buttons defines its
  own focus style (78% of inputs do), but tabbing to "Log Today" showed a clear black ring, and
  `:focus-visible` matched. This is adequate today and fragile — one `outline: none` away from
  breaking.
- **UNVERIFIED:** screen-reader reading order, tab order through the wrapped mobile header, focus
  trapping in the tour and modals, and the touch-drag behaviour of home customisation. These need a
  real assistive-tech pass or an automated suite.

---

## 4. Plain-language problems (glossary)

| Currently says | Where | Suggested wording |
|---|---|---|
| "Busiest at 1 pm–2 pm: 12 people" | Home, Predictions hero | "Busiest 1–2pm: about 72 customers. You'd want ~12 people on." |
| "CLV $5,772.00" | Regulars | "Worth about $5,772 to you over time (estimate)" |
| "Forecast is biased — model may need recalibration (\|tracking signal\| > 4)" | Prediction history | "Ope has been guessing high (or low) for a while — it's adjusting." |
| "Drift check · 32.073 · ±4 or more = worth a look" | Prediction history | "Ope's guesses have drifted — worth checking whether something changed." |
| "Off by 64.98 customers, on average" | Prediction history | "Off by about 65 customers on a typical day" |
| "Keep servers busy (default — 85% utilisation)" | Settings | "Keep staff steadily busy (recommended)" |
| "Cost ($) (optional — enables ROI)" | Promos & Events | "What did it cost? (optional — lets us show what you got back)" |
| "keep it out of your normal baseline" | Promos & Events | "we won't let it skew your normal days" |
| "The lift chart will measure the effect on this specific metric" | Promos & Events | "We'll show what this did to that one number." |
| "Save this period" / "Saved Periods" vs "Promos & Events" | Promos & Events | Pick one word. "Save this promo" / "Your promos & events". |
| "⚠ Order more when you drop below" (no number) | Predictions, Product Status | "Getting low" |
| "How many days to restock?" vs "Days to arrive" | Products | Use one: "How many days until it arrives?" |
| "Proactive nudges" | Settings | "Heads-up messages" |
| "Couldn't load insights — is the backend running?" | error states | "We couldn't reach Ope just now. Your data is safe — try again." |
| "ApiError: boom" | error states | never show a raw error |
| "10 needs ordering" | Home chart badge | "10 products need ordering" |
| "takes ~1 days" | ordering rows | "takes about a day" |
| "393 cups in stock" (when it's a projection) | ordering rows | "About 393 left by then (you counted 1,375)" |

---

## 5. What I could not check

- **The mobile (Expo) app.** Not evaluated at all — web only.
- **Real devices.** Everything was measured in Chrome at real viewport sizes. Actual thumb reach,
  touch-drag on the home customiser, iOS over-scroll revealing the light body colour, and how the
  keyboard covers forms are all **UNVERIFIED**.
- **Screen readers.** No VoiceOver/TalkBack/NVDA pass, and no axe or Playwright suite exists in the
  repo to automate one. I could only measure the raw label/ARIA counts.
- **Real network conditions.** The backend was local. The 48-second retry behaviour is read from
  the code and confirmed by forcing a failure, but a genuine Render cold start was not timed.
- **Real payment and multi-location flows.** The billing provider is in test mode; I did not create
  a second location or run a checkout.
- **Telegram, CSV import with a real file, and the feedback email.** Not exercised end to end.
- **Whether the ordering maths is actually wrong.** I found that the *presentation* doesn't
  reconcile (393 "in stock" vs 2,961 in transit vs "order 2,107"). Diagnosing the engine was out of
  scope for a UX pass.
- **How this behaves for a business whose data is genuinely messy.** The year-long account is clean
  synthetic data. Real accounts will have gaps, zeros and typos; the "weird input" hardening in the
  spec was not stress-tested here.

---

## 6. Verdict

**Would a non-technical owner get value in their first session? Mostly no — and not because the
thinking is wrong.**

The product's judgement is good. The empty states are honest and specific ("Need at least 14 days of
data for ordering recommendations (0 so far)"). The ordering language has been genuinely rewritten
into plain English ("Order more when below 472 burgers", "Keep at least 139"). The import screen and
the planning toolbox are well-written. Hebrew and RTL are close to complete, charts included, which
is rare. Nothing depends on colour alone. Onboarding asks six sensible questions and no more.

What defeats it is the phone. **Ope is a desktop app that renders on a phone** — the navigation
takes 40–60% of the screen and stays there while you scroll; the tap buttons for the app's most
frequent action are 1,100px below the fold and don't scroll into view; the most important card wraps
one word per line; the home screen is seven phone-screens tall and Past Days is fourteen. The
audience is café owners with a phone in one hand. On day one, they will not find the thing they came
for.

**Would they come back on day two?** For a determined owner, yes — the value is real and the
honesty about needing two weeks of data is the right call. But three things will quietly cost you
people: an outage that says "No regulars yet" (they'll think their data vanished), an upgrade banner
that appears before they've entered anything, and the fact that after all the scrolling the app
never simply tells them, in words, how busy tomorrow will be. The slogan is "Know Tomorrow, Today";
the home screen makes you read it off a chart.

Fix the phone navigation, auto-scroll to the tap panel, stack the ordering rows, put one plain
sentence about tomorrow at the top of home, and make failures say "we couldn't reach Ope" instead of
"you have no data". Those five changes would move this from "a good tool that's hard to use on a
phone" to something a busy owner would actually keep open behind the counter.
