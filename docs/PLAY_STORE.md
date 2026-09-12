# Getting Ope onto Google Play

Everything the Play Console will ask for, what the project already satisfies, and
what is still missing. Checked on **2026-09-12** against the rules as they stand
today rather than from memory — the target-API rule changed on 31 August 2026 and
the billing rules changed twice during 2026.

The one-line summary: the **app builds and its technical requirements are met**;
what blocks submission is **paperwork plus one missing feature** (in-app account
deletion), and the fact that the backend the app talks to is currently down.

---

## 1. Technical requirements — met

| Requirement | Rule | Ope | How it was checked |
|---|---|---|---|
| Target API level | New apps must target **Android 16 (API 36)** or higher, since 31 Aug 2026 | **36** | Read out of the built `.aab`'s own manifest: `targetSdkVersion="36"` |
| Minimum API level | No Play rule; lower reaches more phones | **24** (Android 7.0, 2016) | same |
| Build format | **Android App Bundle (.aab)**, not an APK | `.aab` | `eas.json`'s `production` profile is `"buildType": "app-bundle"`, and a real one was built |
| 64-bit support | Required | arm64-v8a and x86_64 both present | listed the bundle's `base/lib/*` entries |
| Signing | **Play App Signing** — Google holds the release key | EAS generates and holds the upload key | see section 3 |

**No upgrade job is needed.** Expo SDK 54 already pins compileSdk and targetSdk
to 36 through React Native 0.81's version catalog
(`node_modules/react-native/gradle/libs.versions.toml`). This was the item most
likely to have been a month of work, and it is already done.

### A production build really does succeed

Not "it type-checks" — a full release bundle, built locally the same way EAS
builds it:

    npx expo prebuild --platform android --clean
    cd android && ./gradlew :app:bundleRelease

`BUILD SUCCESSFUL`, producing a 48 MB `app-release.aab` carrying all four ABIs,
with Android's `lintVital` release check passing. Built twice: once to prove the
toolchain, and again after the icon and permission changes below. Locally the
release is signed with the debug key, which is what the React Native template
does; EAS substitutes the real upload key.

One trap worth writing down. Gradle 8.14.3 cannot compile its own build scripts
under **JDK 25**, which is what Android Studio now bundles — it fails with
`Unsupported class file major version 69`, and it fails *after* `gradlew
--version` has reported everything as fine. Build with **JDK 21**;
`C:\Users\hashvi\.jdks\jbr-21.0.11` is already on this machine.

---

## 2. Permissions — audited, and cut to one

Expo's manifest template ships four optional permissions under a comment reading
"REMOVE WHATEVER YOU DO NOT NEED". Nothing had removed them, so all four were
being requested.

| Permission | Where it came from | Kept? | Why |
|---|---|---|---|
| `INTERNET` | Genuinely needed | **Kept** | The app is a client of the Ope API and of Supabase. Nothing works without it |
| `SYSTEM_ALERT_WINDOW` | Expo template | **Removed** | "Draw over other apps". Nothing in Ope draws an overlay. This is one of the permissions that most alarms users and most reliably draws a reviewer's attention |
| `VIBRATE` | Expo template | **Removed** | Nothing in Ope vibrates |
| `READ_EXTERNAL_STORAGE` | `expo-file-system` | **Removed** | CSV import picks a file through Android's document picker with `copyToCacheDirectory: true`, so the file is read back out of the app's *own* cache. No storage permission is involved |
| `WRITE_EXTERNAL_STORAGE` | `expo-file-system` | **Removed** | Nothing writes outside the app |

Done with `android.blockedPermissions` in `app.json`, which strips them at
manifest-merge time — including the ones a library declares for itself, which a
plain `permissions: []` does not.

**Verified in the artefact, not in the config.** The merged release manifest
inside the built bundle asks for exactly:

    android.permission.INTERNET
    com.opeforecast.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION

The second is an app-private, signature-level permission AndroidX adds to guard
its own broadcast receiver. It is invisible to users and needs no justification.

---

## 3. What you have to do in EAS and Play Console

None of this can be done from this machine; all of it needs your accounts.

**Once, to set up:**

1. **Expo account** — free. Sign up at expo.dev, then from `mobile/`:
   `npx eas-cli login`
2. **Link the project:** `npx eas-cli init`, which writes a project id into
   `app.json`.
3. **Google Play developer account** — **$25, one-off**, at
   play.google.com/console. Registration now requires identity verification and
   can take several days, so start it before you need it.
4. **Create the app in Play Console** with package name `com.opeforecast.app`.
   That name is permanent: it cannot be changed after the first upload.

