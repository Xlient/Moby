# Waypoint brand

- `waypoint-mark.svg`: the mark, a map pin broadcasting a warning. Source of every icon.
- `waypoint-icon.svg`: the full-bleed app icon (navy background with a teal glow).
- `render.js`: regenerates the app icons in `assets/` (`icon.png`, the Android adaptive
  foreground, background and monochrome images, `splash-icon.png`, `favicon.png`) and
  `waypoint-mark.png` for decks. Run it with `sharp` installed: `node render.js`.

## Palette

| Role | Hex |
|---|---|
| Navy (base) | `#0B1F33` |
| Deep navy | `#0E2A44` |
| Alert amber → coral (pin gradient) | `#FFB020` → `#FF5A3C` |
| Teal (calm, "all clear") | `#2DD4BF` |
| Off-white (text on navy) | `#F4F7FA` |
| NVIDIA green (only for NVIDIA references) | `#76B900` |
