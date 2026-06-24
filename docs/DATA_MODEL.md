# Data Model

> Part of the ops-forecast documentation set. See [PROJECT_SPEC.md](PROJECT_SPEC.md) for the index and roadmap.

## Two Input Modes, One Analytical Layer

The app supports two ways to get data in, feeding one shared analytical layer:

**Input mode A — daily totals (backfill & past data):** the owner enters end-of-day numbers via two sub-paths:
- **Manual backfill screen** — dedicated screen to add or correct a specific past day. Use a **date picker (clickable calendar)**, never a free-text date field. By default captures daily totals only, but offer an optional way to add hourly detail for a past day when the owner has it (e.g. from smart-register logs). This is the same hourly shape POS integration will later import automatically, so building the capability now is forward-compatible.
- **CSV import** — for bulk history. Date handling must be robust: accept common formats, and **show the user how each date was interpreted before saving** (a preview), so DD/MM vs MM/DD confusion and Excel's auto-reformatting can't silently corrupt data. Consider accepting ISO `yyyy-mm-dd` as canonical but tolerating others with the confirmation preview.

**Input mode B — live transactions (going forward):** the owner taps a product button the instant a customer buys it. Each tap is stored as a time-stamped event. Because every sale carries a timestamp, the **hourly view, busiest-hour analysis, and staffing recommendations all derive automatically** from this same data — no separate hourly data entry needed. It also mirrors exactly what a smart register produces, lining up with the end-state.

**Aggregation:** the engine always reads daily (and, when available, hourly) aggregates. Those aggregates are either typed directly (mode A) or rolled up automatically from transactions (mode B). The forecasting engine doesn't care which mode produced them.

---

## Entities

### Business
id, name, settings (opening days/hours, default lead time, target service level, average service time per customer for staffing).

**Opening days/hours must be editable in a settings screen** — and the forecasting engine must use them: closed days are excluded from forecasting entirely (not treated as zero-customer days), and hourly features only consider open hours.

### Product
id, business_id, name, **product_type ('stocked' | 'service', default 'stocked')**, **price (optional, in optional details)**, lead_time_days, **optional service_time_minutes** (overrides the business default for staffing math — exposed in the product add/edit UI under optional details, defaulting to business setting when blank), **optional capacity** (max units that physically fit — NOT "storage cost"; that field must NOT exist), **optional shelf_life_days** (spoilage), **unit_mode ('whole' | 'decimal', default 'whole')**.

**product_type** is chosen at creation and controls the stock/reorder side only (demand is always forecast):
- **stocked** — physical goods (coffee beans, wax strips). Full stock / reorder / batch / FIFO system as normal.
- **service** — performed, never held (massage, haircut, facial). Demand forecast runs normally, but the app **never** suggests reordering a service, shows no stock figure for it, and omits it from the ordering view entirely.

**Service consumables (optional, reuses the stocked-good system).** When creating a SERVICE product, the owner can link consumables — stocked products it uses per performance (e.g. 20 ml of massage oil per massage). Each link is stored in **ServiceConsumable** (below). When the service is logged, those consumables' projected stock is drawn down by qty_per_performance × units performed. The consumable's own reorder/batch logic then applies. **Silent fallback:** if no consumables are linked for a service, the app says nothing about supplies — it never invents a consumable or nags the owner. Consumables surface only if the owner provided them. This is stock/reorder-side only — it does NOT change the service's demand forecast.

### ServiceConsumable
id, business_id, **service_product_id** (FK products.id — must be a service), **consumable_product_id** (FK products.id — must be a stocked product), **qty_per_performance** (units of the consumable used per service performance). Managed via `GET/POST/DELETE /products/{id}/consumables`.

- Capacity and shelf-life are **optional, off by default** — app must work cleanly when neither applies. When present they constrain ordering advice (see [FORECASTING.md](FORECASTING.md) ordering bridge).
- **unit_mode controls counting AND forecast output:** whole = always whole numbers ("order 45", never "45.3"); decimal = fractional input/output. **This has regressed repeatedly** — decimals reappearing for whole-unit products AND customers shown with decimals in the HOURLY CHART. Whole-unit display must apply EVERYWHERE: the forecast, order quantities, the demand chart, AND the busy-hours/hourly chart — customers are whole people, never "12.4". Add a guarding test covering the hourly chart too, so it stays fixed.
- For decimal products, the tap-to-record screen must show an **editable tap-unit field** next to the button (e.g. "0.5 L / 0.1 L / 1 L") so the owner can adjust what one tap represents.
- Products must be **quick to add, edit, and DELETE** — erase-product is required and must actually work.
- **There is NO holding_cost and NO order_cost field — do not add or retain these.** EOQ is advanced-only and must not require cost inputs from the user.

