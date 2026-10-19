# DigiAtlas development

For downloads, supported games and getting started, see the [main README](../README.md).
This guide covers source builds, tests and the imported data.

## Requirements

- Node.js 22 and npm.
- A stable Rust toolchain.
- The [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system.
- Your own supported game disc image for testing the importer or browsing real data.

## Run the desktop app

From the repository root:

```sh
npm ci
npm run desktop
```

The desktop app starts its development server and asks for a disc image when no current import
is available. Source builds use the same importer and data checks as release builds.

On systems with Bash, the launcher can also build and open the app:

```sh
./run.sh
./run.sh --dev
./run.sh --release
./run.sh --iso "/path/to/Digimon World 4 (USA).iso"
./run.sh --open "#/map/stag0101?d=hard"
```

The launcher installs JavaScript dependencies when needed. `--dev` runs a development window;
`--release` builds an optimized executable. `--iso` imports that disc on startup, including over
an existing import. `--open` chooses the initial view. Other arguments pass through to the app.

## Browser development

Browser mode reads an existing export; disc selection and importing are desktop features.
Create an export, then start the browser server:

```sh
cargo run --release --manifest-path importer/Cargo.toml -- "/path/to/game.iso" --out data/generated/ps2 --maps
npm run dev
```

The server listens at `http://127.0.0.1:5175`. Set `DIGIATLAS_DATA` to serve another exported
folder instead of `data/generated/ps2`.

`?import=welcome`, `?import=stale` and `?import=failed` preview the import screens with a mock importer.

## Checks

```sh
npm run check:format
npm run build
npm test
cargo fmt --check --manifest-path importer/Cargo.toml
cargo clippy --all-targets --locked --manifest-path importer/Cargo.toml -- -D warnings
cargo test --locked --manifest-path importer/Cargo.toml
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --locked --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

Build the interface before native checks so that Tauri can embed it. The ordinary test suite
uses small fixtures; real-disc and real-save checks are opt-in. See the
[importer guide](../importer/README.md), [power calculator notes](power-calculators.md) and
[GameCube save test](../tests/gamecube-real.test.js) for their environment variables.

## Build packages

The [Release workflow](../.github/workflows/release.yml) produces Windows MSI/ZIP and Linux
DEB/tarball downloads from version tags. Its commands are the reference for packaging each platform.
See [app updates and release builds](app-updates.md) for version checks and publishing details.

[Linux CI](../.github/workflows/ci-linux.yml) and [Windows CI](../.github/workflows/ci-windows.yml)
run independently, each checking the interface, importer and desktop build and attaching its
executable to successful runs. The README has a live build-status badge for each platform.
[macOS source checks](../.github/workflows/ci-macos.yml) remain separate. These platform workflows
reuse the [shared check definitions](../.github/workflows/ci-platform.yml).

## Imported data

Game images, saves and generated exports stay outside version control. The importer writes the
same [data schema](schema.md) for each supported platform; the manifest records the platform,
region, frame rate, source fingerprint and extracted counts.

The desktop app retains its original `data/ps2-usa` folder name for all supported discs:

| System | Data folder |
| --- | --- |
| Linux | `~/.local/share/io.github.crashbashash.digiatlas/data/ps2-usa` |
| Windows | `%APPDATA%\io.github.crashbashash.digiatlas\data\ps2-usa` |
| macOS | `~/Library/Application Support/io.github.crashbashash.digiatlas/data/ps2-usa` |

These locations follow Tauri's app-data directory rules. Imports are written to a temporary sibling
and installed only after they finish, preserving the previous data if an import fails.
The app checks both the importer version and `manifest.exporter.appVersion` on startup; changed
or missing versions show the disc-reload screen. [Update behavior](app-updates.md) covers this flow.

## Technical references

- [Importer implementation and real-disc tests](../importer/README.md)
- [Export schema](schema.md)
- [Attack damage calculations](weapon-damage.md)
- [Power Up/Down calculations and save support](power-calculators.md)
- [Application updates and release process](app-updates.md)
- [Opt-in direct app control](agent-control.md)

Deep links preserve views and settings, such as `#/map/stag0101?d=hard` or
`#/items?cat=weapon&sort=strength&dir=desc`. The app's command-line `--open` option accepts these links.
