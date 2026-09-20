# Design System — Mobile Client

A build spec for the AI tooling generating the React Native client. Every token,
state and rule here is a constraint, not a suggestion. Where this document and a
generated screen disagree, this document wins.

---

## 1. Brief

**Product.** An early-warning app for severe weather and natural disasters, for people
in remote or connectivity-poor places — hikers, trekkers, guides, valley residents.

**Audience.** Someone outdoors. Possibly in bad light, bad weather, gloves, rain on the
screen, one hand free, moving. Possibly frightened. Possibly reading this at 3am in a
tent. Rarely sitting comfortably.

**Primary job.** Answer one question first — *am I safe right now?* — and if the answer
is no, say what to do about it.

**Correct usage pattern.** The user almost never opens this app. When they do, something
may be wrong. Design for the moment of use, not for retention.

**Vernacular to draw from.** Field instruments, topographic sheets, weather-service
products, trail signage, marine radios. Things built to be read under duress by someone
who did not choose to be reading them.

**Vernacular to avoid.** Consumer dashboards, social feeds, fitness apps, anything that
wants to be opened daily.

---

## 2. Principles

**1. Warmth means danger.** The entire interface chrome is cold — slate, granite, storm.
Warm hue appears *only* to indicate hazard severity. Nothing decorative is ever warm. A
user learns this rule in one session and can then read severity from peripheral vision
alone.

**2. One answer per screen.** The home screen makes a single statement. Detail is one tap
deeper. Density is noise in a crisis.

**3. Trust is structural, not decorative.** How a claim is verified changes the *shape*
of the thing it is written on, not just its color. See §7 — this is the most important
section in the document.

**4. Calm at rest, loud only when earned.** The 99% state is quiet and reassuring. Only a
real active hazard is permitted to be visually loud.

**5. Nothing announces itself.** No badges, no streaks, no "you haven't checked in." The
app does not compete for attention.

---

## 3. Color

Cool base throughout. Dark mode is the primary theme, not an afterthought — the app is
read at night more than most.

### Base (dark — primary)

| Token | Hex | Use |
|---|---|---|
| `bg.base` | `#131A21` | App background. Cold slate, never warm-black |
| `bg.raised` | `#1C252E` | Cards, sheets |
| `bg.sunken` | `#0E1419` | Map canvas, inset wells |
| `line.hairline` | `#2B3742` | Dividers, card edges |
| `line.strong` | `#41505C` | Structural rules, active borders |
| `text.primary` | `#E7EDF1` | Body, headlines |
| `text.secondary` | `#9DAEBB` | Metadata, timestamps |
| `text.faint` | `#6B7C89` | Disabled, placeholder |

### Base (light)

| Token | Hex | Use |
|---|---|---|
| `bg.base` | `#F1F4F6` | Cool paper. Not cream |
| `bg.raised` | `#FFFFFF` | Cards |
| `bg.sunken` | `#E3E9ED` | Map canvas |
| `line.hairline` | `#D2DAE0` | Dividers |
| `line.strong` | `#93A4B1` | Structural rules |
| `text.primary` | `#141C23` | Body |
| `text.secondary` | `#54646F` | Metadata |
| `text.faint` | `#8493A0` | Disabled |

### Severity ramp — the only warm hues in the product

| Level | Hex (dark) | Hex (light) | Note |
|---|---|---|---|
| `low` | `#6E93A8` | `#4A7186` | **Cold by design.** An advisory is not danger |
| `medium` | `#D9A038` | `#A9762010` | Amber |
| `high` | `#DE6B1E` | `#B4521040` | Orange |
| `critical` | `#D33B31` | `#AE2A22` | Red |

`low` being cold is deliberate and load-bearing — it is what makes the warmth rule
readable. Do not "fix" it to a warmer tone for visual consistency.

### Status

| Token | Hex | Use |
|---|---|---|
| `status.clear` | `#5B9E78` | "No active alerts." Muted, not celebratory |
| `status.offline` | `#7E8C98` | Offline banner. Neutral — offline is not an error |

