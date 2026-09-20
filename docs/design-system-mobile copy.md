# Design System — Mobile Client (v2)

Supersedes v1. Changes: single-layout home (no calm-empty screen), softer and friendlier
visual direction, simplified trust treatments, responsive rules for real device widths,
Firebase Auth, and an Assistant tab.

A build spec for the AI tooling generating the React Native client. Where this document
and a generated screen disagree, this document wins.

---

## 1. Brief

**Product.** An early-warning app for severe weather and natural disasters, for people in
remote or connectivity-poor places — hikers, trekkers, guides, valley residents.

**Audience.** Someone outdoors. Possibly bad light, rain on the screen, gloves, one hand
free. Possibly worried. Rarely sitting comfortably.

**Primary job.** Show that something is watching on their behalf, and if something is
wrong, say what it is and what to do.

**Tone.** Calm, plain, reassuring. A steady companion, not an alarm panel. The app should
feel like a well-made outdoor tool: simple, unfussy, quietly competent.

**Avoid.** Consumer dashboards, social feeds, engagement mechanics, anything that wants to
be opened daily.

---

## 2. Principles

**1. Show the watch, not the silence.** At rest the app's value is visible evidence that
monitoring is happening — areas watched, feeds current, recent nearby activity. Never a
blank "nothing here" screen.

**2. Saturation means urgency.** All interface chrome is soft and low-saturation. Strong,
saturated color appears *only* for hazard severity. This is what lets someone read
urgency from peripheral vision, and it is why the chrome can be warm and friendly without
competing.

**3. One layout, expanding screens.** A single home composition. Detail lives in screens
reached by expanding a section, not in parallel tabs.

**4. Trust is visible without being loud.** Verified, corroborated and unverified content
are unmistakably different, using elevation and a plain label — not decoration.

**5. Simple over clever.** Fewer borders, fewer rules, more space. If a divider can be
replaced by whitespace, replace it.

---

## 3. Color

Soft, daylight-neutral base. Gentle rather than cold.

### Light (primary)

| Token | Hex | Use |
|---|---|---|
| `bg.base` | `#F7F8F6` | App background. Soft neutral, not cream, not grey-cold |
| `bg.raised` | `#FFFFFF` | Cards |
| `bg.recessed` | `#EFF1EE` | Unverified cards, inset areas |
| `line.hairline` | `#E1E5E1` | Rare dividers |
| `text.primary` | `#1F2A2E` | Body, headings |
| `text.secondary` | `#5F6E73` | Metadata, timestamps |
| `text.faint` | `#93A1A4` | Placeholder, disabled |
| `accent.calm` | `#6B8F87` | Reassurance — "watching", all-clear, success |

### Dark

| Token | Hex | Use |
|---|---|---|
| `bg.base` | `#181D1F` | Soft charcoal, not black |
| `bg.raised` | `#212829` | Cards |
| `bg.recessed` | `#141819` | Unverified cards, inset areas |
| `line.hairline` | `#2E3638` | Rare dividers |
| `text.primary` | `#E9EDEB` | Body, headings |
| `text.secondary` | `#9BA8AB` | Metadata |
| `text.faint` | `#6C797C` | Placeholder, disabled |
| `accent.calm` | `#7FA79E` | Reassurance |

### Severity — the only saturated hues in the product

| Level | Light | Dark |
|---|---|---|
| `low` | `#5B87A0` | `#7BA3B8` |
| `medium` | `#C98A26` | `#E0A33C` |
| `high` | `#C55D23` | `#DD7434` |
| `critical` | `#BC3B32` | `#CE4B41` |

Nothing else in the interface is saturated. No saturated accents, no colored buttons, no
tinted backgrounds.

---

## 4. Typography

**Platform system fonts.** SF Pro on iOS, Roboto on Android. Reasons: the app already
carries a large optional model download so bundle weight matters; system fonts render
instantly offline; and they inherit the user's font-scale accessibility setting for free.

**Tabular figures** (`fontVariant: ['tabular-nums']`) on all measurements — distances,
times, temperatures. Digits must not jitter as values update.

### Scale (base — see §6 for small-width adjustment)

| Token | Size / Line | Weight | Use |
|---|---|---|---|
| `title` | 26 / 32 | 600 | Alert headline |
| `heading` | 19 / 25 | 600 | Section heading |
| `body` | 17 / 25 | 400 | Body, guidance |
| `bodyStrong` | 17 / 25 | 600 | Emphasis |
| `meta` | 14 / 19 | 400 | Timestamps, distance, source |
| `label` | 13 / 17 | 500 | Trust label, chips |

