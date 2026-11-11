import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReport, scan } from '../src/engine.mjs';
import { classifyIntakeFile, readIntakeFile, textLayerIsUseful } from '../src/intake.mjs';

const LABELED = `REPORT DATE: 2026-11-01
CONSUMER: Practice Photo

CREDITOR: Northwind Card
BUREAU: Equifax
ACCOUNT: 4412
TYPE: Credit card
STATUS: Charge-off
OPENED: 2019-03-01
CLOSED: 2024-06-30
REPORTED: 2026-10-01
LAST PAYMENT: 2024-06-18
DOFD: 2024-03-01
CHARGE OFF: 2024-06-30
BALANCE: 1500
PAST DUE: 1500
HIGH: 4000
LIMIT: 5000
HISTORY: 2024-03:30, 2024-04:60, 2024-05:90, 2024-06:CO
`;

function fileLike(name, type, bytes) {
  const payload = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  return {
    name,
    type,
    async text() {
      return new TextDecoder().decode(payload);
    },
    async arrayBuffer() {
      return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
    },
  };
}

test('the picker accepts photos, PDFs, and text', () => {
  for (const name of ['page.jpg', 'page.jpeg', 'page.png', 'page.webp', 'scan.PDF', 'notes.txt']) {
    const kind = classifyIntakeFile({ name, type: '' });
    assert.notEqual(kind, 'unsupported', name);
  }
  assert.equal(classifyIntakeFile({ name: 'shot.heic', type: '' }), 'image');
  assert.equal(classifyIntakeFile({ name: 'a.gif', type: 'image/gif' }), 'image');
  assert.equal(classifyIntakeFile({ name: 'sheet.csv', type: 'text/csv' }), 'text');
  assert.equal(classifyIntakeFile({ name: 'notes.docx', type: '' }), 'unsupported');
});

test('labeled text still parses and scans', async () => {
  const text = await readIntakeFile(fileLike('notes.txt', 'text/plain', LABELED), {});
  const parsed = parseReport(text);
  assert.equal(parsed.tradelines.length, 1);
  assert.equal(parsed.tradelines[0].creditor, 'Northwind Card');
  assert.equal(parsed.tradelines[0].bureau, 'equifax');
  assert.equal(parsed.tradelines[0].paymentHistory.at(-1).code, 'CO');
  const findings = scan({ ...parsed, mailings: [], rawText: text, reportDate: parsed.reportDate || '2026-11-01' });
  assert.ok(findings.some((finding) => finding.mail && finding.id.includes('last-pay-late')));
});

test('a text PDF is not sent through OCR', async () => {
  let ocrCalls = 0;
  const text = await readIntakeFile(fileLike('report.pdf', 'application/pdf', new Uint8Array([1, 2, 3])), {
    extractPdfText: async () => LABELED,
    ocrPdf: async () => {
      ocrCalls += 1;
      return '';
    },
  });
  assert.equal(ocrCalls, 0);
  assert.equal(text, LABELED);
  assert.equal(textLayerIsUseful(LABELED), true);
  assert.equal(textLayerIsUseful('   '), false);
});

test('a scanned PDF with no text layer is read by the OCR hook', async () => {
  let sawBuffer = false;
  const text = await readIntakeFile(fileLike('scan.pdf', 'application/pdf', new Uint8Array([9, 9, 9])), {
    extractPdfText: async () => '   \n',
    ocrPdf: async (buffer) => {
      sawBuffer = buffer.byteLength === 3;
      return LABELED;
    },
  });
  assert.equal(sawBuffer, true);
  assert.match(text, /Northwind Card/);
  const parsed = parseReport(text);
  assert.equal(parsed.tradelines[0].accountNumber, '4412');
});

test('a photo is recognized on device and then parsed', async () => {
  const calls = [];
  const text = await readIntakeFile(fileLike('page.jpg', 'image/jpeg', new Uint8Array([4, 5])), {
    ocrImage: async (file) => {
      calls.push(file.name);
      return LABELED;
    },
  });
  assert.deepEqual(calls, ['page.jpg']);
  assert.equal(parseReport(text).tradelines[0].creditor, 'Northwind Card');
});

test('png and webp use the same photo path', async () => {
  for (const name of ['desk.png', 'desk.webp']) {
    const text = await readIntakeFile(fileLike(name, '', new Uint8Array([1])), {
      ocrImage: async () => LABELED,
    });
    assert.match(text, /CREDITOR: Northwind Card/);
  }
});

test('an unreadable photo or scan says to paste or type the accounts', async () => {
  await assert.rejects(
    () => readIntakeFile(fileLike('blur.jpg', 'image/jpeg', new Uint8Array([1])), {
      ocrImage: async () => '???',
    }),
    /paste the text, or type the accounts/i,
  );
  await assert.rejects(
    () => readIntakeFile(fileLike('empty.pdf', 'application/pdf', new Uint8Array([1])), {
      extractPdfText: async () => '',
      ocrPdf: async () => 'no words here',
    }),
    /paste the text or type the accounts/i,
  );
  await assert.rejects(
    () => readIntakeFile(fileLike('sheet.docx', '', new Uint8Array([1])), {}),
    /not a PDF or a photo/i,
  );
});

test('a HEIC failure keeps its own message', async () => {
  const error = Object.assign(new Error('Save it as a JPG and try again, or paste the text.'), { userMessage: true });
  await assert.rejects(
    () => readIntakeFile(fileLike('phone.heic', 'image/heic', new Uint8Array([1])), {
      ocrImage: async () => {
        throw error;
      },
    }),
    /Save it as a JPG/,
  );
});
