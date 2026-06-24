# Features & Design Language

> Part of the ops-forecast documentation set. See [PROJECT_SPEC.md](PROJECT_SPEC.md) for the index and roadmap.

## Product Identity, Branding & Design Language

- **Name:** **Ope**. **Slogan:** "Know Tomorrow, Today."
- **Logo:** the provided "OPe" mark in blue with a green accent (stored under `web/src/assets/`). Use it in the header and as the favicon. Use a **transparent-background PNG** (no white or colored box behind the logo). Owner must supply the file; Claude Code places it. If not available, use remove.bg or the original source.
- **Audience:** owners of *small* businesses, not large companies. Many are adults who are not comfortable with technology (potential technophobes). This drives every UX decision.

### Palette & Visual Design

- **Palette:** soft blue-green, relaxing rather than corporate or high-contrast. Blue as the primary, green as the accent (matching the logo). Plenty of whitespace, gentle rounded corners, no harsh pure-black-on-white.
- **Palette — calm but alive, with depth (corrected again):** the original was too bright; a pass overcorrected to grey/washed-out; the header and body ended up the *same* shade. Fix: soft, low-saturation teal/blue-green with warmth (not grey, not clinical); **the top/header row should be a brighter shade of the lower body** (clear but gentle contrast between them); backgrounds and ad-slot/bottom areas use a **soft tint, never pure white**. Consistent across all screens.
- **Plain language everywhere:** no jargon in the UI. Say "How busy will tomorrow be?" not "Forecast horizon"; "You'll likely need this much" not "Reorder point = …". Keep statistical terms (MAPE, tracking signal) in an optional "details" area, not the main view.
- **Big, obvious controls:** large tap targets, clear single primary action per screen, readable font sizes. Assume a nervous first-time user on a phone.
- **Dark mode:** full dark-mode support, toggleable in settings (or follows system preference). All screens, charts, and cards must render correctly in both modes.

### Home Screen Layout (ordered, top to bottom — "what do I need right now")

1. **Quick actions** (Record a sale, Log today, Record a regular) — MOST prominent, at the very top.
2. The **switchable forecast/order chart** (week prediction ↔ demand-by-product ↔ what-to-order). **Week prediction is NOT a separate card** — it is one view of this chart. Any standalone "week prediction" card is redundant and must be removed. The single chart switches between **Week prediction / Demand forecast / What to order** (these are views of the same thing, not separate cards), with **customers as just one selectable series** alongside each product (show one series at a time; don't overlay mismatched scales).
3. **Busy hours** — **tomorrow's** (today is already in motion and not actionable), then a **peak-hours-by-weekday forecast**. Slightly less upfront.

**Remove from default home:** "your typical week" and "how is the app doing." **Move "how our predictions did" into the Manage menu** (a review tool, not a right-now decision).

### Home Customization

**Home is fully user-customizable — ALL charts, not just Predictions.** EVERY chart and card anywhere in the app (forecasting, hourly, ordering, staffing, accuracy, etc.) must have an **"Add to home"** option. Once a chart is already on home, that button must change to **"Remove from home"** (or disappear) — it must NOT keep showing "Add to home" for a chart that's already added. The home screen is then fully **reorganizable** (drag to reorder). The current default home layout is copied into a **"Predictions" tab** so defaults are preserved; home starts from those defaults for new users.

### Ad Slots

Ad slots must be tall enough to fill the side margins meaningfully (currently too short). Stretch them vertically to use the available edge space without covering content; keep them tinted, never white.

**Ad placement rules (non-negotiable for trust):** never pop-ups, never overlapping/covering content, never interrupting. Wide screens: tinted side-margin slots; narrow screens: one slim tinted bottom banner outside content. Always visually separated from app content. **Removing ads is a premium perk.**

### Record a Sale

Show a brief note next to the tap screen, e.g. "Tap once for each customer, then tap what they bought and how many."

### Localization (Durable Approach — Not Repeated Patching)

Hebrew strings keep reverting because each fix only catches some strings and CHART labels are handled separately from normal UI text. The piecemeal approach has failed repeatedly — switch to an **audit**:

1. Programmatically find EVERY user-facing string in the codebase (scan components for hardcoded text, chart label props, axis/legend/tooltip strings, series names, placeholders, button labels, empty states) and list which are NOT going through the translation system.
2. One central translation source for ALL strings including **Recharts chart/graph labels, axis titles, legends, tooltips, and data-derived/series names** (these bypass the normal text path — the stubborn part).
3. Make untranslated strings **detectable** (a check that flags any string not in the translation files) so gaps are visible instead of silently English.
4. Explicitly cover recently-added features (Telegram panel, locations, regulars, all charts).

It's light work but must be done by auditing the whole codebase centrally, not patching the strings someone happens to notice.

### General UX Principles
- **Guidance over blank slates:** short helper text, sensible defaults, friendly empty/"not enough data yet" states.
- **Forgiving:** easy undo, confirm before anything destructive, never punish a wrong tap.
- **Information architecture:** lead with immediate essentials; group everything else (settings, products, past-data, history, analytics depth, advanced toolbox) behind fewer, clearly-labelled entry points.

---

## Earned Retention Features (the Moat Made Felt)

These make the accumulated taught-context visible and valuable (see §1.6 in PROJECT_SPEC.md for strategic context). Data export stays free — fighting portability breaks the trust that IS the differentiator; the moat is the intelligence built ON the data, not the raw data.

### 1. "What Ope Has Learned About You" — Business Insights View

A screen of true, derived facts about the owner's *own* business they likely never saw laid out: busiest/slowest day and by how much, peak/quiet hours, year-over-year growth, most *unpredictable* day, how many months logged, and current forecast accuracy ("accurate to within X%"). Useful FIRST (owners run on gut and have never seen their patterns), moat SECOND (it makes the accumulated intelligence visible — exactly what they'd lose). Honest, data-driven, no fabrication — only show insights the data actually supports, and say so when data is thin.

