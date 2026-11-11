/**
 * Decide how a file is read. OCR itself is injected so tests can run without a browser.
 * The bytes of a report stay on the device that opened them.
 */

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif'];

export const UNREADABLE = 'Could not read that file on this device. Paste the text, or type the accounts in the form.';

export function classifyIntakeFile(file) {
  const name = String(file?.name ?? '').toLowerCase();
  const type = String(file?.type ?? '').toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.text')) return 'text';
  if (type.startsWith('image/') || IMAGE_EXTENSIONS.some((extension) => name.endsWith(`.${extension}`))) return 'image';
  return 'unsupported';
}

export function textLayerIsUseful(text) {
  return (String(text ?? '').match(/[A-Za-z]/g) || []).length >= 40;
}

function readableError(error, fallback) {
  if (error && error.userMessage && error.message) return error;
  return Object.assign(new Error(fallback), { userMessage: true });
}

export async function readIntakeFile(file, hooks = {}) {
  const kind = classifyIntakeFile(file);
  if (kind === 'unsupported') {
    throw Object.assign(new Error('That file is not a PDF or a photo this shop can open. Paste the text, or type the accounts in the form.'), { userMessage: true });
  }
  if (kind === 'text') {
    const text = await file.text();
    if (!String(text ?? '').trim()) throw readableError(null, UNREADABLE);
    return text;
  }
  if (kind === 'image') {
    hooks.onStatus?.('Reading the photo on this device…');
    let text = '';
    try {
      text = await hooks.ocrImage(file);
    } catch (error) {
      throw readableError(error, 'Could not read the words in that photo. Try a clearer picture, paste the text, or type the accounts in the form.');
    }
    if (!textLayerIsUseful(text)) {
      throw Object.assign(new Error('Could not read the words in that photo. Try a clearer picture, paste the text, or type the accounts in the form.'), { userMessage: true });
    }
    return text;
  }
  const buffer = await file.arrayBuffer();
  const copy = buffer.slice(0);
  hooks.onStatus?.('Reading the PDF on this device…');
  let text = '';
  try {
    text = await hooks.extractPdfText(buffer);
  } catch {
    text = '';
  }
  if (textLayerIsUseful(text)) return text;
  if (!hooks.ocrPdf) {
    throw Object.assign(new Error('That PDF has no text layer this shop could read. Paste the text, or type the accounts in the form.'), { userMessage: true });
  }
  hooks.onStatus?.('No text layer in that PDF. Reading the page image on this device…');
  let recognized = '';
  try {
    recognized = await hooks.ocrPdf(copy);
  } catch (error) {
    throw readableError(error, 'Could not read that PDF on this device. If it is a scan or a photo, try a clearer picture. You can also paste the text or type the accounts in the form.');
  }
  if (!textLayerIsUseful(recognized)) {
    throw Object.assign(new Error('Could not read that PDF on this device. If it is a scan or a photo, try a clearer picture. You can also paste the text or type the accounts in the form.'), { userMessage: true });
  }
  return recognized;
}
