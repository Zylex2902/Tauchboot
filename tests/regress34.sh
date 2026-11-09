#!/bin/sh
cd "$(dirname "$0")"
for t in leave cr-controls er-controls airdrill chart25b drill dive save timescale hull truth-key twin radio26b scope32b hits2; do
  echo "=== $t"
  timeout 900 node $t.mjs 2>&1 | tail -8
done
timeout 400 node recog31b.mjs 8 2>&1 | grep -E 'PASS|FAIL'
timeout 600 node attack33b.mjs 8 2>&1 | grep -E 'PASS|FAIL'
timeout 600 node attack34b.mjs 21 2>&1 | grep -E 'PASS|FAIL'
for e in attack33 torp34 hydro23 chart25 air24 radio26 recog31 scope32 sense world power plot; do npx --prefix .. rolldown $e-entry.ts --format esm --platform node -o $e-sim.mjs >/dev/null 2>&1; done
node attack33.mjs | tail -3
node torp34.mjs 1500 | grep -cE '^PASS'; node torp34.mjs 1500 | grep -E 'FAIL|ALL'
for t in hydro23 chart25 air24 radio26 recog31 scope32 sense world power plotq; do echo "=== $t"; timeout 900 node $t.mjs 2>&1 | tail -3; done
echo REGRESS-DONE
