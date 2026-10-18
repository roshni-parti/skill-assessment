// Usage: node scripts/build-demo.mjs  -> dist-demo/page.html (content-only page for the Artifact tool)
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
execSync('npx vite build -c vite.demo.config.js', { stdio: 'inherit' });
const js = readFileSync('dist-demo/demo.js', 'utf8').replace(/<\/script/gi, '<\\/script');
const css = readFileSync('dist-demo/demo.css', 'utf8');
writeFileSync('dist-demo/page.html', `<meta name="claude:viewport-fit-sides" content="cover">
<title>Level Readiness</title>
<style>${css}</style>
<div id="root"></div>
<script>${js}</script>
`);
console.log('wrote dist-demo/page.html');
