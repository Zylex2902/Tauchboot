#!/bin/sh
cd "$(dirname "$0")"
npx --prefix .. rolldown loss46-entry.ts --format esm --platform node -o loss46-sim.mjs >/dev/null 2>&1
sh regress45.sh
echo "=== loss46"; timeout 900 node loss46.mjs 2>&1 | grep -E "FAIL|ALL"
echo "=== loss46ui"; timeout 900 node loss46ui.mjs 2>&1 | grep -E "FAIL|ALL"
echo REGRESS46-DONE
