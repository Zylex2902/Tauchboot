#!/bin/sh
cd "$(dirname "$0")"
# Every sim bundle first (a fresh clone has none; older chains build some only after tests that need them).
for e in *-entry.ts; do npx --prefix .. rolldown "$e" --format esm --platform node --inline-dynamic-imports -o "${e%-entry.ts}-sim.mjs" >/dev/null 2>&1; done
npx --prefix .. rolldown gangs53-entry.ts --format esm --platform node -o gangs53-sim.mjs >/dev/null 2>&1
sh regress52.sh
echo "=== gangs53"; timeout 600 node gangs53.mjs 2>&1 | grep -E "FAIL|ALL"
echo "=== gangs53ui"; timeout 900 node gangs53ui.mjs 2>&1 | grep -E "FAIL|ALL"
echo REGRESS53-DONE
