// Dalliqo brand generator.
//
//   cd tools/brand && npm install && node build.mjs
//
// Reads shared/brand/dalliqo.tokens.json and writes:
//   branding/            master logo set (SVG + transparent PNG), favicons, app icons, splash art
//   web/                 public favicons + manifest, logo SVGs, generated CSS variables
//   mobile/              bundled font (TTF), logo PNGs, Android/iOS launcher icons + splash, Dart tokens
//   server/assets/brand  logo PNG used in PDF reports
//   shared/src/brand.ts  name, tagline and colours for TypeScript code
// It also checks text/background contrast against WCAG AA and prints a report.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import opentype from 'opentype.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '../..');
const require = createRequire(join(ROOT, 'server/package.json'));
const sharp = require('sharp');
const T = JSON.parse(readFileSync(join(ROOT, 'shared/brand/dalliqo.tokens.json'), 'utf8'));
const L = T.logo;
const out = (...p) => {
  const f = join(ROOT, ...p);
  mkdirSync(dirname(f), { recursive: true });
  return f;
};
const write = (rel, data) => writeFileSync(out(...rel.split('/')), data);

// ───────────── fonts: WOFF → TTF (Flutter needs TTF; web uses @fontsource) ─────────────
function woffToTtf(buf) {
  if (buf.toString('ascii', 0, 4) !== 'wOFF') throw new Error('not a WOFF file');
  const flavor = buf.readUInt32BE(4);
  const numTables = buf.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20;
    const tag = buf.toString('ascii', o, o + 4);
    const offset = buf.readUInt32BE(o + 4);
    const compLength = buf.readUInt32BE(o + 8);
    const origLength = buf.readUInt32BE(o + 12);
    const checksum = buf.readUInt32BE(o + 16);
    const raw = buf.subarray(offset, offset + compLength);
    const data = compLength < origLength ? inflateSync(raw) : Buffer.from(raw);
    tables.push({ tag, checksum, data });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const pow = 2 ** Math.floor(Math.log2(numTables));
  const header = Buffer.alloc(12 + 16 * numTables);
  header.writeUInt32BE(flavor, 0);
  header.writeUInt16BE(numTables, 4);
  header.writeUInt16BE(pow * 16, 6);
  header.writeUInt16BE(Math.log2(pow), 8);
  header.writeUInt16BE(numTables * 16 - pow * 16, 10);
  let offset = header.length;
  const chunks = [header];
  tables.forEach((t, i) => {
    const rec = 12 + i * 16;
    header.write(t.tag, rec, 'ascii');
    header.writeUInt32BE(t.checksum, rec + 4);
    header.writeUInt32BE(offset, rec + 8);
    header.writeUInt32BE(t.data.length, rec + 12);
    const pad = (4 - (t.data.length % 4)) % 4;
    chunks.push(t.data, Buffer.alloc(pad));
    offset += t.data.length + pad;
  });
  return Buffer.concat(chunks);
}