Six steps, down from seven. The `display` step is gone with the calm-empty screen.

Body line length capped around 70 characters.

### Prohibited

- All-caps labels, including trust labels
- Accenting one word in a headline with color, italic or weight
- Eyebrow labels above headings
- Monospace for data labels
- `→` appended to button or link text

---

## 5. Layout and spacing

Base unit **4**. Scale: `4, 8, 12, 16, 20, 24, 32, 48`.

- Screen gutter: `16` (see §6 for small widths)
- Card padding: `16`
- Section gap: `24`
- Minimum tap target: **48×48**, no exceptions

**Radius.** `12` for cards, `8` for chips and inputs, `999` for pills. Softer than v1 —
this carries much of the friendlier feel.

**Elevation.** One soft shadow level only, on raised cards. Unverified cards have no
shadow. Do not invent additional elevation levels.

**Alignment.** Left-aligned throughout. Nothing is centered.

**Dividers.** Use sparingly. Prefer whitespace and section headings.

---

## 6. Responsive rules

Phone widths vary from 320 to 440+ points, and layout must hold across all of them plus
landscape and tablet. This is a build requirement, not a polish pass.

### Breakpoints

| Name | Width | Notes |
|---|---|---|
| `compact` | < 360 | Small phones (SE, older Android) |
| `regular` | 360–413 | Most phones |
| `wide` | 414–767 | Large phones |
| `tablet` | ≥ 768 | Two-column where useful |

### Rules

- **No fixed pixel widths on containers.** Flex and percentages only. A fixed `width: 350`
  is a defect.
- **Gutter:** `12` at compact, `16` at regular and wide, `24` at tablet.
- **Type at compact:** reduce `title` to 22/28 and `heading` to 18/24. Body never shrinks
  below 17 — legibility is the point of this product.
- **Map preview** uses `aspectRatio` (16:10), never a fixed height.
- **Cards** are full-bleed-minus-gutter at all phone widths. At tablet, cap content width
  at 680 and center the column.
- **Text never truncates to a single line** where it carries meaning. Headlines wrap to
  two lines; trust labels never truncate at all.
- **Landscape:** content scrolls; nothing relies on vertical space. Map preview may reduce
  to 16:6.
- **Safe areas** respected on all four edges, including landscape notch insets.
- **Font scaling to 200%** must not clip or overlap at any breakpoint. Test at compact
  width with large text — this combination is where layouts break.

### Verification

Every screen must be checked at 320, 390 and 430 width, in both themes, and at 200% font
scale. State in the self-review that this was done.

---

## 7. Severity encoding

Three signals, always:

1. Color from the ramp
2. A distinct icon **shape** per level — not one icon recolored
3. Text label: Low / Medium / High / Critical

Color alone is defeated by sunlight, rain, cracked screens and colorblindness.

---

## 8. Trust treatment

`verification_label` has three values. They must be distinguishable at a glance. Simpler
than v1 — two signals, elevation and label, rather than four.

### `official_confirmed`
- Raised card (`bg.raised`, soft shadow)
- Solid 3px left edge in the severity color
- Filled pill with the agency name, e.g. "National Weather Service"

### `corroborated_report`
- Raised card (`bg.raised`, soft shadow)
- Solid 3px left edge in the severity color at 50% opacity
- Outline pill: "Confirmed by 4 nearby"

### `unverified_report`
- **Recessed card** (`bg.recessed`, no shadow, hairline border)
- **No left edge**
- Plain text label in `text.secondary`: "Unverified — single report"

### Hard rules
- Unverified never gets a shadow, a severity edge, or a pill
- The trust label is always visible — never truncated, never behind a tap, never an icon
  alone
- Official and unverified content never appear in one list without their treatments intact

This exists because the liability risk in this product is a community report that looks
like a government warning. Deviations are release blockers.

---

## 9. Home — single layout

One composition. Sections appear and disappear; the structure never changes.

