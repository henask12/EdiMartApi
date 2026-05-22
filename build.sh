#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo "Building EdiMart API from $(pwd)"
npm install --include=dev
npx prisma generate --schema=../../packages/database/prisma/schema.prisma
npm run build
test -f dist/main.js && echo "OK: dist/main.js exists" || (echo "ERROR: dist/main.js missing" && exit 1)
