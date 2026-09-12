# Where Ope can take money, and what each route costs

Research only — nothing here is built. Checked **2026-09-12**, because this area
changed twice during 2026 and anything written from memory would be wrong.

The decision you actually have to make is narrower than it looks: **the web is
easy and the Android app is the constrained one**, and the constraint depends on
which country your users are in.

---

## 1. The rule that governs the Android app

Google Play's Payments policy: an app distributed on Play that charges for access
to in-app features **must use Google Play's billing system**, unless an exemption
applies.

The relevant exemption is narrow:

> "Purchases of digital goods or services that can only be consumed outside of a
> Play-distributed app and cannot be accessed in a Play-distributed app do not
> require Google Play's billing system."

**That does not cover Ope.** Premium unlocks things the owner uses inside the
Android app — more locations, longer history, no adverts. The moment a purchase
changes what the app does, it is in scope.

There is **no blanket exemption for business or productivity software**. I looked
for one specifically, because the assumption that "B2B is exempt" is widespread
and wrong. The policy's carve-outs are for physical goods, and for a short list
of regulated services — insurance, stock trades, investment advice, tax
preparation. Not SaaS.

### What changed in 2026

Following Epic's win against Google and the US settlement, and the EU's Digital
Markets Act, Google no longer requires Play Billing exclusively **for users in
the US, the UK and the EEA**. Developers there may use alternative billing inside
the app, or link out to a web checkout, with service fees capped below the
standard rate. Reporting and fee payment under those programmes begins
**1 October 2026**.

User-choice billing — where the buyer picks between Play and your processor, and
your fee drops by 4% — runs in Australia, Brazil, India, Indonesia, Japan, South
Africa, South Korea, the UK, the US, and the EEA.

**Israel is on none of those lists.** For an Israel-first launch, the old rules
apply in full: if premium is purchasable inside the Android app, it goes through
Google Play Billing.

---

## 2. The three routes, honestly

### Route A — Google Play Billing in the app

Premium is bought inside the Android app. Google takes **15%** of the first
$1M per year and **30%** above it. At ₪30/month that is about ₪4.50 a month per
subscriber.

- Works everywhere, no policy risk, and it is the purchase flow Android users
  expect — one tap, card already on file, which measurably converts better.
- Google handles VAT. For an Israeli developer without EU VAT registration, that
  is worth real money and real paperwork avoided.
- Costs a Play Billing integration on the phone, plus server-side receipt
  validation, and a second subscription state to reconcile against the web one.
- Cancellations and refunds happen in Google's UI, not yours.

### Route B — web-only purchase, app is sign-in only

Premium is bought on the Ope website. The Android app never sells anything; it
signs in and reflects whatever tier the account already has. This is the
"multi-platform" pattern Google has always permitted, and it is how a great many
business SaaS apps work.

- **No Google cut at all.** You keep everything the web processor leaves.
- Allowed everywhere, Israel included.
- **The catch, and it is a real one:** outside the US, UK and EEA the app may not
  link to the web checkout, or show a price, or tell the user where to go. It may
  not even show an "Upgrade" button that opens a browser. You can email owners
  about it, and you can say whatever you like on your own website — but the app
  must stay silent. Enforcement against apps that quietly add a link is real, and
  the penalty is removal.
- So an Android owner who wants premium has to find out some other way. For a
  product sold person-to-person to small businesses in Israel, that may be
  perfectly survivable. For self-serve growth it is a serious brake.

### Route C — the direct APK from your own website

`web/public/download.html` already exists for this. An APK downloaded from your
own site is outside Play's rules entirely: sell however you like, link however
you like, keep 100%.

- The spec already plans an incentive for direct download plus web signup.
  **Promote it only on the website, never from inside the Play build** — steering
  Play users to an outside payment is exactly the violation that gets apps pulled.
- The honest cost: sideloading means several scary Android warnings, no automatic
  updates unless you build that yourself, and a meaningful share of
  non-technical owners simply failing to complete it. For an audience described
  in the spec as potentially technophobic, treat this as a secondary channel, not
  the main one.

---

## 3. The web side

The spec's finding still holds: **Stripe does not onboard Israeli businesses.**
Two workable shapes:

- **Merchant of record** — Paddle or Lemon Squeezy. They become the seller,
  handle VAT everywhere, and pay you out. Roughly 5% + 50¢ per transaction.
  Costs more than a raw gateway, and removes the entire tax problem, which for a
  solo developer selling internationally is worth it.
- **Israeli gateway** — Tranzila, Cardcom, Meshulam, PayPlus. Cheaper per
  transaction, accepts the local cards Israeli owners actually carry (Isracard,
  Cal, Max) and Bit. You handle VAT and invoicing yourself, and you need the
  business registration finished first.

Either one sits behind the `PaymentProvider` interface already in
`app/billing/provider.py`, so this choice does not change any other code.

---

## 4. What I would do

**Start with Route B, and design so Route A can be added without a rebuild.**

The reasoning: the first users will be a handful of Israeli businesses you reach
directly, not strangers finding you in Play search. For those, "buy it on the
website" costs nothing and gives up no revenue, and the no-linking rule barely
bites because you are talking to them anyway. Meanwhile the web processor has to
exist regardless — the web app is the primary client.

Add Play Billing when self-serve Android signups start mattering more than the
15%. Keeping the tier as one server-side fact about the account, with the
purchase route as a detail underneath, is what makes that a contained change
later rather than a rebuild — which is what the existing provider abstraction is
already set up for.

**What that means concretely, when billing gets built:** the Android app must
ship with *no* upgrade button, no price, and no link — not even a disabled one.
That has to be decided before the UI is built, not retrofitted, because a
premium-gated screen has to say something when an Android owner reaches it.
"Premium is not available on this device" is allowed; anything that points at
where to buy it is not.

---

## 5. If this is wrong in three months

Every fee and country list above has moved at least once this year, and the US
programme's reporting obligations only begin in October. Re-check before
committing, particularly:

- whether Israel has been added to the alternative-billing or user-choice
  programmes;
- what the US and EEA fee caps settle at once the reporting period starts;
- whether the no-linking rule outside those regions survives further litigation.

**Sources**

- [Target API level requirements for Google Play apps](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en)
- [Understanding Google Play's Payments policy](https://support.google.com/googleplay/android-developer/answer/10281818?hl=en)
- [An update regarding Google Play's policies for developers serving users in the US](https://support.google.com/googleplay/android-developer/answer/15582165?hl=en)
- [Understanding user choice billing on Google Play](https://support.google.com/googleplay/android-developer/answer/13821247?hl=en)
- [Offering an alternative billing system for users in the EEA](https://support.google.com/googleplay/android-developer/answer/12348241?hl=en)
- [Expanded billing choice and lower fees on Google Play](https://android-developers.googleblog.com/2026/06/play-expanded-billing.html)
