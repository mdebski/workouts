// iPhone screens, in pixels and in CSS points, for the launch screens (portrait).
// The image must match the screen's real pixel size or iOS ignores it, so the minis get their own
// entry: their 1080×2340 screen is matched as 360×780 points at 3×.
export const SPLASH_SIZES = [
  { width: 1260, height: 2736, w: 420, h: 912, dpr: 3 }, // Air
  { width: 1320, height: 2868, w: 440, h: 956, dpr: 3 }, // 16 Pro Max
  { width: 1206, height: 2622, w: 402, h: 874, dpr: 3 }, // 16 Pro
  { width: 1290, height: 2796, w: 430, h: 932, dpr: 3 }, // 14 Pro Max, 15 Plus/Pro Max, 16 Plus
  { width: 1179, height: 2556, w: 393, h: 852, dpr: 3 }, // 14 Pro, 15, 15 Pro, 16
  { width: 1284, height: 2778, w: 428, h: 926, dpr: 3 }, // 12/13 Pro Max, 14 Plus
  { width: 1170, height: 2532, w: 390, h: 844, dpr: 3 }, // 12, 13, 14, 12/13 Pro
  { width: 1125, height: 2436, w: 375, h: 812, dpr: 3 }, // X, XS, 11 Pro
  { width: 1080, height: 2340, w: 360, h: 780, dpr: 3 }, // 12 mini, 13 mini
  { width: 1242, height: 2688, w: 414, h: 896, dpr: 3 }, // XS Max, 11 Pro Max
  { width: 828, height: 1792, w: 414, h: 896, dpr: 2 },  // XR, 11
  { width: 1242, height: 2208, w: 414, h: 736, dpr: 3 }, // 6/7/8 Plus
  { width: 750, height: 1334, w: 375, h: 667, dpr: 2 },  // 6/7/8, SE 2nd/3rd gen
  { width: 640, height: 1136, w: 320, h: 568, dpr: 2 },  // 5/5s, SE 1st gen
];

/** The <link> tags for index.html. */
export const splashLinks = () => SPLASH_SIZES.map(({ width, height, w, h, dpr }) =>
  `    <link rel="apple-touch-startup-image" href="./splash/${width}x${height}.png" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)" />`).join('\n');
