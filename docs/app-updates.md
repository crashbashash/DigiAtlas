# Application updates

The desktop app checks GitHub once at startup and provides **Check for updates**
on its header and import screens. Startup failures stay quiet so offline use is
uninterrupted; a manual check explains connection failures. Available stable
releases show their notes, including versions skipped since the current build.
**Later** dismisses the offer until another check or launch. No download starts
until **Download and update** is chosen.

The implementation follows Crown Mod's updater:

- Windows MSI installations download the matching MSI, verify its exact byte count
  and GitHub SHA-256 digest, launch Windows Installer, then close DigiAtlas. MSI
  detection requires the current executable's exact registered install directory.
- Portable Windows builds and Linux open the selected GitHub release page after
  the user accepts. Linux packages should be installed through the package manager;
  portable copies can be replaced with the new download.
- Other platforms use the release page too; the release workflow currently builds
  Windows and Linux packages.

DigiAtlas never accepts an installer URL or command from the webview. The backend
checks only `crashbashash/DigiAtlas`, skips drafts, prereleases and non-semver tags,
and requires the exact `digiatlas-VERSION-windows-x86_64.msi` asset name, repository
path, HTTPS URL, bounded size and valid SHA-256 digest. Release notes are rendered
as text. The original CSP stays in force; networking happens in the native backend.

An import and an accepted update share one atomic operation gate, so the app cannot
start an installer while disc data is being written. Saved games are only read by
the calculators. App updates preserve the existing app identifier and data folder;
each installed app version requires a fresh disc import. The native import stamps
`manifest.exporter.appVersion`. On startup, a changed or missing app-version stamp
shows **Your data needs refreshing** and asks the user to load their disc again,
even when the importer version is unchanged. Importer-version changes also require
a reload. Existing data is retained until the new import succeeds; failed imports
leave it intact.

## Release feed availability

The configured repository must expose releases publicly for anonymous update
checks and downloads. While it is private, manual checks report that updates are
not publicly available; startup stays quiet. The app contains no GitHub token.
A separate public release repository could be used instead by changing the
backend feed, release-page and exact asset URL allowlist together, and publishing
the release assets there.

## Publishing

Keep `package.json`, the root package version in `package-lock.json`,
`src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` at the same stable version.
`node tools/check-release.mjs vVERSION` checks them before release builds.

Pushing a `vVERSION` tag triggers `.github/workflows/release.yml`. It builds a
Windows MSI and portable ZIP, plus Linux DEB and portable tarball. It publishes
only after both platforms succeed and all four assets exist. GitHub generates
the release notes; those notes are what the application displays. Release assets
contain the application and public documentation, never imported disc data.
MSI identity is pinned by the WiX upgrade code in `tauri.conf.json` and the native
Windows helper. Do not change it for normal version upgrades.

## Verification

`npm test` covers startup/manual/offline checks, skipped notes, explicit acceptance,
retries, concurrent checks and installer busy state. Native tests cover stable
version ordering, allowed assets, tampered/truncated downloads, MSI location
matching, the operation gate and pinned upgrade identity. A read-only live check:

```sh
cargo test --manifest-path src-tauri/Cargo.toml live_release_check -- --ignored
```

This check never downloads or launches an installer. Windows MSI installation
must also be tested on Windows when producing a release.
