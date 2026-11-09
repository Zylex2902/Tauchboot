#!/bin/sh
cd "$(dirname "$0")"
npx --prefix .. rolldown watch52-entry.ts --format esm --platform node --inline-dynamic-imports -o watch52-sim.mjs >/dev/null 2>&1
sh regress51.sh
echo "=== watch52"; timeout 600 node watch52.mjs 2>&1 | grep -E "FAIL|ALL"
echo "=== roster52ui"; timeout 600 node roster52ui.mjs 2>&1 | grep -E "FAIL|ALL"
echo REGRESS52-DONE