**To build a release:**

    cd mobile
    npx eas-cli build --platform android --profile production

The first run offers to generate an upload keystore and keep it for you — say
yes. EAS stores it and you never handle a key file. Google holds the actual
release key under **Play App Signing**, which is automatic for new apps.

**To submit:** either download the `.aab` and upload it by hand, or use
`npx eas-cli submit --platform android` after adding a Google service-account
key. Uploading the first one by hand is simpler and worth doing that way once.

**Every later release must bump `versionCode`** in `app.json`, which is `1` now.
Play rejects a repeat of a version code that has already been uploaded.

---

## 4. Store listing — what you need to supply

### Text

| Field | Limit | Status |
|---|---|---|
| App name | 30 characters | drafted in section 5 |
| Short description | 80 characters | drafted in section 5 |
| Full description | 4,000 characters | drafted in section 5 |

### Images

| Asset | Spec | Status |
|---|---|---|
| App icon | **512 × 512**, 32-bit PNG, under 1 MB | **Made** — `mobile/assets/icon-play-512.png` |
| Feature graphic | **1024 × 500**, JPEG or 24-bit PNG, **no transparency** | **You need to make this.** It is a wide banner, not an icon — Play shows it above the listing. Keep anything that matters near the centre; the edges are cropped in some layouts |
| Phone screenshots | **At least 2**, up to 8. PNG or JPEG, no alpha. Portrait 9:16, at least 1080 × 1920, and the longer side may not exceed twice the shorter. No device frames, no added marketing text | **Not made** — see below |

**About the icon.** Play draws icons as a full square and applies its own rounded
corners. `assets/applogo.png` had rounded corners *painted into it*, with
**black** filling the area outside them, so Play would have rendered a black
notch at each corner inside its own rounding. The generated 512 fills those
corners with the surrounding gradient and ends at a clean square edge, which is
what Play's spec asks for.

The same fault would have appeared on every Android home screen, because Android
masks the adaptive icon to whatever shape the launcher uses. That is fixed
properly too: the foreground is now the white gear alone on transparency, sized
to 60.5% of the canvas so it sits inside Android's 66/108 safe circle, over a
full-bleed gradient background image. Both were checked by compositing them and
drawing the mask and safe-zone circles over the result, not by assuming.

Generated into `mobile/assets/`:

| File | What it is |
|---|---|
| `icon-play-512.png` | the 512 × 512 you upload to Play Console |
| `icon-1024.png` | square opaque app icon (`expo.icon`; iOS forbids alpha here) |
| `adaptive-icon-foreground.png` | white gear on transparency, inside the safe zone |
| `adaptive-icon-background.png` | the gradient, full bleed |
| `logo-rounded.png` | the original artwork with its corners made *transparent* instead of black, for the splash screen over its pale background |

**About screenshots.** They must show the app actually working, and right now it
cannot: the backend is unreachable, so every screen would show an error or an
empty state. Take them once the backend answers again — from a phone, or from the
Pixel 7 emulator already configured on this machine — signed in to a business
with a few weeks of data, so the charts have something in them.

A good set of five: the Log (tap-to-record) screen, the week forecast, what to
order, busy hours, and the insights view.

---

## 5. Draft listing text

### App name — 26 characters

    Ope — Know Tomorrow, Today

If you would rather the name carried search terms, this also fits in 30 and says
what it does: `Ope: Forecast & Stock Orders`. The first is truer to the calm,
branded feel the product is built around; the second will be found by more
people. Your call.

### Short description — 70 characters

    Know how busy tomorrow will be, and how much to order.

### Full description

    Ope helps you decide how much to order and how many people to put on — using
    what your own shop has actually sold.

    You log what you sell. Either tap a button for each sale as it happens, or
    type the day's totals at closing time. Ope learns your pattern and tells you
    what is coming.

    WHAT OPE TELLS YOU

    • How busy tomorrow and next week will be, day by day
    • How much of each product to order, and when to order it
    • Which hours are your busy ones, and how many people you need on the floor
    • Whether an advert or an event actually brought people in
    • When something is changing — a day that is quietly slipping, a regular you
      are losing, a rush that has moved to a different hour

    BUILT FOR A SHOP, NOT FOR AN ACCOUNTANT

    There is no jargon. Ope says "order more when you drop below 73", not
    "reorder point". Every screen has one job and big, clear buttons. If even
    that feels technical, a setting makes the wording simpler still.

    YOU TEACH IT, IT LISTENS

    Ope never pretends to know your world better than you do. Mark a festival,
    tell it that a school group comes in every Sunday morning, flag a strange day
    as a one-off — and it folds that in instead of arguing with you. The longer
    you use it, the better it fits your shop.

    ALSO IN THE APP

    • Stock tracking with batches and expiry dates, so the oldest sells first
    • Your regular customers, and what each is worth to you
    • Bookings and appointments, if you take them
    • Import your past sales from a spreadsheet to get started faster
    • 15 languages, including Hebrew, with full right-to-left support
    • Light and dark mode
    • The same account on your phone and on the web

    HONEST ABOUT WHAT IT NEEDS

    Ope needs roughly two to four weeks of your data before its forecasts are
    worth trusting. It says so on screen, rather than showing you a confident
    number it has not earned. It tells you how accurate it has been, and it gets
    better as you use it.

    Free to use, with everything that affects accuracy included. Paid plans lift
    limits — more locations, longer history, no adverts — and never make the
    forecast better. That would be the wrong thing to charge for.

