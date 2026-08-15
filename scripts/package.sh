#!/usr/bin/env bash
# Package the CloudFile Local Session Receiver for Chrome Web Store upload.
# Chrome Web Store accepts an unsigned zip of the unpacked MV3 directory;
# signing happens on Google's side at publication time, so this script only
# needs to zip exactly the files the store requires (manifest + assets, no
# README, no scripts, no dotfiles).
set -euo pipefail

cd "$(dirname "$0")/.."

version="$(python3 -c 'import json;print(json.load(open("manifest.json"))["version"])')"
out="dist/cloudfile-local-session-receiver-${version}.zip"

mkdir -p dist
rm -f "$out"
zip -q -X "$out" manifest.json background.js popup.js popup.html popup.css

echo "$out"
