// Bildebehandling, tekstgjenkjenning (Tesseract.js) og PDF-generering (jsPDF).
// Alle biblioteker og språkdata ligger i appen selv (docs/vendor), så bildene leses lokalt
// på telefonen og ingenting sendes til tredjeparter. De lastes først når de trengs.

const vendor = (path) => new URL(`../vendor/${path}`, import.meta.url).href;
const TESSERACT_URL = vendor('tesseract/tesseract.min.js');
const JSPDF_URL = vendor('jspdf/jspdf.umd.min.js');

const scripts = new Map();
function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => { scripts.delete(src); reject(new Error('Kunne ikke laste ' + src)); };
      document.head.append(el);
    }));
  }
  return scripts.get(src);
}

/** Leser en bildefil til et canvas, nedskalert til maks `maxSize` piksler på lengste side. */
async function fileToCanvas(file, maxSize) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

/** Gråtoner og kontraststrekk – gir merkbart bedre gjenkjenning på termopapir. */
function enhanceForOcr(source) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = g;
    hist[g]++;
  }
  // Finn 2 % og 98 % persentil og strekk mellom dem.
  const total = d.length / 4;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.02) { hi = v; break; } }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

let workerPromise = null;
async function getWorker(onProgress) {
  await loadScript(TESSERACT_URL);
  if (!workerPromise) {
    workerPromise = window.Tesseract.createWorker(['nor', 'eng'], 1, {
      workerPath: vendor('tesseract/worker.min.js'),
      corePath: vendor('tesseract/core'),
      langPath: vendor('tesseract/lang'),
      workerBlobURL: false,
      gzip: true,
      logger: (m) => {
        if (m.status === 'recognizing text') onProgress?.(`Leser tekst … ${Math.round(m.progress * 100)} %`);
        else if (m.status?.includes('loading')) onProgress?.('Laster tekstgjenkjenning (første gang tar litt tid) …');
      },
    }).catch((e) => { workerPromise = null; throw e; });
  }
  const worker = await workerPromise;
  await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '4' });
  return worker;
}

/**
 * Behandler valgte filer (bilder og/eller én PDF).
 * @returns {Promise<{pdf: Blob, text: string, images: number}>}
 */
export async function processReceiptFiles(files, onProgress) {
  const list = [...files];
  const pdfFile = list.find((f) => f.type === 'application/pdf');
  if (pdfFile) {
    // Kvitteringer på e-post er ofte PDF – lagres som de er.
    return { pdf: pdfFile, text: '', images: 0 };
  }

  onProgress?.('Klargjør bilde …');
  const canvases = [];
  for (const file of list) canvases.push(await fileToCanvas(file, 2000));

  const pdf = await makePdf(canvases);

  let text = '';
  try {
    const worker = await getWorker(onProgress);
    for (const canvas of canvases) {
      const { data } = await worker.recognize(enhanceForOcr(canvas));
      text += data.text + '\n';
    }
  } catch (e) {
    console.warn('OCR feilet', e);
    throw Object.assign(new Error('Tekstgjenkjenning feilet: ' + e.message), { pdf });
  }
  return { pdf, text, images: canvases.length };
}

async function makePdf(canvases) {
  await loadScript(JSPDF_URL);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 24;
  canvases.forEach((canvas, i) => {
    if (i > 0) doc.addPage();
    const scale = Math.min((pageW - 2 * margin) / canvas.width, (pageH - 2 * margin) / canvas.height);
    const w = canvas.width * scale;
    const h = canvas.height * scale;
    const jpeg = canvas.toDataURL('image/jpeg', 0.75);
    doc.addImage(jpeg, 'JPEG', (pageW - w) / 2, margin, w, h);
  });
  doc.setProperties({ title: 'Kvittering', creator: 'Drivstoffapp' });
  return doc.output('blob');
}

// MARK: Visning av PDF

const PDFJS_URL = vendor('pdfjs/pdf.min.js');

/**
 * Tegner alle sidene i en PDF som bilder i `container`. Brukes i stedet for nettleserens
 * innebygde PDF-viser, som er upålitelig i Safari på iPhone (særlig fra Hjem-skjermen).
 */
export async function renderPdf(blob, container) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
    throw new Error('Filen er ikke en gyldig PDF');
  }
  await loadScript(PDFJS_URL);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = vendor('pdfjs/pdf.worker.min.js');
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const cssWidth = Math.max(280, container.clientWidth || 360);
  // Høy oppløsning så teksten er skarp når man zoomer, men innenfor iOS sin grense for canvas.
  const pixelWidth = Math.min(2000, Math.round(cssWidth * Math.min(3, (window.devicePixelRatio || 1) * 1.5)));
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: pixelWidth / page.getViewport({ scale: 1 }).width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    canvas.className = 'pdf-page';
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    container.append(canvas);
  }
  return doc.numPages;
}
