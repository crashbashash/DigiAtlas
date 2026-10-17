# DigiAtlas

A desktop map and data explorer for Digimon World 4. DigiAtlas puts enemy
stats, spawn locations and item drops on interactive dungeon maps, replacing
the static spreadsheets with something you can click through.

## Status

Early development. The PS2 exporter, the data schema and a first working viewer are in place.

## What it does

The app opens on a home page with one search box over items, enemies and rooms, and entry points
into each section. From any result you can keep going: an item's page shows its stats, every map it
drops in (best chance first) and its trades; picking a map opens it with the droppers highlighted.

- **Home:** search, "continue where you left off", the worlds, item categories and bosses.
- **Item pages** (`#/item/weapon:175`): description and stats; **Where it drops**, ranked by chance per
  kill, each opening the map zoomed to the droppers; **Trades & appraisal**, with the traders who give or
  take it and what the Appraiser makes of it.
- **Maps** (`#/map/stag0102`): every stage by world, room and floor, with a top-down map. Markers show
  every enemy, boss and breakable object a stage can spawn; a selected item or enemy stays highlighted as
  you move between rooms, with a banner saying whether it drops here and where it drops best if not.
  Enemies with several stat variants (crown ranks) are one row that expands. Long drop tables fold the
  rare drops away. Hover or select a radar spawner to see how close you must get for it to start.
- **Enemy pages** (`#/enemy/Goburimon`): stats and resistances for each variant (area tiers and crown
  ranks) on the chosen difficulty; **Where it spawns**, rooms ranked by how many it places, each opening
  the map with it highlighted; **Drops**, everything it can drop with the best chance and the best rooms.
- **Tables** you can filter and sort by any column, with the sort kept in the address:
  `#/items?cat=weapon&sort=strength&dir=desc` shows each category's own stats, prices and the best
  drop chance; `#/enemies?kind=boss&view=resist` shows every enemy's stats or resistances as ranges
  across its variants, and how many rooms it spawns in.
- **Search** (`#/search?q=sword`): every match, by items, enemies and rooms.
- Difficulty (Normal, Hard, Very Hard), players (1 to 4) and unused spawners change the spawns, stats
  and drop chances together. They are kept in the address, so links reproduce what you saw, and the
  last ones chosen are remembered.
- Spawners that no game script starts are left out by default ("Show unused" brings them back), and the
  spawner panel says what starts each one: the trigger circle, or the script condition, in words.
- Click a marker or an enemy in the list for its stats, resistances, how many spawn and a drop table
  with chances (including the chance of nothing).
- Keyboard: `/` opens search from anywhere; arrow keys and `Enter` pick a result; `Esc` closes search
  or clears the selection. The room list is a tree (arrow keys move, open and close). Double-click the
  map or press Fit to reset it; "Zoom to matches" frames highlighted spawners.

Markers show what a stage can spawn. Some enemies are started by game scripts under conditions (story
progress, your level), and scripted item pickups are not extracted yet.

## Running it

```sh
./run.sh                                               # build (fast after the first time) and open the app
./run.sh --iso "/path/to/Digimon World 4 (USA).iso"   # optional: import that disc image on start
```

The first time, DigiAtlas asks for your Digimon World 4 disc image (USA, PS2; an `.iso` dump of
your own disc). It reads the disc once, which takes a minute or two, and keeps the data, so you can
move or delete the image afterwards. "Re-import from disc" at the bottom of the home page reads it
again; when a newer DigiAtlas reads more from the disc, it asks for the image again instead of
showing the old data.

`run.sh` installs the JavaScript dependencies when needed, builds the desktop app and starts it. It
needs Node.js and Rust (with the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
for your OS); no Python. Options: `--release` for an optimised build, `--dev` for a hot-reloading
development window, `--iso PATH` to import a disc image on start (the app's own `--iso` option, also
over existing data), and `--open "#/map/stag0101?d=hard"` to start on a view. Anything else is
passed to the app. From the workspace root, `run-digiatlas.sh` does the same.

By hand:

```sh
npm install && npm run desktop     # desktop app; asks for the disc image the first time
npm run dev                        # or a browser at http://127.0.0.1:5175, served from data/generated/ps2
```

The browser mode has no importer; it serves an already imported folder (`DIGIATLAS_DATA`, default
`data/generated/ps2`), which the command-line importer writes:

```sh
cargo run --release --manifest-path importer/Cargo.toml -- "/path/to/Digimon World 4 (USA).iso" --out data/generated/ps2 --maps
```

In the browser, `?import=welcome`, `?import=stale` or `?import=failed` previews the desktop app's
import screens with a stand-in importer.

`npm test` runs the interface tests, `cargo test` (in `src-tauri`) the native ones, and
`python3 -m unittest discover -s tests` the exporter tests. GitHub Actions runs all three, plus the format check and build, on every push and pull request.

## Data

Game-derived data is never committed. DigiAtlas reads the user's own disc image with its built-in
importer (the `importer` crate, which writes the [schema](docs/schema.md)) and caches the result in
the app's data folder, under `data/ps2-usa/`:

| OS | Cache folder |
|---|---|
| Linux | `~/.local/share/io.github.crashbashash.digiatlas/data/ps2-usa` |
| Windows | `%APPDATA%\io.github.crashbashash.digiatlas\data\ps2-usa` |
| macOS | `~/Library/Application Support/io.github.crashbashash.digiatlas/data/ps2-usa` |

(This is Tauri's app data directory; the name is the `identifier` in `src-tauri/tauri.conf.json`.)
An import is written to `ps2-usa.new` next to it and swapped in only when it has finished, so a
failed or interrupted import keeps the previous data. Deleting the folder makes the app ask for the
disc again. The cache records the importer version (`manifest.exporter`); data from another version
is not shown but imported again.

Each platform has its own reader that writes the same schema, so platform differences stay out of
the UI. The PS2 reader exports 580 enemy and object rows with names and stats, 590 items with names
and descriptions, 98 named stages, 81 stages of spawn generators across all three difficulties
(with world positions), 344 drop pools, loading banners, and top-down maps for 82 stages. See
[tools/README.md](tools/README.md) for what it can and cannot read yet.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
