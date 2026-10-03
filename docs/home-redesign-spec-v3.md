# Home Redesign — Spec and Task Cards (v3)

Supersedes the home layout in design system v2 §9 and migration session M3. Everything
else in v2 and the M1/M2 Paper theme still applies unless revised below.

**Direction:** Google's Material 3 simplicity, made calm and cozy. Generous whitespace,
soft rounded shapes, tonal surfaces instead of heavy shadows, friendly plain-language
copy, rounded icons. Quiet by default, clear when something matters.

---

## Part 1 — Design direction

### What "Google simplistic" means here

- **Material 3 type variants only.** Use Paper's MD3 text variants. Do not invent custom
  font sizes — this is the fastest route to a coherent, Google-feeling hierarchy.
- **Tonal surfaces, not shadows.** Cards separate from the background by tone. Use Paper's
  `Card mode="contained"` or low elevation. No dramatic drop shadows.
- **Big soft radius.** Cards 16, chips 8, buttons fully rounded (Paper default).
- **Leading icons in tinted circles.** Paper `Avatar.Icon` — how Google signals type.
- **One primary action per screen**, as a floating action button.
- **Whitespace over dividers.** Sections separate by space and a section title, not lines.
- **Warm, plain copy.** "All quiet nearby" rather than "No active alerts found."

### Type mapping — use these MD3 variants

| Element | Paper `variant` |
|---|---|
| Greeting | `headlineMedium` |
| Greeting subline | `bodyLarge`, `text.secondary` |
| Section title | `titleMedium` |
| Alert headline | `titleMedium` |
| Alert metadata | `bodyMedium`, `text.secondary` |
| Empty-state title | `titleLarge` |
| Empty-state body | `bodyLarge`, `text.secondary` |
| Chip / trust label | `labelLarge` |

All distances, times and counts use `fontVariant: ['tabular-nums']`.

### Color — unchanged from v2

Soft neutrals for all chrome. Saturated color only for hazard severity. `accent.calm`
(`#6B8F87` light / `#7FA79E` dark) for reassurance — the empty state, the greeting status
dot, confirmations.

### Icons

Paper's default icon set (MaterialCommunityIcons). Prefer outlined and rounded forms —
they read softer. Suggested:

| Use | Icon |
|---|---|
| All-quiet empty state | `shield-check-outline` or `weather-sunny` |
| Flood | `waves` |
| Fire | `fire` |
| Earthquake | `pulse` |
| Storm | `weather-lightning-rainy` |
| Landslide | `image-filter-hdr` |
| Other | `alert-circle-outline` |
| Radius chip | `map-marker-radius-outline` |
| Report FAB | `plus` |

Severity is still encoded three ways (see Part 3): **color**, **text label**, and a
**distinct shape** — here via the icon's container shape or a small severity glyph beside
the label. Never color alone.

---

## Part 2 — Home layout

```
┌────────────────────────────────────┐
│                                    │
│  Good morning, Maya                │  headlineMedium
│  ● Watching within 25 km           │  bodyLarge, accent.calm dot
│                                    │
│  Alerts near you                   │  titleMedium
│  ┌──────────────────────────────┐  │
│  │ (≈)  Flood warning      High │  │  alert card
│  │      National Weather Svc    │  │  trust chip
│  │      3.2 km · 14 min ago     │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │ (!)  Rockslide reported      │  │  unverified — recessed,
│  │      Unverified · 8 km       │  │  neutral icon
│  └──────────────────────────────┘  │
│  See all alerts                    │  text button, only if > 3
│                                    │
│  Map                               │  titleMedium
│  ┌──────────────────────────────┐  │
│  │                              │  │
│  │   static preview, 16:10      │  │  tap anywhere → full map
│  │   pins + radius circle       │  │
│  │                              │  │
│  │  [◎ Within 25 km]            │  │  radius chip, tappable
│  └──────────────────────────────┘  │
│                                    │
│                        [+ Report]  │  extended FAB
└────────────────────────────────────┘
      Home     Assistant    Settings
```

### Empty state (no alerts within radius)

```
│  Alerts near you                   │
│  ┌──────────────────────────────┐  │
│  │                              │  │
│  │          ( ✓ )               │  │  Avatar.Icon, accent.calm
│  │                              │  │  tonal container, size 64
│  │     All quiet nearby         │  │  titleLarge
│  │                              │  │
│  │  No alerts or reports within │  │  bodyLarge, secondary
│  │  25 km. We'll let you know   │  │
│  │  if anything changes.        │  │
│  │                              │  │
│  │     Checked 2 min ago        │  │  bodyMedium, faint
│  └──────────────────────────────┘  │
```

This is the only centered block in the app. It should feel like good news: soft sage
tones, generous padding, no warning colors, no exclamation marks.

### Scroll architecture — required

- **The whole home screen is one vertical scroll.** One `ScrollView`, nothing nested inside
  it that also scrolls.