---

## 4. Typography

**Use platform system fonts.** SF Pro on iOS, Roboto on Android.

This is a considered choice, not a default: the app already faces a large on-demand model
download, so bundle weight matters; system fonts render instantly with no FOUT offline;
and they inherit the user's Dynamic Type / font-scale accessibility setting for free,
which matters more here than a bespoke typeface would.

**Numerals.** Enable tabular figures (`fontVariant: ['tabular-nums']`) on all measurements
— distances, times, magnitudes, countdowns. Digits must not jitter as values update. Do
not substitute a monospace face for this.

### Scale

| Token | Size / Line height | Weight | Use |
|---|---|---|---|
| `display` | 40 / 44 | 600 | Home status statement only |
| `title` | 28 / 34 | 600 | Alert headline |
| `heading` | 20 / 26 | 600 | Section, card title |
| `body` | 17 / 25 | 400 | Guidance text, brief prose |
| `bodyStrong` | 17 / 25 | 600 | Emphasis within body |
| `meta` | 14 / 19 | 400 | Timestamps, source, distance |
| `micro` | 12 / 16 | 600 | Trust label only |

Line length: cap body text at ~70 characters. Guidance cards get generous leading — they
are read by someone who is not concentrating well.

### Prohibited

- All-caps labels. Including the trust label. Especially the trust label.
- Accenting one word in a headline with color, italic or weight.
- Eyebrow labels above headings.
- A monospace face for small data labels.
- `→` appended to button or link text.

---

## 5. Layout and spacing

Base unit **4**. Scale: `4, 8, 12, 16, 24, 32, 48, 64`.

- Screen gutter: `16`
- Card padding: `16`, `20` for alert cards
- Section gap: `32`
- Minimum tap target: **48×48** everywhere, no exceptions. Gloves, rain, panic.

**Radius.** `8` for cards, `4` for inline chips, `0` for full-bleed banners. Do not apply
one radius uniformly — the banner being square is how it reads as system-level rather
than as another card.

**Alignment.** Left-aligned throughout. The only centered element in the product is the
home status statement.

---

## 6. Severity encoding

Every severity indication carries **three** signals. Never fewer.

1. Color from the ramp
2. A distinct icon shape per level (not the same icon tinted)
3. The text label: "Low" / "Medium" / "High" / "Critical"

Rationale: sunlight, rain, cracked screens, colorblindness, and panic each independently
defeat color alone.

---

## 7. Trust treatment — most important section

`verification_label` from the API has three values. They must be distinguishable at a
glance, across the room, in peripheral vision. **Structural difference, not a badge.**

### `official_confirmed`

- Solid `4px` left rule in the severity color
- Filled source band across the card top, `bg.raised` inverted, showing the agency name
- Card uses `bg.raised`, full opacity
- Trust text: the agency name, e.g. "National Weather Service"

### `corroborated_report`

- **Hatched** `4px` left rule — diagonal stripes in the severity color
- No source band
- Card uses `bg.raised`
- Trust text: "Confirmed by N people nearby"

### `unverified_report`

- **Dotted** `4px` left rule in `text.secondary`, *not* the severity color
- No source band
- Card background: `bg.base` with a `1px` `line.hairline` border — visually recessed
  rather than raised
- Trust text: "Unverified — single report"

### Hard rules

- An unverified report never renders with a source band, never uses a filled severity
  background, and never uses a solid rule.
- The trust text is always present. It is never truncated, never collapsed behind a tap,
  never reduced to an icon.
- Never interleave official alerts and unverified reports in one undifferentiated list
  without their treatments intact.

This section exists because the liability risk in this product is a community report that
looks like a government warning. Treat any deviation as a release blocker.

---

## 8. Component inventory

