---
name: skymetropolis-asset
description: Design 3D landmark and building assets for the SkyMetropolis city builder as JSON "shape scripts" (boxes, cylinders, cones, spheres, rings, pyramids). Use when asked to create, design or modify a SkyMetropolis monument, landmark or building asset.
---

# SkyMetropolis asset designer

SkyMetropolis is an isometric 3D city builder. Players design landmarks ("monuments") as JSON shape scripts, place them in their cities, and license them to friends. You write the JSON; the game draws it. The JSON is data only: never include code, functions, comments or links.

## Output
Reply with **one JSON object only** (no explanation), in this format:

```json
{
  "format": "skymetro-asset",
  "version": 1,
  "name": "Short name (max 40 characters)",
  "description": "One sentence (max 200 characters)",
  "tier": "monument",
  "footprint": [1, 1],
  "parts": [ { "shape": "box", "position": [0, 0.5, 0], "size": [0.5, 1, 0.5], "color": "#e2e8f0" } ]
}
```

## Coordinates
- 1 unit = 1 map tile. **y is up**, y = 0 is the ground. x runs east, z runs south.
- The footprint is **centred on the origin**: a footprint of [w, d] covers x from -w/2 to +w/2 and z from -d/2 to +d/2.
- Everything must stay inside the footprint and above the ground. Leave a small margin (about 0.05) from the edges.

## Tier and footprint
- `"monument"` (Monument): up to 3 tiles tall on a 1×1 footprint, +1 per extra tile of the longer side. Costs $400, earns $20/day tourism and +2 move-ins/day per footprint tile, upkeep $2/day per tile.
- `"grand"` (Grand Monument): up to 5 tiles tall on a 1×1 footprint, +1 per extra tile of the longer side. Costs $1200, earns $60/day tourism and +5 move-ins/day per footprint tile, upkeep $6/day per tile.
- `footprint`: [width, depth] in whole tiles, each 1 to 3. Use 1×1 for towers and statues; 2×2 or 3×3 for temples, stadiums, gardens; 3×1 for gates and long halls.

## Parts
Each part is one simple shape:
- `shape`: one of `box`, `cylinder`, `cone`, `sphere`, `torus`, `pyramid`. A `pyramid` is a square-based cone; a `torus` is a flat ring lying on the ground plane (stand it up with rotation [90, 0, 0]).
- `position`: [x, y, z] of the **centre** of the shape. A box of height 1 standing on the ground has y = 0.5.
- `size`: [width, height, depth] of the shape's bounding box (or one number for all three). A cylinder of size [0.4, 2, 0.4] is 0.4 across and 2 tall.
- `rotation` (optional): [x, y, z] in degrees.
- `color`: hex like `"#e2e8f0"`. Optional `metal` and `rough` (0 to 1), `opacity` (0.1 to 1, for glass).
- `glow` (optional, 0 to 3): the colour shines (lamps, neon, gold tips). Add `"glowAtNight": true` to glow only after dark (windows, lanterns).
- `animate` (optional): `{ "spin": degrees per second around y, "bob": height to float up and down (max 0.5) }`.

## Copies (keep the JSON short)
- `repeat`: `{ "count": 2-50, "offset": [dx, dy, dz], "rotate": [rx, ry, rz] }` makes `count` copies, each moved by `offset` (and turned by `rotate`) from the previous one. Great for floors, stripes, fences, stairs.
- `radial`: `{ "count": 2-64 }` makes copies spaced evenly around the vertical axis, starting from the part's position; add `"radius"` to set the distance from the centre. Great for columns, lanterns, petals.
- At most **300 shapes in total** after copies.

## Design tips
- Start with a base or plinth, then the main body, then details and a crowning top piece.
- Use 3–5 colours that go together; add one glowing accent so it looks good at night.
- Make it recognisable from above at an angle: strong silhouette, contrasting top.
- Thin details smaller than 0.04 won't be visible.

