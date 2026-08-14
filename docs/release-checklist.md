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
- [x] **`version` set to `1.0.0`.** It was `0.0.0`, which is only a label but
      reads as abandoned on a store page. `versionCode` is the number Play
      actually orders by.
- [x] **`eas-cli` installed** as a root devDependency (v21.8.0), so the version is
      pinned and reproducible rather than whatever happens to be on the machine —
      EAS builds are sensitive to it. It costs about 190 extra packages in
      `node_modules`, and CI installs them without using them.
- [x] **`eas.json`** with two profiles: `preview` builds an **APK** for
      sideloading to yourself or a tester directly, `production` builds an **AAB**,
      which is what Play requires. `appVersionSource: "local"` keeps `versionCode`
      in `app.config.js` rather than letting EAS increment it remotely — one place
      to look, no surprises between a local config and a dashboard.
- [x] **Icons generated** — `app/assets/icon.png` (1024², opaque, as Play requires)
      and `adaptive-icon.png` (1024², transparent foreground). Drawn by
      `scratchpad/make-icon.ts` in pure Node: a PNG is a signature, an IHDR, a
      deflated block of scanlines and an IEND, and `zlib` ships with Node, so no
      image dependency was needed for one flat shape. The mark is the board's own
      hexagon in the board's own green, and the adaptive foreground is drawn at
      56% so a circular or squircle mask cannot clip it.

      They are honest placeholders and they look it — one shape, flat colour.
      Legitimate for a closed test; the public listing still deserves a design
      pass, and the feature graphic is not something a script should invent.

---

## Only you can do these

Each needs a Google account, a payment, or your identity. None of them can be
scripted from here.

- [ ] **Play Console developer account** — one-off fee, identity verification.
      Verification has taken people days; start it before you need it.
- [ ] **`eas login`.** The CLI is installed and configured, but every command
      that touches a build needs an Expo account. `eas config` was run here to
      validate the setup and stopped exactly there, so the config is unverified
      past the point where a login is required.
- [ ] **`eas build --platform android --profile production`.** Nothing in this
      environment can build or run an Android app, so this has never executed.
      Expect the first run to ask about signing.
- [ ] **Upload keystore.** Let Play manage signing and keep the upload key
      backed up somewhere that is not only this laptop. Losing it means never
      updating this listing again under this package name.
- [ ] **Feature graphic** (1024×500). Artwork, not copy. The icons are generated
      placeholders; this one a script has no business inventing.
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
- [ ] **`userInterfaceStyle: 'dark'`** — now set, since the board has one fixed
      palette and never reads the system scheme, so the old `'light'` described an
      appearance the app never has. Web output is unchanged (it is an Android
      setting) and the board still renders clean. What is *not* confirmed is the
      thing it exists for: that Android stops applying forced-dark to an already
      dark surface. Look at the greens on a real device.
- [ ] **The generated icon at real sizes.** It was checked at 1024²; the shape is
      simple enough to survive 48px but that is a prediction, not an observation.

---

## Dependency issues, settled

Found by `npx expo-doctor` while checking the config, and now fixed.
`expo-doctor` goes from 3 failures to 1.

- [x] **Duplicate `react` in the tree.** Expo's packages declare `react` as a peer
      of `*`, so npm auto-installed the newest it could find (19.2.8) and left the
      app's exact `19.2.3` pin as a second, separate copy. expo-doctor is blunt
      about why that matters: *"Native builds may only contain one version of any
      given native module."*

      Fixed with an `overrides` block at the workspace root forcing `react` and
      `react-dom` to **19.2.3** — the version SDK 57 actually expects — so the
      tree dedupes *and* matches Expo's tested combination. Pinning the app to
      19.2.8 instead would also have deduped, but would have put the project five
      patches ahead of the React that Expo tested against, on the one surface
      nothing here can verify.

      npm will not apply a new `overrides` block while it considers the tree
      satisfied; the lockfile entries for the two packages have to be dropped so
      it re-resolves. `npm ci` then reproduces the deduped tree, which is what CI
      runs.

- [x] **Two packages behind what SDK 57 expects.** `expo` 57.0.9 → `~57.0.12`,
      `@expo/metro-runtime` 57.0.8 → `~57.0.9`, via `npx expo install`.

Verified after both: typecheck clean, 277 tests, web build exports, and the board
still places machines, draws belts by drag and advances a tick in the browser.
The Android surface remains unverified, which was the argument for doing this
before a first build rather than debugging a confusing native failure after one.

---

## The Metro config warning, settled

- [x] **`resolver.disableHierarchicalLookup` removed.** It came from the older
      Expo monorepo recipe. Turning hierarchical lookup off leaves the two
      `nodeModulesPaths` entries as the *only* places Metro will look — a strict
      subset of the default — and since every dependency hoists to the workspace
      root, and that root is already listed, the setting was ruling things out
      rather than ruling anything in.

      Verified by building the web bundle with it on and with it off, back to
      back: **byte-identical, same SHA**. The dev server was checked separately,
      because that is the surface the setting most affects — board renders,
      `@factory/sim` resolves, a machine places, belts draw by drag, a tick
      advances, no console errors.

      Worth recording how nearly this went wrong. The first comparison showed the
      bundle 173 bytes *smaller* after the change, which looked like a real
      difference; it was a stale Metro cache from the earlier `npm ci`. Rebuilding
      both variants back to back under identical conditions is what settled it.
      Ordinary caution about editing `metro.config.js` is why the check was worth
      running twice.

`expo-doctor` is now 20 of 21. The one remaining failure is `expo` and
`@expo/metro-runtime` sitting one patch behind — and it is a moving target rather
than a defect: Expo published new patches between fixing this yesterday and
re-checking today. **Run `npx expo install --check` as the first step of building
rather than trying to stay ahead of it.**

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
