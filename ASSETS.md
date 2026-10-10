# SkyMetropolis asset list

Every 3D object in the game is currently built in code from simple shapes (boxes, cylinders, cones, spheres) in `components/IsoMap.tsx`. This list covers each one with its current size, colours and variants, so it can be replaced by a modelled asset.

## Specs for every asset

- **Scale:** 1 unit = 1 map tile. Model at 1 Blender unit = 1 tile.
- **Origin:** bottom centre, at ground level.
- **Footprint:** buildings fit inside **0.9 × 0.9**, leaving a small gap between tiles.
- **Front:** faces **+Z**. The game rotates each building to a random 90° angle per tile, so all four sides should look finished.
- **Format:** `.glb` (glTF binary), Y-up, low-poly with flat colours. The current look uses flat shading and no textures.
- **Colour variation:** the game shifts each building's colour slightly per tile. Keep the main body as one separate material named `Body` so the game can still tint it.
- **Naming:** `<category>-<asset>-<variant>.glb`, e.g. `house-cottage.glb`, `shop-highrise.glb`, `road-corner.glb`.

## A. Placeable buildings

| # | Asset | Variant | Current shape and size (W × H × D) | Notes |
|---|---|---|---|---|
| 1 | **House** | Cozy Cottage | Body 0.7 × 0.6 × 0.6, 4-sided pyramid roof, ~0.95 tall | 2 windows and a door on the front. Base colour `#f87171` |
| 2 | | Modern Boxy | Two joined blocks (0.6 × 0.7 × 0.8 and 0.4 × 0.5 × 0.6), 0.7 tall | Wide front window |
| 3 | | Townhouse | 0.5 × 1.0 × 0.6 with a flat roof cap, ~1.1 tall | 2 stacked windows |
| 4 | **Shop** | High-rise | 0.7 × 0.7, **height varies 1.5–3.0** | Glass window bands every 0.3, roof cap. Must work at any height: stretchable or modular floors. Base colour `#60a5fa` |
| 5 | | Storefront | 0.9 × 0.8 × 0.8 | Large shop window and a slanted **awning**, red `#ef4444` or blue `#3b82f6` |
| 6 | | Corner Store | Tall block 0.5 × 1.0 × 0.5 joined to a low block 0.7 × 0.6 × 0.7 | Rooftop AC unit, front window |
| 7 | **Factory** | Factory | 0.9 × 0.8 × 0.8, two sloped (sawtooth) roof ridges | **Chimney**, with smoke puffs rising from it (#25). Base colour `#facc15` |
| 8 | | Warehouse | Block 0.5 × 0.6 × 0.9 plus **2 silos** (cylinders, 0.8 tall) | Pipe joining the silos |
| 9 | **Park** | Grass pad | Flat 0.9 × 0.9 light-green square `#86efac` | Base of every park |
| 10 | | Pine tree | Trunk and 2 stacked cones, ~0.85 tall at full size | 1–3 per park, scaled 0.5–1.0, shade of green varies |
| 11 | | Fountain | Stone ring 0.8 across with a water disc | Appears in about 30% of parks |

**Shared part:** a window in glowing light-blue glass `#bfdbfe`, used on houses and shops.

## B. Ground and roads

| # | Asset | Size | Notes |
|---|---|---|---|
| 12 | Grass tile | 1 × 0.5 × 1 block | 3 shades of green, small height differences between tiles |
| 13 | Concrete base | 1 × 0.5 × 1 | Under every building, `#d1d5db` |
| 14 | Road tile | 1 × 0.5 × 1, asphalt `#374151` | Road surface sits slightly above grass |
| 15–20 | Road markings | Yellow centre lines `#fbbf24` | **6 pieces:** straight, corner, T-junction, crossroads, dead end, lone tile. The game picks the piece from the neighbouring roads |

## C. Moving things and effects

| # | Asset | Size | Notes |
|---|---|---|---|
| 21 | **Car** | 0.5 long × 0.15 tall × 0.3 wide; front faces +X | Up to 30 on screen, 6 paint colours. Keep under ~300 triangles, since all cars are drawn in one batch |
| 22 | **Citizen** | 0.08 × 0.2 × 0.08 | Up to 300 on screen, random colours, bob up and down while walking. Keep under ~100 triangles. **Seen up close in walk view** |
| 23 | Cloud | Cluster of 5–10 puffs, ~3 across | 3 in the sky, drifting |
| 24 | Bird | Two-wing V shape, ~0.4 wide | 3 circling, wings flap |
| 25 | Smoke puff | Sphere 0.2 across, grows and fades | Rises from factory chimneys |
| 26 | Water | Flat plane, 4× the map width | Surrounds the island, shiny blue `#3b82f6` |

## D. Not separate models

- **Hover cursor and placement preview:** the preview reuses the building model at 70% opacity, and the cursor is a flat highlight square.
- **Lighting and sky:** a "city" lighting environment from the drei library, a sun and ambient light, and a flat background colour for the sky. A custom skybox would be a worthwhile later addition, especially for walk view.
- **UI icons:** already done as SVGs in `components/Icons.tsx`.

## Totals and suggested order

**26 assets:** 11 building and park models, 9 ground and road pieces, 6 moving things and effects.

Suggested order, by how much each improves the game:

1. Houses, shops and factories (#1–8). Seen everywhere.
2. Car and citizen (#21–22). Very visible in walk view.
3. Road tiles and markings (#14–20).
4. Park pieces (#9–11).
5. Sky and water (#23–26).
