# DigiAtlas

A desktop map and data explorer for Digimon World 4. DigiAtlas puts enemy
stats, spawn locations and item drops on interactive dungeon maps, replacing
the static spreadsheets with something you can click through.

## Status

Early development. The PS2 exporter, the data schema and a first working viewer are in place.

## What it does

- Browse every stage by world, room and floor, each with a top-down map.
- Markers show every enemy, boss and breakable object a stage can spawn, with a difficulty dropdown
  (Normal, Hard, Very Hard) that switches the spawns, enemy stats and drop tables together.
- Click a marker or an enemy in the list for its stats, resistances, how many spawn and a drop table
  with chances (including the chance of nothing).
- Search an item to see every enemy and object that drops it, with the chance, and jump to the stage.
- Search an enemy to see its stat variants and every stage it appears in.
- The address bar holds the stage, difficulty and selection (`#/stag0102?d=normal&item=weapon:175`), so
  links and the back button work; the last view is remembered.
- Shortcuts: `/` focuses search, `Enter` opens the first result, `Esc` clears the search, then the
  selection. Double-click the map or press Fit to reset it; "Zoom to matches" frames highlighted spawners.

Markers show what a stage can spawn. Some enemies are started by game scripts under conditions (story
progress, your level), and scripted item pickups are not extracted yet.

## Running it

```sh
# 1. Export the data from your own disc image (about 5 minutes with maps)
cd tools && python3 -m ps2_export.export "/path/to/Digimon World 4 (USA).iso" --out ../data/generated/ps2 --maps && cd ..

# 2a. Desktop app (remembers the data folder; use "Change data folder" to pick another)
npm install && npm run desktop

# 2b. Or in a browser, served from data/generated/ps2 (or DIGIATLAS_DATA)
npm run dev          # http://127.0.0.1:5175
```

`npm test` runs the interface tests, `cargo test` (in `src-tauri`) the native ones, and
`python3 -m unittest discover -s tests` the exporter tests.

## Data

Game-derived data is never committed. DigiAtlas reads the user's own disc image and builds JSON
under `data/generated/` (git-ignored). Each platform has its own reader that writes the same
[schema](docs/schema.md), so platform differences stay out of the UI.

```sh
cd tools && python3 -m ps2_export.export "/path/to/Digimon World 4 (USA).iso" --out ../data/generated/ps2
```

The PS2 reader exports 580 enemy and object rows with names and stats, 590 items with names and
descriptions, 98 named stages, 85 stages of spawn generators across all three difficulties (with world
positions), 344 drop pools, loading banners, and top-down maps for 82 stages (`--maps`). See [tools/README.md](tools/README.md) for what it can and cannot read yet.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