## Examples
### 1×1 monument: lighthouse
```json
{
  "format": "skymetro-asset",
  "version": 1,
  "name": "Harbour Lighthouse",
  "description": "Red and white striped lighthouse with a rotating lamp.",
  "tier": "monument",
  "footprint": [
    1,
    1
  ],
  "parts": [
    {
      "shape": "cylinder",
      "position": [
        0,
        0.05,
        0
      ],
      "size": [
        0.9,
        0.1,
        0.9
      ],
      "color": "#64748b"
    },
    {
      "shape": "cylinder",
      "position": [
        0,
        0.3,
        0
      ],
      "size": [
        0.5,
        0.35,
        0.5
      ],
      "color": "#f8fafc",
      "repeat": {
        "count": 4,
        "offset": [
          0,
          0.7,
          0
        ]
      }
    },
    {
      "shape": "cylinder",
      "position": [
        0,
        0.65,
        0
      ],
      "size": [
        0.48,
        0.35,
        0.48
      ],
      "color": "#dc2626",
      "repeat": {
        "count": 3,
        "offset": [
          0,
          0.7,
          0
        ]
      }
    },
    {
      "shape": "cylinder",
      "position": [
        0,
        2.62,
        0
      ],
      "size": [
        0.55,
        0.06,
        0.55
      ],
      "color": "#1f2937",
      "metal": 0.7
    },
    {
      "shape": "box",
      "position": [
        0,
        2.74,
        0.1
      ],
      "size": [
        0.12,
        0.12,
        0.06
      ],
      "color": "#fef9c3",
      "glow": 3,
      "glowAtNight": true,
      "animate": {
        "spin": 90,
        "bob": 0
      }
    },
    {
      "shape": "cone",
      "position": [
        0,
        2.88,
        0
      ],
      "size": [
        0.45,
        0.24,
        0.45
      ],
      "color": "#1f2937",
      "metal": 0.6
    }
  ]
}
```

### 2×2 grand monument: temple
```json
{
  "format": "skymetro-asset",
  "version": 1,
  "name": "Temple of the Sun",
  "description": "A 2×2 marble temple with a ring of columns and a golden dome.",
  "tier": "grand",
  "footprint": [
    2,
    2
  ],
  "parts": [
    {
      "shape": "box",
      "position": [
        0,
        0.1,
        0
      ],
      "size": [
        1.9,
        0.2,
        1.9
      ],
      "color": "#e7e5e4",
      "rough": 0.8
    },
    {
      "shape": "box",
      "position": [
        0,
        0.25,
        0
      ],
      "size": [
        1.6,
        0.1,
        1.6
      ],
      "color": "#f5f5f4"
    },
    {
      "shape": "cylinder",
      "position": [
        0.65,
        0.9,
        0
      ],
      "size": [
        0.14,
        1.2,
        0.14
      ],
      "color": "#fafaf9",
      "radial": {
        "count": 12
      }
    },
    {
      "shape": "cylinder",
      "position": [
        0,
        1.6,
        0
      ],
      "size": [
        1.55,
        0.15,
        1.55
      ],
      "color": "#e7e5e4"
    },
    {
      "shape": "sphere",
      "position": [
        0,
        1.9,
        0
      ],
      "size": [
        1,
        0.8,
        1
      ],
      "color": "#facc15",
      "metal": 0.9,
      "rough": 0.2
    },
    {
      "shape": "cone",
      "position": [
        0,
        2.45,
        0
      ],
      "size": [
        0.12,
        0.35,
        0.12
      ],
      "color": "#fde047",
      "glow": 1.5
    },
    {
      "shape": "sphere",
      "position": [
        0.85,
        0.35,
        0.85
      ],
      "size": [
        0.12,
        0.12,
        0.12
      ],
      "color": "#fb923c",
      "glow": 3,
      "glowAtNight": true,
      "radial": {
        "count": 4
      }
    }
  ]
}
```

### 1×1 monument: obelisk
```json
{
  "format": "skymetro-asset",
  "version": 1,
  "name": "Sky Obelisk",
  "description": "A tall stone obelisk with a glowing tip and four lanterns.",
  "tier": "monument",
  "footprint": [
    1,
    1
  ],
  "parts": [
    {
      "shape": "box",
      "position": [
        0,
        0.05,
        0
      ],
      "size": [
        0.9,
        0.1,
        0.9
      ],
      "color": "#94a3b8"
    },
    {
      "shape": "box",
      "position": [
        0,
        0.2,
        0
      ],
      "size": [
        0.6,
        0.2,
        0.6
      ],
      "color": "#cbd5e1"
    },
    {
      "shape": "box",
      "position": [
        0,
        1.1,
        0
      ],
      "size": [
        0.3,
        1.6,
        0.3
      ],
      "color": "#e2e8f0",
      "rough": 0.4
    },
    {
      "shape": "pyramid",
      "position": [
        0,
        2.05,
        0
      ],
      "size": [
        0.3,
        0.3,
        0.3
      ],
      "color": "#fde047",
      "glow": 2,
      "metal": 0.8
    },
    {
      "shape": "sphere",
      "position": [
        0.38,
        0.25,
        0
      ],
      "size": [
        0.08,
        0.08,
        0.08
      ],
      "color": "#fef3c7",
      "glow": 3,
      "glowAtNight": true,
      "radial": {
        "count": 4
      }
    }
  ]
}
```

## Checklist before replying
1. Only JSON, nothing else.
2. Every part is inside the footprint (|x| ≤ w/2, |z| ≤ d/2) and its bottom is at y ≥ 0.
3. Nothing is taller than the tier allows.
4. 300 shapes or fewer after copies.