- **The alert list is not its own scroll area.** Home shows at most **3** alerts inline,
  highest severity first. If there are more, a "See all alerts" text button opens a
  dedicated Alerts screen, which uses `FlatList`.
- **The map preview does not respond to pan or zoom.** It is a static preview. Tapping it
  anywhere opens the full-screen map. This avoids the map fighting the page scroll.
- Rendering up to 3 items directly inside the ScrollView is acceptable. Any list that can
  exceed that belongs on its own screen with `FlatList`.

### Greeting

- Time-based: "Good morning / Good afternoon / Good evening, {first name}"
- First name from the Firebase user's `displayName`; if absent, omit the name
- Subline: status dot in `accent.calm` + "Watching within {radius} km"
- Offline: subline becomes "Offline — showing saved info" with a neutral dot. No banner.

---

## Part 3 — Alert card (revised trust treatment)

The colored left edge is replaced by a **leading severity icon in a tinted circle**. The
trust rules are unchanged in intent.

### `official_confirmed`
- `Card mode="elevated"` (low elevation)
- Leading `Avatar.Icon`: hazard icon, container tinted with the **severity color**
- **Filled** `Chip` with agency name, e.g. "National Weather Service"
- Severity text label ("High") on the right in the severity color

### `corroborated_report`
- `Card mode="elevated"`
- Leading `Avatar.Icon`: hazard icon, container tinted with the severity color at 50%
- **Outlined** `Chip`: "Confirmed by 4 nearby"
- Severity text label on the right

### `unverified_report`
- `Card mode="outlined"` on `bg.recessed`, **no elevation**
- Leading `Avatar.Icon` in a **neutral** container (`bg.raised` / `text.secondary` icon)
  — **never severity-tinted**
- **No chip.** Plain `labelLarge` text: "Unverified · single report"
- Severity text label present but in `text.secondary`, not the severity color

### Hard rules (unchanged)
- An unverified report never uses severity color prominently, never gets a chip, never
  gets elevation
- Trust label always visible — never truncated, never behind a tap, never icon-only
- Official and unverified never look alike at a glance

---

## Part 4 — Map

### Preview card (on home)
- Inside a `Card`, 16:10 `aspectRatio`, radius 16
- Shows: user location, radius circle, pins for every alert/report inside the radius
- **Non-interactive:** no pan, no zoom, no pin taps. The whole card is one tap target.
- Radius chip overlaid bottom-left: `map-marker-radius-outline` + "Within 25 km"
- Tapping the chip opens the radius picker; tapping anywhere else opens the full map

### Full-screen map
- Pan, zoom, and pin selection enabled
- Pins encode severity by color **and** shape; unverified pins neutral
- Radius circle visible; area outside the radius gently dimmed
- Tapping a pin opens a bottom sheet with the alert card (same trust treatment) and a
  "View details" button
- Top bar: back button, title "Map", radius chip
- A "Re-center" button returns to the user's location

### Radius — single source of truth
- One user setting, `nearbyRadiusKm`. Options: **5, 10, 25, 50, 100 km**. Default **25**.
- The **same value** filters the home alert list, the preview, and the full map. The list
  and map must always agree — an alert never appears on one and not the other.
- Changeable from the radius chip (preview or full map) and in Settings.
- Stored locally on the device for now. Passed to `GET /alerts` as `radius_km`.

### Location
- Use device location to center the map and the radius.
- Permission denied: center on the user's first subscribed area and say so in the
  greeting subline ("Watching near Boulder").
- No location and no subscriptions: show a friendly prompt to set an area.

### Environment note
`react-native-maps` renders on real devices (including Expo Go) but **not in web
previews**. On web, show a themed placeholder with the same 16:10 shape and the text
"Map preview available on your phone." Use a `Platform.OS === 'web'` check. Do not build
a fake map.

---

## Part 5 — Task cards

Run one card per session, in order. Standing rules and the M1 theme remain in effect.

---

### Card H1 — Home scaffold and greeting

**Build.** The home screen shell: a single `ScrollView` with safe-area padding, the
time-based greeting with the user's first name, the status subline, the "Alerts near you"
and "Map" section titles, and an extended FAB labeled "Report." Sections below the titles
are empty placeholders this session.

**States.** Morning / afternoon / evening greeting; name present / absent; online /
offline subline.

**Out of scope.** Alert cards, empty state, map, radius, navigation beyond the FAB press
handler.

**Acceptance.**
- One vertical `ScrollView`; nothing nested scrolls
- Greeting uses `headlineMedium`, subline `bodyLarge` with an `accent.calm` dot
- Offline changes the subline only — no banner
- FAB does not cover content: bottom padding accounts for it
- No custom font sizes — MD3 variants only
- Checked at 320 / 390 / 430 width and 200% font scale, both themes

---

### Card H2 — Alert list section and cozy empty state

