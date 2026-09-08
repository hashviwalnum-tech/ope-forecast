# Email — how Ope sends it, and how to set it up

There are **two entirely separate email paths**, and each has to be configured
on its own. Forgetting one leaves that half silently dead, which is exactly what
happened: the Render service was recreated, the feedback variables went with it,
and the form has been answering 503 ever since without anyone noticing.

| Path | Sends | Configured where | Uses |
|---|---|---|---|
| **Supabase Auth** | Signup confirmation, password recovery, email-change confirmation | The Supabase dashboard, under Authentication | Whatever SMTP server the dashboard names |
| **The feedback form** | The in-app "send feedback" message, to `hashvi2906@gmail.com` | Render environment variables | `FEEDBACK_SMTP_HOST` / `_PORT` / `FEEDBACK_FROM_EMAIL` / `_PASSWORD` |

Nothing else in the app sends email. Nudges go out over **Telegram** only
(`POST /nudges/send-telegram`). Drift and outlier alerts are shown **in the app**
and nowhere else. `grep -rn "smtplib" backend/app` returns the feedback endpoint
and nothing besides.

They can and should point at the same provider, but that is still two pieces of
configuration.

---

## Why Supabase needs a mail server of its own

Supabase ships a built-in sender so a new project works out of the box. It is
strictly for development: a handful of emails per hour, and it will only deliver
to addresses belonging to the project's own team members. A stranger signing up
would simply never receive anything.

So confirmation cannot be turned on until custom SMTP is in place. Turning it on
first would lock every new user out of an account they cannot confirm.

---

## Do you need to buy a domain?

**Yes, if strangers are going to receive these emails.** About $10–15 a year.

You can technically start without one — Brevo lets you verify a single sender
address, and Resend gives you `onboarding@resend.dev` — but both are testing
arrangements:

* Sending "from" a Gmail address you do not control the DNS for means Gmail's
  own DMARC policy tells receiving servers to reject it. Delivery to strangers
  will be poor to nonexistent.
* Resend's shared testing domain only delivers to your own account address.

A domain also settles what the confirmation email says it is from. `Ope
<hello@ope.app>` reads as a product; `ope.noreply.2024@gmail.com` reads as
something to delete. For an app asking small-business owners to trust it with
their takings, that is not cosmetic.

Buy it wherever you like — Namecheap, Cloudflare Registrar, Porkbun. You will be
adding DNS records to it, so a registrar with a decent DNS panel helps.

---

## Recommended: Resend

**Free tier:** 3,000 emails a month, 100 a day. A pilot will use a handful.

Chosen over Brevo because the SMTP setup is three fields and the domain
verification is copy-paste DNS records with a live checker. Brevo's free tier is
larger per day (300) and it does more besides email, which is exactly why its
setup has more in it. If you already use Brevo for something, use Brevo — the
Supabase side is identical either way, only the host and credentials change.

### 1. Set up Resend

1. Sign up at `resend.com`.
2. **Domains → Add Domain.** Give it a subdomain rather than the bare domain —
   `send.yourdomain.com` is their convention. A subdomain keeps Ope's sending
   reputation separate from any mail you send from the domain yourself.
3. Resend shows you a set of DNS records — typically an `MX` and a `TXT` (SPF)
   on the subdomain, and a `TXT` for DKIM. Add each one exactly as shown in your
   registrar's DNS panel, then press Verify. Propagation is usually minutes;
   allow up to an hour before worrying.
4. Add a DMARC record on the root domain if Resend suggests one. It is a `TXT`
   at `_dmarc.yourdomain.com`; start permissive (`p=none`) and tighten later.
5. **API Keys → Create API Key.** Sending permission is enough. Copy it once —
   it is not shown again.

### 2. What you now have

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `587` |
| Username | `resend` (the literal word) |
| Password | the API key from step 5 |
| Sender address | something `@send.yourdomain.com`, e.g. `hello@send.yourdomain.com` |
| Sender name | `Ope` |

The sender address must be on the domain you verified. Resend will refuse
anything else, which is the point.

---

## Setting it in Supabase

All of this is in the Supabase dashboard for project `nyktzxkkoworphvnurrp`.
Supabase moves its menus around; these are the settings by name, and they are
all under **Authentication**.

### 1. Custom SMTP — do this first

**Authentication → Emails → SMTP Settings** (older dashboards: Project Settings
→ Auth → SMTP Settings).

Enable custom SMTP and fill in the six fields from the table above. Save.

### 2. URL configuration — do this second

**Authentication → URL Configuration.**

* **Site URL:** `https://ope-forecast-bngx.vercel.app`
* **Redirect URLs:** add both
  * `https://ope-forecast-bngx.vercel.app`
  * `http://localhost:5173`

This matters more than it looks. A confirmation link sends the user to an
address, and Supabase refuses any address not on this list. The web app now
passes its own origin when signing up (`emailRedirectTo` in
`web/src/contexts/AuthContext.tsx`), so a link from the live site returns to the
live site and one from a dev server returns to the dev server — but only if both
origins are listed here. If the Site URL is still `http://localhost:5173` from
Phase 2, every confirmation email you send a real owner points at their own
machine, where nothing is running.

### 3. Turn confirmation on — do this last

**Authentication → Sign In / Providers → Email → Confirm email.** Turn it on.

Last, deliberately: with it on and SMTP not yet working, every new signup is
stranded.

### 4. Raise the email rate limit

