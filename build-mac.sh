#!/bin/bash
# Builds hsk. Studio Companion on a Mac: a universal .dmg (Apple Silicon + Intel), copied to the Desktop.
# Run from the project folder:  bash build-mac.sh
set -e
cd "$(dirname "$0")"

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Lipsesc uneltele Xcode. Se deschide instalarea; după ce se termină, rulează din nou scriptul."
  xcode-select --install; exit 1
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "Instalez Rust (rustup.rs)..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  . "$HOME/.cargo/env"
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Lipsește Node.js. Instalează-l de la https://nodejs.org (versiunea LTS) și rulează din nou scriptul."; exit 1
fi

rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm install --no-audit --no-fund
npx tauri build --target universal-apple-darwin --bundles dmg

DMG=$(ls -t src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg | head -1)
cp "$DMG" "$HOME/Desktop/"
echo "Gata: $HOME/Desktop/$(basename "$DMG")"
