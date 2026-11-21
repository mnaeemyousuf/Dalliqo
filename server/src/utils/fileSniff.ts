/**
 * Recognises the upload types Stateown accepts from the file's own bytes (the name and the
 * client-sent MIME type are never trusted). Replaces the `file-type` package, whose CommonJS
 * line has an unfixed infinite loop on malformed media files; this only reads fixed offsets and
 * does one bounded search, so no input can make it hang.
 */
export interface Sniffed {
  ext: string;
  mime: string;
}

const ascii = (b: Buffer, start: number, end: number) => b.subarray(start, end).toString('latin1');
const startsWith = (b: Buffer, bytes: number[], at = 0) => b.length >= at + bytes.length && bytes.every((v, i) => b[at + i] === v);

export function sniffFileType(b: Buffer): Sniffed | undefined {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { ext: 'jpg', mime: 'image/jpeg' };
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', mime: 'image/png' };
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  if (ascii(b, 0, 5) === '%PDF-') return { ext: 'pdf', mime: 'application/pdf' };

  // ISO base media (MP4 / QuickTime): "ftyp" box at offset 4, major brand right after it.
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12);
    if (brand === 'qt  ') return { ext: 'mov', mime: 'video/quicktime' };
    // Still images (HEIC/AVIF), 3GP and M4V/M4A share the container but are not accepted.
    if (/^(heic|heix|hevc|mif1|msf1|avif|3g|M4A|M4V|M4B|M4P|crx)/.test(brand)) return undefined;
    return { ext: 'mp4', mime: 'video/mp4' };
  }

  // Matroska / WebM: EBML header, then a DocType element naming "webm".
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) {
    return ascii(b, 0, Math.min(b.length, 64)).includes('webm') ? { ext: 'webm', mime: 'video/webm' } : undefined;
  }

  // Office Open XML is a ZIP whose part names say what it is (names are stored uncompressed).
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) {
    if (!b.includes('[Content_Types].xml', 0, 'latin1')) return undefined;
    if (b.includes('word/', 0, 'latin1')) return { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    if (b.includes('xl/', 0, 'latin1')) return { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    return undefined;
  }
  return undefined;
}
