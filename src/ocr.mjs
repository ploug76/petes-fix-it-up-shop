/**
 * On-device text recognition. The language file and the engine are loaded from
 * this app's own folder. A report image is not sent anywhere.
 */

const CORE_DIR = new URL('../vendor/tesseract/', import.meta.url);
const WORKER_URL = new URL('../vendor/tesseract/worker.min.js', import.meta.url);
const LANG_URL = new URL('../vendor/tesseract/lang/', import.meta.url);

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = startWorker().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

function readerError() {
  return Object.assign(new Error('The text reader on this device did not start. Paste the text, or type the accounts in the form.'), { userMessage: true });
}

async function startWorker() {
  let createWorker;
  try {
    const mod = await import('../vendor/tesseract/tesseract.esm.min.js');
    createWorker = mod.default.createWorker;
  } catch {
    throw readerError();
  }
  if (typeof createWorker !== 'function') throw readerError();
  const started = createWorker('eng', 1, {
    workerPath: WORKER_URL.href,
    corePath: CORE_DIR.href,
    langPath: LANG_URL.href,
    cachePath: 'petes-fix-it-up-ocr',
    gzip: true,
    workerBlobURL: true,
  });
  const worker = await Promise.race([
    started,
    new Promise((_, reject) => {
      setTimeout(() => reject(readerError()), 45000);
    }),
  ]);
  await worker.setParameters({ preserve_interword_spaces: '1' });
  return worker;
}

async function recognize(source) {
  const worker = await getWorker();
  const result = await worker.recognize(source);
  return result?.data?.text ?? '';
}

export function ocrBlob(blob) {
  return recognize(blob);
}

export function ocrCanvas(canvas) {
  return recognize(canvas);
}
