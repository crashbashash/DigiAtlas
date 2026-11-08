# DigiAtlas: Digimon World 4 Maps, Drops & Calculators

DigiAtlas is a desktop companion for **Digimon World 4 (DW4)** and **Digimon World X**,
with interactive maps, enemy stats and spawns, item drop tables and character
calculators for **Windows and Linux**.

[![Linux build](https://github.com/crashbashash/DigiAtlas/actions/workflows/ci-linux.yml/badge.svg?branch=main&event=push)](https://github.com/crashbashash/DigiAtlas/actions/workflows/ci-linux.yml)
[![Windows build](https://github.com/crashbashash/DigiAtlas/actions/workflows/ci-windows.yml/badge.svg?branch=main&event=push)](https://github.com/crashbashash/DigiAtlas/actions/workflows/ci-windows.yml)

Find where an item drops, track down an enemy, or try a different character setup before you play.
DigiAtlas reads the information from your own game disc image.

## What you can do

- **Map viewer:** explore interactive maps of the game's areas, rooms and floors.
- **Enemy stats and spawns:** compare enemy stats and find their spawn locations across difficulties and player counts.
- **Drop tables:** check item drop chances and find places to farm.
- **Calculators:** plan your character's damage, healing, buffs and status effects using a custom setup or an imported save.
- **Stat growth:** graph all seven natural stats through level 999, compare Digimon forms and check exact gains at each level.

## Download and install

Get DigiAtlas from the **[Releases page](https://github.com/crashbashash/DigiAtlas/releases)**.
Choose the download for your operating system:

| System | Download | How to use it |
| --- | --- | --- |
| Windows, 64-bit | `.msi` | Run the installer, then open DigiAtlas. |
| Windows, 64-bit | `.zip` | Extract the archive and run `digiatlas.exe`. |
| Linux, 64-bit | `.deb` | Install with your package manager, then open DigiAtlas. |
| Linux, 64-bit | `.tar.gz` | Extract the archive and run `digiatlas`. |

The Linux `.deb` package is for Debian/Ubuntu-based distributions.

## Supported games and disc images

You will need a disc image from your own copy of the game.

| Platform | Supported regions |
| --- | --- |
| PlayStation 2 | USA, Europe and Japan |
| GameCube | USA and Japan |

- **PS2:** `.iso`
- **GameCube:** `.iso`, `.gcm`, NKit ISO, `.rvz`, `.wia`, `.gcz` and `.ciso`

Signed Crown Mod images are also supported; DigiAtlas shows the detected mod version and uses the data from that image.

## Getting started

1. Open DigiAtlas and choose **Load your Digimon World 4 disc image**.
2. Select your supported disc image and wait for the import to finish.
3. Search for an item or enemy, explore **Maps**, or open **Calculators**.

DigiAtlas remembers the imported data between launches, and you can browse it offline.
Use **Re-import from disc** on the home page to switch to another image.

## Using the calculators

Open **Calculators → Stat growth** to choose a Digimon and stat. The graph always shows levels
1–999. Add a second form to compare growth, then drag the graph's vertical marker or use the
level input or slider to inspect a level. Values show natural stats before equipment and permanent
upgrades, using each form's data from your loaded disc.

Choose your Digimon and level, add equipment and XData power, then select the enemy and variant
you want to compare against when the technique targets an enemy. The totals update as you change
your setup. Use the **?** buttons beside the results for formulas and worked examples using your
current setup.

To start from a save, open **Load a save** and choose a file or one of your last three opened saves.

- **PS2:** 80 KB extracted saves or `.ps2` memory-card images.
- **GameCube:** `.gci` saves, `.raw`/`.gcp` memory-card images, or 80 KB extracted save data.

Loading a save is read-only. Temporary combat effects and special combo multipliers can change
in-game damage beyond the setup shown in the calculator.

## Updates

DigiAtlas checks for updates when it starts. You can also use **Check for updates** to see
available versions and read the release notes.

**Keep your disc image handy:** after installing a different app version, DigiAtlas asks you to
load your disc again to refresh its maps, drops and stats.

## Help and feedback

Found a problem or have an idea? Open an **[issue](https://github.com/crashbashash/DigiAtlas/issues)**.

Maps show what a room can spawn; story progress and other conditions affect what appears in-game.
Scripted item pickups are not currently listed.

For building from source, tests and technical documentation, see the
**[development guide](https://github.com/crashbashash/DigiAtlas/blob/main/docs/development.md)**.

## License

DigiAtlas is licensed under **GPL-3.0-or-later**. See [LICENSE](LICENSE).
