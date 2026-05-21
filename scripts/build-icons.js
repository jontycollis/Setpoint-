// Icon generator for the Bior rebrand.
//
// Renders SVG templates with sharp/librsvg → PNG. Outputs:
//   assets/icon.png                   (1024x1024 master)
//   assets/adaptive-icon.png          (1024x1024 foreground, transparent bg, ~16% safe-zone)
//   assets/adaptive-icon-monochrome.png (1024x1024 white silhouette on transparent)
//   assets/bior-logo.png              (800x260 horizontal in-app logo)
//   assets/splash.png                 (1284x2778 launch splash)
//   assets/favicon.png                (48x48 favicon downscale)
//
// Run: node scripts/build-icons.js

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..', 'assets');

// Shared SVG fragments
// ────────────────────────────────────────────────────────────────────────────

const defs = `
  <defs>
    <linearGradient id="bg1" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#0F3D8C"/>
      <stop offset="100%" stop-color="#0A2461"/>
    </linearGradient>
    <radialGradient id="ballHL" cx="35%" cy="30%" r="60%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.95"/>
      <stop offset="60%" stop-color="#F0EBD0" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#C9B870" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ballBase" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFDA63"/>
      <stop offset="100%" stop-color="#D89B1B"/>
    </linearGradient>
    <filter id="ballShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="14"/>
      <feOffset dx="0" dy="18" result="offblur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.55"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
`;

// 3D gold volleyball with seams + highlight, centered at (cx, cy), radius r.
function ballGroup(cx, cy, r) {
  // Seams scale with radius. The original used r=290 with these numbers;
  // we proportionally scale.
  const k = r / 290;
  return `
  <g transform="translate(${cx} ${cy})">
    <circle r="${r}" fill="url(#ballBase)" filter="url(#ballShadow)"/>
    <circle r="${r}" fill="url(#ballHL)"/>
    <g stroke="#7A4F0A" stroke-width="${14 * k}" fill="none" stroke-linecap="round">
      <path d="M ${-270 * k} ${-100 * k} Q ${-110 * k} ${-180 * k} ${220 * k} ${-240 * k}"/>
      <path d="M ${-270 * k} ${100 * k} Q ${-110 * k} ${180 * k} ${220 * k} ${240 * k}"/>
      <path d="M ${-160 * k} ${-270 * k} Q ${-240 * k} ${-110 * k} ${-270 * k} ${220 * k}"/>
      <path d="M ${160 * k} ${-270 * k} Q ${240 * k} ${-110 * k} ${270 * k} ${220 * k}"/>
    </g>
  </g>`;
}

function spikeDot(cx, cy, r) {
  return `
  <g transform="translate(${cx} ${cy})">
    <circle r="${r}" fill="#FF5A36"/>
    <circle r="${r}" fill="none" stroke="#FFFFFF" stroke-width="${r * 0.18}"/>
  </g>`;
}

const FONT = `'Segoe UI', -apple-system, Roboto, Arial, sans-serif`;

// SVGs
// ────────────────────────────────────────────────────────────────────────────

// Master icon — 1024x1024 with navy gradient bg + ball + spike dot + BIOR text.
function masterSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  ${defs}
  <rect width="1024" height="1024" rx="220" fill="url(#bg1)"/>
  ${ballGroup(512, 440, 280)}
  ${spikeDot(512, 440, 52)}
  <text x="512" y="900" font-family="${FONT}" font-weight="800" font-size="200" letter-spacing="-2" text-anchor="middle" fill="#FFFFFF">BIOR</text>
</svg>`;
}

// Adaptive icon foreground — same content but transparent bg, scaled to ~70%
// of canvas (16% safe-zone padding each side).
function adaptiveForegroundSvg() {
  // The ball + dot + text live inside a 1024x1024 viewBox. To leave 16%
  // padding on the outer 1024 canvas, we scale to 68% and translate to center.
  // 68% of 1024 = 696.32; offset = (1024 - 696.32)/2 = 163.84.
  // Compose by wrapping in a <g transform>.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  ${defs}
  <g transform="translate(163.84 163.84) scale(0.68)">
    ${ballGroup(512, 440, 280)}
    ${spikeDot(512, 440, 52)}
    <text x="512" y="900" font-family="${FONT}" font-weight="800" font-size="200" letter-spacing="-2" text-anchor="middle" fill="#FFFFFF">BIOR</text>
  </g>
</svg>`;
}

// Monochrome themed icon — pure white silhouette of ball + spike + text on
// transparent. Android 13+ tints this single layer with the user's theme
// accent; only the alpha channel matters. Scaled to match the foreground.
function monochromeSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <g transform="translate(163.84 163.84) scale(0.68)">
    <circle cx="512" cy="440" r="280" fill="#FFFFFF"/>
    <text x="512" y="900" font-family="${FONT}" font-weight="800" font-size="200" letter-spacing="-2" text-anchor="middle" fill="#FFFFFF">BIOR</text>
  </g>
