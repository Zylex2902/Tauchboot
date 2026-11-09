#!/bin/sh
# Chunk 3.6 done-when: the engagement end to end on every test device (sequential: software rendering is slow).
cd "$(dirname "$0")"
for d in "$@"; do
  set -- $d
  MIN=48 timeout 3300 node e2e36.mjs $1 $2 $3 $4 $5 > /tmp/claude-0/e2e-$4.log 2>&1
  grep -E "^(PASS|FAIL)" /tmp/claude-0/e2e-$4.log
done
echo E2E-DONE
