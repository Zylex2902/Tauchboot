import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const html = readFileSync(process.argv[2]);
createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; worker-src blob:" });
  r.end(html);
}).listen(4180);