| Component | States to implement |
|---|---|
| `StatusBlock` | clear · active alert · offline · location unavailable |
| `AlertCard` | 3 trust treatments × 4 severities · expired |
| `AlertDetail` | brief pending · brief ready · brief failed · no brief |
| `BriefPanel` | pending (with expected wait) · ready · failed · uncertainty section always visible |
| `GuidanceCard` | online · cached · stale (>90 days) · critical-fallback |
| `ReportForm` | hazard select · severity select · location confirm · note · queued-offline |
| `ConfirmPrompt` | yes / no / unsure · already answered |
| `MapView` | loading · loaded · offline-cached · no location permission |
| `OfflineBanner` | persistent, dismissible per session |
| `SubscriptionRow` | active · editing · deleting |

Every list has a designed empty state. "No active alerts near you" is a *good* outcome —
write it as reassurance, not as absence.

---

## 9. Screens

Shell is a calm default with a map tab.

```
┌─────────────────────────┐   Home (default)
│                         │
│   [ status icon ]       │
│                         │
│   No active alerts      │  display, centered
│   near you              │
│                         │
│   Checked 2 min ago     │  meta
│                         │
│  ─────────────────────  │
│   Guidance      Report  │  two persistent actions
└─────────────────────────┘
     Home   Map   Settings
```

```
┌─────────────────────────┐   Home (active)
│ ▌FLOOD                  │  title + severity rule
│ ▌National Weather Svc   │  source band
│ ▌                       │
│ ▌Move to higher ground  │  body
│ ▌now.                   │
│ ▌                       │
│ ▌3.2 km · 14 min ago    │  meta, tabular
│  ─────────────────────  │
│   What to do    Details │
└─────────────────────────┘
```

**Map tab.** Events as severity-coded pins, subscription radius as an overlay, user
position anchored. Answers "is this upstream of me?" — which is the real spatial question
in a valley. Must render cached tiles offline and say so.

**Detail.** Alert at top, then brief (or its pending state), then contributing reports
with trust treatments intact, then guidance.

**Report.** Three taps to submit: hazard, severity, confirm location. Note is optional and
last. Must complete fully offline and show "Queued — will send when you have signal."

---

## 10. Offline

Offline is a **normal state**, not an error. Never an alarm color, never a retry-spinner
wall.

- Persistent neutral banner: "Offline — showing saved information"
- Guidance cards show `last_reviewed_at` as a plain date, always
- Cards older than 90 days show "Last updated [date]" in `text.secondary` — inform, do not
  alarm
- Queued reports show their queue state honestly
- The map states plainly that tiles are cached

---

## 11. Motion

**One orchestrated moment: alert arrival.** A new active alert enters with a single
deliberate transition. That is the product's only signature motion.

Everything else is functional only — sheet open, expand, confirm. No fade-and-slide-up on
section entry, no hover-equivalent transitions on cards, no looping ambient animation.

`prefers-reduced-motion` respected everywhere. Under reduced motion the alert arrival is a
cut, not a fade.

---

## 12. Accessibility floor

Non-negotiable, since the use context is already degraded:

- Contrast ≥ 4.5:1 body, ≥ 3:1 large text, verified in **both** themes
- Dynamic Type / font scaling honored up to 200% without clipping
- Every interactive element labeled for screen readers
- Severity and trust conveyed by text, not color or icon alone
- Tap targets ≥ 48×48
- No time-limited interactions except the confirm prompt, which must be dismissible

---

## 13. Anti-patterns — do not generate

- Identical rounded cards with the same shadow for every content type
- A tracked-out all-caps eyebrow above every heading
- Metadata joined with middle dots as a house style
- Gradient washes as decoration
- Engagement mechanics of any kind
- A loading spinner covering an alert while the brief generates — the alert renders
  immediately, always
- Blending unverified reports into official alert lists
- Warm accent color anywhere that is not severity
- Emoji as severity or status indicators

---

## 14. Out of scope

The **reviewer console** is a separate surface with its own system: desktop, dense,
keyboard-driven, built for someone triaging a queue for an hour. Do not apply this mobile
system to it. It will be specified separately.
