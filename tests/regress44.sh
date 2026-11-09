#!/bin/sh
cd "$(dirname "$0")"
for e in evade43 cas44; do npx --prefix .. rolldown $e-entry.ts --format esm --platform node -o $e-sim.mjs >/dev/null 2>&1; done
sh regress43.sh
echo "=== evade43"; timeout 1800 node evade43.mjs 30 2>&1 | grep -E "FAIL|ALL"
echo "=== cas44"; timeout 900 node cas44.mjs 40 2>&1 | grep -E "FAIL|ALL"
echo "=== cas44b"; timeout 900 node cas44b.mjs 2>&1 | grep -E "FAIL|ALL"
echo "=== dmg44ui"; timeout 900 node dmg44ui.mjs 2>&1 | grep -E "FAIL|ALL"
echo REGRESS44-DONE
