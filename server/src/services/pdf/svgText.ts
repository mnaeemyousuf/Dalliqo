import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ARABIC, MIRROR, gapsBetween, tokenize, visualOrder, type Dir, type Token } from './pdfText';

/**
 * Text for generated images (brochure share cards): every word is shaped with fontkit — the same engine
 * the PDFs use — and written as SVG <path>s, so Urdu renders correctly without any system fonts (librsvg
 * in sharp would otherwise fall back to whatever fonts the server has). Bundled fonts: Noto Sans (Latin)
 * and Noto Naskh Arabic, both OFL.
 */

// fontkit ships with pdfkit; its types are not published, so the few members used are typed here.
interface FkGlyph {
  path: { toSVG(): string };
}
interface FkRun {
  glyphs: FkGlyph[];
  positions: { xAdvance: number; xOffset: number; yOffset: number }[];
  advanceWidth: number;
}
interface FkFont {
  unitsPerEm: number;
  ascent: number;
  layout(text: string): FkRun;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fontkit = require('fontkit') as { openSync(path: string): FkFont };

const fontFile = (name: string) => [join(__dirname, '../../../assets/fonts', name), join(process.cwd(), 'assets/fonts', name)].find((p) => existsSync(p));
const cache = new Map<string, FkFont | null>();
function load(name: string): FkFont | null {
  if (!cache.has(name)) {
    const file = fontFile(name);
    cache.set(name, file ? fontkit.openSync(file) : null);
  }
  return cache.get(name)!;
}

export function svgFontsAvailable(): boolean {
  return !!load('NotoSans-Regular.woff') && !!load('NotoNaskhArabic-Regular.woff');
}

function fontFor(text: string, bold: boolean): FkFont {
  const urdu = ARABIC.test(text);
  const f = urdu ? load(bold ? 'NotoNaskhArabic-Bold.woff' : 'NotoNaskhArabic-Regular.woff') : load(bold ? 'NotoSans-Bold.woff' : 'NotoSans-Regular.woff');
  if (!f) throw new Error('Brochure fonts missing from assets/fonts');
  return f;
}

const width = (text: string, size: number, bold: boolean) => {
  const f = fontFor(text, bold);
  return (f.layout(text).advanceWidth / f.unitsPerEm) * size;
};

/** One shaped word as SVG paths, its baseline at (x, y). */
function wordPaths(text: string, x: number, y: number, size: number, bold: boolean): string {
  const f = fontFor(text, bold);
  const run = f.layout(text);
  const s = size / f.unitsPerEm;
  let cx = 0;
  const out: string[] = [];
  run.glyphs.forEach((g, i) => {
    const p = run.positions[i];
    const d = g.path.toSVG();
    if (d) out.push(`<path transform="translate(${(x + (cx + p.xOffset) * s).toFixed(2)} ${(y - p.yOffset * s).toFixed(2)}) scale(${s.toFixed(5)} ${(-s).toFixed(5)})" d="${d}"/>`);
    cx += p.xAdvance;
  });
  return out.join('');
}

export interface SvgTextOptions {
  x: number;
  y: number;
  width: number;
  size: number;
  bold?: boolean;
  color?: string;
  align?: 'start' | 'center';
  lineHeight?: number;
  maxLines?: number;
  /** Force the paragraph direction (an Urdu card keeps Latin-only lines right-aligned). */
  rtl?: boolean;
}

/**
 * Wrapped, bidi-ordered text as an SVG group. `y` is the top of the first line. Lines whose first strong
 * character is Urdu run right to left (aligned right for align: 'start'). Returns the group and its height.
 */
export function svgText(text: string, o: SvgTextOptions): { svg: string; height: number } {
  const bold = !!o.bold;
  const lineHeight = o.lineHeight ?? o.size * 1.45;
  const gap = width(' ', o.size, false);
  const parts: string[] = [];
  let y = o.y;
  let lines = 0;
  for (const raw of text.split('\n')) {
    if (o.maxLines && lines >= o.maxLines) break;
    const line = raw.trim();
    if (!line) {
      y += lineHeight * 0.5;
      continue;
    }
    const base: Dir = o.rtl ?? (ARABIC.test(line[0] ?? '') || (ARABIC.test(line) && !/[A-Za-z0-9]/.test(line[0]))) ? 'R' : 'L';
    const tokens: Token[] = tokenize(line, base).map((t) => {
      const shown = t.neutral && t.dir === 'R' ? [...t.text].map((c) => MIRROR[c] ?? c).join('') : t.text;
      return { ...t, text: shown, width: width(shown, o.size, bold) };
    });
    // Greedy wrap.
    const wrapped: Token[][] = [];
    let cur: Token[] = [];
    let curW = 0;
    for (const t of tokens) {
      const add = (cur.length && t.space ? gap : 0) + t.width;
      if (cur.length && curW + add > o.width && !t.neutral) {
        wrapped.push(cur);
        cur = [{ ...t, space: false }];
        curW = t.width;
      } else {
        cur.push(cur.length ? t : { ...t, space: false });
        curW += add;
      }
    }
    if (cur.length) wrapped.push(cur);
    for (let li = 0; li < wrapped.length; li++) {
      if (o.maxLines && lines >= o.maxLines) break;
      let lineTokens = wrapped[li];
      // Last allowed line of a longer text ends with an ellipsis.
      if (o.maxLines && lines === o.maxLines - 1 && li < wrapped.length - 1) lineTokens = [...lineTokens, { text: '…', dir: base, neutral: true, space: false, width: width('…', o.size, bold) }];
      const visual = visualOrder(lineTokens, base);
      const gaps = gapsBetween(lineTokens, visual, gap);
      const total = visual.reduce((s, t, i) => s + t.width + gaps[i], 0);
      let x = o.align === 'center' ? o.x + (o.width - total) / 2 : base === 'R' ? o.x + o.width - total : o.x;
      const baseline = y + o.size * 1.05;
      visual.forEach((t, i) => {
        parts.push(wordPaths(t.text, x, baseline, o.size, bold));
        x += t.width + gaps[i];
      });
      y += lineHeight;
      lines++;
    }
  }
  return { svg: `<g fill="${o.color ?? '#111111'}">${parts.join('')}</g>`, height: y - o.y };
}