### 2. Accuracy-Improvement-Over-Time Story

Show the forecast getting better as they teach it ("started at ~18% error, now ~8%") — the accumulated value, charted; leaving = discarding that progress + facing the cold ~2-week ramp again. Honest framing, not manipulative.

### 3. Daily Value + Proactive Nudges (Workflow Embedding)

Ope proactively surfaces the ONE thing worth acting on today, delivered via the existing Telegram agent and/or in-app: "Tomorrow looks unusually busy (~55 vs usual 47) — consider extra help"; "Projected to run out of [product] by Thursday — reorder by tomorrow"; "Sunday looks unusually slow — you might cut staff." Each useful heads-up catches something the owner would miss and is a reason to keep Ope. Must be genuinely useful and not spammy — only ping when there's something worth acting on; respect a frequency limit; let the owner tune/mute.

---

## Staffing & Capacity / Queueing

These answer "given the demand, are my registers/staff enough and how long do people wait?" — distinct from "how many customers."

### Formulas
- **Little's Law** — `L = λ · W` (avg number in system = arrival rate × avg time in system).
- **Throughput** — units/customers served per unit time.
- **Bottleneck capacity** — the slowest stage caps the whole system.
- **Utilization** — `λ / (servers × μ)`, where μ is service rate per server.
- **Queue / waiting time** — M/M/1 and M/M/c expected wait and queue length; pairs with the busiest-hour feature to suggest how many registers to open at peak.

### Staffing Per Shift

Using the hourly arrival rate (λ) and average service time, find the smallest number of servers `c` that keeps utilization below a safe threshold (and wait under target): "for the 5–6pm rush, schedule 3 people." Depends on transaction capture for hourly λ.

**Service time is per-product, not one flat average.** Business has a **default**; products can **override** (spa: massage 60 min, express 10 min; a café may just use the default). Staffing math weights by the **actual product mix sold in each hour**, not a blanket average. The per-product field must be exposed in the product UI and feed the wait-line calc.

### Marginal-Worker Value

Show what adding/removing one worker does ("a 3rd person at 5–6pm cuts the wait from 8 to 3 min") — queueing run at `c` and `c±1`, compared. Also show the **expected wait time / queue length** at current staffing.

**Extreme-wait wording:** when the queue is overloaded the Erlang-C wait explodes toward infinity (e.g. "293 min"). Don't show a silly precise number; say something like "you'd be severely understaffed" when the projected wait exceeds a sane cap (e.g. ~60 min).

### Owner-Set Acceptable Wait / Line (REQUIRED — not yet implemented)

Staffing has no correct answer until the owner says how much waiting is tolerable. The app must actually **ask the owner for their threshold — a max acceptable wait time OR max number of people in line** — and then compute the smallest staff count whose expected wait/queue stays under it. This question is currently not being asked anywhere; it must be added (in settings or the staffing view).

