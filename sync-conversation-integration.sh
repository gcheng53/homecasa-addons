#!/usr/bin/env bash
# Single editable source of the HomeCasa conversation integration lives in
# homecasa_conversation/custom_components/homecasa. The HomeCasa Agent add-on
# bundles a copy (it can only COPY files from its own build context), so run
# this after editing the integration to keep the bundled copy in sync.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/homecasa_conversation/custom_components/homecasa"
DEST="$HERE/homecasa_agent/ha_integration/homecasa"

if [ ! -d "$SRC" ]; then
  echo "Source integration not found at $SRC" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
cp -r "$SRC" "$DEST"
find "$DEST" -type d -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true
find "$DEST" -type f -name '*.pyc' -delete 2>/dev/null || true
echo "Synced conversation integration -> $DEST"