```
┌────────────────────────────────┐
│ Watching 2 areas · updated 1m  │  status strip, accent.calm dot
├────────────────────────────────┤
│                                │
│ ▌ Flood              High      │  active alerts, when present
│ ▌ National Weather Service     │  dominant, full trust treatment
│ ▌ 3.2 km · 14 min ago          │
│                                │
│ Nearby                         │
│   Rockslide reported     8 km  │  Tier 0/1, recessed treatment
│   Wind advisory         22 km  │
│                                │
│ ┌────────────────────────────┐ │
│ │      map preview 16:10     │ │  live pins, tap to expand
│ └────────────────────────────┘ │
│                                │
│ Conditions                     │
│   14°C · Rain · River rising   │
│                                │
│ Recent                         │
│   Flood advisory ended  Tue    │  proof of life
│                                │
├────────────────────────────────┤
│  What to do          Report    │
└────────────────────────────────┘
     Home    Assistant   Settings
```

**With no active alert**, the alert block is absent and Nearby moves up. The screen is
never empty — status strip, map, conditions and recent activity always have content.

**When an alert is active**, it is visually dominant: larger type, full treatment, top of
the scroll. Everything below recedes. This preserves "one answer" in a crisis while
keeping the screen useful at rest.

### Tabs
- **Home** — the layout above
- **Assistant** — guidance chat (see §10)
- **Settings** — subscriptions, notifications, theme, account

### Expandable screens
Sections open into their own screens: map preview → full map; an alert → alert detail;
Conditions → detail; Recent → history.

---

## 10. Assistant tab

A guidance assistant answering questions like "what do I do about the flood warning."

**Ships online first.** Backed by the server-side guidance endpoint, grounded in the same
official guidance cards. The on-device model is a later swap behind the same UI — not a
prerequisite, and the tab is not a placeholder.

### Requirements
- Answers cite the guidance cards they came from; every card is tappable to its source
- An answer with no supporting card says so plainly rather than improvising
- Offline: the tab falls back to browsing guidance cards directly, and says why
- Visually distinct from alerts — this is help, never an agency instruction
- Plain conversation UI. No avatars, no typing personality, no chat gimmicks

---

## 11. Component inventory

| Component | States |
|---|---|
| `StatusStrip` | watching · updating · offline · no location |
| `AlertCard` | 3 trust treatments × 4 severities · expired |
| `NearbyRow` | tier 0 · tier 1 · resolved |
| `MapPreview` | loading · loaded · offline-cached · no permission |
| `ConditionsBlock` | current · stale · unavailable |
| `RecentRow` | resolved · expired |
| `AlertDetail` | brief pending · ready · failed · none |
| `BriefPanel` | pending · ready · failed — uncertainty always shown |
| `GuidanceCard` | online · cached · stale >90d · critical-fallback |
| `ReportForm` | hazard · severity · location · note · queued-offline |
| `AssistantThread` | empty · thinking · answered · no-grounding · offline |
| `SubscriptionRow` | active · editing · deleting |

Every list has a designed empty state written as reassurance or invitation, never as
absence.

---

## 12. Offline

A normal state, not an error. Neutral styling, honest messaging, cached content shown
with its age.

- Status strip shows offline inline — no separate alarming banner
- Guidance cards always display `last_reviewed_at`
- Cards older than 90 days show their age in `text.secondary`
- Queued reports show their queue state honestly
- Map states plainly that tiles are cached

---

## 13. Motion

**One orchestrated moment: alert arrival.** A single deliberate transition when a new
active alert appears. That is the product's only signature motion.

Everything else functional only — sheet open, expand, confirm. No section-entry
animations, no ambient looping motion.

`prefers-reduced-motion` respected everywhere; under it, alert arrival is a cut.

---

## 14. Accessibility floor

- Contrast ≥ 4.5:1 body, ≥ 3:1 large text, **both themes**
- Font scaling to 200% without clipping **at every breakpoint**
- `accessibilityLabel` and `accessibilityRole` on every interactive element
- Severity and trust always carry a text label
- Tap targets ≥ 48×48
- No time-limited interactions except the confirm prompt, which is dismissible

---

## 15. Anti-patterns — do not generate

- Identical rounded cards with identical shadows for every content type
- All-caps eyebrow labels above headings
- Metadata joined with middle dots as a house style
- Gradient washes, glassmorphism, decorative blur
- Saturated color anywhere that is not severity
- Engagement mechanics of any kind
- A spinner covering an alert while its brief loads
- Unverified reports blended into official alert lists
- Emoji as severity or status indicators
- Fixed pixel widths on any container

---

## 16. Out of scope

The **reviewer console** is a separate surface — desktop, dense, keyboard-driven. Do not
apply this mobile system to it.
