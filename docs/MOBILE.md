# Mobile (Phase 4 + Phase 4.5)

> Part of the ops-forecast documentation set. See [PROJECT_SPEC.md](PROJECT_SPEC.md) for the index and roadmap.

## Phase 4 — Mobile

**Goal:** a React Native (Expo) app for **both iOS and Android** with **full feature parity** with the web app, reusing the **same Render backend API** (the forecasting/ordering/auth/database brain is unchanged — only a new front-end). Decided: Expo (handles build tooling, on-device testing via QR, and store submission), both platforms, full parity as the end state.

### Mobile UX — its own design, NOT a shrunk web app

A phone is tap-first and one-job-per-screen. Use a **bottom tab bar** (thumb-reachable, mobile-native) with **4 tabs**, large touch targets, generous spacing, one focused job per screen:

- **Log (default landing screen)** — the tap screen. Big, thumb-friendly buttons to record a sale/customer and tap each product. Opens first because logging is the most frequent action. Built for quick tapping while busy, not a shrunk form.
- **Forecast** — week prediction, busy hours (tomorrow + by weekday), what to order.
- **Analytics** — staffing/marginal-worker, ad/event lift, accuracy, deeper charts.
- **Manage** — products, regulars, past days/backfill, settings, Telegram connect, premium.

Each screen does ONE job with large tap targets; switch via the bottom bar. Full feature parity with web reached by building these out in waves.

### Build Order (foundation-first, verified before stacking)

1. **Scaffold + auth + one screen** — **DONE** (app runs on phone, login + live forecast data working). Expo project; Supabase auth working on a phone; one screen pulling real data from the Render backend. This proves the hardest part (auth + backend connectivity from a phone) before any features. Run on a real device via Expo Go.
2. **Navigation shell + Log screen** (the core daily action), tested on a real phone.
3. **Forecast screen** (week prediction, busy hours, ordering).
4. **Analytics screen** (staffing, ad/event lift, accuracy).
5. **Manage screen** (products, regulars, past days, settings, Telegram, premium) + remaining parity items: Hebrew + dark mode, home customization equivalent, etc.

Test each screen on the actual device before moving on — mobile feel (target size, spacing, flow) can only be judged in-hand.

### Reuse

Share TypeScript types and an API client between web and mobile where practical (a shared package or copied client) so the two front-ends stay consistent with the backend. The backend, database, and auth do NOT change.

### App-Store Path (the unpredictable tail — plan for it)

- **Google Play developer account** (~$25 one-time) and **Apple developer account** (~$99/year).
- App icons, screenshots, store descriptions, a privacy policy, and content for review.
- **Apple review can reject and require resubmission** — budget time for back-and-forth.
- For digital subscriptions, Apple/Google usually require their in-app purchase (15–30% cut) — affects how premium billing works on mobile vs web.
- Expo EAS Build / Submit can streamline building and submitting to both stores.
- **Test on a real device throughout** (Expo Go / development builds) — don't wait until the end.

**Timeline (honest):** the app reusing the backend is a few weeks of iterative work; the store-submission tail is unpredictable (days to weeks). ~1–2 months to live in both stores, coding being the predictable part.

---

## Phase 4.5 — Beta Readiness

Before real businesses use Ope, harden the things solo testing on clean synthetic data never exercised.

### New-User Onboarding — DONE

Guided setup — business name → opening hours → first products → how to log. Opening hours must be discoverable in setup (the engine depends on them). Honest expectation-setting that forecasts need ~weeks of data to be accurate.

### Multi-Business Isolation

Several real businesses (café, florist, spa) on the system at once, with different patterns. Confirm NO data bleeds between accounts/businesses — forecasts, products, regulars, settings all strictly scoped per business/user. Confirm the premium/multi-location logic behaves with real separate users (free = 1 location, premium raises the limit at runtime; "copy settings + products NOT data" on new location; delete-location works).

### Graceful Handling of Weird Real Input

Real people log 0, log huge numbers, skip days, put values in wrong fields, use the app at odd hours. The app must degrade gracefully — validate/clamp absurd inputs, never crash, show a helpful message rather than a 500. (Recall the disguised-CORS 500s — unhandled exceptions must not surface as cryptic failures.)

### Feedback Mechanism

An in-app "Send feedback" form (web + mobile) — fields: **name, business, message** only. Submits and emails to hashvi2906@gmail.com on the backend (the user does NOT get redirected to a mail client — it's an in-app form like other websites). Simple, low-friction, translatable.

### Error Monitoring

Confirm Sentry catches errors on web AND mobile so beta bugs surface to the developer rather than users silently giving up.
