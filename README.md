# DigiAtlas

A desktop map and data explorer for Digimon World 4. DigiAtlas puts enemy
stats, spawn locations and item drops on interactive dungeon maps, replacing
the static spreadsheets with something you can click through.

## Status

Early development. The app shell is a pannable placeholder map; the PS2 data exporter and the
schema are in place.

## Planned

- Interactive per-floor dungeon maps with pan and zoom
- Enemy spawn markers linked to enemy stat pages
- Drop tables per enemy, per box and per item (where an item comes from)
- Search and filters across enemies, items and areas
- Tauri desktop app with a web frontend (same stack as DW4_Asset_Viewer)

## Data

Game-derived data is never committed. DigiAtlas reads the user's own disc image and builds JSON
under `data/generated/` (git-ignored). Each platform has its own reader that writes the same
[schema](docs/schema.md), so platform differences stay out of the UI.

```sh
cd tools && python3 -m ps2_export.export "/path/to/Digimon World 4 (USA).iso" --out ../data/generated/ps2
```

The PS2 reader exports 580 enemy and object rows with names and stats, 590 items with names and
descriptions, 85 stages of spawn generators across all three difficulties, and 344 drop pools. See [tools/README.md](tools/README.md) for what it can and cannot read yet.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
