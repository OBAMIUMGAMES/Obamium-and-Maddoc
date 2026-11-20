// Bundles src/ into dist/ as a classic (non-module) script so it runs from file:// in an Android WebView.
//  - fonts (assets/fonts, SIL OFL) are inlined into style.css as data URIs: a WebView page loaded
//    from file:// may not fetch font files cross-origin, inline fonts always load
//  - the main-menu key art (assets/branding/key-art.jpg) is written to dist/ui/ as WebP plus a small
//    pre-blurred backdrop, so the menu never runs a live blur filter
import { build } from 'esbuild';
import sharp from 'sharp';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/ui', { recursive: true });
await build({
  entryPoints: ['src/js/main.js'],
  bundle: true, minify: true, format: 'iife', target: ['chrome80'],
  outfile: 'dist/game.js', legalComments: 'none',
  loader: { '.glb': 'binary' }, // the fighter models are embedded so the game also runs from file:// and in the APK WebView
});
cpSync('src/index.html', 'dist/index.html');

const css = readFileSync('src/style.css', 'utf8').replace(/url\('fonts\/([\w.-]+\.woff2)'\)/g, (_, f) =>
  `url(data:font/woff2;base64,${readFileSync(`assets/fonts/${f}`).toString('base64')})`);
writeFileSync('dist/style.css', css);

const art = 'assets/branding/key-art.jpg';
await sharp(art).webp({ quality: 86, effort: 5 }).toFile('dist/ui/key-art.webp');
await sharp(art).resize(240, 360).blur(10).modulate({ brightness: 0.8 }).jpeg({ quality: 70 }).toFile('dist/ui/key-art-blur.jpg');
console.log('web build -> dist/');
