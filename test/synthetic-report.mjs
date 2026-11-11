import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

export const REPORT_LINES = [
  'REPORT DATE: 2026-11-01',
  'CONSUMER: Practice Photo',
  'CREDITOR: Northwind Card',
  'BUREAU: Equifax',
  'ACCOUNT: 4412',
  'TYPE: Credit card',
  'STATUS: Charge-off',
  'OPENED: 2019-03-01',
  'CLOSED: 2024-06-30',
  'REPORTED: 2026-10-01',
  'LAST PAYMENT: 2024-06-18',
  'DOFD: 2024-03-01',
  'CHARGE OFF: 2024-06-30',
  'BALANCE: 1500',
  'PAST DUE: 1500',
  'HIGH: 4000',
  'LIMIT: 5000',
  'HISTORY: 2024-03:30, 2024-04:60, 2024-05:90, 2024-06:CO',
];

let fontReady = false;

export function renderReportPng() {
  if (!fontReady) {
    GlobalFonts.registerFromPath(FONT, 'ReportSans');
    fontReady = true;
  }
  const width = 2200;
  const height = 180 + REPORT_LINES.length * 86;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#111111';
  ctx.font = '54px ReportSans';
  REPORT_LINES.forEach((line, index) => {
    ctx.fillText(line, 90, 120 + index * 86);
  });
  return canvas.toBuffer('image/png');
}

export async function renderScannedPdf(png) {
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(png);
  const page = pdf.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  return Buffer.from(await pdf.save());
}

export async function writeFixtures(directory) {
  mkdirSync(directory, { recursive: true });
  const png = renderReportPng();
  const pdf = await renderScannedPdf(png);
  const pngPath = join(directory, 'synthetic-report.png');
  const pdfPath = join(directory, 'synthetic-scan.pdf');
  writeFileSync(pngPath, png);
  writeFileSync(pdfPath, pdf);
  return { pngPath, pdfPath, png, pdf };
}

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = await writeFixtures(join(here, 'fixtures'));
  console.log(out.pngPath, out.png.length, out.pdfPath, out.pdf.length);
}
