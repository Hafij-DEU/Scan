import { detectDocument } from '../imaging/detect';
import type { FilterId } from '../imaging/filters';
import { fullQuad, type Quad } from '../imaging/geometry';
import { canvasOf, ctx2d, loadImage, PAGE_SIDE, renderPage, thumbnail, toJpeg } from '../imaging/image';
import { defaultDocName, getDoc, getPage, newId, putDoc, putPage, type PageMark, type PageRec, type Rotation } from '../store';
import { busy, errorMessage, pickImages, toast } from '../ui/dom';
import { popTo, push } from '../ui/router';
import { cameraScreen } from './camera';
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
  /** Set while scanning an ID card: both sides go onto one page. */
  card?: CardState;
}

/** ID-card mode: the front side waits here until the back is scanned. */
export interface CardState {
  front?: HTMLCanvasElement;
}

export function autoQuad(c: HTMLCanvasElement): { quad: Quad; detected: boolean } {
  const quad = detectDocument(c, c.width, c.height);
  // No page outline (screenshot, flat scan, or no contrast): keep the whole image.
  return quad ? { quad, detected: true } : { quad: fullQuad(c.width, c.height), detected: false };
}

export function startCrop(docId: string | null, original: HTMLCanvasElement, card?: CardState): void {
  const { quad, detected } = autoQuad(original);
  push(cropScreen({ docId, original, quad, filter: card ? 'original' : 'magic', rotation: 0, card }, detected));
}

/** One image opens the crop screen; several are auto-cropped with Magic color and saved directly. */
export async function importInto(docId: string | null, card?: CardState): Promise<void> {
  const files = await pickImages(!card);
  if (!files.length) return;
  if (files.length === 1) {
    const done = await busy('Loading image…');
    try {
      startCrop(docId, await loadImage(files[0]), card);
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
  const existing = d.pageId ? await getPage(d.pageId) : undefined;
  if (existing?.marks) await drawMarks(full, existing.marks);
  const processed = await toJpeg(full, 0.88);
  const thumb = await thumbnail(full);
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
    marks: existing?.marks,
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

/** Stamps signatures onto a page image. */
export async function drawMarks(c: HTMLCanvasElement, marks: PageMark[]): Promise<void> {
  const g = ctx2d(c);
  for (const m of marks) {
    const img = await loadImage(m.png);
    const w = m.w * c.width;
    g.drawImage(img, m.x * c.width, m.y * c.height, w, (w * img.height) / img.width);
  }
}

// A4 at 300 dpi; an ID card (85.6 mm) is 715 px wide on it.
const SHEET_W = 1754;
const SHEET_H = 2480;
const CARD_SIDE = 715;

/**
 * Saves one side of an ID card. After the front, goes back to the camera for
 * the back; after the back, puts both sides on one A4 page.
 */
export async function saveCardSide(d: PageDraft & { card: CardState }): Promise<void> {
  const side = renderPage(d.original, d.quad, d.filter, d.rotation, 1100);
  if (!d.card.front) {
    d.card.front = side;
    if (!popTo('camera')) push(cameraScreen(d.docId, d.card));
    toast('Front saved. Now scan the back');
    return;
  }
  const sheet = canvasOf(SHEET_W, SHEET_H);
  const g = ctx2d(sheet);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, SHEET_W, SHEET_H);
  for (const [c, centerY] of [[d.card.front, 0.27], [side, 0.65]] as const) {
    const s = CARD_SIDE / Math.max(c.width, c.height);
    const w = c.width * s;
    const h = c.height * s;
    g.drawImage(c, (SHEET_W - w) / 2, SHEET_H * centerY - h / 2, w, h);
  }
  const id = await savePage({ docId: d.docId, original: sheet, quad: fullQuad(SHEET_W, SHEET_H), filter: 'original', rotation: 0 });
  d.card.front = undefined;
  openDoc(id);
  toast('ID card saved');
}
