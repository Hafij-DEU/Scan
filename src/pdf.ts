import type { PageSize } from './settings';

/** A recognised word; the box is in fractions of the page image (0..1, top-left origin). */
export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PdfImage {
  jpeg: Uint8Array;
  width: number;
  height: number;
  /** Invisible text drawn over the image so the PDF is searchable. */
  words?: OcrWord[];
}

const A4_SHORT = 595.28;
const SIZES: Record<Exclude<PageSize, 'fit'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/**
 * Minimal PDF 1.4 writer: one JPEG (DCTDecode) image per page. "fit" sizes
 * each page to its image; A4 and Letter centre the image on a fixed page,
 * turned to landscape for landscape images.
 */
export function buildPdf(images: PdfImage[], title: string, pageSize: PageSize = 'fit'): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const begin = (id: number) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
  };

  // Objects: 1 catalog, 2 page tree, 3 info, 4 font, then (page, content, image) per page.
  const pageId = (i: number) => 5 + i * 3;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  begin(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  begin(2);
  const kids = images.map((_, i) => `${pageId(i)} 0 R`).join(' ');
  push(`<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>\nendobj\n`);
  begin(3);
  push(`<< /Title (${pdfString(title)}) /Producer (DocScan) /CreationDate (D:${pdfDate(new Date())}) >>\nendobj\n`);
  begin(4);
  push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');

  images.forEach((img, i) => {
    const portrait = img.height >= img.width;
    let pw: number;
    let ph: number;
    let ix = 0;
    let iy = 0;
    let iw: number;
    let ih: number;
    if (pageSize === 'fit') {
      pw = portrait ? A4_SHORT : (A4_SHORT * img.width) / img.height;
      ph = portrait ? (A4_SHORT * img.height) / img.width : A4_SHORT;
      iw = pw;
      ih = ph;
    } else {
      const [short, long] = SIZES[pageSize];
      pw = portrait ? short : long;
      ph = portrait ? long : short;
      const scale = Math.min(pw / img.width, ph / img.height);
      iw = img.width * scale;
      ih = img.height * scale;
      ix = (pw - iw) / 2;
      iy = (ph - ih) / 2;
    }
    const id = pageId(i);
    begin(id);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(pw)} ${n(ph)}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> /Font << /F1 4 0 R >> >> /Contents ${id + 1} 0 R >>\nendobj\n`);
    let content = `q ${n(iw)} 0 0 ${n(ih)} ${n(ix)} ${n(iy)} cm /Im0 Do Q`;
    if (img.words?.length) content += textLayer(img.words, ix, iy, iw, ih);
    begin(id + 1);
    push(`<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream\nendobj\n`);
    begin(id + 2);
    push(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`);
    push(img.jpeg);
    push('\nendstream\nendobj\n');
  });

  const count = 5 + images.length * 3;
  const xref = length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}

/** Invisible (render mode 3) words, each stretched to its box so selection lines up with the image. */
function textLayer(words: OcrWord[], ix: number, iy: number, iw: number, ih: number): string {
  let out = '\nBT 3 Tr';
  for (const w of words) {
    const bytes = winAnsi(w.text);
    if (!bytes.length) continue;
    const height = (w.y1 - w.y0) * ih;
    const width = (w.x1 - w.x0) * iw;
    if (height <= 0 || width <= 0) continue;
    const size = height;
    const natural = (bytes.reduce((sum, b) => sum + charWidth(b), 0) / 1000) * size;
    const stretch = natural > 0 ? (100 * width) / natural : 100;
    const x = ix + w.x0 * iw;
    // Baseline about a fifth of the box above its bottom (room for descenders).
    const y = iy + (1 - w.y1) * ih + height * 0.2;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    out += `\n/F1 ${n(size)} Tf ${n(stretch)} Tz 1 0 0 1 ${n(x)} ${n(y)} Tm <${hex}> Tj`;
  }
  return `${out}\nET`;
}

/** Latin-1 subset of WinAnsi; anything else becomes "?". */
function winAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 32 && c <= 126) out.push(c);
    else if (c >= 160 && c <= 255) out.push(c);
    else if (c > 32) out.push(63);
  }
  return out;
}

// Helvetica advance widths (1/1000 em) for ASCII 32..126, from the standard AFM.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

function charWidth(b: number): number {
  return b >= 32 && b <= 126 ? HELVETICA[b - 32] : 556;
}

function n(v: number): string {
  return v.toFixed(2);
}

function pdfString(s: string): string {
  // Keep to printable ASCII so the literal string needs no encoding.
  return s.replace(/[^\x20-\x7E]/g, '_').replace(/([\\()])/g, '\\$1');
}

function pdfDate(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/**
 * The first embedded JPEG of a PDF (the first page image of a DocScan PDF,
 * and of most scanned PDFs), for thumbnails. Null when there is none.
 */
export function firstJpeg(bytes: Uint8Array): Uint8Array | null {
  const text = new TextDecoder('latin1').decode(bytes);
  let at = 0;
  for (;;) {
    const filter = text.indexOf('/DCTDecode', at);
    if (filter < 0) return null;
    const start = text.indexOf('stream', filter);
    if (start < 0) return null;
    let body = start + 6;
    if (text[body] === '\r') body++;
    if (text[body] === '\n') body++;
    // A JPEG starts with FF D8.
    if (bytes[body] === 0xff && bytes[body + 1] === 0xd8) {
      const end = text.indexOf('endstream', body);
      return bytes.subarray(body, end < 0 ? bytes.length : end);
    }
    at = filter + 10;
  }
}
