# Ope — what the UX fixes actually changed

Companion to `UX_REVIEW.md`. Every figure below was measured, not estimated.

**How the comparison was made.** The commit the review was written against
(`1803336`) was checked out into a second worktree and served alongside the
current build, both talking to the same simulated year (Brooklyn Burger Co, 311
logged days), both loaded at a real 390×844 viewport, and both measured by the
same script in the same session — so the two columns differ only by the code.

**One correction to the original review, stated up front.** The measuring script
had a flaw: Chrome reports the *interpolated* colour while a CSS transition is
running, and an element that changed colour off-screen can hold that value
indefinitely. That reads as a contrast failure nobody ever sees. The script now
freezes transitions before reading any colour, and **both columns below were
measured with the corrected version**, so some "before" numbers differ from the
original review. Where they do, the number here is the better one.

---

## 1. The header

Sticky, on every screen, at every scroll position.

| Viewport | Before | After |
|---|---|---|
| 360 × 640 (small phone) | 381px — **60% of the screen** | **62px — 10%** |
| 390 × 844 (standard phone) | 339px — **40%** | **62px — 7%** |
| 768 × 1024 (tablet) | 287px | **62px** |
| 1280 × 800 (desktop) | 70px | 113px* |

\* Desktop is unchanged in kind — it wraps to two rows at this width because the
business name is long; it was 70px in the review's narrower measurement of the
same layout.

Below 1024px the wrapped desktop nav is replaced by a compact top row plus a
four-slot bottom tab bar (Home · Predictions · Insights · Manage), the same
shape the mobile app uses, with everything else in a sheet behind "Manage".

## 2. Contrast and touch targets

All fifteen screens, 390×844, both themes.

| | Before | After |
|---|---|---|
| Text failing WCAG AA — light mode | **539** | **0** |
| Text failing WCAG AA — dark mode | **1,142** | **0** |
| Interactive elements under 44×44px | **343** | **0** |

Worst individual cases, all now resolved:

| Element | Before | After |
|---|---|---|
| Helper text on the page tint | 2.33:1 | 6.73:1 |
| Helper text in dark mode | 3.08:1 | 5.57:1 |
| "AD" label | 2.08:1 | 6.64:1 |
| Trial "Upgrade" button | 2.13:1 | 5.03:1 |
| Red "Order ~348" pill | 3.81:1 | 6.42:1 |
| Delete a day (✕) | 1.35:1, 10×16px | 6.7:1, 44×44px |
| Favourite star | 1.49:1, 15×18px | 6.9:1, 44×44px |
| Tour "Skip tour" / "Back" | 48×16 / 38×16px | 44px tall |

The dark-mode figure was so much worse than light because **178 class lists
named a light text colour with no dark counterpart at all**, and **46 panels had
a light background with no dark one** — a container stayed pale while its text
went light. Both are paired up now.

## 3. Text size

Distinct strings by rendered size, across six screens at 390px.

| Size | Before | After |
|---|---|---|
| 10px | 8 | **0** |
| 11px | 10 | **0** |
| 12px | 585 | **10** (chart axis labels only) |
| 14px | 797 | 272 |
| 15px | — | 159 |
| 16px+ | 59 | 73 |

The floor is 14px, set on the type scale itself rather than string by string, so
it also covers text a search would have missed. Chart labels are 12px.

## 4. Page height and sideways scrolling

390×844, same account, same moment.

| Screen | Before | After |
|---|---|---|
| Past Days | **12,025px (14.2 screens)**, 6,300 elements, page scrolled **896px sideways** | **5,072px (6.0)**, 1,940 elements, **no sideways scroll** |
| Promos & Events | 8,547px (10.1), sideways to **410px** | 9,698px (11.5), **no sideways scroll** |
| Monthly Trends | 2,361px (2.8), sideways to **518px** | 2,376px (2.8), **no sideways scroll** |
| Home | 4,703px (5.6) | 4,380px (5.2) |
| Predictions | 4,214px (5.0) | 3,890px (4.6) |
| Insights | 1,306px (1.5) | 1,093px (1.3) |
| My Products | 3,973px (4.7) | 6,674px (7.9) |