const FONT_DIR = join(here, 'node_modules/@fontsource/plus-jakarta-sans/files');
const WEIGHT_NAME = { 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold' };
const ttf = {};
for (const w of T.typography.weights) {
  ttf[w] = woffToTtf(readFileSync(join(FONT_DIR, `plus-jakarta-sans-latin-${w}-normal.woff`)));
  write(`mobile/assets/fonts/PlusJakartaSans-${WEIGHT_NAME[w]}.ttf`, ttf[w]);
}
const licence = join(here, 'node_modules/@fontsource/plus-jakarta-sans/LICENSE');
if (existsSync(licence)) copyFileSync(licence, out('mobile', 'assets', 'fonts', 'OFL-PlusJakartaSans.txt'));
const fontOf = (w) => opentype.parse(ttf[w].buffer.slice(ttf[w].byteOffset, ttf[w].byteOffset + ttf[w].byteLength));
const fWord = fontOf(T.typography.wordmarkWeight);
const fTag = fontOf(T.typography.taglineWeight);

/** Text as an SVG path (no font needed to display the logo), plus its bounding box. */
function textPath(font, text, size, tracking = 0) {
  let x = 0;
  const parts = [];
  const glyphs = font.stringToGlyphs(text);
  glyphs.forEach((g, i) => {
    const p = g.getPath(x, 0, size);
    parts.push(p.toPathData(2));
    x += (g.advanceWidth / font.unitsPerEm) * size + tracking * size;
    if (i < glyphs.length - 1) x += (font.getKerningValue(g, glyphs[i + 1]) / font.unitsPerEm) * size;
  });
  const full = font.getPath(text, 0, 0, size);
  const bb = full.getBoundingBox();
  return { d: parts.join(' '), width: x - tracking * size, top: bb.y1, bottom: bb.y2 };
}

// ───────────── the mark ─────────────
// A rounded app tile with a bold "D" whose counter is a house with a door, and an
// amber dot (the lead / location ping). Drawn on a 512 grid.
const MARK_PATH = 'M136 112H262C358 112 412 176 412 256C412 336 358 400 262 400H136Z M258 168L338 238V332H276V290H240V332H178V238Z';
function markSvg({ tile = true, fg = L.mark, dot = L.dot, square = false, id = 'g' } = {}) {
  const defs = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${L.gradientFrom}"/><stop offset="1" stop-color="${L.gradientTo}"/></linearGradient></defs>`;
  const bg = tile ? `<rect width="512" height="512" rx="${square ? 0 : 116}" fill="url(#${id})"/>` : '';
  return `${tile ? defs : ''}${bg}<path fill="${fg}" fill-rule="evenodd" d="${MARK_PATH}"/><circle cx="404" cy="128" r="30" fill="${dot}"/>`;
}
const svgDoc = (w, h, body, title = T.name) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;

const WORD = textPath(fWord, 'dalliqo', 200, -0.015);
const TAG = textPath(fTag, T.tagline, 40, 0.01);

function horizontal(dark) {
  const H = 160;
  const scale = (H * 0.62) / (WORD.bottom - WORD.top); // ascenders ≈ 62% of the mark height
  const gap = 40;
  const wordW = WORD.width * scale;
  const ty = H / 2 - ((WORD.top + WORD.bottom) / 2) * scale;
  const w = Math.ceil(H + gap + wordW + 8);
  return svgDoc(w, H, `<g transform="scale(${H / 512})">${markSvg({ id: dark ? 'gd' : 'gl' })}</g><path fill="${dark ? L.wordmarkOnDark : L.wordmarkOnLight}" transform="translate(${H + gap} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})" d="${WORD.d}"/>`, `${T.name} — ${T.tagline}`);
}

function primary(dark) {
  const M = 220;
  const wordScale = 0.62;
  const wordW = WORD.width * wordScale;
  const tagScale = 0.86;
  const tagW = TAG.width * tagScale;
  const W = Math.ceil(Math.max(wordW, tagW, M) + 40);
  const wordTop = M + 36;
  const wy = wordTop - WORD.top * wordScale;
  const wordBottom = wy + WORD.bottom * wordScale;
  const tagTop = wordBottom + 28;
  const ty = tagTop - TAG.top * tagScale;
  const Hh = Math.ceil(ty + TAG.bottom * tagScale + 12);
  return svgDoc(W, Hh,
    `<g transform="translate(${(W - M) / 2} 0) scale(${M / 512})">${markSvg({ id: dark ? 'pd' : 'pl' })}</g>` +
    `<path fill="${dark ? L.wordmarkOnDark : L.wordmarkOnLight}" transform="translate(${((W - wordW) / 2).toFixed(2)} ${wy.toFixed(2)}) scale(${wordScale})" d="${WORD.d}"/>` +
    `<path fill="${dark ? L.taglineOnDark : L.taglineOnLight}" transform="translate(${((W - tagW) / 2).toFixed(2)} ${ty.toFixed(2)}) scale(${tagScale})" d="${TAG.d}"/>`,
    `${T.name} — ${T.tagline}`);
}

function wordmark(dark) {
  const s = 0.5;
  const w = Math.ceil(WORD.width * s + 4);
  const h = Math.ceil((WORD.bottom - WORD.top) * s + 4);
  return svgDoc(w, h, `<path fill="${dark ? L.wordmarkOnDark : L.wordmarkOnLight}" transform="translate(2 ${(2 - WORD.top * s).toFixed(2)}) scale(${s})" d="${WORD.d}"/>`);
}

const SVGS = {
  'dalliqo-mark': svgDoc(512, 512, markSvg()),
  'dalliqo-mark-square': svgDoc(512, 512, markSvg({ square: true, id: 'gs' })),
  'dalliqo-mark-white': svgDoc(512, 512, markSvg({ tile: false, fg: '#FFFFFF', dot: L.dot })),
  'dalliqo-mark-mono': svgDoc(512, 512, markSvg({ tile: false, fg: L.wordmarkOnLight, dot: L.wordmarkOnLight })),
  'dalliqo-logo-horizontal': horizontal(false),
  'dalliqo-logo-horizontal-dark': horizontal(true),
  'dalliqo-logo-primary': primary(false),
  'dalliqo-logo-primary-dark': primary(true),
  'dalliqo-wordmark': wordmark(false),
  'dalliqo-wordmark-white': wordmark(true),
};
for (const [name, svg] of Object.entries(SVGS)) write(`branding/svg/${name}.svg`, svg);

const png = (svg, width, height) => sharp(Buffer.from(svg), { density: 300 }).resize(width, height ?? null, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toBuffer();
const sizeOf = (svg) => svg.match(/width="(\d+)" height="(\d+)"/).slice(1).map(Number);

// Transparent PNG exports.
for (const name of ['dalliqo-logo-horizontal', 'dalliqo-logo-horizontal-dark', 'dalliqo-logo-primary', 'dalliqo-logo-primary-dark', 'dalliqo-wordmark', 'dalliqo-wordmark-white']) {
  const [w, h] = sizeOf(SVGS[name]);
  for (const target of [600, 1200, 2400]) write(`branding/png/${name}-${target}w.png`, await png(SVGS[name], target, Math.round((h / w) * target)));
}
for (const name of ['dalliqo-mark', 'dalliqo-mark-white', 'dalliqo-mark-mono']) {
  for (const s of [16, 32, 48, 64, 128, 256, 512, 1024]) write(`branding/png/${name}-${s}.png`, await png(SVGS[name], s, s));
}

// ───────────── favicons, PWA icons ─────────────
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map((x) => x.data)]);
}
const fav = {};
for (const s of [16, 32, 48]) fav[s] = await png(SVGS['dalliqo-mark'], s, s);
const favicon = ico([16, 32, 48].map((size) => ({ size, data: fav[size] })));
const apple = await sharp(Buffer.from(SVGS['dalliqo-mark-square'])).resize(180, 180).flatten({ background: L.gradientTo }).png().toBuffer();
const icon192 = await png(SVGS['dalliqo-mark'], 192, 192);
const icon512 = await png(SVGS['dalliqo-mark'], 512, 512);
// Maskable: full-bleed background, mark inside the 80% safe zone.
const maskable = svgDoc(512, 512, `<defs><linearGradient id="gm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${L.gradientFrom}"/><stop offset="1" stop-color="${L.gradientTo}"/></linearGradient></defs><rect width="512" height="512" fill="url(#gm)"/><g transform="translate(76.8 76.8) scale(0.7)">${markSvg({ tile: false })}</g>`);
const icon512m = await png(maskable, 512, 512);
const manifest = JSON.stringify({
  name: `${T.name} — ${T.description}`,
  short_name: T.name,
  description: T.tagline,
  start_url: '/',
  display: 'standalone',
  background_color: T.color.light.canvas,
  theme_color: T.color.primary['900'],
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2);
for (const base of ['branding/favicon', 'web/public']) {
  write(`${base}/favicon.ico`, favicon);
  write(`${base}/favicon.svg`, SVGS['dalliqo-mark']);
  write(`${base}/favicon-16.png`, fav[16]);
  write(`${base}/favicon-32.png`, fav[32]);
  write(`${base}/apple-touch-icon.png`, apple);
  write(`${base}/icons/icon-192.png`, icon192);
  write(`${base}/icons/icon-512.png`, icon512);
  write(`${base}/icons/icon-512-maskable.png`, icon512m);
  write(`${base}/site.webmanifest`, manifest + '\n');
}
for (const n of ['dalliqo-mark', 'dalliqo-logo-horizontal', 'dalliqo-logo-horizontal-dark', 'dalliqo-logo-primary', 'dalliqo-logo-primary-dark']) write(`web/src/assets/brand/${n}.svg`, SVGS[n]);

// ───────────── Android launcher icons + splash ─────────────
const RES = 'mobile/android/app/src/main/res';
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
// Adaptive layers (108dp canvas; keep the mark inside the 66dp safe circle).
const fgSvg = (fg, dot) => svgDoc(432, 432, `<g transform="translate(108 108) scale(${216 / 512})">${markSvg({ tile: false, fg, dot })}</g>`);
const bgSvg = svgDoc(432, 432, `<defs><linearGradient id="ab" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${L.gradientFrom}"/><stop offset="1" stop-color="${L.gradientTo}"/></linearGradient></defs><rect width="432" height="432" fill="url(#ab)"/>`);
for (const [d, k] of Object.entries(DENS)) {
  write(`${RES}/mipmap-${d}/ic_launcher.png`, await png(SVGS['dalliqo-mark'], 48 * k, 48 * k));
  write(`${RES}/mipmap-${d}/ic_launcher_round.png`, await sharp(await png(SVGS['dalliqo-mark-square'], 48 * k, 48 * k)).composite([{ input: Buffer.from(`<svg width="${48 * k}" height="${48 * k}"><circle cx="${24 * k}" cy="${24 * k}" r="${24 * k}"/></svg>`), blend: 'dest-in' }]).png().toBuffer());
  write(`${RES}/mipmap-${d}/ic_launcher_foreground.png`, await png(fgSvg('#FFFFFF', L.dot), 108 * k, 108 * k));
  write(`${RES}/mipmap-${d}/ic_launcher_monochrome.png`, await png(fgSvg('#FFFFFF', '#FFFFFF'), 108 * k, 108 * k));
  write(`${RES}/mipmap-${d}/ic_launcher_background.png`, await png(bgSvg, 108 * k, 108 * k));
  // Pre-Android-12 splash: logo centred on the brand background.
  write(`${RES}/drawable-${d}/splash_logo.png`, await png(SVGS['dalliqo-logo-primary-dark'], Math.round(200 * k)));
  // Android 12+ splash icon (240dp canvas, icon inside the 160dp circle).
  write(`${RES}/drawable-${d}/splash_icon.png`, await png(svgDoc(480, 480, `<g transform="translate(120 120) scale(${240 / 512})">${markSvg({ id: 'si' })}</g>`), 240 * k, 240 * k));
}
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
`;
write(`${RES}/mipmap-anydpi-v26/ic_launcher.xml`, adaptive);
write(`${RES}/mipmap-anydpi-v26/ic_launcher_round.xml`, adaptive);
write(`${RES}/values/colors.xml`, `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by tools/brand/build.mjs from shared/brand/dalliqo.tokens.json -->
<resources>
    <color name="dalliqo_splash">${L.splashBackground}</color>
    <color name="dalliqo_primary">${T.color.primary['600']}</color>
</resources>
`);
const launchBg = `<?xml version="1.0" encoding="utf-8"?>
<!-- Dalliqo launch screen (generated by tools/brand/build.mjs). -->
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/dalliqo_splash" />
    <item>
        <bitmap android:gravity="center" android:src="@drawable/splash_logo" />
    </item>
</layer-list>
`;
write(`${RES}/drawable/launch_background.xml`, launchBg);
write(`${RES}/drawable-v21/launch_background.xml`, launchBg);
const v31 = (parent) => `<?xml version="1.0" encoding="utf-8"?>
<!-- Android 12+ system splash (generated by tools/brand/build.mjs). -->
<resources>
    <style name="LaunchTheme" parent="${parent}">
        <item name="android:windowSplashScreenBackground">@color/dalliqo_splash</item>
        <item name="android:windowSplashScreenAnimatedIcon">@drawable/splash_icon</item>
        <item name="android:windowBackground">@drawable/launch_background</item>
    </style>
    <style name="NormalTheme" parent="${parent}">
        <item name="android:windowBackground">?android:colorBackground</item>
    </style>
</resources>
`;
write(`${RES}/values-v31/styles.xml`, v31('@android:style/Theme.Light.NoTitleBar'));
write(`${RES}/values-night-v31/styles.xml`, v31('@android:style/Theme.Black.NoTitleBar'));

// ───────────── iOS app icons + launch image ─────────────
const IOS = 'mobile/ios/Runner/Assets.xcassets';
const iconDir = join(ROOT, IOS, 'AppIcon.appiconset');
if (existsSync(iconDir)) {
  for (const f of readdirSync(iconDir).filter((x) => x.endsWith('.png'))) {
    const m = f.match(/(\d+(?:\.\d+)?)x\d+(?:\.\d+)?@(\d)x/);
    if (!m) continue;
    const px = Math.round(Number(m[1]) * Number(m[2]));
    // iOS masks the corners itself and rejects transparency: full-bleed square, flattened.
    write(`${IOS}/AppIcon.appiconset/${f}`, await sharp(Buffer.from(SVGS['dalliqo-mark-square'])).resize(px, px).flatten({ background: L.gradientTo }).png().toBuffer());
  }
}
for (const [f, k] of [['LaunchImage.png', 1], ['LaunchImage@2x.png', 2], ['LaunchImage@3x.png', 3]]) {
  write(`${IOS}/LaunchImage.imageset/${f}`, await png(SVGS['dalliqo-logo-primary-dark'], 200 * k));
}

// ───────────── app-embedded logos ─────────────
for (const [name, w] of [['dalliqo-mark', 512], ['dalliqo-logo-horizontal', 1200], ['dalliqo-logo-horizontal-dark', 1200], ['dalliqo-logo-primary', 900], ['dalliqo-logo-primary-dark', 900]]) {
  const [sw, sh] = sizeOf(SVGS[name]);
  write(`mobile/assets/brand/${name}.png`, await png(SVGS[name], w, Math.round((sh / sw) * w)));
}
write('server/assets/brand/dalliqo-logo-horizontal.png', await png(SVGS['dalliqo-logo-horizontal'], 900));
write('server/assets/brand/dalliqo-mark.png', await png(SVGS['dalliqo-mark'], 256, 256));

// ───────────── theme code ─────────────
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ');
const css = (mode) => {
  const c = T.color[mode];
  return [
    `--brand-50: ${rgb(c.primarySoft)};`, `--brand-100: ${rgb(c.primarySoft2)};`, `--brand-500: ${rgb(c.primaryFocus)};`,
    `--brand-600: ${rgb(c.primary)};`, `--brand-700: ${rgb(c.primaryHover)};`, `--brand-ink: ${rgb(c.primarySoftInk)};`, `--on-brand: ${rgb(c.onPrimary)};`,
    `--accent: ${rgb(T.color.accent['500'])};`, `--canvas: ${rgb(c.canvas)};`, `--surface: ${rgb(c.surface)};`, `--line: ${rgb(c.line)};`,
    `--ink: ${rgb(c.ink)};`, `--muted: ${rgb(c.muted)};`,
  ].map((l) => `  ${l}`).join('\n');
};
write('web/src/styles/brand.css', `/* Generated by tools/brand/build.mjs from shared/brand/dalliqo.tokens.json — do not edit by hand. */
:root {
${css('light')}
  color-scheme: light;
}
.dark {
${css('dark')}
  color-scheme: dark;
}
`);
write('shared/src/brand.ts', `// Generated by tools/brand/build.mjs from shared/brand/dalliqo.tokens.json — do not edit by hand.
export const BRAND = ${JSON.stringify({ name: T.name, tagline: T.tagline, description: T.description, color: T.color, logo: T.logo, typography: T.typography, radius: T.radius }, null, 2)} as const;
`);
const dc = (hex) => `Color(0xFF${hex.slice(1).toUpperCase()})`;
const dartSet = (mode) => Object.entries(T.color[mode]).map(([k, v]) => `  static const ${k} = ${dc(v)};`).join('\n');
write('mobile/lib/core/theme/brand_tokens.dart', `// Generated by tools/brand/build.mjs from shared/brand/dalliqo.tokens.json — do not edit by hand.
import 'package:flutter/material.dart';

class Brand {
  Brand._();
  static const name = '${T.name}';
  static const tagline = '${T.tagline}';
  static const description = '${T.description.replace(/'/g, "\\'")}';
  static const fontFamily = '${T.typography.family}';
