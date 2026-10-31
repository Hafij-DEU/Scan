import { drawScaled, loadImage, toJpeg } from './imaging/image';
import { recognize, type OcrResult } from './ocr';
import { buildPdf, type PdfImage } from './pdf';
import { fileExists, shareBlob, writeFile } from './platform';
import { pdfFileName, safeFileName, settings, type Quality } from './settings';
import { getPage, putPage, type DocMeta, type PageRec } from './store';
import { requestSync } from './sync';
import { busy, choiceDialog, errorMessage, toast } from './ui/dom';

const QUALITY: Record<Exclude<Quality, 'original'>, { side: number; q: number }> = {
  medium: { side: 1600, q: 0.75 },
  small: { side: 1100, q: 0.6 },
};

/** Text of a page, recognised once and then kept with the page. */
export async function pageText(page: PageRec, onProgress?: (p: number) => void): Promise<OcrResult> {
  if (page.ocr) return page.ocr;
  const result = await recognize(page.processed, page.width, page.height, onProgress);
  page.ocr = result;
  await putPage(page);
  return result;
}

/** Builds the document's PDF with the page size, quality and text-layer settings. */
export async function makePdf(doc: DocMeta, status: (message: string) => void = () => undefined): Promise<Blob> {
  const s = settings();
  const images: PdfImage[] = [];
  const n = doc.pages.length;
  for (const [i, pid] of doc.pages.entries()) {
    const page = await getPage(pid);
    if (!page) continue;
    let words;
    if (s.searchable) {
      status(n > 1 ? `Reading text, page ${i + 1} of ${n}…` : 'Reading text…');
      words = (await pageText(page)).words;
    }
    status(n > 1 ? `Adding page ${i + 1} of ${n}…` : 'Creating PDF…');
    let jpeg = page.processed;
    let { width, height } = page;
    if (s.quality !== 'original') {
      const { side, q } = QUALITY[s.quality];
      const c = drawScaled(await loadImage(page.processed), width, height, side);
      jpeg = await toJpeg(c, q);
      width = c.width;
      height = c.height;
    }
    images.push({ jpeg: new Uint8Array(await jpeg.arrayBuffer()), width, height, words });
  }
  return buildPdf(images, doc.name, s.pageSize);
}

/**
 * Writes `blob` as `name` into the save folder. When the name is taken, asks
 * whether to replace the file or keep both. Returns the name used, or null.
 */
export async function writeWithChoice(name: string, blob: Blob | (() => Promise<Blob>), status?: (m: string) => void): Promise<string | null> {
  let overwrite = false;
  if (await fileExists(name)) {
    const choice = await choiceDialog(`“${name}” is already in the save folder.`, [
      { label: 'Keep both', value: 'both' as const },
      { label: 'Replace', value: 'replace' as const },
    ]);
    if (!choice) return null;
    if (choice === 'replace') overwrite = true;
    else name = await freeName(name);
  }
  const data = typeof blob === 'function' ? await blob() : blob;
  status?.('Saving…');
  await writeFile(name, data, overwrite);
  return name;
}

/** "Receipt.pdf" → "Receipt (2).pdf", the first name not in the folder. */
export async function freeName(name: string): Promise<string> {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!(await fileExists(candidate))) return candidate;
  }
}

/** Save PDF button: builds the PDF into the save folder. Returns the file name, or null. */
export async function savePdf(doc: DocMeta): Promise<string | null> {
  if (!doc.pages.length) {
    toast('No pages to export', true);
    return null;
  }
  let done: Awaited<ReturnType<typeof busy>> | null = null;
  try {
    const name = await writeWithChoice(pdfFileName(doc.name), async () => {
      done = await busy('Creating PDF…');
      return makePdf(doc, done.text);
    });
    if (name) {
      toast(`Saved ${name}`);
      requestSync();
    }
    return name;
  } catch (e) {
    toast(errorMessage(e), true);
    return null;
  } finally {
    (done as (() => void) | null)?.();
  }
}

export async function sharePdf(doc: DocMeta): Promise<void> {
  if (!doc.pages.length) {
    toast('No pages to share', true);
    return;
  }
  const done = await busy('Creating PDF…');
  try {
    await shareBlob(await makePdf(doc, done.text), pdfFileName(doc.name));
  } catch (e) {
    toast(errorMessage(e), true);
  } finally {
    done();
  }
}

export function jpgFileName(docName: string, pageNumber: number): string {
  return `${safeFileName(docName)}-p${pageNumber}.jpg`;
}