### SaleEvent *(mode B — live capture)*
id, business_id, product_id (nullable — a tap can record "a customer" with no specific product), timestamp, quantity (default 1; respects the product's unit_mode), optional unit_price.

The raw transaction stream; foundation for hourly/staffing and POS integration.

### DayRecord *(mode A — daily totals)*
id, business_id, date (**unique per business — the app must REFUSE to create a second past-day entry for a date that already exists; offer to edit the existing one instead**), customers (int), notes.

### SaleRecord *(mode A)*
id, day_record_id, product_id, units_sold.

### HourRecord *(derived / analytics)*
id, business_id, date, hour (0–23), customers, units_sold. Rolled up from SaleEvents; powers busiest-hour and staffing.

### Period
id, business_id, start_date, end_date, type ('event' | 'ad'), label, optional cost, **recurring flag + recurrence rule (optional)**. One-off OR recurring. Excluded from the "normal" baseline; recurring ones are folded back in as expected.

### RecurringPattern *(owner-taught context — moat feature)*
id, business_id, label, weekday(s), **optional start-hour, optional end-hour** (if end-hour not set, the engine infers the extent from the data), effect (e.g. "higher").

For predictable repeating bumps the owner knows about — e.g. "a school trip every Sunday 9–11am." The engine must **treat these as expected (fold into the forecast for that weekday/hour), NOT flag them as anomalies.** Both start and end hour should be settable; if only start is set, pattern applies to that hour; if both are set, it spans the range.

### Regular *(separate entity — NOT in past-data/demand history)*
id, business_id, name, **first_visit_date**, avg_spend_per_visit, derived **CLV** (auto-computed), optional notes.

- Edited on a dedicated screen. **"Record a regular" logs ONE record per regular per day**, holding that day's running total spend. **It must be editable (additive) during open hours** — e.g. Sarah spends $20 at noon (logged), then $10 at 3pm → the owner edits today's entry to $30; this is the meaning of "record a visit twice." The day's total **locks after closing hours** (then it's final).
- **Current bug:** recording/editing a same-day regular visit is blocked — it must allow updating today's total. **Recording/editing a regular is allowed any time during open hours** (point-event, exempt from the sales entry-timing rule).
- Regulars never enter DayRecord/SaleEvent demand history.
- **Regular profitability chart:** show how much a regular has earned the business over **this month, this year, and since first arrival** (using first_visit_date). **OBSERVED BUG:** there is currently nowhere that actually shows a regular's profitability/tracking — it must actually appear.
- **Regular churn / recent-months tracking:** also show a regular's visit frequency over **recent months** so the owner can spot a regular they may be **losing** (declining visits) — a retention signal.

### Ad/Event Product Targeting
When creating an ad or event, **ask which product it's meant to promote/bring in** (with "customers" available as a selectable target, treated like a product). Then the lift analysis tracks the effect on *that specific target* (that product's sales, or overall customers), not just total customers — so the owner sees whether the ad moved the thing it was for.

### ForecastRun *(recommended)*
id, business_id, created_at, target_date, predicted value, interval low/high, model weights used. Lets accuracy be measured against what was actually predicted, not recomputed after the fact.

### OrderRecord *(ordering lifecycle — workflow-embedding feature)*
id, business_id, product_id, ordered_date, quantity, expected_arrival_date (auto = ordered_date + product.lead_time_days), status.

The owner logs **"I ordered X units"** via a button; the app records it and **assumes arrival after the product's lead time** (no second confirmation — expected_arrival_date auto-set), at which point projected stock increases by the quantity. The order is **cancellable/editable until closing hours** that day (locks after close, same forgiving pattern as day-records/regulars). Also track **product creation date** (when the product was added) so its history has a start point.

---

## Ordering Lifecycle & Stock Tracking

### Projected Stock

