import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type PDFDocument from 'pdfkit';

// Urdu (Arabic script) in PDFs: Helvetica has no Arabic glyphs, so Arabic-script runs use Noto Naskh Arabic
// (bundled, OFL). That font has no Latin letters or digits, so mixed text is written run by run.
const fontFile = (name: string) => [join(__dirname, '../../../assets/fonts', name), join(process.cwd(), 'assets/fonts', name)].find((p) => existsSync(p));
export const URDU_FONT = { regular: fontFile('NotoNaskhArabic-Regular.woff'), bold: fontFile('NotoNaskhArabic-Bold.woff') };
const AR = '؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿';
export const ARABIC = new RegExp(`[${AR}]`);
const ARABIC_RUNS = new RegExp(`([${AR}]+(?:\\s+[${AR}]+)*)`);
const ARABIC_PIECES = new RegExp(`([${AR}]+)`);

export type Pdf = InstanceType<typeof PDFDocument>;

/** Registers the bundled Urdu fonts on a document (no-op when the font files are missing). */
export function registerUrduFonts(doc: Pdf) {
  if (URDU_FONT.regular) doc.registerFont('Urdu', URDU_FONT.regular);
  if (URDU_FONT.bold) doc.registerFont('Urdu-Bold', URDU_FONT.bold);
}

export function pdfFont(doc: Pdf, text: string, bold = false) {
  if (URDU_FONT.regular && ARABIC.test(text)) return doc.font(bold && URDU_FONT.bold ? 'Urdu-Bold' : 'Urdu');
  return doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
}

/**
 * Writes one line of text that may mix Urdu and Latin. Each script run is drawn whole (PDFKit's word
 * wrapper would split an Urdu phrase into left-to-right words; fontkit shapes and orders a whole run
 * correctly). Urdu-first text is right-aligned with its runs in right-to-left order. Text without
 * Arabic script keeps PDFKit's normal wrapping.
 */
export function pdfText(doc: Pdf, text: string, x: number, y: number, opts: PDFKit.Mixins.TextOptions, bold = false) {
  if (!URDU_FONT.regular || !ARABIC.test(text)) {
    pdfFont(doc, text, bold).text(text, x, y, opts);
    return;
  }
  const rtl = ARABIC.test(text.trim()[0] ?? '');
  const parts = text.split(ARABIC_RUNS).map((p) => p.trim()).filter(Boolean);
  if (rtl) parts.reverse();
  const gap = doc.font('Helvetica').widthOfString(' ');
  const widths = parts.map((p) => pdfFont(doc, p, bold).widthOfString(p));
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * (parts.length - 1);
  const width = opts.width ?? doc.page.width - x - doc.page.margins.right;
  let cx = rtl && total < width ? x + width - total : x;
  let lineHeight = 0;
  parts.forEach((p, i) => {
    pdfFont(doc, p, bold).text(p, cx, y, { lineBreak: false });
    lineHeight = Math.max(lineHeight, doc.currentLineHeight(true));
    cx += widths[i] + gap;
  });
  doc.x = x;
  doc.y = y + lineHeight;
}

export type Dir = 'L' | 'R';

export interface Token {
  text: string;
  /** Resolved direction: Arabic-script words are R, Latin words and numbers L, punctuation takes its neighbours'. */
  dir: Dir;
  neutral: boolean;
  /** A space separates it from the previous token (in reading order). */
  space: boolean;
  width: number;
}

