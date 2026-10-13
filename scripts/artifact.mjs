// Turns dist-single/index.html into a body-only page for the hosted playtest link.
import { readFileSync, writeFileSync } from 'node:fs';
const [src = 'dist-single/index.html', out = 'dist-single/tiefgang.html', title = 'Tiefgang'] = process.argv.slice(2);
const html = readFileSync(src, 'utf8');
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '').trim();
const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]).join('\n');
const scripts = [...html.matchAll(/<script type="module"[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0]).join('\n');
const page = `<title>${title}</title>
<meta name="theme-color" content="#0b0c0e">
<style>:root{--hull:#0b0c0e;color-scheme:dark}body{background:var(--hull)}</style>
${styles}
${bodyHtml}
${scripts}
`;
writeFileSync(out, page);
console.log(out, (page.length / 1024).toFixed(0) + ' KB');
