#!/usr/bin/env bash
# Validate EPUB files with epubcheck (downloaded once into .cache/).
#   bash scripts/epubcheck.sh file1.epub [file2.epub ...]
#   bash scripts/epubcheck.sh            # checks out/*.epub
set -euo pipefail
VERSION=5.4.0
SHA256=33350c61038e71dfb3d45a76aed04bf5481e6d5500cb780f6e98db8bbd15a28c
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/.cache/epubcheck-$VERSION"
if [ ! -f "$DIR/epubcheck.jar" ]; then
  mkdir -p "$ROOT/.cache"
  curl -sSL -o "$ROOT/.cache/epubcheck.zip" "https://github.com/w3c/epubcheck/releases/download/v$VERSION/epubcheck-$VERSION.zip"
  echo "$SHA256  $ROOT/.cache/epubcheck.zip" | sha256sum -c -
  (cd "$ROOT/.cache" && unzip -qo epubcheck.zip)
fi
if [ "$#" -eq 0 ]; then set -- "$ROOT"/out/*.epub; fi
status=0
for f in "$@"; do
  # --failonwarnings: warnings are failures too
  if java -jar "$DIR/epubcheck.jar" --failonwarnings -q "$f" 2> >(grep -v "^Picked up JAVA_TOOL_OPTIONS" >&2); then
    echo "epubcheck OK: $(basename "$f")"
  else
    echo "epubcheck FAILED: $f"; status=1
  fi
done
exit $status
