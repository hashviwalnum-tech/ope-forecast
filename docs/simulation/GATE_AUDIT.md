# Gate audit — everything that depends on user / subscription state

**Why.** The trial-to-free transition leaked (F-018) because the tier every limit
check reads — `Business.settings["tier"]` — is a **cached flag**, and the only
thing that ever wrote it back down was the client calling `GET /subscription`.
A user who never opened the premium screen kept unlimited locations, ads, events
and history permanently.

This is a full sweep of every place in the backend that gates a feature, a limit
or a tier, checking one thing: **does it resolve authoritative state on the
server at the moment of the gated action, or does it trust something cached or
client-supplied?**

**This must hold before billing work begins**, because after billing the same
class of bug stops being a free upgrade and starts being lost revenue.

---

## The rule

`Business.settings["tier"]` is a **cache, not a source of truth.** The source of
truth is the `Subscription` row, via `Subscription.effective_tier` (active
subscription → premium; inside trial window → premium; otherwise free).

`deps.sync_user_tier(db, user_id)` is the **one** function that reconciles the
two. Any code path that reads `biz.tier` must have run it first for that user.

There is exactly one deliberate exception: `settings["tier_admin_override"]`,
set by the admin-key `PATCH /businesses/me/tier`, pins a tier for testing before
billing exists. It is respected by design and is only reachable with the server's
`ADMIN_KEY`.

---

## Every gate found

### Tier / limit gates

| # | Gate | Where | How it resolves tier | Status |
|---|---|---|---|---|
| 1 | History cutoff (forecast baseline) | `analytics.py` `_clean_records` | `get_business` → `sync_user_tier` | **safe** |
| 2 | History cutoff (trends & history) | `analytics.py` `_history_records` | `get_business` → `sync_user_tier` | **safe** |
| 3 | History cutoff (Past Days list) | `day_records.py` `list_day_records` | `get_business` → `sync_user_tier` | **safe** |
| 4 | Reject a day older than the free cap | `day_records.py` `create_day_record` | `get_business` → `sync_user_tier` | **safe** |
| 5 | Ad / event allowance | `periods.py` `create_period` | `get_business` → `sync_user_tier` | **safe** |
| 6 | Second location | `businesses.py` `create_business` | explicit `sync_user_tier` | **was leaking — fixed (F-018)** |
| 7 | Copy a location | `businesses.py` `copy_business` | explicit `sync_user_tier` | **was leaking — fixed (F-018)** |
| 8 | Tier reported to the client | `businesses.py` `list` / `me` | explicit `sync_user_tier` | **was leaking — fixed (F-018)** |
| 9 | **Telegram bot forecast** | `bot.py` `_business_for_chat` | now `sync_user_tier` on the linked business | **was leaking — fixed by this audit** |
| 10 | **Telegram bot ordering** | `bot.py` `_business_for_chat` | same helper | **was leaking — fixed by this audit** |
| 11 | **Telegram nudge fan-out** | `bot.py` `bot_send_all_nudges` | now `sync_user_tier` per business | **was leaking — fixed by this audit** |

### Gates 9–11: what was wrong

The bot resolves its business from the `TelegramLink` row with
`db.get(Business, link.business_id)` — it never goes through `get_business`, so
`sync_user_tier` never ran. Both bot read endpoints call straight into the
analytics functions, which read `biz.tier` for the history cutoff.

Consequence: **an expired trial with a linked Telegram bot kept premium history
depth in its forecasts indefinitely.** Worse than the original F-018 leak,
because the bot path also never *refreshed* the cached flag, so nothing on that
path could ever correct itself.

Fixed by resolving the live tier inside `_business_for_chat` and in the nudge
loop, immediately after loading the business and before it is handed to anything
that gates.

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
  the tier sync with subtly different rules. Now delegates to
  `deps.sync_user_tier`, so there is one implementation. Two copies of "is this
  user premium" is precisely how two parts of an app come to disagree.

---

## Standing guard

`tests/test_tier_limits.py::test_no_new_code_path_reads_a_tier_off_a_directly_loaded_business`
parses the application's AST and fails if **any function** both loads a Business
directly with `db.get(Business, …)` and reads `.tier`, without also calling
`sync_user_tier`. That is exactly the shape of gates 9–11, so the same mistake
cannot be reintroduced silently.

Alongside it, eleven behavioural tests cover: the trial granting premium; the
trial expiring **without the client asking**; the ad, event, history and location
caps all binding; ads and events having separate allowances; an admin upgrade
taking effect at runtime; and the bot no longer serving a stale tier.

---

## Verdict

**Three leaks found by this audit, all in the Telegram path, all fixed.**
Every remaining gate resolves authoritative state server-side at the moment of
the gated action. Nothing gates on a client-supplied value, and the one cached
value that limits still read (`settings["tier"]`) is now reconciled from the
subscription on every path that reaches it.

**One thing to decide before billing:** `settings["tier"]` remains a cache that
happens to be kept correct, rather than being removed in favour of reading the
subscription directly at each check. Keeping it is a performance choice (one
query saved per request). It is currently safe, but every new code path is one
more chance to read it without syncing — which is why the AST guard exists. If
you would rather not carry that risk into a paid product, the alternative is to
make `Business.tier` unavailable and have the limit helpers take an explicitly
resolved tier argument, so forgetting becomes a type error rather than a silent
leak.