The app maintains projected stock over time. **Starting stock** is set at product creation (and can be set anytime for existing products). Stock **draws down** as sales are logged and **goes up** when a logged reorder arrives (after lead time). The owner can **manually override the current stock at any time** — the app then **recalculates forward from the corrected number**, never stubbornly trusting its own projection over the owner's correction. Track stock **from product creation** so there's a real starting point.

**Honest fallback:** for an existing product with no starting-stock ever set, the app **cannot know current stock — it must SAY so** ("set a starting count to track this product's stock") rather than invent a number. The reorder forecast must prompt the owner to enter the amount/current stock when it's missing, rather than showing nothing. Never fabricate stock figures.

### Batch Tracking + FIFO Shelf-Life (full version)

Stock is tracked as **dated batches**, not one blob. Each reorder (and the initial starting stock) creates a **batch** = quantity + arrival date + its own **expiry** (arrival date + shelf_life_days). Sales **deplete the OLDEST batch first (FIFO)**. Spoilage is computed **per batch**: if a batch reaches its expiry with units left, those are flagged as spoiled/at-risk — not silently kept as good stock.

**The app must clearly STATE that it ASSUMES you sell oldest stock first (FIFO)** wherever this affects advice, so the owner can correct it if they actually sell newest-first.

**Reorder-while-stock-remains prompt:** when the owner reorders while existing stock is still on hand, the app surfaces the existing **older stock and its expiry** ("you still have ~20 units expiring around [date] — those sell first"), so a fresh reorder doesn't hide the fact that the old stock is about to spoil. The new order becomes its own later-expiring batch.

**Two reminders:** (1) a **heads-up before** running low (approaching the reorder point), and (2) a **low-stock alert** at the reorder point. Both plain-language.

### "I Reordered This" Button

Prominent in the reorder section; the owner taps it when they place an order, capturing the quantity. Creates the OrderRecord and starts the arrival/stock projection (stock rises after lead time). **This button/action must be available in the reorder SCREEN itself, not only in the forecast chart.**

**One reorder per product per day** — you cannot reorder the same product twice in one day; instead you EDIT today's order while it's still open hours (locks after closing), same forgiving pattern as day-records and regulars.

### Arrival Confirmation

Stock projection is reportedly NOT advancing as days pass (an order placed on the 13th, due the 14th, showed no change by the 15th) — investigate and fix so projected stock actually updates with elapsed time and logged arrivals.

Add an **"Did this shipment arrive?" confirmation button** for each pending order, and a setting/option to **"always assume orders arrive on time"** (so the owner can either confirm each arrival manually, or let it auto-mark arrivals as on-time). When confirmed (or auto-assumed), the batch becomes available stock from that date.

### Settings Toggle
The owner can **turn reorder/stock management OFF entirely** for owners who don't want it.

### "You Didn't Order" Warning
Fires ONLY when projected stock is about to run out, not on every recommendation. Dismissable ("leave it be") — when dismissed, don't nag again that cycle.

---

## Data-Sufficiency Rules

- Day-of-week patterns: need ≈ 2–4+ weeks before forecasts are trustworthy.
- Hourly patterns (Phase 3): need ≈ 2–4 weeks of hourly entries.
- Annual seasonality: realistically needs ≈ 2 years — most users won't have it, so make it a "someday" feature, not a Phase-1 promise.
- **A missing day means "no data," never "zero customers."** Days not logged are ignored by the engine, not counted as zero. Combined with opening-days settings: closed days are expected-absent; open days with no entry are missing data, not zero.

---

## Entry-Timing Rules (Data Integrity)