**Authentication → Rate Limits → "Rate limit for sending emails".** The default
is set for the built-in sender. With your own SMTP it can go up; something like
30 an hour is ample for a pilot and still caps the damage if someone hammers
signup.

### 5. Optional: the email templates

**Authentication → Emails → Templates.** The default confirmation email says
"Confirm your signup" over a bare link. It is worth a minute to make it say Ope,
in plain language. The templates are English-only — Supabase sends one template
regardless of the language the owner chose in the app, which is a real gap for a
fifteen-language product and not one you can close from the dashboard.

---

## Proving it works for someone who is not you

The point of the test is an address you do not control, on a provider that is
not yours, going through the real link.

**Do not use a `+alias` on your own Gmail for this.** It proves the mechanism and
nothing about deliverability: mail to your own address from a domain you set up
is the easy case. Use a free mailbox on a different provider — Outlook, Proton,
Yandex — or better, ask someone else to try it on their own phone.

1. **Check the setting took.** This should now say `"mailer_autoconfirm": false`:
   ```
   curl -s -H "apikey: <the anon key from mobile/.env>" \
     https://nyktzxkkoworphvnurrp.supabase.co/auth/v1/settings
   ```
2. **Sign up** on `https://ope-forecast-bngx.vercel.app` with the outside
   address. You should land on "Check your email", **not** inside the app. Being
   dropped straight into the app means confirmation is still off.
3. **Try to sign in before clicking the link.** It must be refused. This is the
   whole security point: an address nobody has proved they own gets nothing.
4. **Check the inbox — and the spam folder.** Note which one it arrived in. Spam
   placement usually means a DNS record is missing or unverified.
5. **Click the link.** You should land on the Vercel app, signed in. Landing on
   `localhost` means the Site URL or the redirect allow-list is wrong.
6. **Complete onboarding** — business name, opening days and hours, currency —
   and log one day. That data is going into live Postgres.
7. **Sign out and sign back in** with the same address and password.
8. **Then run:**
   ```
   cd backend
   python -m tests.deployment.probe_tenancy
   ```
   With confirmation on it now checks that a signup grants no session and that an
   unconfirmed address cannot sign in, then stops, because it has no mailbox to
   click a link in. To carry on through the cross-tenant isolation checks, give
   it two accounts you have confirmed by hand:
   ```
   python -m tests.deployment.probe_tenancy \
     --confirmed-accounts a@example.com:pw1,b@example.com:pw2
   ```
   Both should be throwaway: it writes day records into the first and deletes
   what it can afterwards.

Delete the test account afterwards from **Authentication → Users**, and clear its
business with `python -m tests.deployment.find_business_orphans
--purge-businesses <id>`.

---

## Password reset

Built, on both clients, and waiting on the SMTP above — Supabase will accept
the request and send nothing until a mail server is configured.

**Web:** "Forgot your password?" under the sign-in form asks for an address and
nothing else. The reply says only that *if* an account exists a link is on its
way — confirming the account would turn the form into a way of finding out who
has one. Clicking the link lands on `SetPasswordPage`, which is shown ahead of
everything else while `recovering` is true. That ordering matters: the Supabase
client reads the token out of the URL and signs the person in before any of our
code runs, so without it the app would simply open and the link would go
unspent.

**Mobile:** the phone asks for the link; the new password is set in a browser.
Catching a recovery link on the phone would mean a URL scheme registered with
both stores and a development build to test it on — a lot of moving parts for a
screen someone may see once. The notice says so in the language the owner
picked, so nobody is left waiting for something to happen in the app.

**Two things to know about the link:**

* It expires in an hour, and Supabase's default rate limit applies to recovery
  emails as well as confirmations.
* Supabase validates the address on this endpoint more strictly than on signup.
  An `@example.com` address can be registered but never recovered — worth
  knowing when you make throwaway accounts.

Verified in a browser against the live project: the request form, the "check
your email" reply, the rejection of an undeliverable address, and the
set-password screen, all in Russian to confirm the layout survives a language
that is not English. What could not be tested is the part that needs a mailbox —
the link itself — because no SMTP server is configured yet. That is step one of
the test plan above.

---

## Moving the feedback form onto the same provider

Currently it authenticates to Gmail with an App Password. That works, but Google
expires App Passwords, disables them when account security settings change, and
rate-limits programmatic sending — and the failure is a 503 the owner sees and
you do not.

The host and port are configuration now, so pointing it at Resend is four
environment variables on Render and no code change:

```
FEEDBACK_SMTP_HOST=smtp.resend.com
FEEDBACK_SMTP_PORT=587
FEEDBACK_FROM_EMAIL=resend
FEEDBACK_FROM_PASSWORD=<the Resend API key>
```

`FEEDBACK_FROM_EMAIL` is doing double duty as the SMTP username, which is why it
is the literal word `resend` here. The address the mail appears to come from is
set in the message itself; if you move to a provider whose username is not the
sender address, that is the line to revisit in `backend/app/api/feedback.py`.

Confirm it afterwards: `GET /health` reports `configured.feedback_email`, and
sending one message through the in-app form should arrive at
`hashvi2906@gmail.com`.

---

## Checking it stayed working

`GET https://ope-forecast-dj78.onrender.com/health` reports
`configured.feedback_email` as a boolean. The Supabase side has no equivalent, so
the check there is the `auth/v1/settings` curl in step 1 above — if
`mailer_autoconfirm` ever reads `true` again, confirmation has been turned off
and anyone can register any address.
