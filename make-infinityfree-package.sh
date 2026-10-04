#!/usr/bin/env bash
# InfinityFree'ye yüklenecek dosyaları dist/infinityfree/ altına toplar ve
# tek zip hâline getirir. Zip içeriğini htdocs klasörüne aynen yükleyin.
set -euo pipefail
cd "$(dirname "$0")"

OUT="dist/infinityfree"
rm -rf "$OUT"
mkdir -p "$OUT/api" "$OUT/assets"

cp index.html .htaccess "$OUT/"
cp api/nvidia.php api/.htaccess api/config.sample.php "$OUT/api/"
cp assets/demo.pdf "$OUT/assets/"
cp -R vendor "$OUT/vendor"

# Yerel gerçek anahtar dosyası varsa pakete koyma (güvenlik).
rm -f "$OUT/api/config.php"

mkdir -p dist
( cd "$OUT" && zip -qr ../infinityfree-upload.zip . )
echo "Hazır: dist/infinityfree-upload.zip  (içeriği htdocs'a çıkarın)"