- Do NOT allow logging or editing *today's sales/customer totals* while the business is still open / the day hasn't finished (day's data is incomplete).
- Do NOT allow live sales input outside opening hours.
- Do NOT allow creating or editing a past day if that day is marked as a **non-working/closed day** — not even via the backfill screen. If the owner tries, show a friendly explanation.
- **EXCEPTION — Recording a regular is always allowed**, including during open hours and any time of day. It is a point event, not a day-total, so timing rules don't apply to it.
- Tap-only days (no manual total entered) roll into past-days automatically after closing hours.
- **Duplicate past-day entry — offer in-place OVERRIDE, not just "go edit it."** If a date already exists, show a prompt at the moment of conflict: "A record for this date already exists — Overwrite it with this data, or Cancel?" Overwrite updates the existing record directly with the new data; Cancel does nothing. (Current behavior wrongly says "find it in Past Days to edit it" with no overwrite option.)
- **Undo an override (one-step):** when a day record is overwritten, keep the immediately-previous version so the owner can **restore it** ("undo — return to the previous version"). One step back is enough. After restoring, the just-overwritten version can be re-applied if they undo the undo, but a single previous-version slot is sufficient.
- **After creating or editing a past day, stay on that date** — do NOT redirect back to yesterday. The owner is doing backfill work and expects to stay where they are.
- **Fluke (and any outlier flag) must be fully reversible.** If a day is marked as a fluke, the owner must be able to un-mark it and restore it to normal. Current bug: a fluke-marked day can't be un-marked even after editing — must fix. Fluke status is a user-editable label, not a permanent brand.

---

## Data Consistency Rules (Enforce the Math)

The daily total is the source of truth. When a day has hourly entries:

1. If the **hours sum is greater than** the manual customer total → the **hours sum becomes the customer total** (hourly detail is more reliable; the manual figure was too low).
2. If **no manual total was entered** → the **hours sum becomes the customer total** (derive the day total from the hours).
3. If the **hours sum is less than** the manual total → keep the manual total; treat the difference (total − hours sum) as **"unknown hours"** counted in the day total but not attributed to a specific hour. (This is the only case where the manual total "wins.")

In all cases, typed hours always count as real hourly data, and the app should make the resulting day total clear to the user. (This has repeatedly not worked — implement it for real, with tests covering all three cases.)

**Partial hours are allowed:** the user may enter only some hours plus a daily total. Known hours are a partial breakdown; the remainder is "unknown hours" — still counted in the day total, just not attributed to specific hours. Offer "rely on the daily total only" when hours and total mismatch.

**Products vs customers is NOT hard-bound** — a customer can buy multiple products, so product units may exceed customers. Do NOT block on this. Only flag *wildly* implausible mismatches (e.g. hundreds of products for a couple of customers) as "worth checking," never as an error.

**Hourly-average suppression bug (FIX):** `hourly_averages()` divides each hour's total by the count of ALL distinct days, including days with no tap at that hour, so busy hours come back **suppressed below reality**. Same missing-day≠zero error already fixed for the daily forecast, surviving in the hourly math. Fix: divide each hour's total by the number of days that hour could actually have had activity, not by all days. Add a test proving a consistently busy hour isn't dragged down by days where that hour had no data.

---

## CSV Import Notes

- The template's instruction/example row (row 2) must be **skipped on import**, not parsed as data — currently it's misread as a date and errors.
- When hourly columns are present, **auto-sum them into the daily total** (consistent with the hours-vs-total rule above).
- Import is **slow and may not reliably complete** — make it performant and confirm it actually finishes (show clear success/failure, not a silent hang). Validate rows and report which rows (if any) couldn't be read, rather than failing the whole import.
- **DATA-CORRUPTION BUG (priority, diagnostic-first):** import sometimes stores a *different number than entered* — e.g. 70 customers entered for a date imports as 89. "Sometimes, not always" suggests certain rows mis-parse, columns misalign, or the new hours-vs-total reconciliation is wrongly *adding* hourly values onto the daily total during import (89 ≈ 70 + some hours). Investigate why a known input changes value before fixing; add a test that imports a known file and asserts every stored value exactly matches the input.
- **Template must include per-product daily totals** — columns for each product's quantity for the day (NOT broken down by hour), alongside the date, customer total, and optional hourly columns.
- Template's date column should **default to / start at 1 Jan 2026** (the first example row dated 2026-01-01), so users have a clear starting point.
- Show a dummy-friendly **tip on the import page** for how to total hours in Excel (e.g. "to add up your hours, click an empty cell and type =SUM( then select the hour cells and press Enter"). Must be fully translatable.
- Show a clear, dummy-friendly explanation of **how to add earlier dates** — i.e. add more rows above/below with earlier dates in the date column to extend history further back. Must be translatable.
- Show the user **how each date was interpreted before saving** (a confirmation preview), so DD/MM vs MM/DD confusion and Excel's auto-reformatting can't silently corrupt data.
