# Accessibility suite

Automated a11y coverage for the web app: **axe-core** across the main screens in
both themes, English + Hebrew, at a phone (390x844) and a desktop (1280x800)
viewport, plus hand-written checks for the things the UX round asked to be
*verified working* rather than just present — focus order through the bottom tab
bar, no keyboard traps, modal focus containment, aria-live regions that actually
receive text, and a screen-reader table beside every chart.

Full write-up, including everything it found and what was deliberately left:
`docs/ux/A11Y_SUITE.md`.

## Running it

```bash
cd web
npm run test:a11y
npm run test:a11y:report   # open the HTML report
```

Nothing needs to be running first. Playwright starts its own backend on **port
8100** against a fresh `backend/a11y.db` (deleted before each run), starts Vite
pointed at it, seeds ~130 days of history / products / regulars / a promo
through the API, logs in once, and reuses that storage state for every spec.

Port 8100 is deliberately not 8000: the suite can never reach a dev backend you
happen to have running, let alone the deployed one.

**Required:** `web/.env.local` with `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` (the config fails with an explicit message otherwise),
and email confirmation **off** on the Supabase project.

**One fixed account, not a new one per run.** Auth still goes to the real
Supabase project — there is no throwaway one — so the suite signs in as
`ope-a11y-suite@example.com`, creating it only the first time it is ever needed.
Override with `A11Y_EMAIL` / `A11Y_PASSWORD`. It used to sign up
`a11y+<timestamp>@example.com` on every run, which left a dead user behind each
time.

## Reading the results

`test-results/a11y-findings/<project>-<screen>-<theme>-<lang>.json` — one file
per scan, holding the full violation list at every severity, with WCAG and
best-practice findings kept separate. Grep these rather than clicking through
the HTML report when the question is "what did all 96 scans find".

## What it checks

- `axe` matrix — 12 screens x {light,dark} x {en,he}, once per viewport project.
  Fails on any **critical** or **serious** WCAG A/AA violation.
- A second, **non-failing** scan of axe's `best-practice` rules, recorded to the
  findings files so what is being left alone is a number rather than a filtered
  rule.
- `bottom tab bar` — DOM/tab order matches visual order; `aria-current` on the
  active tab; Tab leaves the bar after its last button (no recycling trap); the
  whole page is traversable end to end without a focus loop.
- `Manage sheet` — opens with focus inside, Escape closes it, Tab stays within
  the `aria-modal` panel.
- `guided tour` — same three.
- `aria-live` — a real Settings save populates a `role="status"[aria-live]`
  region; an invalid Products submit populates a `role="alert"`.
- `charts` — every Recharts surface sits inside an `aria-hidden` wrapper and is
  paired with an `sr-only` table whose caption is non-empty and whose body
  contains digits; the Hebrew run asserts the caption is actually translated.

## What it does NOT check — still needs a real screen reader

axe verifies *markup and computed properties*, not what an assistive technology
announces. A NVDA / JAWS / VoiceOver / TalkBack pass is still required for:

- whether aria-live regions are actually spoken, at the right politeness,
  without clobbering each other;
- browse-/virtual-cursor reading order vs visual order (esp. RTL Hebrew);
- whether each AT honours `aria-modal` + the JS focus trap, or needs `inert` on
  the background;
- whether the new chart tables are *useful* to listen to, as opposed to merely
  present and correct — the suite can only prove the latter;
- `aria-describedby` hint text being read with its field.
