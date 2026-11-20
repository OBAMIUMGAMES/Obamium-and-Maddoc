// Android launcher icons from assets/branding/app-icon-source.jpg (Toaku + the BRAWLERS logo).
//   legacy  : res/mipmap-<density>/ic_launcher.png      (Android 7, rounded-square artwork)
//   adaptive: res/mipmap-anydpi-v26/ic_launcher.xml     (Android 8+, launcher applies its own mask)
//             foreground = the artwork shrunk into the 66 dp safe zone so a circle mask keeps the
//             helmet and the whole logo; background = the same artwork enlarged and blurred.
// usage: node tools/build-icons.mjs
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';

const SRC = 'assets/branding/app-icon-source.jpg';
const RES = 'android/res';
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const ART_DP = 66; // artwork size inside the 108 dp adaptive canvas = the 66 dp safe zone, so no mask clips the logo

/** The artwork with its black rounded corners made transparent, at `size` px. */
async function art(size, radiusFrac = 0.075) {
  const r = Math.round(size * radiusFrac);
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);
  return sharp(SRC).resize(size, size, { kernel: 'lanczos3' })
    .composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

for (const [name, k] of Object.entries(DENSITIES)) {
  const dir = `${RES}/mipmap-${name}`;
  mkdirSync(dir, { recursive: true });
  // legacy: 48 dp, artwork fills the square with a small margin
  const L = Math.round(48 * k), inner = Math.round(46 * k), off = Math.round((L - inner) / 2);
  await sharp({ create: { width: L, height: L, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await art(inner), left: off, top: off }]).png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 }).toFile(`${dir}/ic_launcher.png`);
  // adaptive layers: 108 dp
  const A = Math.round(108 * k), a = Math.round(ART_DP * k), o = Math.round((A - a) / 2);
  await sharp({ create: { width: A, height: A, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await art(a), left: o, top: o }]).png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 }).toFile(`${dir}/ic_launcher_foreground.png`);
  await sharp(SRC).resize(A, A).modulate({ brightness: 0.55, saturation: 1.1 }).blur(Math.max(1, 6 * k)).png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 }).toFile(`${dir}/ic_launcher_background.png`);
}
mkdirSync(`${RES}/mipmap-anydpi-v26`, { recursive: true });
const xml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
writeFileSync(`${RES}/mipmap-anydpi-v26/ic_launcher.xml`, xml);
writeFileSync(`${RES}/mipmap-anydpi-v26/ic_launcher_round.xml`, xml);
// round legacy icon = same artwork in a circle-friendly layout (Android 7.1 round launchers)
for (const [name, k] of Object.entries(DENSITIES)) {
  const L = Math.round(48 * k);
  const circle = Buffer.from(`<svg width="${L}" height="${L}"><circle cx="${L / 2}" cy="${L / 2}" r="${L / 2}" fill="#fff"/></svg>`);
  const a = Math.round(L * 0.86), o = Math.round((L - a) / 2);
  const bg = await sharp(SRC).resize(L, L).modulate({ brightness: 0.55 }).blur(Math.max(1, 3 * k)).png().toBuffer();
  await sharp(bg).composite([{ input: await art(a), left: o, top: o }, { input: circle, blend: 'dest-in' }]).png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 }).toFile(`${RES}/mipmap-${name}/ic_launcher_round.png`);
}
console.log('icons -> android/res/mipmap-*');
