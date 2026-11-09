#!/bin/sh
cd "$(dirname "$0")"
sh regress35-rest.sh
echo "=== engage36"; timeout 900 node engage36.mjs 20 2>&1 | grep -E "PASS|FAIL|ALL"
echo "=== again36"; timeout 300 node again36.mjs 2>&1 | tail -4
echo "=== sndaudit36"; timeout 900 node sndaudit36.mjs 2>&1 | tail -3
echo "=== hunt41"; timeout 900 node hunt41.mjs 30 2>&1 | grep -E "FAIL|ALL"
echo "=== pipe41"; timeout 600 node pipe41.mjs 2>&1 | grep -E "FAIL|ALL"
echo REGRESS41-DONE
