// Bundles src/ into dist/ as a classic (non-module) script so it runs from file:// in an Android WebView.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/js/main.js'],
  bundle: true, minify: true, format: 'iife', target: ['chrome80'],
  outfile: 'dist/game.js', legalComments: 'none',
  loader: { '.glb': 'binary' }, // the Toaku model is embedded so the game also runs from file:// and in the APK WebView
});
cpSync('src/index.html', 'dist/index.html');
cpSync('src/style.css', 'dist/style.css');
console.log('web build -> dist/');
