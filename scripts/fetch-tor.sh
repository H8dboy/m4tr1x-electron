#!/usr/bin/env bash
# Scarica il Tor Expert Bundle ufficiale per ogni piattaforma desktop e lo mette
# in resources/tor/<piattaforma>/ così electron-builder lo impacchetta nell'app.
# In questo modo l'app desktop ha l'onion "out of the box", senza chiedere
# all'utente di installare Tor. I binari NON sono committati (vedi .gitignore):
# questo script va eseguito prima del packaging (hook prepack).
set -euo pipefail
VER="${TOR_TEB_VERSION:-15.0.21}"
BASE="https://archive.torproject.org/tor-package-archive/torbrowser/${VER}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/resources/tor"

# mappa: <cartella app> <asset expert-bundle> <nome eseguibile>
map=(
  "linux-x64  linux-x86_64   tor"
  "mac-x64    macos-x86_64   tor"
  "mac-arm64  macos-aarch64  tor"
  "win-x64    windows-x86_64 tor.exe"
)

fetch() {
  local dir="$1" asset="$2" exe="$3"
  local out="$DEST/$dir"
  if [ -x "$out/$exe" ] || [ -f "$out/$exe" ]; then echo "[fetch-tor] $dir già presente"; return; fi
  echo "[fetch-tor] scarico $asset ..."
  local tmp; tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/teb.tar.gz" "$BASE/tor-expert-bundle-${asset}-${VER}.tar.gz"
  tar xzf "$tmp/teb.tar.gz" -C "$tmp"
  mkdir -p "$out"
  # solo l'eseguibile e le sue librerie: niente geoip/pluggable_transports (peso)
  cp "$tmp/tor/$exe" "$out/" 2>/dev/null || cp "$tmp/tor/tor" "$out/$exe"
  find "$tmp/tor" -maxdepth 1 \( -name '*.so*' -o -name '*.dll' -o -name '*.dylib' \) -exec cp {} "$out/" \; 2>/dev/null || true
  chmod +x "$out/$exe" 2>/dev/null || true
  rm -rf "$tmp"
  echo "[fetch-tor] $dir pronto ($(du -sh "$out" | cut -f1))"
}

for row in "${map[@]}"; do read -r dir asset exe <<<"$row"; fetch "$dir" "$asset" "$exe"; done
echo "[fetch-tor] fatto. Tor $VER in $DEST"
