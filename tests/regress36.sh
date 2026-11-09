#!/bin/sh
cd "$(dirname "$0")"
sh regress35.sh
echo "=== engage36"; timeout 900 node engage36.mjs 20 2>&1 | grep -E "PASS|FAIL|ALL"
echo "=== again36"; timeout 300 node again36.mjs 2>&1 | tail -4
echo "=== sndaudit36"; timeout 900 node sndaudit36.mjs 2>&1 | tail -3
echo REGRESS36-DONE
