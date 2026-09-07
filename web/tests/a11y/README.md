# Accessibility suite

Automated a11y coverage for the web app: **axe-core** across the main screens in
both themes, English + Hebrew, at a phone (390×844) and a desktop (1280×800)
viewport, plus hand-written checks for the things the UX round asked to be
*verified working* rather than just present — focus order through the bottom tab
bar, no keyboard traps, modal focus containment, and aria-live regions that
actually receive text.

## Running it

The suite needs a backend it can seed against. The cloud backend rejects
cross-origin writes from `localhost`, so run a local one on SQLite:

```bash
# terminal 1 — backend (from backend/)
DATABASE_URL="sqlite:///./a11y.db" \
SUPABASE_URL="https://<your-project>.supabase.co" \
ALLOWED_ORIGINS="http://localhost:5173" \
uvicorn app.main:app --port 8000

# terminal 2 — the suite (from web/)
#   web/.env.local must point VITE_API_BASE_URL at http://127.0.0.1:8000
#   and carry the real VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run test:a11y
npm run test:a11y:report   # open the HTML report
```

`global-setup.ts` signs up a throwaway Supabase user, seeds one business with
~130 days of history / products / regulars / a promo through the API, logs in
once, and saves the storage state. Every spec reuses it. Email confirmation must
be **off** on the Supabase project for the signup to return a session.

## What it checks

- `axe.spec` matrix — 12 screens × {light,dark} × {en,he}, once per viewport
  project. Fails the test on any **critical** or **serious** violation; attaches
  the full violation list (all severities) to the report.
- `bottom tab bar` — DOM/tab order matches visual order; `aria-current` on the
  active tab; Tab leaves the bar after its last button (no recycling trap); the
  whole page is traversable end to end without a focus loop.
- `Manage sheet` — opens with focus inside, Escape closes it, Tab stays within
  the `aria-modal` panel.
- `guided tour` — same three: focus in, Escape out, Tab contained.
- `aria-live` — a real Settings save populates a `role="status"[aria-live]`
  region; an invalid Products submit populates a `role="alert"`.

## What it does NOT check — still needs a real screen reader

axe verifies *markup and computed properties*, not what an assistive technology
announces. A NVDA / JAWS / VoiceOver / TalkBack pass is still required for:

- whether aria-live regions are actually spoken, at the right politeness, without
  clobbering each other;
- browse-/virtual-cursor reading order vs visual order (esp. RTL Hebrew);
- whether each AT honours `aria-modal` + the JS focus trap, or needs `inert` on
  the background;
- Recharts chart content — the numbers in the SVGs are almost certainly not
  perceivable without sight and likely need a table alternative;
- `aria-describedby` hint text being read with its field.