</svg>`;
}

// Horizontal in-app logo — 800x260. Left: "Bior" wordmark in two colors
// echoing the original "Set"+"Point" split; below it: tagline. Right:
// volleyball icon with motion lines.
function bannerLogoSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 260" width="800" height="260">
  ${defs}
  <!-- Wordmark: "Bi" in blue, "or" in dark navy to echo the SetPoint two-tone -->
  <text x="20" y="135" font-family="${FONT}" font-weight="800" font-size="120" letter-spacing="-3" fill="#1a73e8">Bi<tspan fill="#0A2461">or</tspan></text>
  <!-- Tagline -->
  <text x="22" y="180" font-family="${FONT}" font-weight="400" font-size="26" fill="#666666">Live volleyball scores &amp; stats</text>
  <!-- Motion lines -->
  <g stroke="#bcd3f5" stroke-width="6" stroke-linecap="round" fill="none">
    <line x1="430" y1="100" x2="540" y2="100"/>
    <line x1="450" y1="130" x2="540" y2="130"/>
    <line x1="430" y1="160" x2="540" y2="160"/>
  </g>
  <!-- Ball, scaled and shifted to fit on the right -->
  <g transform="translate(660 130) scale(0.36)">
    <circle r="290" fill="url(#ballBase)" filter="url(#ballShadow)"/>
    <circle r="290" fill="url(#ballHL)"/>
    <g stroke="#7A4F0A" stroke-width="14" fill="none" stroke-linecap="round">
      <path d="M -270 -100 Q -110 -180 220 -240"/>
      <path d="M -270 100 Q -110 180 220 240"/>
      <path d="M -160 -270 Q -240 -110 -270 220"/>
      <path d="M 160 -270 Q 240 -110 270 220"/>
    </g>
    <circle r="60" fill="#FF5A36"/>
    <circle r="60" fill="none" stroke="#FFFFFF" stroke-width="12"/>
  </g>
</svg>`;
}

// Splash screen — 1284x2778 white canvas, centered icon + wordmark + tagline.
function splashSvg() {
  // Reuse the master icon at ~520px in the middle, with text below.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1284 2778" width="1284" height="2778">
  ${defs}
  <rect width="1284" height="2778" fill="#ffffff"/>
  <!-- Centered icon group ~520x520 at midpoint vertically -->
  <g transform="translate(${(1284 - 520) / 2} ${1280}) scale(${520 / 1024})">
    <rect width="1024" height="1024" rx="220" fill="url(#bg1)"/>
    ${ballGroup(512, 440, 280)}
    ${spikeDot(512, 440, 52)}
    <text x="512" y="900" font-family="${FONT}" font-weight="800" font-size="200" letter-spacing="-2" text-anchor="middle" fill="#FFFFFF">BIOR</text>
  </g>
  <!-- Wordmark below -->
  <text x="642" y="1900" font-family="${FONT}" font-weight="800" font-size="96" letter-spacing="-2" text-anchor="middle" fill="#0A2461">Bior</text>
  <text x="642" y="1970" font-family="${FONT}" font-weight="400" font-size="40" text-anchor="middle" fill="#666666">Live volleyball scores &amp; stats</text>
</svg>`;
}

// Build + verify
// ────────────────────────────────────────────────────────────────────────────

async function renderSvg(svg, outPath, expected) {
  const buf = Buffer.from(svg);
  // Render at higher density for crisp text/curves, then resize to target.
  // density 200 yields ~2.78x oversample for a 1024 viewBox; fine for downscale.
  await sharp(buf, { density: 200 })
    .resize(expected.w, expected.h, { fit: 'fill' })
    .png()
    .toFile(outPath);
  const meta = await sharp(outPath).metadata();
  const ok = meta.width === expected.w && meta.height === expected.h && meta.channels === 4;
  console.log(
    `${ok ? '✓' : '✗'} ${path.relative(path.resolve(__dirname, '..'), outPath)}  ${meta.width}x${meta.height} ${meta.channels}ch`
  );
  if (!ok) {
    throw new Error(
      `Mismatch: ${outPath} expected ${expected.w}x${expected.h} 4ch, got ${meta.width}x${meta.height} ${meta.channels}ch`
    );
  }
}

async function main() {
  if (!fs.existsSync(OUT)) {
    throw new Error(`assets/ does not exist at ${OUT}`);
  }
  await renderSvg(masterSvg(), path.join(OUT, 'icon.png'), { w: 1024, h: 1024 });
  await renderSvg(adaptiveForegroundSvg(), path.join(OUT, 'adaptive-icon.png'), { w: 1024, h: 1024 });
  await renderSvg(monochromeSvg(), path.join(OUT, 'adaptive-icon-monochrome.png'), { w: 1024, h: 1024 });
  await renderSvg(bannerLogoSvg(), path.join(OUT, 'bior-logo.png'), { w: 800, h: 260 });
  await renderSvg(splashSvg(), path.join(OUT, 'splash.png'), { w: 1284, h: 2778 });

  // Favicon — downscale from the freshly-generated icon.png to 48x48.
  await sharp(path.join(OUT, 'icon.png'))
    .resize(48, 48, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(OUT, 'favicon.png'));
  const fm = await sharp(path.join(OUT, 'favicon.png')).metadata();
  console.log(
    `${fm.width === 48 && fm.height === 48 ? '✓' : '✗'} assets/favicon.png  ${fm.width}x${fm.height} ${fm.channels}ch`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
