#!/bin/sh
cd "$(dirname "$0")"
npx --prefix .. rolldown dc45-entry.ts --format esm --platform node -o dc45-sim.mjs >/dev/null 2>&1
sh regress44.sh
echo "=== dc45"; timeout 900 node dc45.mjs 2>&1 | grep -E "FAIL|ALL"
echo "=== dc45ui"; timeout 900 node dc45ui.mjs 2>&1 | grep -E "FAIL|ALL"
echo REGRESS45-DONE
