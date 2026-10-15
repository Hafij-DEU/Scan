export interface PdfImage {
  jpeg: Uint8Array;
  width: number;
  height: number;
}

const A4_SHORT = 595.28;

/** Minimal PDF 1.4 writer: one JPEG (DCTDecode) image per page, page sized to the image aspect. */
export function buildPdf(images: PdfImage[], title: string): Blob {
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

  // Objects: 1 catalog, 2 page tree, 3 info, then (page, content, image) per page.
  const pageId = (i: number) => 4 + i * 3;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  begin(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  begin(2);
  const kids = images.map((_, i) => `${pageId(i)} 0 R`).join(' ');
  push(`<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>\nendobj\n`);
  begin(3);
  push(`<< /Title (${pdfString(title)}) /Producer (DocScan) /CreationDate (D:${pdfDate(new Date())}) >>\nendobj\n`);

  images.forEach((img, i) => {
    const portrait = img.height >= img.width;
    const pw = portrait ? A4_SHORT : (A4_SHORT * img.width) / img.height;
    const ph = portrait ? (A4_SHORT * img.height) / img.width : A4_SHORT;
    const W = pw.toFixed(2);
    const H = ph.toFixed(2);
    const id = pageId(i);
    begin(id);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>\nendobj\n`);
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    begin(id + 1);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    begin(id + 2);
    push(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`);
    push(img.jpeg);
    push('\nendstream\nendobj\n');
  });

  const count = 4 + images.length * 3;
  const xref = length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}

function pdfString(s: string): string {
  // Keep to printable ASCII so the literal string needs no encoding.
  return s.replace(/[^\x20-\x7E]/g, '_').replace(/([\\()])/g, '\\$1');
}

function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
