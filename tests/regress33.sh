#!/bin/sh
cd "$(dirname "$0")"
for t in leave cr-controls er-controls airdrill chart25b drill dive save timescale hull truth-key twin radio26b scope32b hits2; do
  echo "=== $t"
  timeout 900 node $t.mjs 2>&1 | tail -8
done
timeout 400 node recog31b.mjs 8 2>&1 | grep -E 'PASS|FAIL'
echo REGRESS-DONE
