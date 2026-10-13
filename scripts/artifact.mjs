// Turns dist-single/index.html into a body-only page for the hosted playtest link.
import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync('dist-single/index.html', 'utf8');
const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]).join('\n');
const scripts = [...html.matchAll(/<script type="module"[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0]).join('\n');
const page = `<title>Tiefgang</title>
<meta name="theme-color" content="#0b0c0e">
<style>:root{--hull:#0b0c0e;color-scheme:dark}body{background:var(--hull)}</style>
${styles}
<div id="safe-probe"></div>
<div id="app"></div>
${scripts}
`;
writeFileSync('dist-single/tiefgang.html', page);
console.log('dist-single/tiefgang.html', (page.length / 1024).toFixed(0) + ' KB');
