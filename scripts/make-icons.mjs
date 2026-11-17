// Renders the PNG app icons from public/icon.svg. Needs `sharp` (a dev dependency).
//   docker compose run --rm app npm run icons
import sharp from 'sharp';

const src = new URL('../public/icon.svg', import.meta.url).pathname;
const out = (name) => new URL(`../public/${name}`, import.meta.url).pathname;
// Home-screen icons get masked by the OS, so fill the rounded corners with the icon's background.
const background = '#17161f';

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await sharp(src, { density: (72 * size) / 512 * 4 })
    .resize(size, size)
    .flatten({ background })
    .png()
    .toFile(out(name));
  console.log(`${name} ${size}×${size}`);
}
