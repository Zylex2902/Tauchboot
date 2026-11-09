#!/bin/sh
cd "$(dirname "$0")"
npx --prefix .. rolldown engage36-entry.ts --format esm --platform node -o engage36-sim.mjs >/dev/null 2>&1
npx --prefix .. rolldown hunt41-entry.ts --format esm --platform node -o hunt41-sim.mjs >/dev/null 2>&1
sh regress36.sh
echo "=== hunt41"; timeout 900 node hunt41.mjs 30 2>&1 | grep -E "FAIL|ALL"
echo REGRESS41-DONE