About 1,900 characters, well inside the 4,000 limit.

**Hebrew listing.** The launch is Israel, so the listing should exist in Hebrew
too — and it should be **written by a native speaker, not machine-translated**.
Store copy is the first thing an owner reads, and awkward marketing Hebrew costs
more trust than the time it saves. This belongs with `REVIEW_TRANSLATIONS.md`.

---

## 6. Privacy policy

**The URL to give Play:**

    https://ope-forecast-bngx.vercel.app/privacy

**It did not work before today.** `vercel.json` has rewritten `/privacy` to
`/privacy-policy.html` for months, but the file lived at the repository root,
which Vercel never deploys. Both `/privacy` and `/privacy-policy.html` were
quietly returning the app's `index.html` instead — with a 200, so nothing looked
broken to anyone who did not read the page. The file now lives in `web/public/`,
which Vite copies into the build verbatim, the same way `/download.html` already
worked. The download page's own link pointed at `/privacy.html`, a third address
that never existed anywhere; that is now `/privacy` as well.

Reachability still has to be confirmed against the live site after the next
Vercel deploy — see the note in `VERIFICATION.md` about what Vercel is currently
serving.

### What was out of date in it

It was written on 22 June and predates several features. Brought into line with
what the code actually does:

* it now says it covers **the Android app** as well as the website;
* **what is collected** now names sale timestamps, prices and currency, stock and
  deliveries, bookings, and marked events — not just "sales and settings";
* **Telegram** was missing entirely, and it matters: linking it means Ope's
  messages travel through Telegram's servers. Both the stored chat identifier and
  the outbound messages are now described, along with the fact that nothing
  reaches Telegram if it is never connected;
* **Sentry** now says what an error report can actually contain;
* the flat "no advertising profiling" line now also states that there are **no
  analytics or advertising trackers at all** and that the app asks for **one
  permission** — which is the claim section 2 actually supports;
* **encryption in transit** is stated, because the Data safety form declares it
  and the two must agree;
* **deletion** now describes a route rather than "contact us", under a stable
  anchor at `/privacy#delete`, which is the link Play asks for.

One thing the policy claims that the product does not yet deliver: that an
account can be deleted on request. Honour that by hand until section 8 is built.

---

## 7. Data safety form — the answers, taken from the code

Play requires this to match reality, not the privacy policy's intentions. Every
row below came from the models in `backend/app/models/` and from what the two
clients actually send.

### Data collected

| Play category | Type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|---|
| Personal info | **Email address** | Yes | No | Required | Account management, authentication |
| Personal info | **Name** | Yes | No | **Optional** | App functionality — only if the owner uses Regulars, and it is their *customers'* names they type |
| Personal info | Other info | Yes | No | Optional | App functionality — free-text notes on days and on regulars |
| Financial info | **Other financial info** | Yes | No | Optional | App functionality — product prices, per-customer spend, event costs. The owner's own trading figures, never a payment instrument |
| Financial info | Payment info | **No** | — | — | Nothing takes money yet; the payment provider is a stub |
| Financial info | Purchase history | **No** | — | — | same |
| App activity | **Other actions** | Yes | No | Required | App functionality, and analytics — the sales, customer counts, stock, orders and bookings the owner logs. This is the product |
| App info & performance | Crash logs | **No** | — | — | see the note below |
| App info & performance | Diagnostics | **No** | — | — | same |
| Device or other IDs | any | **No** | — | — | No advertising id, no device id, no analytics SDK. The Telegram chat id is supplied by the owner through a code, not read off the device |
| Location | any | **No** | — | — | Never requested, never derived |
| Messages, Photos, Audio, Contacts, Calendar, Health | any | **No** | — | — | None of these are touched |

