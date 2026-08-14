# Phase 5 — release checklist

What is done, what only you can do, and what is blocked on something else.

The listing copy and form answers live in [store-listing.md](store-listing.md).
This file is the running order.

---

## The dependency worth reading first

Phase 5's gate is *production access granted*. Play will not grant it until a
closed test has run with **at least 12 testers opted in for 14 continuous days**,
and the clock only starts once both the testers and an approved build exist.

The roadmap's plan was to recruit those testers from people already playing the
web version. **Nobody has played the web version.** Phase 2's gate — ten players,
three of them watched — has never been met, so there is no pool to recruit from
and the fourteen-day clock cannot start.

That makes the playtest the critical path for Phase 5, not the build. A build
sitting in review with eight testers is fourteen days that have not begun.

It is also worth doing for its own sake: the last time real play was simulated
rather than observed, a guard that made **four levels in five unbuildable** had
been shipping happily through a green suite.

---

## Done, in the repo

- [x] **Privacy policy**, written and hosted — `app/web/privacy.html`, deployed to
      `https://nuenoir.github.io/factory-puzzle/privacy.html`. The deploy workflow
      copies it alongside the bundle, so rebuilding the app cannot break the store
      link. Every claim in it was checked against the code: no network calls, no
      analytics, `localStorage` the only storage.
- [x] **Listing copy** — name, short description (79 of 80 characters), full
      description.
- [x] **Content rating answers** — all no, expected Everyone.
- [x] **Data safety answers** — "collects no data", with the reasoning for why
      local history is not "collection" under Play's definition.
- [x] **`versionCode`** added to the Android config. Play orders releases by this
      integer; it must rise on every upload and can never be reused, including
      after a rejected build.
- [x] **`permissions: []`** declared explicitly rather than left to inference.

---

## Only you can do these

Each needs a Google account, a payment, or your identity. None of them can be
scripted from here.

- [ ] **Play Console developer account** — one-off fee, identity verification.
      Verification has taken people days; start it before you need it.
- [ ] **Expo account and `eas-cli`** to produce an Android build. This is a new
      dependency and a login, which is why it has not been added: CLAUDE.md says
      do not add dependencies without asking. Say the word and it goes in.
- [ ] **Upload keystore.** Let Play manage signing and keep the upload key
      backed up somewhere that is not only this laptop. Losing it means never
      updating this listing again under this package name.
- [ ] **Icon and feature graphic.** Artwork, not copy — see the sizes in the
      listing doc. A generated placeholder would be worse than a plain one.
- [ ] **Screenshots.** Take them from the web build at a phone viewport, of a
      *solved* factory with items on the belts.
- [ ] **Recruit 12 testers** and get them to opt in. See the dependency above.

---

## Verify on the first real build

Things that are probably fine and are not yet *known* to be fine, because
nothing here can build or run an Android app.

- [ ] **Remove the `INTERNET` permission.** The RN template adds it and this app
      never makes a request, so `blockedPermissions: ['android.permission.INTERNET']`
      is the right end state — it makes the Data safety answer structurally true
      rather than merely accurate. It is deliberately *not* set yet: an untested
      config that breaks the runtime is worse than one that over-declares. Add it,
      build, and confirm the app still starts and plays offline.
- [ ] **`localStorage` on Android.** History persistence is verified in a desktop
      browser. React Native WebView storage is usually fine, but the streak is the
      one thing a player would be upset to lose. Solve a puzzle, force-quit, reopen.
- [ ] **Portrait lock and safe areas** on a real phone. The board sizes itself
      from the viewport (`cellSizeFor`), which was checked down to 280px wide, but
      a notch is not a narrow viewport.
- [ ] **The share card in a real share sheet.** `navigator.clipboard` needs a
      secure context and a user gesture; the failure path shows the text for
      manual copying and is verified, the success path has only been verified with
      the write stubbed, because a synthetic click cannot grant the permission.

---

## Calendar

The roadmap put the closed test starting **2 October** and production access by
**23 October**, and that ordering is the part that matters rather than the dates:

```
recruit testers ──┐
                  ├─ closed test opens ─── 14 continuous days ─── production review (~1 week)
build + listing ──┘
```

Nothing after "closed test opens" can be hurried, so everything before it should
happen earlier than feels necessary. Today it is the tester pool that is missing,
not the build.
