#!/bin/sh
# Start the preview server on 4173 if it is not answering.
curl -s -o /dev/null http://localhost:4173/ && exit 0
cd "$(dirname "$0")/.." && setsid nohup npx vite preview --port 4173 --strictPort > /tmp/claude-0/preview.log 2>&1 < /dev/null &
for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; curl -s -o /dev/null http://localhost:4173/ && exit 0; done
echo "preview did not start"; exit 1
