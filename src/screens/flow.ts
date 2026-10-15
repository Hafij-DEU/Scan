import { detectDocument } from '../imaging/detect';
import type { FilterId } from '../imaging/filters';
import { fullQuad, type Quad } from '../imaging/geometry';
import { loadImage, PAGE_SIDE, renderPage, thumbnail, toJpeg } from '../imaging/image';
import { defaultDocName, getDoc, getPage, newId, putDoc, putPage, type PageRec, type Rotation } from '../store';
import { busy, errorMessage, pickImages, toast } from '../ui/dom';
import { popTo, push } from '../ui/router';
import { cropScreen } from './crop';
import { docScreen } from './doc';

/** A page being captured or re-edited. docId null means "create a new document on save". */
export interface PageDraft {
  docId: string | null;
  pageId?: string;
  original: HTMLCanvasElement;
  quad: Quad;
  filter: FilterId;
  rotation: Rotation;
}

export function autoQuad(c: HTMLCanvasElement): { quad: Quad; detected: boolean } {
  const quad = detectDocument(c, c.width, c.height);
  return quad ? { quad, detected: true } : { quad: fullQuad(c.width, c.height, 0.04), detected: false };
}

export function startCrop(docId: string | null, original: HTMLCanvasElement): void {
  const { quad, detected } = autoQuad(original);
  push(cropScreen({ docId, original, quad, filter: 'magic', rotation: 0 }, detected));
}

/** One image opens the crop screen; several are auto-cropped with Magic color and saved directly. */
export async function importInto(docId: string | null): Promise<void> {
  const files = await pickImages(true);
  if (!files.length) return;
  if (files.length === 1) {
    const done = await busy('Loading image…');
    try {
      startCrop(docId, await loadImage(files[0]));
    } catch (e) {
      toast(`Cannot open image: ${errorMessage(e)}`, true);
    } finally {
      done();
    }
    return;
  }
  const done = await busy(`Processing ${files.length} images…`);
  let id = docId;
  let failed = 0;
  try {
    for (const file of files) {
      try {
        const original = await loadImage(file);
        id = await savePage({ docId: id, original, quad: autoQuad(original).quad, filter: 'magic', rotation: 0 });
      } catch {
        failed++;
      }
    }
  } finally {
    done();
  }
  if (failed) toast(`${failed} image${failed === 1 ? '' : 's'} could not be read`, true);
  if (id) openDoc(id);
}

/** Renders the final page, stores it and returns the document id. */
export async function savePage(d: PageDraft): Promise<string> {
  const full = renderPage(d.original, d.quad, d.filter, d.rotation, PAGE_SIDE);
  const processed = await toJpeg(full, 0.88);
  const thumb = await thumbnail(full);
  const existing = d.pageId ? await getPage(d.pageId) : undefined;
  const original = existing?.original ?? (await toJpeg(d.original, 0.92));
  const now = Date.now();
  const doc = (d.docId ? await getDoc(d.docId) : undefined) ?? { id: newId(), name: defaultDocName(), created: now, updated: now, pages: [] };
  const page: PageRec = {
    id: d.pageId ?? newId(),
    docId: doc.id,
    original,
    quad: d.quad,
    filter: d.filter,
    rotation: d.rotation,
    processed,
    width: full.width,
    height: full.height,
    thumb,
  };
  await putPage(page);
  if (!doc.pages.includes(page.id)) doc.pages.push(page.id);
  doc.updated = now;
  await putDoc(doc);
  return doc.id;
}

/** Shows the document screen, reusing it when it is already in the stack. */
export function openDoc(docId: string): void {
  if (popTo(`doc:${docId}`)) return;
  popTo('home');
  push(docScreen(docId));
}
