#!/bin/sh
cd "$(dirname "$0")"
npx --prefix .. rolldown roster51-entry.ts --format esm --platform node --inline-dynamic-imports -o roster51-sim.mjs >/dev/null 2>&1
sh regress46.sh
echo "=== roster51"; timeout 300 node roster51.mjs 2>&1 | grep -E "FAIL|ALL"
echo "=== roster51ui"; timeout 600 node roster51ui.mjs 2>&1 | grep -E "FAIL|ALL"
echo REGRESS51-DONE