**OBSERVED BUG:** staffing is producing strange advice (e.g. "add an 11th person" for ~10 people in an hour), partly because (a) it's running on garbage overnight hours that shouldn't exist, and (b) there's no owner threshold grounding it. Fixing the closed-hours leak and adding the threshold should both improve this; verify staffing numbers are sane on real opening-hours data.

### Closed-Hours Leak (Bug)

Any customers/sales recorded in hours outside the business's opening hours must be **ignored** by the forecasting and staffing math — they shouldn't exist; don't let a stray out-of-hours number pollute the model. **OBSERVED BUG:** the "Peak hours by day" view is showing overnight hours (1–5am) with high traffic for a business that isn't open then — confirming closed-hour data is leaking into the hourly/peak-hours forecast. Check whether opening hours are configured and whether this view actually applies the opening-hours filter; it must.

### Import Sum Tip
The CSV importer can't reliably read a template where the daily total is an Excel formula/sum. Show a short, plain-language, dummy-friendly tip **on the import page** explaining how to total hours in Excel (e.g. "to add up your hours, click an empty cell and type =SUM( then select the hour cells and press Enter"). Must be fully translatable.

---

## Ad / Event Effectiveness

Do not compare raw sales during a promo to a random baseline. Instead: have the trained model forecast what *would* have happened with no event (the normal baseline), then report **actual − baseline = lift** over the period, ideally with a confidence range. This reuses the forecasting engine and yields a defensible "this ad brought ≈ +18% over baseline" figure. If the `Period` has a cost, also report lift per unit cost.

---

## Advanced / Planning Toolbox (Isolated, Plain-Language)

Power-user tools, kept in a **separate "advanced/planning" area** and surfaced in **plain language, never as jargon** (a florist wants "should I order more given it might rain?", not "apply the Hurwicz criterion"). Most owners never open this; power users (and the home-customization feature) can pull pieces forward.

- **Decision theory under uncertainty** — Hurwicz (optimism-pessimism) criterion, maximin/maximax, expected value; framed as "best/worst/likely case" choices.
- **Behavioral framing** — prospect theory (Kahneman–Tversky) awareness, e.g. loss-aversion-aware nudges around stockouts vs waste.
- **Linear programming (LP)** — simple optimization (e.g. allocate limited budget/space/staff across products to maximize expected profit subject to constraints).
- **Basic planning / project-management components** — lightweight scheduling/planning helpers.

**Each tool must clearly EXPLAIN, in plain language, what it actually checks/does** (a short description per tool so a non-expert understands its purpose), and all of it must be **fully translated to Hebrew** (the planning-tools section currently doesn't translate).

**Calmer ordering wording:** any "how does this ordering decision feel" / confidence prompt must be **worded gently and placed at the BOTTOM** of the ordering view, not upfront — the current phrasing/placement can feel alarming to owners. Reassure, don't interrogate.

---

## Free vs Premium Gating

**Premium lifts limits / unlocks scale; the core decision tools stay free for everyone** (hourly, busiest-hour, staffing, change-detection, ordering, regulars/CLV, recurring patterns, full forecasting).

### Premium Includes
- **Multiple locations** — free = **one** business/location; premium = more. Include a **"copy settings & products to a new location"** action (copies configuration, **NOT the data/history**). **The UI must NOT offer a "transfer data/history" option at all** — each location's history is its own; only settings and products are ever copied. **Locations must be deletable** (with a confirm step). **Switching an account to premium must actually raise the location limit at runtime** — a premium user can immediately add more locations; the limit check reads the live tier, not a value cached at signup.
- **Extended history** — free history capped (~**1 year**); premium = more/unlimited.
- **More ads** — ads remain the premium-gated action: free gets a generous expanded allowance (e.g. 10+, not 2); premium = more/unlimited.
- (future) POS integrations.

### Free (Generous — Not Gated)
- **Events (one-off)** — the previous 2-event cap is removed. Give free users a **generous expanded allowance of one-off events** (e.g. 10+, not 2 — this must actually change in the code).
- **Recurring/consistent events (RecurringPattern) are always unlimited and free** — they're core owner-taught context.
- All analytics, ordering, staffing, change-detection, regulars/CLV, the advanced toolbox basics.

### Enforcement
Enforce caps **server-side** (never only client). Simple per-account tier flag + limit checks. **Billing is deferred (Phase 3.5)** — build the gating now (with a manual way to set an account premium for testing), charge later.

*Note: limits alone are a thin reason to pay; the multi-location and extended-history value, plus future deep features, are what should justify premium. Revisit pricing/value after beta.*