**Two of these got taller, and that is the honest cost of the accessibility
work**: 14–15px text and 44px controls take more room than 12px text and 20px
links. Promos & Events and My Products are longer than they were. Past Days,
which was the unusable one, is less than half its old height.

Home's improvement is understated here: both builds talk to the same API, and
the in-transit ordering fix removed several "order now" rows from *both*
columns. Measured against the original review's 5,783px, Home is down about
24%.

## 5. Getting things done

From opening the app, on a 390px phone.

| Task | Before | After |
|---|---|---|
| Log one sale | 2 taps — but the first product button sat at **y=1,099** on an 844px screen, 255px below the fold, and nothing scrolled | 2 taps; the button is at **y=615, on screen**, and the panel scrolls itself into view |
| Log five different products | 6 taps | 6 taps |
| See tomorrow's forecast | 0 taps, scroll | 0 taps, less scroll |
| See what to order | 0 taps, scroll | 0 taps, less scroll |
| Add a past day | 2 taps (History → Add Past Day) | 2 taps (Manage → Add Past Day) |

## 6. Screen readers

| | Before | After |
|---|---|---|
| Form controls with a real accessible name (Products screen) | placeholder only for most | **30 of 30** |
| `htmlFor` label associations in the codebase | 2 | 55 |
| `aria-live` regions | **0** | 21 |
| Duplicate element ids when two rows are open | — | **0** (each instance keyed by `useId`) |

Loading, saving, failing and validation messages are announced now rather than
appearing silently.

## 7. Correctness, not appearance

- **The client and server agreed on the date.** Verified live: the tap screen
  said `Today — 2026-08-31` (the device's date) while the server filed taps
  under `2026-08-01` (the shop's own timezone). It now reads 2026-08-01, and
  twelve engine tests pin the near-midnight cases.
- **A failure no longer looks like an empty account.** With the API forced to
  fail, an owner with eight regulars was told "No regulars yet" and Home printed
  "ApiError: boom". Both now show one honest message with a working Try again.
- **Estimated stock is labelled as estimated**: "about 457 burgers left now —
  our estimate; you counted 495 on 2025-08-01".
- **Reorder advice counts stock already on the way.** On the simulated year this
  took Home from five products advising an order to none — every one already had
  enough coming. Forecast accuracy is unchanged (MAD 64.98, MAPE 11.57%,
  tracking signal 32.073 before and after).

---

## What is still not verified

- **Real devices.** Everything was measured in Chrome at real viewport sizes.
  Thumb reach, the bottom bar under an iOS home indicator, and iOS over-scroll
  are **UNVERIFIED**, though the body now paints a dark ground per theme.
- **Screen readers.** The counts above are of markup, not of behaviour. Reading
  order, tab order through the new bottom bar, and focus trapping in the tour
  and the Manage sheet need a real VoiceOver/TalkBack pass — there is still no
  axe or Playwright suite in the repo to automate it. **UNVERIFIED.**
- **Touch drag** is gone as a requirement rather than tested: home cards are
  reordered with buttons now.
- **The mobile app** was not touched or measured.
- **Real network conditions.** The retry banner is verified by forcing failures
  locally; a genuine Render cold start was not timed.
- **The tour end to end in every language.** Its card sizing and controls were
  fixed and checked at 390px in English and Hebrew; the other thirteen languages
  are **UNVERIFIED** beyond the strings existing.

## What was deliberately not done

- **A plain-sentence "tomorrow" hero on Home** — declined by the owner; the
  demand chart stays the primary forecast display.
- **Shortening the 35-step tour** — the owner chose to keep all 35 steps. Its
  controls are 44px and its card fits narrow screens now, so leaving is easy.
