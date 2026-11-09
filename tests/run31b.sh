#!/bin/sh
# One drill per browser: seeds on the tower path, then two via the desk.
cd "$(dirname "$0")"
for s in 3 8 21 5 13 34; do timeout 400 node recog31b.mjs $s 2>&1 | grep -E '^\{"seed|PASS|FAIL|Error' ; done
for s in 27 40; do timeout 400 node recog31b.mjs $s desk 2>&1 | grep -E '^\{"seed|PASS|FAIL|Error' ; done
echo DONE
