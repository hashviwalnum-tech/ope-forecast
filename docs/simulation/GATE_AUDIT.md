# Gate audit — everything that depends on user / subscription state

**Why.** The trial-to-free transition leaked (F-018) because the tier every limit
check read — `Business.settings["tier"]` — was a **cached flag**, and the only
thing that ever wrote it back down was the client calling `GET /subscription`.
A user who never opened the premium screen kept unlimited locations, ads, events
and history permanently.

**Outcome.** Three further leaks found, all in the Telegram path — then the cache
itself removed, so the class of bug is gone rather than patched.

This is a full sweep of every place in the backend that gates a feature, a limit
or a tier, checking one thing: **does it resolve authoritative state on the
server at the moment of the gated action, or does it trust something cached or
client-supplied?**

**This must hold before billing work begins**, because after billing the same
class of bug stops being a free upgrade and starts being lost revenue.

---

## The rule

**There is no tier cache any more.**

`Business.settings["tier"]` used to be the value every limit check read, kept in
step by whichever code path remembered to sync it. That is now gone as a concept:

* `Business` has **no `.tier` attribute**. Reaching for it raises.
* The tier is obtained only from **`deps.resolve_tier(db, user_id)`**, which
  reads the `Subscription` row — the source of truth — on every call.
* It is returned as an **`app.engine.limits.Tier`**, and every limit helper
  requires that type. Passing a bare string fails. So a caller cannot reach a
  gate at all without having resolved the tier first: **forgetting is now an
  error instead of a silent entitlement leak.**
* Endpoints that gate declare `tier: Tier = Depends(get_tier)` and pass it
  explicitly to whatever needs it.

One deliberate exception remains: `settings["tier_admin_override"]`, set only by
the admin-key `PATCH /businesses/me/tier`, pins a tier for testing until billing
exists. That is a manual act behind the server's own key, not a stale value, and
`resolve_tier` is the only thing that honours it.

Legacy rows in production still carry a leftover `settings["tier"]` string. It is
now inert — a test asserts that a business carrying `{"tier": "premium"}` with no
subscription and no override resolves to **free**.

## Every gate found

All eleven now take an explicitly resolved `Tier`. The "originally" column
records what each did when the audit began.

| # | Gate | Where | Originally | Now |
|---|---|---|---|---|
| 1 | History cutoff (forecast baseline) | `analytics.py` `_clean_records` | read the cached flag, refreshed by `get_business` | takes `tier: Tier` |
| 2 | History cutoff (trends & history) | `analytics.py` `_history_records` | same | takes `tier: Tier` |
| 3 | History cutoff (Past Days list) | `day_records.py` `list_day_records` | same | `Depends(get_tier)` |
| 4 | Reject a day older than the free cap | `day_records.py` `create_day_record` | same | `Depends(get_tier)` |
| 5 | Ad / event allowance | `periods.py` `create_period` | same | `Depends(get_tier)` |
| 6 | Second location | `businesses.py` `create_business` | **leaking** (F-018) | `resolve_tier` at the check |
| 7 | Copy a location | `businesses.py` `copy_business` | **leaking** (F-018) | `resolve_tier` at the check |
| 8 | Tier reported to the client | `businesses.py` `list` / `me` | **leaking** (F-018) | resolved and set explicitly |
| 9 | Telegram bot forecast | `bot.py` | **leaking** — never resolved at all | `resolve_tier`, passed in |
| 10 | Telegram bot ordering | `bot.py` | **leaking** — same | `resolve_tier`, passed in |
| 11 | Telegram nudge fan-out | `bot.py` | **leaking** — same | resolves per business |

### Gates 9–11: what was wrong

The bot resolves its business from the `TelegramLink` row with
`db.get(Business, link.business_id)` — it never goes through `get_business`, so
nothing ever refreshed the cached tier on that path. Both bot read endpoints call
straight into the analytics functions, which gated history depth on it.

Consequence: **an expired trial with a linked Telegram bot kept premium history
depth in its forecasts indefinitely.** Worse than the original F-018 leak,
because the bot path also never *refreshed* the flag, so it could never
self-correct.

The seven analytics endpoints that reach a gate (`/forecast`, `/accuracy`,
`/weekday-averages`, `/ordering`, `/monthly-summary`, `/product-forecast`,
`/insights`) now declare `tier: Tier = Depends(get_tier)` and pass it down.

### Admin-key gates

| Gate | Where | Basis | Status |
|---|---|---|---|
| Set a tier by hand | `businesses.py` `PATCH /me/tier` | `require_admin_key` | **safe** |
| Dev catch-up (synthetic data) | `dev_catchup.py` ×2 | `require_admin_key` + env flag + business-id gate | **safe** |
| Force a subscription state | `subscriptions.py` webhook | `require_admin_key` | **safe** |
| Admin subscriber list | `subscriptions.py` | `require_admin_key` | **safe** |

`require_admin_key` compares the request header against the `ADMIN_KEY`
environment variable with `secrets.compare_digest` on every call, and **fails
closed** when the variable is unset. Nothing cached, nothing client-supplied.

