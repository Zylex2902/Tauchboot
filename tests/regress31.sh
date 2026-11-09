#!/bin/sh
cd "$(dirname "$0")"
for t in leave cr-controls er-controls airdrill chart25b dive save timescale hull truth-key twin radio26b hits2; do
  echo "=== $t"
  timeout 900 node $t.mjs 2>&1 | tail -6
done
echo REGRESS-DONE
