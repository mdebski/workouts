// Renders the PNG app icons and the iPhone launch screens from public/icon.svg.
// Needs `sharp` (a dev dependency):
//   docker compose run --rm app npm run icons
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { SPLASH_SIZES, splashLinks } from './splash-sizes.mjs';

const src = new URL('../public/icon.svg', import.meta.url).pathname;
const out = (name) => new URL(`../public/${name}`, import.meta.url).pathname;
// Home-screen icons get masked by the OS, so fill the rounded corners with the icon's background.
const background = '#17161f';

const icon = (size) => sharp(src, { density: (72 * size) / 512 * 4 }).resize(size, size).flatten({ background }).png();

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await icon(size).toFile(out(name));
  console.log(`${name} ${size}×${size}`);
}

// iOS shows these while an app added to the home screen starts, instead of a white screen:
// the app's background with the icon in the middle, one image per screen size.
mkdirSync(out('splash'), { recursive: true });
for (const { width, height } of SPLASH_SIZES) {
  const size = Math.round(width * 0.28);
  await sharp({ create: { width, height, channels: 3, background } })
    .composite([{ input: await icon(size).toBuffer(), gravity: 'center' }])
    .png({ compressionLevel: 9, palette: true })
    .toFile(out(`splash/${width}x${height}.png`));
  console.log(`splash/${width}x${height}.png`);
}

// Keep the <link> tags in index.html in step with the images.
const html = new URL('../index.html', import.meta.url).pathname;
const before = readFileSync(html, 'utf8');
const after = before.replace(/(?:[ \t]*<link rel="apple-touch-startup-image"[^\n]*\n)+/, splashLinks() + '\n');
if (after !== before) { writeFileSync(html, after); console.log('index.html: launch screen links updated'); }