**Build.** Revised `AlertCard` per Part 3, and the "Alerts near you" section: up to three
cards, highest severity first, "See all alerts" when there are more. When there are none,
the cozy empty state from Part 2.

**States.** 0 alerts (empty state); 1–3 alerts; more than 3 (see-all shown); mixed trust
levels; loading; offline with cached alerts and their age.

**Out of scope.** The full Alerts screen behind "See all" (stub the navigation), the map,
real API wiring (mock data is fine this session).

**Acceptance.**
- All twelve trust × severity combinations render correctly in a dev route
- Unverified: outlined recessed card, neutral icon, no chip, no elevation
- Empty state feels like good news: sage tones, soft icon, no warning colors
- Empty state copy includes the current radius ("within 25 km")
- Never more than 3 cards on home
- Both themes, all widths, 200% font scale

---

### Card H3 — Map preview card and radius setting

**Build.** The static map preview card per Part 4, the radius chip, a radius picker
(bottom sheet or dialog with the five options), and the `nearbyRadiusKm` setting stored
locally. The radius must drive both the preview and the H2 alert list.

**States.** Map loaded; web placeholder; location denied (fallback to subscription area);
no location and no subscriptions (friendly prompt); offline (last known view, stated).

**Out of scope.** Full-screen map (stub the navigation), pin interaction.

**Acceptance.**
- Preview is non-interactive; the whole card is one tap target
- Radius chip opens the picker; changing radius updates the list and preview together
- Radius persists across app restarts
- On web, placeholder renders instead of a map, same shape
- Preview uses `aspectRatio`, never a fixed height
- Both themes, all widths

---

### Card H4 — Full-screen map

**Build.** The full map screen per Part 4: pan, zoom, pin selection, radius circle with
dimmed outside area, pin bottom sheet with the alert card, re-center button, radius chip
in the top bar.

**States.** Loaded; selected pin; no pins in radius (friendly message on the map);
location denied; offline; web placeholder.

**Out of scope.** Alert detail screen (stub "View details"), clustering, routing.

**Acceptance.**
- Pins show severity by color and shape; unverified pins neutral
- Bottom-sheet alert card uses the identical trust treatment from H2
- The set of pins exactly matches the home list for the same radius
- Smooth with 100+ pins
- Both themes, all widths

---

## Self-review additions for these cards

Add to the standing self-review:

- **SCROLL:** confirm nothing on home scrolls independently of the page, and the preview
  map ignores gestures.
- **CONSISTENCY:** confirm the list and the map show the same alerts for the same radius.
- **TONE:** does the empty state read as good news? Any warning color or alarm language in
  a calm state is a defect.

---

## Part 6 — Fixes from the current build

Observed in the build as of Sep 21. Each is now an explicit rule; H1 and H2 must verify
all of them.

### 6.1 No vertical centering, no filler height
The current home has two large empty bands around the status line — a leftover of the v1
centered status block.
- No `flex: 1`, `minHeight`, or `justifyContent: 'center'` on any home section
- Delete the v1 `StatusBlock` component entirely; the greeting in H1 replaces it
- Content starts directly below the safe area, top padding 16
- Section spacing is fixed at 24 between sections, 12 between cards — nothing else

### 6.2 Trust is never a text prefix
The current Nearby list writes "Unverified:" into the headline and renders the unverified
item identically to a verified one. This violates the core trust rule.
- The word "Unverified" never appears inside a headline string
- Nearby is removed as a separate section; all items go in the single "Alerts near you"
  list using `AlertCard` and its Part 3 treatments
- An unverified item must be distinguishable from a verified one **with the text
  unreadable** — by card mode, elevation and icon tint alone

### 6.3 The chip is quiet
The current filled chip is the brightest element on screen and out-shouts the headline.
- Filled chips use a **tonal** container — set the theme's `secondaryContainer` to a soft
  neutral close to `bg.recessed`, with `text.primary` label text
- A chip must never be higher contrast than the card's headline
- No white or near-white chips in dark mode

### 6.4 Say things once
The current card shows the agency name twice.
- The chip carries attribution. The metadata line is **distance · time only**
- Each fact appears once per card

### 6.5 One card language
The current screen mixes left-bar filled cards and plain outlined boxes.
- Every alert, at every trust level, is an `AlertCard`
- No other card-like component appears in the alert list

### 6.6 Headline copy
Current headlines are long title-case strings split with em dashes ("Flash Flood Warning
— Russian River Basin").
- Sentence case: "Flash flood warning"
- Place names move to the metadata line: "Russian River Basin · 3.2 km · 14 min ago"
- Headlines wrap to at most two lines

### 6.7 Theme default
The build renders dark. Light is the default per M1 unless the device is set to dark.
Confirm the theme follows system preference and that light renders correctly — do not
review only in dark mode.

### Self-review addition
- **REGRESSIONS:** confirm each item in Part 6 is resolved, one line each.
