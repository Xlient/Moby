# Moby brand

- `moby-mark.svg`: the mark ("Sheltered"), a person under two arcs: watched over, warned early.
  Drawn for dark backgrounds and the source of every icon. In the app it is `src/components/MobyMark.tsx`.
- `moby-mark-light.svg`: the same mark for light backgrounds (navy person, deeper teal and gold).
- `moby-icon.svg`: the full-bleed app icon (navy background with a teal glow).
- `render.js`: regenerates the app icons in `assets/` (`icon.png`, the Android adaptive
  foreground, background and monochrome images, `splash-icon.png`, `favicon.png`) and
  `moby-mark.png` for decks. Run it with `sharp` installed: `node render.js`.

## Palette

| Role | Hex |
|---|---|
| Navy (base) | `#0B1F33` |
| Deep navy | `#0E2A44` |
| Teal (inner arc) | `#2DD4BF` |
| Sunbeam yellow (outer arc, accent) | `#FFD34D` |
| Off-white (text on navy) | `#F4F7FA` |
| NVIDIA green (only for NVIDIA references) | `#76B900` |

The mark avoids anything that reads as an emergency service: no crosses, star of life,
shields, badges, sirens or red. Moby watches out for you; it is not the agency.