### Bot service-key gate

| Gate | Where | Basis | Status |
|---|---|---|---|
| Every `/bot/*` endpoint | `bot.py` `_verify_service_key` | shared secret from the environment, checked per request | **safe** |

Scoping is by `TelegramLink.chat_id → business_id`, a server-side row. The caller
supplies only the `chat_id`, which is the identifier the link was established
with — it cannot name a business it is not linked to.

### Identity

| Gate | Where | Basis | Status |
|---|---|---|---|
| Who is this user | `deps.py` `get_current_user` | Supabase JWT verified against the JWKS endpoint per request | **safe** |
| Which business | `deps.py` `get_business` | `X-Business-Id` header, but **always filtered by `user_id`** | **safe** |

The business header is client-supplied and therefore untrusted — but the query
filters on the authenticated user first, so naming another account's business id
returns nothing. Confirmed empirically in the feature sweep: a second account
forcing `X-Business-Id: 1` gets a 404, not the first account's data.

### Non-gates (read user state but gate nothing)

Recorded so the sweep is complete and a future reader does not have to re-derive
that these are harmless:

* `day_records.py` `_auto_flag_outliers` — loads a Business directly, reads only
  `settings["opening_days"]`.
* `telegram.py` `redeem` — loads a Business directly, reads only `name`.
* `nudges.py` — gates on `settings["nudges_enabled"]` and a frequency stamp, both
  owner preferences rather than entitlements.
* `subscriptions.py` `_sync_business_tier` — **was a second implementation** of
  the tier sync with subtly different rules. Two copies of "is this user premium"
  is precisely how two parts of an app come to disagree. **Now deleted
  entirely**, along with its call sites: with no cache there is nothing to sync,
  and a subscription change takes effect on the very next gated request.

---

---

## Billing-adjacent changes

What changed in code that will matter once real money is involved:

| File | Change | Effect on billing |
|---|---|---|
| `subscriptions.py` | `_sync_business_tier` **deleted**, and its three call sites removed from `GET /subscription`, `POST /subscription/cancel` and the webhook handler | A subscription change now takes effect on the **very next gated request**. Previously an entitlement only appeared once something wrote the cache — which for a *paying* customer meant a purchase that did not take effect until the app happened to refresh. |
| `businesses.py` `create_business` | The trial no longer writes `settings["tier"] = "premium"` | The 30-day trial grants premium purely by the `Subscription` row existing. There is no flag left to go stale when it expires — the original F-018 bug cannot recur. |
| `businesses.py` `PATCH /me/tier` | Unchanged behaviour; still writes `tier` + `tier_admin_override` | Still the manual grant path behind `ADMIN_KEY`, and now the **only** thing `settings["tier"]` is read for. Spec §3.5 replaces this with a verified payment when billing lands; nothing else needs to change when it does. |
| `deps.py` | `sync_user_tier` (read-and-write) replaced by `resolve_tier` (read-only) | No request writes to the database just to answer "is this user premium". Fewer writes, and no lost-update risk between concurrent requests. |
| `bot.py` | Resolves the tier itself and passes it in | The Telegram bot is a paying customer's channel too; it was serving premium depth to expired accounts. |
| `engine/limits.py` | `Tier` type; all three limit helpers require it | A future billing code path physically cannot call a limit check with an unresolved value. |

Three tests cover the billing paths specifically: activating a subscription lifts
the limits on the next request with no refresh in between; cancelling removes the
entitlement at once; and the tier *reported* to the client always matches the
tier the gates *enforce*, so a screen can never claim premium while a gate
refuses.

**Unchanged:** the payment provider abstraction, the checkout flow, and the
webhook handler's logic. `payment_provider.verify_webhook` still returns `{}` for
the stub, so the webhook remains a no-op until a real provider is wired in — that
is pre-existing and expected.

---

## Verdict

**Three leaks were found by the audit, all in the Telegram path, all fixed — and
the underlying cache has since been removed entirely.**

Every gate now resolves authoritative state server-side at the moment of the
gated action. Nothing gates on a client-supplied value, and there is no longer a
cached tier for anything to read.

### Standing guards

Four tests keep it that way:

* **No `.tier` on the model** — asserts the attribute does not exist, so the old
  mistake is not expressible.
* **Nothing reads a tier out of settings** — parses every module's AST (not a
  grep, so the docstrings explaining this history do not trip it) and fails on
  any `settings["tier"]` subscript or `.get("tier")` call outside `deps.py` and
  `businesses.py`.
* **Limit helpers reject an unresolved tier** — passing the bare string
  `"premium"` to `history_cutoff` or `check_periods` raises.
* **No function loads a Business directly and reads a tier** — the shape of the
  three Telegram leaks.

Alongside them, nineteen behavioural tests cover the trial granting premium, the
trial expiring without the client asking, all four caps binding, an admin grant
being honoured, a stale settings string being ignored, and the billing paths
below.
