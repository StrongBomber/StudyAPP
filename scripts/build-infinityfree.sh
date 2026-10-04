#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
OUT_RAW="${1:-$ROOT/dist/infinityfree}"
if [[ "$OUT_RAW" != /* ]]; then
  OUT_RAW="$PWD/$OUT_RAW"
fi

# Canonicalize through the nearest existing parent before deleting anything.
OUT_PARENT="$(dirname -- "$OUT_RAW")"
OUT_NAME="$(basename -- "$OUT_RAW")"
if [[ "$OUT_NAME" == "." || "$OUT_NAME" == ".." || "$OUT_NAME" == "/" ]]; then
  echo "Refusing unsafe output path: $OUT_RAW" >&2
  exit 2
fi
while [[ ! -d "$OUT_PARENT" ]]; do
  OUT_NAME="$(basename -- "$OUT_PARENT")/$OUT_NAME"
  OUT_PARENT="$(dirname -- "$OUT_PARENT")"
done
OUT="$(cd -- "$OUT_PARENT" && pwd -P)/$OUT_NAME"
case "$OUT" in
  "$ROOT"|"$ROOT/"|"$ROOT/.git"|"$ROOT/.git/"*)
    echo "Refusing unsafe output path: $OUT" >&2
    exit 2
    ;;
esac

rm -rf -- "$OUT"
mkdir -p "$OUT/api/nvidia"
cp -- "$ROOT/index.html" "$ROOT/app-config.js" "$OUT/"
cp -a -- "$ROOT/assets" "$ROOT/vendor" "$OUT/"
for file in .htaccess common.php status.php chat.php config.example.php; do
  cp -- "$ROOT/api/nvidia/$file" "$OUT/api/nvidia/$file"
done

printf 'InfinityFree upload files are ready in:\n%s\n' "$OUT"
printf 'Upload the CONTENTS of this directory to the domain\x27s htdocs/ folder.\n'
