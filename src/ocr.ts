import type { OcrWord } from './pdf';

/** Text recognition with tesseract.js (English), fully offline from the files in public/ocr. */

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;

let worker: Promise<TesseractWorker> | null = null;
let progress: ((p: number) => void) | null = null;

function ocrUrl(file: string): string {
  return new URL(`./ocr/${file}`, location.href).href;
}

function getWorker(): Promise<TesseractWorker> {
  worker ??= (async () => {
    // Loaded on first use: keeps the engine out of the start-up bundle.
    const { createWorker, OEM } = await import('tesseract.js');
    return createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: ocrUrl('worker.min.js'),
      corePath: ocrUrl('tesseract-core-lstm.js'),
      langPath: ocrUrl('').replace(/\/$/, ''),
      workerBlobURL: false,
      gzip: true,
      cacheMethod: 'none',
      logger: (m) => {
        if (m.status === 'recognizing text') progress?.(m.progress);
      },
    });
  })();
  worker.catch(() => {
    worker = null;
  });
  return worker;
}

export interface OcrResult {
  text: string;
  words: OcrWord[];
}

/** Recognises the text of a page image; word boxes are fractions of the image size. */
export async function recognize(image: Blob, width: number, height: number, onProgress?: (p: number) => void): Promise<OcrResult> {
  const w = await getWorker();
  progress = onProgress ?? null;
  try {
    const { data } = await w.recognize(image, {}, { text: true, blocks: true });
    const words: OcrWord[] = [];
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          for (const word of line.words) {
            const text = word.text.trim();
            if (!text || word.confidence < 30) continue;
            const { x0, y0, x1, y1 } = word.bbox;
            words.push({ text, x0: x0 / width, y0: y0 / height, x1: x1 / width, y1: y1 / height });
          }
        }
      }
    }
    return { text: data.text.trim(), words };
  } finally {
    progress = null;
  }
}
