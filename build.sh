#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo "Building EdiMart API from $(pwd)"
npm ci || npm install --include=dev
npm run generate
npm run build
test -f dist/main.js && echo "OK: dist/main.js exists" || (echo "ERROR: dist/main.js missing" && exit 1)
