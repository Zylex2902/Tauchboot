#!/bin/sh
cd "$(dirname "$0")"
sh regress42.sh
echo "=== pipe43"; timeout 600 node pipe43.mjs 2>&1 | grep -E "FAIL|ALL"
echo REGRESS43-DONE