const NEUTRAL = /^[\s()[\]{}:;,.!?'"«»·\-–—/_]+$/;
const EDGE_PUNCT = /^([(["«]*)(.*?)([)\]"».,:;!?]*)$/s;
export const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '«': '»', '»': '«' };

/** Splits a line into words and edge punctuation, each tagged with its script direction. */
export function tokenize(line: string, base: Dir): Omit<Token, 'width'>[] {
  const raw: { text: string; strong: Dir | null; space: boolean }[] = [];
  let space = false;
  for (const piece of line.split(ARABIC_PIECES)) {
    if (!piece) continue;
    if (ARABIC.test(piece)) {
      raw.push({ text: piece, strong: 'R', space: raw.length > 0 && space });
      space = false;
      continue;
    }
    for (const w of piece.split(/(\s+)/)) {
      if (!w) continue;
      if (/^\s+$/.test(w)) {
        space = true;
        continue;
      }
      const [, lead, core, trail] = EDGE_PUNCT.exec(w) ?? ['', '', w, ''];
      const parts = [...[...lead].map((c) => ({ t: c, n: true })), ...(core ? [{ t: core, n: NEUTRAL.test(core) }] : []), ...[...trail].map((c) => ({ t: c, n: true }))];
      parts.forEach((p, i) => {
        raw.push({ text: p.t, strong: p.n ? null : 'L', space: raw.length > 0 && i === 0 && space });
      });
      space = false;
    }
  }
  // Neutrals between two runs of the same direction take it; otherwise the line's direction.
  return raw.map((t, i) => {
    if (t.strong) return { text: t.text, dir: t.strong, neutral: false, space: t.space };
    const prev = raw.slice(0, i).reverse().find((x) => x.strong)?.strong;
    const next = raw.slice(i + 1).find((x) => x.strong)?.strong;
    return { text: t.text, dir: prev && prev === next ? prev : base, neutral: true, space: t.space };
  });
}

/** Visual left-to-right order of a line's tokens. */
export function visualOrder(tokens: Token[], base: Dir): Token[] {
  const seq = base === 'R' ? [...tokens].reverse() : [...tokens];
  const other: Dir = base === 'R' ? 'L' : 'R';
  const out: Token[] = [];
  for (let i = 0; i < seq.length; ) {
    if (seq[i].dir !== other) {
      out.push(seq[i++]);
      continue;
    }
    let j = i;
    while (j < seq.length && seq[j].dir === other) j++;
    out.push(...seq.slice(i, j).reverse());
    i = j;
  }
  return out;
}

/**
 * Space after each visual token. A gap goes between two tokens that are neighbours in reading order when
 * the later one had a space before it; between two direction runs it belongs to the boundary, i.e. to the
 * later run's first token.
 */
export function gapsBetween(lineTokens: Token[], visual: Token[], gap: number): number[] {
  const order = new Map(lineTokens.map((t, i) => [t, i]));
  const runOf: number[] = [];
  const runStart: number[] = [];
  lineTokens.forEach((t, i) => {
    const r = i === 0 ? 0 : runOf[i - 1] + (t.dir === lineTokens[i - 1].dir ? 0 : 1);
    if (runStart[r] === undefined) runStart[r] = i;
    runOf.push(r);
  });
  return visual.map((t, i) => {
    const n = visual[i + 1];
    if (!n) return 0;
    const a = order.get(t)!;
    const b = order.get(n)!;
    if (runOf[a] === runOf[b]) return Math.abs(a - b) === 1 && lineTokens[Math.max(a, b)].space ? gap : 0;
    return Math.abs(runOf[a] - runOf[b]) === 1 && lineTokens[runStart[Math.max(runOf[a], runOf[b])]].space ? gap : 0;
  });
}

/**
 * Writes a paragraph (lines separated by \n) that wraps to `width`, adding pages when needed.
 * Each word is shaped on its own and placed by a simplified bidi algorithm: Urdu lines run right to
 * left with Latin words, numbers and amounts left to right inside them (and the reverse for English
 * lines containing Urdu names); brackets are mirrored in right-to-left text.
 */
export function pdfParagraph(doc: Pdf, text: string, x: number, width: number, opts: { bold?: boolean; size?: number; lineGap?: number; bottom?: number; align?: 'left' | 'center'; rtl?: boolean } = {}) {
  const size = opts.size ?? 10.5;
  const lineGap = opts.lineGap ?? 3;
  const bottom = opts.bottom ?? doc.page.height - doc.page.margins.bottom;
  doc.fontSize(size);
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      doc.y += size * 0.6;
      continue;
    }
    if (!URDU_FONT.regular || !ARABIC.test(line)) {
      const h = pdfFont(doc, line, opts.bold).heightOfString(line, { width, lineGap });
      if (doc.y + Math.min(h, size * 2) > bottom) doc.addPage();
      // In an Urdu document Latin-only lines stay right-aligned.
      pdfFont(doc, line, opts.bold).text(line, x, doc.y, { width, lineGap, align: opts.align ?? (opts.rtl ? 'right' : 'left') });
      continue;
    }
    const base: Dir = opts.rtl || ARABIC.test(line.trim()[0] ?? '') ? 'R' : 'L';
    const gap = doc.font('Helvetica').widthOfString(' ');
    const tokens: Token[] = tokenize(line, base).map((t) => {
      const shown = t.neutral && t.dir === 'R' ? [...t.text].map((c) => MIRROR[c] ?? c).join('') : t.text;
      return { ...t, text: shown, width: pdfFont(doc, shown, opts.bold).widthOfString(shown) };
    });
    // Greedy wrap in reading order.
    const lines: Token[][] = [];
    let cur: Token[] = [];
    let curW = 0;
    for (const t of tokens) {
      const add = (cur.length && t.space ? gap : 0) + t.width;
      if (cur.length && curW + add > width && !t.neutral) {
        lines.push(cur);
        cur = [{ ...t, space: false }];
        curW = t.width;
      } else {
        cur.push(cur.length ? t : { ...t, space: false });
        curW += add;
      }
    }
    if (cur.length) lines.push(cur);
    for (const lineTokens of lines) {
      const lineH = Math.max(...lineTokens.map((t) => pdfFont(doc, t.text, opts.bold).currentLineHeight(true))) + lineGap;
      if (doc.y + lineH > bottom) doc.addPage();
      const y = doc.y;
      // A gap goes between two tokens that are neighbours in reading order when the later one had a space before it.
      const visual = visualOrder(lineTokens, base);
      const gapAfter = gapsBetween(lineTokens, visual, gap);
      const total = visual.reduce((s, t, i) => s + t.width + gapAfter[i], 0);
      let cx = opts.align === 'center' ? x + (width - total) / 2 : base === 'R' ? x + width - total : x;
      // Urdu and Latin fonts have different ascenders: put every word on one shared baseline.
      const ascent = (t: Token) => ((pdfFont(doc, t.text, opts.bold) as unknown as { _font: { ascender: number } })._font.ascender / 1000) * size;
      const baseline = y + Math.max(...visual.map(ascent));
      visual.forEach((t, i) => {
        pdfFont(doc, t.text, opts.bold).text(t.text, cx, baseline, { lineBreak: false, baseline: 'alphabetic' });
        cx += t.width + gapAfter[i];
      });
      doc.x = x;
      doc.y = y + lineH;
    }
  }
}
