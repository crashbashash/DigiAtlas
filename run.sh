#!/usr/bin/env bash
# Build and run DigiAtlas.
#
#   ./run.sh                      build (debug, fast to rebuild) and open the app
#   ./run.sh --release            optimised build
#   ./run.sh --iso GAME.iso       import that disc image on start (also re-imports over existing data)
#   ./run.sh --dev                hot-reloading development window instead of a build
#   ./run.sh --open "#/map/stag0101?d=hard"   start on a view (the address-bar format)
#
# Anything the script does not know goes to the app. Without --iso, the app asks for the disc
# image the first time and keeps the imported data in its app data folder.
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
profile=debug
mode=build
app_args=()

usage() { sed -n "2,11p" "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while (($#)); do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --release) profile=release ;;
    --debug) profile=debug ;;
    --dev) mode=dev ;;
    --iso)
      [[ $# -ge 2 ]] || { echo "--iso needs a path" >&2; exit 2; }
      [[ -f "$2" ]] || { echo "Disc image not found: $2" >&2; exit 1; }
      # Absolute, because the development window runs from another directory.
      app_args+=(--iso "$(cd -- "$(dirname -- "$2")" && pwd)/$(basename -- "$2")"); shift ;;
    *) app_args+=("$1") ;;
  esac
  shift
done

for tool in node npm cargo; do
  command -v "$tool" >/dev/null || { echo "Missing $tool; install it first (see README)." >&2; exit 1; }
done

(
  cd -- "$root"
  mkdir -p .local

  # Install JavaScript dependencies when the lockfile changes.
  lock_hash="$(sha256sum package-lock.json)"
  if [[ ! -d node_modules || ! -f .local/npm-lock.sha256 || "$(cat .local/npm-lock.sha256)" != "$lock_hash" ]]; then
    echo "Installing dependencies..." >&2
    npm install --no-audit --no-fund --prefer-offline >&2
    printf '%s\n' "$lock_hash" > .local/npm-lock.sha256
  fi

  if [[ $mode == dev ]]; then
    # npm hands what follows its `--` to `tauri dev`, whose `-- [runner args] -- [app args]`
    # (no runner args here) reaches the app.
    if ((${#app_args[@]})); then
      exec npm run desktop -- -- -- "${app_args[@]}"
    fi
    exec npm run desktop
  fi

  flags=(--no-bundle --ci)
  [[ $profile == debug ]] && flags+=(--debug)
  echo "Building ($profile)..." >&2
  npm run tauri -- build "${flags[@]}" >&2
)

[[ $mode == dev ]] && exit 0
exec "$root/src-tauri/target/$profile/digiatlas" ${app_args[@]+"${app_args[@]}"}
