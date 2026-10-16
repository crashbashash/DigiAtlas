# DigiAtlas

A desktop map and data explorer for Digimon World 4. DigiAtlas puts enemy
stats, spawn locations and item drops on interactive dungeon maps, replacing
the static spreadsheets with something you can click through.

## Status

Early development. The PS2 exporter, the data schema and a first working viewer are in place.

## What it does

- Browse every stage by world, room and floor, each with a top-down map.
- Markers show every enemy, boss and breakable object a stage can spawn, with a difficulty dropdown
  (Normal, Hard, Very Hard) that switches the spawns, enemy stats and drop tables together, and a
  players dropdown (1 to 4) because spawn counts and some drops scale with the number of players.
- Spawners that no game script starts are left out by default (a "Show unused" box brings them back), and the
  spawner panel says what starts each one: the trigger circle, or the script condition, in words.
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
./run.sh --iso "/path/to/Digimon World 4 (USA).iso"   # first run: exports the data, builds, opens the app
./run.sh                                               # later runs: build (fast) and open
```

`run.sh` installs the JavaScript dependencies when needed, exports the data from your disc if
`data/generated/ps2` is missing (about 5 minutes, with maps), builds the desktop app and starts it.
Options: `--release` for an optimised build, `--reexport` to export again, `--dev` for a
hot-reloading development window, and `--data DIR` to open a different exported folder. From the
workspace root, `run-digiatlas.sh` does the same.

By hand:

```sh
cd tools && python3 -m ps2_export.export "/path/to/Digimon World 4 (USA).iso" --out ../data/generated/ps2 --maps && cd ..
npm install && npm run desktop     # desktop app (remembers the data folder; "Change data folder" picks another)
npm run dev                        # or a browser at http://127.0.0.1:5175, served from data/generated/ps2
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
descriptions, 98 named stages, 81 stages of spawn generators across all three difficulties (with world
positions), 344 drop pools, loading banners, and top-down maps for 82 stages (`--maps`). See [tools/README.md](tools/README.md) for what it can and cannot read yet.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
