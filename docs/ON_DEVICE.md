# Running Ope on your own Android phone, and what to check when it is there

Two halves. The first is how to get the app onto the handset over USB. The second
is the checklist to work through once it is running — the things that genuinely
cannot be judged from a desk, and which nobody has ever checked.

---

## Part 1 — Getting it onto the phone

You need the phone, the USB cable, and this computer. Everything the build needs
is already installed.

### Once, on the phone

1. Open **Settings → About phone**.
2. Find **Build number** and tap it **seven times**. It counts down at you and
   then says "You are now a developer".
3. Go back to **Settings → System → Developer options** (on Samsung it is
   **Settings → Developer options**).
4. Turn on **USB debugging**.

### Every time

5. Plug the phone into this computer with the cable. Use a cable you know carries
   data — plenty of charging cables do not, and a charge-only cable is the single
   most common reason none of this works.
6. The phone shows **"Allow USB debugging?"** with this computer's fingerprint.
   Tick **"Always allow from this computer"** and tap **Allow**. If no prompt
   appears, unlock the phone and unplug/replug.
7. On the phone, pull down the notification shade, tap the **USB** notification,
   and set the mode to **File transfer / MTP**. On some phones "Charging only"
   blocks debugging.

### Then, on this computer

8. Open a terminal in the project and run these two lines, which point the tools
   at the Android SDK and check the phone is visible:

       export ANDROID_HOME="$HOME/AppData/Local/Android/Sdk"
       "$ANDROID_HOME/platform-tools/adb.exe" devices

   You want a line ending in **`device`**. If it says `unauthorized`, you missed
   step 6. If the list is empty, it is the cable or step 4.

9. Then build and install, from `mobile/`:

       export JAVA_HOME="$HOME/.jdks/jbr-21.0.11"
       npx expo run:android

   The first run takes 10–15 minutes: it generates the native project, downloads
   Gradle, compiles, installs, and launches. Later runs are a couple of minutes.

   **`JAVA_HOME` matters.** Android Studio now bundles JDK 25, and Gradle 8.14
   cannot build with it — it fails with "Unsupported class file major version 69"
   after appearing to start normally. The line above points at the JDK 21 already
   on this machine.

10. The app opens on the phone by itself. Leave it connected: edits to the code
    reload on the phone within a second or two, which is what makes the checklist
    below quick to work through.

If something crashes and you want to know why, with the phone still plugged in:

    "$ANDROID_HOME/platform-tools/adb.exe" logcat -s ReactNativeJS:V AndroidRuntime:E

### The alternative, if USB refuses to cooperate

Install **Expo Go** from the Play Store, run `npx expo start` from `mobile/`, and
scan the QR code with the phone's camera. Both devices have to be on the same
Wi-Fi. It is quicker to get going and good enough for almost everything on the
checklist — the exceptions are the launcher icon and the splash screen, which
Expo Go replaces with its own.

---

## Part 2 — The on-device checklist

Group by group, so you can stop after any group and report. Say what looked
wrong even if you cannot say why — "the buttons felt cramped" is a useful bug
report.

### A. It starts at all

- [ ] The app launches without a crash or a red error screen.
- [ ] The **icon on the home screen** shows the gear on the blue-green gradient,
      with no black corners and nothing cut off. Check the app drawer too, and
      long-press it — some launchers use a different mask shape.
- [ ] The **splash screen** shows the logo on the pale background with no black
      box behind it.
- [ ] Sign in works, and it lands on the Log tab.
- [ ] **Close the app completely** — swipe it out of the recent-apps list — and
      reopen it. You should still be signed in, with nothing to type. *(This is
      the one step missing from an otherwise-verified claim about staying signed
      in: the library and the refresh path are proven, an actual cold start on a
      handset is not.)*

### B. The hands part — the reason this cannot be done from a desk

- [ ] On the **Log** screen, tap out ten sales quickly, as you would in a rush.
      Does every tap land? Is anything so small you have to aim?
- [ ] Is any button harder to reach one-handed with a thumb?
- [ ] Open a text field. Does the **keyboard cover the field you are typing in**?
      This is the classic phone bug and it cannot be seen on a desktop.
- [ ] Can you dismiss the keyboard easily and get back to the buttons?
- [ ] Does the **bottom tab bar** sit clear of the gesture bar / home indicator?
- [ ] Rotate nothing — the app is portrait-locked. Confirm it stays portrait.

### C. Reading it

- [ ] Is any text too small to read comfortably at arm's length?
- [ ] Do the charts fit the screen without sideways scrolling or cut-off labels?
- [ ] Turn the phone's brightness right down and stand near a window. Still
      readable?
- [ ] Switch the phone to **dark mode** in its own settings. Every screen should
      follow: no white flashes, no white-on-white, no invisible chart lines.
      Check charts especially — that is where dark mode usually breaks.

### D. Hebrew and right-to-left

- [ ] Switch Ope to Hebrew in Settings.
- [ ] Does the whole layout flip — tab bar, back arrows, chart axes, the lot?
- [ ] Any text overflowing its button, or clipped?
- [ ] Any screen still in English? *(Note it: automated checks prove the strings
      exist, not that every screen uses them.)*
- [ ] Switch back to English. Does everything flip back cleanly?

### E. The real screens

- [ ] **Forecast** — the week prediction, busy hours and what-to-order all render
      with real numbers, not spinners or "—".
- [ ] **Analytics** — staffing, ad/event lift and accuracy.
- [ ] **Manage** — products, regulars, past days, settings, Telegram, premium.
- [ ] **Bookings** — never seen on a phone at all. Look hardest here.
- [ ] The **Privacy Policy** link at the bottom of Settings opens in the browser
      and shows the policy, not the app.
- [ ] Add a product, edit it, delete it.
- [ ] Log a past day through the date picker.

### F. Being on a phone rather than a computer

- [ ] Turn **aeroplane mode on** while the app is open. It should say something
      useful about being offline — not hang on a spinner for ever.
- [ ] Turn it back off. Does the app recover without being restarted?
- [ ] Take a phone call, or switch to another app for a minute, then come back.
      Is the app where you left it?
- [ ] Let the screen lock, then unlock. Same question.

---

## What cannot be known until this is run

Being plain about it, because it is the honest boundary of everything that has
been checked from here:

**Provable without the handset, and proven:** the app compiles; a full production
release bundle builds; the shipped manifest targets Android 16 and requests only
internet access; every TypeScript type checks; the translation suites pass; the
API client points at the right backend; the icon assets composite correctly
inside Android's masks.

**Not knowable until you run it.** All of it is about the physical object:

- whether a tap target is big enough for a real thumb in a real hurry;
- whether the keyboard covers the field under it — depends on the phone's
  keyboard, not on the code;
- whether text is legible on that screen, at that size, in that light;
- whether the RTL flip is right in practice, as opposed to applied;
- whether dark mode looks right on an OLED panel;
- whether the app feels fast, or janky, on that particular processor;
- whether the launcher's icon mask cuts the gear — every manufacturer's is
  different, which is why the safe zone was made generous;
- whether the session really survives a cold start on the device;
- whether anything crashes in a way no simulator reproduces.

**A caveat on Group E:** the backend sleeps after about fifteen minutes idle and
can take a minute or more to wake — occasionally much longer. The first screen
you open may sit there for a while. That is the hosting, not a mobile bug. Open
`https://ope-forecast-dj78.onrender.com/health` in a browser and wait for it to
reply before starting Group E.
