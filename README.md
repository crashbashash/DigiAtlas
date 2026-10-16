# DigiAtlas

A desktop map and data explorer for Digimon World 4. DigiAtlas puts enemy
stats, spawn locations and item drops on interactive dungeon maps, replacing
the static spreadsheets with something you can click through.

## Status

Early planning. The data comes from the existing decompilation work and the
spreadsheet prototypes (drop reference, enemy reference, Humid Cave map sample).

## Planned

- Interactive per-floor dungeon maps with pan and zoom
- Enemy spawn markers linked to enemy stat pages
- Drop tables per enemy, per box and per item (where an item comes from)
- Search and filters across enemies, items and areas
- Tauri desktop app with a web frontend (same stack as DW4_Asset_Viewer)

## Data

Game-derived data and assets are not committed. Generated tables live under
`data/generated/` (git-ignored) and are built from the decomp tooling.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
