// Turn the single-file Vite build into an Artifact page fragment (no html/head/body tags).
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('dist-single/index.html', 'utf8');
const title = (src.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || 'Slopmerica';
const links = [...src.matchAll(/<link[^>]+fonts\.googleapis\.com\/css2[^>]*>/g)].map((m) => m[0]);
const preconnect = [...src.matchAll(/<link[^>]+rel="preconnect"[^>]*>/g)].map((m) => m[0]);
const styles = [...src.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]);
const scripts = [...src.matchAll(/<script[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0]);
const out = [`<title>${title}</title>`, ...preconnect, ...links, ...styles, '<div id="app"></div>', ...scripts].join('\n');
writeFileSync('dist-single/slopmerica.html', out);
console.log('artifact bytes', out.length, 'scripts', scripts.length, 'styles', styles.length);