**Crash logs — understand this one before answering.** The web app reports
crashes to Sentry. **The Android app does not: there is no Sentry in `mobile/` at
all.** So for the Android app the honest answer today is No. If Sentry is added
to the phone — and it should be, see section 8 — this row becomes
"Crash logs: Yes, not shared, required, purpose: analytics", and the form has to
be updated before that build ships.

**Files.** CSV import reads only the one file the owner picks, and only to turn
it into the same sales figures they could have typed by hand. Nothing scans their
storage and the file itself is neither uploaded nor kept. Declared as the
business data it becomes, under App activity, rather than as "Files and docs".

### Sharing

Answer **No** to sharing. Supabase, Render, Vercel and Sentry are service
providers processing on Ope's behalf, which Google's own definition excludes from
"shared". Telegram is genuinely different — that data does leave to a third party
— but only when the owner deliberately connects it, which is Google's "transfer
at the user's direction" exception. Say so in the free-text if there is room: it
costs nothing and it is the truthful framing.

### Security practices

| Question | Answer | Basis |
|---|---|---|
| Is data encrypted in transit? | **Yes** | Every call from both clients is HTTPS; Render and Supabase serve nothing else |
| Can users request data deletion? | **Yes** | By email, documented at `/privacy#delete` |
| Does the app follow the Families policy? | Not applicable | Not aimed at children |
| Has the app been independently validated against a security standard? | **No** | Nobody has audited it. Say no |

---

## 8. What still blocks submission

### In-app account deletion does not exist — a hard blocker

Play requires any app that lets people create an account to offer deletion
**from inside the app**, and to publish a **web link** for the same request.
Searching the whole repository for account deletion finds nothing on either
client and no endpoint behind them. Deleting a *business* and a *location*
exists; deleting the *account* does not.

The web-link half is now satisfied by `/privacy#delete`. The in-app half is not,
and Play rejects submissions for it.

It is a contained job: a "Delete my account" action in Settings with a real
confirmation, an endpoint that removes the businesses and everything beneath them
(`business_cascade.py` already knows the order Postgres insists on), and a call
to Supabase's admin API to remove the auth user — which needs the service-role
key as a new environment variable on Render.

That last part is a new secret and a new destructive endpoint, so it has **not**
been built without asking.

### The backend is down — blocks everything downstream

`ope-forecast-dj78.onrender.com` accepts a TLS connection and then never answers,
across repeated attempts of up to four minutes. An app submitted in this state
would fail review at first launch, and no screenshot can be taken until it is
back. See `VERIFICATION.md`.

### The phone has no crash reporting

The web app has Sentry; the phone has none. The first beta tester whose app
crashes on a handset you have never seen will simply stop using it, and you will
never find out why. `@sentry/react-native` is a new dependency, so this is a
question rather than a change.

### Nothing has run on a phone

Covered in `MOBILE.md` and `VERIFICATION.md`. The on-device checklist has not
been worked through.

---

## 9. Content rating questionnaire

Ope is a business tool with no objectionable content, so expect **Everyone /
PEGI 3**. The questionnaire takes about five minutes; these are the answers that
apply.

| Question | Answer |
|---|---|
| Category | **Utility, Productivity, Communication or Other** — not a game |
| Violence, blood, sexuality, nudity | No, to all of them |
| Crude humour, profanity, horror | No |
| Drugs, alcohol, tobacco | No |
| **Gambling**, simulated or real | **No.** Forecasting is not gambling and there is nothing to wager. Answer no without hesitating |
| Does the app share the user's **location** with other users? | **No** |
| Does the app let users **interact or exchange content**? | **No.** Each business's data is its own; there is no messaging between users, no comments, nothing shared. The Telegram link only ever talks to the owner's own chat |
| Does the app let users **purchase digital goods**? | **No today.** Change it to yes when billing ships |
| Does the app contain **user-generated content shown to others**? | **No** |
| Does the app collect or share personal information? | **Yes** — and it must match the Data safety form in section 7 |

Separately, in the **App content** section: declare **no ads** for as long as
none ship, and set the target audience to **18 and over**.

---

## 10. The order to do things in

1. Get the backend answering again — nothing below can be checked until it does.
2. Build in-app account deletion (needs a decision — section 8).
3. Add Sentry to the phone (needs a decision — section 8).
4. Run the app on a real phone and work through the on-device checklist.
5. Register the Play developer account — $25, and the identity check takes days.
6. Take screenshots against real data, and make the 1024 × 500 feature graphic.
7. Have the Hebrew listing copy written by a person.
8. `npx eas-cli build --profile production`, then upload.
