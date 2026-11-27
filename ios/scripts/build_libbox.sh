#!/usr/bin/env bash
set -euo pipefail

# Build sing-box Libbox.xcframework for iOS (arm64 + iphonesimulator)
# Requires: Go 1.23+, Xcode 15+, gomobile installed

SINGBOX_VERSION="${SINGBOX_VERSION:-v1.11.4}"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/Frameworks"
mkdir -p "$OUT_DIR"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

git clone --depth 1 --branch "$SINGBOX_VERSION" https://github.com/SagerNet/sing-box.git "$WORK_DIR/sing-box"
cd "$WORK_DIR/sing-box"

go install github.com/sagernet/gomobile/cmd/gomobile@latest
go install github.com/sagernet/gomobile/cmd/gobind@latest
gomobile init

go run ./cmd/internal/build_libbox -target apple -platform ios
mv Libbox.xcframework "$OUT_DIR/Libbox.xcframework"
echo "Built $OUT_DIR/Libbox.xcframework successfully."