${Object.entries(T.color.primary).map(([k, v]) => `  static const primary${k} = ${dc(v)};`).join('\n')}
  static const accent = ${dc(T.color.accent['500'])};
  static const success = ${dc(T.color.status.success)};
  static const warning = ${dc(T.color.status.warning)};
  static const danger = ${dc(T.color.status.danger)};
  static const info = ${dc(T.color.status.info)};
  static const splashBackground = ${dc(L.splashBackground)};
  static const gradientFrom = ${dc(L.gradientFrom)};
  static const gradientTo = ${dc(L.gradientTo)};
  static const radiusSm = ${T.radius.sm}.0;
  static const radiusMd = ${T.radius.md}.0;
  static const radiusLg = ${T.radius.lg}.0;
  static const radiusXl = ${T.radius.xl}.0;
}

class BrandLight {
  BrandLight._();
${dartSet('light')}
}

class BrandDark {
  BrandDark._();
${dartSet('dark')}
}
`);

// ───────────── contrast report (WCAG 2.1) ─────────────
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const pairs = [];
for (const mode of ['light', 'dark']) {
  const c = T.color[mode];
  pairs.push(
    [mode, 'Body text (ink) on surface', c.ink, c.surface, 4.5],
    [mode, 'Body text (ink) on canvas', c.ink, c.canvas, 4.5],
    [mode, 'Secondary text (muted) on surface', c.muted, c.surface, 4.5],
    [mode, 'Secondary text (muted) on canvas', c.muted, c.canvas, 4.5],
    [mode, 'Links / IDs (primary) on surface', c.primary, c.surface, 4.5],
    [mode, 'Button label on primary', c.onPrimary, c.primary, 4.5],
    [mode, 'Button label on primary (hover)', c.onPrimary, c.primaryHover, 4.5],
    [mode, 'Selected item text on soft primary', c.primarySoftInk, c.primarySoft, 4.5],
    [mode, 'Borders (line) vs surface — non-text', c.line, c.surface, 1.0],
  );
}
pairs.push(['both', 'Text on accent (midnight on amber)', T.color.primary['900'], T.color.accent['500'], 4.5]);
pairs.push(['both', 'Wordmark on light / white on midnight', L.wordmarkOnLight, '#FFFFFF', 4.5]);
const report = pairs.map(([mode, what, fg, bg, min]) => ({ mode, what, fg, bg, ratio: Math.round(ratio(fg, bg) * 100) / 100, min, pass: ratio(fg, bg) >= min }));
write('branding/contrast-report.json', JSON.stringify(report, null, 2) + '\n');
const failing = report.filter((r) => !r.pass);
console.table(report.map(({ mode, what, ratio: r, pass }) => ({ mode, what, ratio: r, pass })));
if (failing.length) {
  console.error(`✗ ${failing.length} colour pair(s) below WCAG AA`);
  process.exitCode = 1;
} else console.log('✓ all text colour pairs meet WCAG AA (4.5:1)');
console.log('✓ brand assets generated');
