#!/usr/bin/env bash
# Builds the Android APK without Gradle / the Google SDK manager.
# Requirements (Ubuntu): apt-get install aapt apksigner zipalign dalvik-exchange
#                        openjdk-17+ , node/npm (for esbuild + three)
# The android-33 platform jar is fetched once into tools/.cache/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/tools/.cache"
OUT="$ROOT/build/android"
DIST="$ROOT/builds"
mkdir -p "$CACHE" "$OUT" "$DIST"
PLATFORM="$CACHE/android-33.jar"
if [ ! -f "$PLATFORM" ]; then
  curl -sSL -o "$PLATFORM" https://raw.githubusercontent.com/Sable/android-platforms/master/android-33/android.jar
fi

# 1. Bundle the web game
(cd "$ROOT" && npm run --silent build:web)

# 2. Stage assets
rm -rf "$OUT"; mkdir -p "$OUT/assets/www" "$OUT/classes" "$OUT/gen"
cp -r "$ROOT/dist/." "$OUT/assets/www/"

# 3. Resources + manifest -> unsigned apk
aapt package -f -m -J "$OUT/gen" -M "$ROOT/android/AndroidManifest.xml" \
  -S "$ROOT/android/res" -A "$OUT/assets" -I "$PLATFORM" \
  -F "$OUT/app.unaligned.apk"

# 4. Java -> dex
javac --release 8 -nowarn -classpath "$PLATFORM" -d "$OUT/classes" \
  $(find "$ROOT/android/src" "$OUT/gen" -name '*.java') 2>&1 | grep -v 'warning' || true
dalvik-exchange --dex --min-sdk-version=24 --output="$OUT/classes.dex" "$OUT/classes"
(cd "$OUT" && aapt add app.unaligned.apk classes.dex >/dev/null)

# 5. Align + sign (debug keystore generated on first build)
KS="$CACHE/debug.keystore"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storepass android -keypass android -alias androiddebugkey \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Toaku Debug,O=Obamium Games,C=US" >/dev/null 2>&1
fi
zipalign -f -p 4 "$OUT/app.unaligned.apk" "$OUT/app.aligned.apk"
apksigner sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --min-sdk-version 24 --out "$DIST/toaku-desert-brawl.apk" "$OUT/app.aligned.apk"
apksigner verify "$DIST/toaku-desert-brawl.apk"
echo "APK: $DIST/toaku-desert-brawl.apk ($(du -h "$DIST/toaku-desert-brawl.apk" | cut -f1))"
