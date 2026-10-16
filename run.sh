#!/usr/bin/env bash
# Build and run DigiAtlas.
#
#   ./run.sh                      build (debug, fast to rebuild) and open the app
#   ./run.sh --release            optimised build
#   ./run.sh --iso GAME.iso       export the data from your disc first if it is missing
#   ./run.sh --iso GAME.iso --reexport   export again even if data exists
#   ./run.sh --dev                hot-reloading development window instead of a build
#   ./run.sh --data DIR           anything the script does not know goes to the app
#   ./run.sh --open "#/stag0101?d=hard"   start on a view (the address-bar format)
#
# The data folder is data/generated/ps2 (or DIGIATLAS_DATA). The app also lets you pick one.
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
profile=debug
mode=build
reexport=0
iso="${DIGIATLAS_ISO:-}"
app_args=()

usage() { sed -n "2,12p" "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while (($#)); do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --release) profile=release ;;
    --debug) profile=debug ;;
    --dev) mode=dev ;;
    --reexport) reexport=1 ;;
    --iso)
      [[ $# -ge 2 ]] || { echo "--iso needs a path" >&2; exit 2; }
      iso="$2"; shift ;;
    *) app_args+=("$1") ;;
  esac
  shift
done

for tool in node npm cargo; do
  command -v "$tool" >/dev/null || { echo "Missing $tool; install it first (see README)." >&2; exit 1; }
done

data_dir="${DIGIATLAS_DATA:-$root/data/generated/ps2}"

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

  # Export the data from the disc image when it is missing (or when asked to).
  if [[ ! -f "$data_dir/manifest.json" || $reexport -eq 1 ]]; then
    if [[ -n "$iso" ]]; then
      [[ -f "$iso" ]] || { echo "Disc image not found: $iso" >&2; exit 1; }
      command -v python3 >/dev/null || { echo "Missing python3, needed for the data export." >&2; exit 1; }
      echo "Exporting data from $iso (about 5 minutes)..." >&2
      iso_abs="$(cd -- "$(dirname -- "$iso")" && pwd)/$(basename -- "$iso")"
      (cd tools && python3 -m ps2_export.export "$iso_abs" --out "$data_dir" --maps) >&2
    else
      echo "No data in $data_dir. The app will ask for a folder; to build it from your disc run:" >&2
      echo "  ./run.sh --iso \"/path/to/Digimon World 4 (USA).iso\"" >&2
    fi
  fi

  if [[ $mode == dev ]]; then
    exec npm run desktop
  fi

  flags=(--no-bundle --ci)
  [[ $profile == debug ]] && flags+=(--debug)
  echo "Building ($profile)..." >&2
  npm run tauri -- build "${flags[@]}" >&2
)

[[ $mode == dev ]] && exit 0
# Run from the caller's directory so relative --data paths mean what they say there.
export DIGIATLAS_DATA="$data_dir"
exec "$root/src-tauri/target/$profile/digiatlas" "${app_args[@]}"
